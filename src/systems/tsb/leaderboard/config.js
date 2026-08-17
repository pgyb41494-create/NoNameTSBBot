const api = require("../../../utils/loadApi");

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

function getLeaderboardConfig(guildId) {
  const cfg = api.leaderboard.getConfig(guildId);
  if (!cfg.topPerChannel) cfg.topPerChannel = cfg.slotCount || 10;
  if (cfg.suffix == null) cfg.suffix = "default";
  if (!cfg.rankLabel) cfg.rankLabel = "Phase";
  if (!cfg.allowedRoles) cfg.allowedRoles = [];
  if (!cfg.rankRequirements) cfg.rankRequirements = [];
  if (!cfg.boardPages) cfg.boardPages = [];
  cfg.challengeTickets = challengeTicketsOf(cfg);
  return cfg;
}

function setLeaderboardConfig(guildId, config) {
  const current = getLeaderboardConfig(guildId);
  const top = config.topPerChannel || config.slotCount || current.topPerChannel || 10;
  return api.leaderboard.updateConfig(guildId, {
    ...current,
    ...config,
    setupCompleted: true,
    slotCount: top,
    topPerChannel: top,
  });
}

function updateLeaderboardConfig(guildId, patch) {
  const current = getLeaderboardConfig(guildId);
  if (patch.topPerChannel && !patch.slotCount) patch = { ...patch, slotCount: patch.topPerChannel };
  if (patch.slotCount && !patch.topPerChannel) patch = { ...patch, topPerChannel: patch.slotCount };
  if (patch.challengeTickets) {
    patch = {
      ...patch,
      challengeTickets: challengeTicketsOf({ challengeTickets: { ...current.challengeTickets, ...patch.challengeTickets } }),
    };
  }
  return api.leaderboard.updateConfig(guildId, { ...current, ...patch });
}

function ensureSlots(guildId, count) {
  return api.leaderboard.ensureSlots(guildId, count);
}

module.exports = {
  getLeaderboardConfig,
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
