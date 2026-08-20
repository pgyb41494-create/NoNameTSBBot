const { getLeaderboardConfig, getLeaderboardConfigAsync, updateLeaderboardConfig, ensureSlots } = require("./config");
const { publishLeaderboard } = require("../../boardPublish");
const { getOrCreateNamedChannel } = require("../shared/channelReuse");
const { resolveMaybe } = require("../../../utils/resolveMaybe");

const MAX_TOP = 50;

function getPageRanges(total) {
  const n = Math.max(1, Math.min(MAX_TOP, Number(total) || 10));
  const ranges = [];
  for (let start = 1; start <= n; start += 10) {
    ranges.push({ start, end: Math.min(start + 9, n) });
  }
  return ranges;
}

function sanitizeSuffix(suffix) {
  return String(suffix || "default")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "default";
}

function pageChannelName(start, end, suffix) {
  const safe = sanitizeSuffix(suffix);
  if (safe === "default") return `top-${start}-${end}`;
  return `top-${start}-${end}-${safe}`;
}

function pageChannelNames(start, end, suffix) {
  const safe = sanitizeSuffix(suffix);
  const base = `top-${start}-${end}`;
  return safe === "default" ? [base, `${base}-default`] : [`${base}-${safe}`, base];
}

async function getOrCreatePageChannel(guild, start, end, cfg, existingPage = null, { create = true } = {}) {
  const names = pageChannelNames(start, end, cfg.suffix);
  const pageIndex = Math.floor((start - 1) / 10);
  const storedId = existingPage?.channelId
    || (start === 1 ? cfg.leaderboardChannelId || cfg.publicChannelId : null)
    || cfg.publicChannelIds?.[pageIndex]
    || null;

  return getOrCreateNamedChannel(guild, {
    channelId: storedId,
    names,
    pattern: new RegExp(`^top-${start}-${end}(?:-[a-z0-9_-]+)?$`),
    createName: pageChannelName(start, end, cfg.suffix),
    topic: `Top ${start}–${end}`,
    reason: "TSB top leaderboard page",
    create,
  });
}

async function upsertLeaderboard(guild, { createChannels = true } = {}) {
  const cfg = await getLeaderboardConfigAsync(guild.id);
  if (!createChannels && !cfg.setupCompleted && !(cfg.publicChannelIds || []).length) {
    return { skipped: true, boardPages: [], channelId: null, messageIds: {} };
  }
  const total = Math.max(1, Math.min(MAX_TOP, cfg.topPerChannel || cfg.slotCount || 10));
  await resolveMaybe(ensureSlots(guild.id, total));
  const ranges = getPageRanges(total);
  const previousPages = cfg.boardPages || [];
  const boardPages = [];
  const publicChannelIds = [];

  const used = new Set();
  for (const range of ranges) {
    const prior = previousPages.find((p) => p.start === range.start && p.end === range.end);
    const channel = await getOrCreatePageChannel(guild, range.start, range.end, cfg, prior, {
      create: createChannels,
    });
    if (!channel || used.has(channel.id)) continue;
    used.add(channel.id);
    publicChannelIds.push(channel.id);
    boardPages.push({ start: range.start, end: range.end, channelId: channel.id });
  }

  if (!publicChannelIds.length) {
    return { skipped: true, boardPages: [], channelId: null, messageIds: {} };
  }

  await resolveMaybe(
    updateLeaderboardConfig(guild.id, {
      publicChannelIds,
      boardPages,
      leaderboardChannelId: publicChannelIds[0] || null,
      slotCount: total,
      topPerChannel: total,
      setupCompleted: true,
    })
  );

  await publishLeaderboard(guild);
  const latest = await getLeaderboardConfigAsync(guild.id);
  return {
    channelId: publicChannelIds[0] || null,
    boardPages,
    messageIds: latest.messageIds || {},
    edited: true,
  };
}

async function refreshLeaderboard(guild) {
  const cfg = await getLeaderboardConfigAsync(guild.id);
  const hasChannels = (cfg.publicChannelIds || []).length || cfg.publicChannelId || cfg.leaderboardChannelId;
  if (!cfg.setupCompleted && !hasChannels) {
    return { skipped: true, boardPages: [], channelId: null, messageIds: {} };
  }
  await publishLeaderboard(guild);
  return {
    channelId: cfg.leaderboardChannelId || cfg.publicChannelIds?.[0] || null,
    boardPages: cfg.boardPages || [],
    messageIds: cfg.messageIds || {},
    edited: true,
  };
}

module.exports = {
  MAX_TOP,
  getPageRanges,
  pageChannelName,
  upsertLeaderboard,
  refreshLeaderboard,
  publishLeaderboard: upsertLeaderboard,
};
