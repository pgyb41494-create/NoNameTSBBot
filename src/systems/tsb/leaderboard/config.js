const api = require("../../../utils/loadApi");
const { resolveMaybe } = require("../../../utils/resolveMaybe");

function defaultChallengeTickets() {
  return {
    enabled: false,
    channelId: "",
    categoryId: "",
    panelMessageId: "",
    spotsAhead: 3,
    ranges: [],
  };
}

function parseChallengeRanges(raw) {
  return String(raw || "")
    .split(",")
    .map((part) => {
      const m = String(part || "").trim().match(/^(\d+)\s*-\s*(\d+)\s*:\s*(\d+)$/);
      if (!m) return null;
      const from = Number(m[1]);
      const to = Number(m[2]);
      const spots = Math.max(1, Math.min(15, Number(m[3])));
      if (!from || !to || !spots) return null;
      return { from, to, spots };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function challengeTicketsOf(cfg = {}) {
  const raw = cfg.challengeTickets && typeof cfg.challengeTickets === "object" ? cfg.challengeTickets : {};
  const spotsAhead = Math.max(1, Math.min(15, Number(raw.spotsAhead) || 3));
  return {
    ...defaultChallengeTickets(),
    ...raw,
    enabled: !!raw.enabled,
    channelId: String(raw.channelId || ""),
    categoryId: String(raw.categoryId || ""),
    panelMessageId: String(raw.panelMessageId || ""),
    spotsAhead,
    ranges: Array.isArray(raw.ranges) ? raw.ranges.filter((r) => r && r.from && r.to && r.spots) : [],
  };
}

function spotsAheadFor(position, tickets) {
  const pos = Number(position);
  for (const range of tickets?.ranges || []) {
    const a = Math.min(Number(range.from), Number(range.to));
    const b = Math.max(Number(range.from), Number(range.to));
    if (pos >= a && pos <= b) return Math.max(1, Math.min(15, Number(range.spots) || tickets.spotsAhead || 3));
  }
  return Math.max(1, Math.min(15, Number(tickets?.spotsAhead) || 3));
}

function formatChallengeRules(tickets) {
  const cfg = challengeTicketsOf({ challengeTickets: tickets });
  if (!cfg.ranges.length) return `up to **${cfg.spotsAhead}** spots ahead of you`;
  const ranges = cfg.ranges.map((r) => `#${r.from}–#${r.to}: ${r.spots}`).join(", ");
  return `${ranges} · default **${cfg.spotsAhead}** spots ahead`;
}

function defaultConfig(guildId) {
  return api.leaderboard.defaultConfig
    ? api.leaderboard.defaultConfig(guildId)
    : api.leaderboard.getConfig(guildId);
}

function normalizeLeaderboardConfig(cfg) {
  if (!cfg.topPerChannel) cfg.topPerChannel = cfg.slotCount || 10;
  if (cfg.suffix == null) cfg.suffix = "default";
  if (!cfg.rankLabel) cfg.rankLabel = "Phase";
  if (!cfg.allowedRoles) cfg.allowedRoles = [];
  if (!cfg.rankRequirements) cfg.rankRequirements = [];
  if (!cfg.boardPages) cfg.boardPages = [];
  cfg.challengeTickets = challengeTicketsOf(cfg);
  return cfg;
}

async function getLeaderboardConfig(guildId) {
  const cfg = await resolveMaybe(api.leaderboard.getConfig(guildId));
  return normalizeLeaderboardConfig(cfg && typeof cfg === "object" ? { ...cfg } : {});
}

async function getLeaderboardConfigAsync(guildId) {
  return getLeaderboardConfig(guildId);
}

async function setLeaderboardConfig(guildId, config) {
  const current = await getLeaderboardConfig(guildId);
  const top = config.topPerChannel || config.slotCount || current.topPerChannel || 10;
  return resolveMaybe(api.leaderboard.updateConfig(guildId, {
    ...current,
    ...config,
    setupCompleted: true,
    slotCount: top,
    topPerChannel: top,
  }));
}

async function updateLeaderboardConfig(guildId, patch) {
  const current = await getLeaderboardConfig(guildId);
  let nextPatch = { ...patch };
  if (nextPatch.topPerChannel && !nextPatch.slotCount) nextPatch = { ...nextPatch, slotCount: nextPatch.topPerChannel };
  if (nextPatch.slotCount && !nextPatch.topPerChannel) nextPatch = { ...nextPatch, topPerChannel: nextPatch.slotCount };
  if (nextPatch.challengeTickets) {
    nextPatch = {
      ...nextPatch,
      challengeTickets: challengeTicketsOf({ challengeTickets: { ...current.challengeTickets, ...nextPatch.challengeTickets } }),
    };
  }
  return resolveMaybe(api.leaderboard.updateConfig(guildId, { ...current, ...nextPatch }));
}

async function ensureSlots(guildId, count) {
  if (typeof api.leaderboard.ensureSlots === "function") {
    return resolveMaybe(api.leaderboard.ensureSlots(guildId, count));
  }
  const cfg = await getLeaderboardConfig(guildId);
  const n = Math.max(1, Math.min(50, count || cfg.slotCount || cfg.topPerChannel || 10));
  const slots = [...(cfg.slots || [])];
  while (slots.length < n) slots.push({ position: slots.length + 1, discordId: null });
  const next = slots.slice(0, n).map((s, i) => ({ position: i + 1, discordId: s.discordId || null }));
  return updateLeaderboardConfig(guildId, { slots: next, slotCount: n, topPerChannel: n });
}

module.exports = {
  getLeaderboardConfig,
  getLeaderboardConfigAsync,
  normalizeLeaderboardConfig,
  setLeaderboardConfig,
  updateLeaderboardConfig,
  ensureSlots,
  defaultConfig,
  defaultChallengeTickets,
  parseChallengeRanges,
  challengeTicketsOf,
  spotsAheadFor,
  formatChallengeRules,
};
