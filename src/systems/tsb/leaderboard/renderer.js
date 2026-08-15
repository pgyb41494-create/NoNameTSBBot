const { ChannelType } = require("discord.js");
const { getLeaderboardConfig, updateLeaderboardConfig, ensureSlots } = require("./config");
const { publishLeaderboard } = require("../../boardPublish");

const MAX_TOP = 50;

function getPageRanges(total) {
  const n = Math.max(1, Math.min(MAX_TOP, Number(total) || 10));
  const ranges = [];
  for (let start = 1; start <= n; start += 10) {
    ranges.push({ start, end: Math.min(start + 9, n) });
  }
  return ranges;
}

function pageChannelName(start, end, suffix) {
  const safe = String(suffix || "default")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "default";
  return `top-${start}-${end}-${safe}`;
}

async function getOrCreatePageChannel(guild, start, end, cfg, existingPage = null, { create = true } = {}) {
  const name = pageChannelName(start, end, cfg.suffix);
  if (existingPage?.channelId) {
    const existing = await guild.channels.fetch(existingPage.channelId).catch(() => null);
    if (existing?.isTextBased?.()) return existing;
  }
  if (!create) return null;
  const byName = guild.channels.cache.find((c) => c.name === name && c.isTextBased?.());
  if (byName) return byName;
  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    topic: `Top ${start}–${end} · ${cfg.suffix || "default"}`,
    reason: "TSB top leaderboard page",
  });
}

async function upsertLeaderboard(guild, { createChannels = true } = {}) {
  const cfg = getLeaderboardConfig(guild.id);
  if (!createChannels && !cfg.setupCompleted && !(cfg.publicChannelIds || []).length) {
    return { skipped: true, boardPages: [], channelId: null, messageIds: {} };
  }
  const total = Math.max(1, Math.min(MAX_TOP, cfg.topPerChannel || cfg.slotCount || 10));
  ensureSlots(guild.id, total);
  const ranges = getPageRanges(total);
  const previousPages = cfg.boardPages || [];
  const boardPages = [];
  const publicChannelIds = [];

  for (const range of ranges) {
    const prior = previousPages.find((p) => p.start === range.start && p.end === range.end);
    const channel = await getOrCreatePageChannel(guild, range.start, range.end, cfg, prior, {
      create: createChannels,
    });
    if (!channel) continue;
    publicChannelIds.push(channel.id);
    boardPages.push({ start: range.start, end: range.end, channelId: channel.id });
  }

  if (!publicChannelIds.length) {
    return { skipped: true, boardPages: [], channelId: null, messageIds: {} };
  }

  updateLeaderboardConfig(guild.id, {
    publicChannelIds,
    boardPages,
    leaderboardChannelId: publicChannelIds[0] || null,
    slotCount: total,
    topPerChannel: total,
    setupCompleted: true,
  });

  await publishLeaderboard(guild);
  return {
    channelId: publicChannelIds[0] || null,
    boardPages,
    messageIds: getLeaderboardConfig(guild.id).messageIds || {},
    edited: true,
  };
}

async function refreshLeaderboard(guild) {
  const cfg = getLeaderboardConfig(guild.id);
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
