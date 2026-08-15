const api = require("../../../utils/loadApi");

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
};
