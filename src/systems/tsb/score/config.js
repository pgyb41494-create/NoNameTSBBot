const api = require("../../../utils/loadApi");

function defaultConfig() {
  return api.score.defaultConfig ? api.score.defaultConfig() : {
    setupCompleted: false,
    winnerCooldownDays: 4,
    loserCooldownDays: 7,
    autowinEnabled: true,
    autowinThreshold: 3,
    autowinSuccessBehavior: "reset",
    pvpUpdatesRoleId: null,
    allowedRoleIds: [],
    playerState: {},
    matches: [],
  };
}

function getScoreConfig(guildId) {
  const cfg = api.score.getConfig(guildId);
  if (cfg.winnerCooldownDays == null) cfg.winnerCooldownDays = 4;
  if (cfg.loserCooldownDays == null) cfg.loserCooldownDays = 7;
  if (cfg.autowinEnabled == null) cfg.autowinEnabled = true;
  if (cfg.autowinThreshold == null) cfg.autowinThreshold = 3;
  if (!cfg.autowinSuccessBehavior) cfg.autowinSuccessBehavior = "reset";
  if (!cfg.allowedRoleIds) cfg.allowedRoleIds = [];
  if (!cfg.playerState) cfg.playerState = {};
  return cfg;
}

function setScoreConfig(guildId, config) {
  return api.score.updateConfig(guildId, { ...getScoreConfig(guildId), ...config, setupCompleted: true });
}

function updateScoreConfig(guildId, patch) {
  return api.score.updateConfig(guildId, { ...getScoreConfig(guildId), ...patch });
}

function resetScoreConfig(guildId) {
  if (typeof api.score.resetConfig === "function") return api.score.resetConfig(guildId);
  return api.score.updateConfig(guildId, defaultConfig());
}

function getPlayerState(guildId, userId) {
  if (typeof api.score.getPlayerState === "function") return api.score.getPlayerState(guildId, userId);
  const cfg = getScoreConfig(guildId);
  return cfg.playerState?.[String(userId)] || {
    lastMatchAt: null,
    lastResult: null,
    cooldownUntil: null,
    autowinStrikes: 0,
  };
}

function setPlayerState(guildId, userId, patch) {
  if (typeof api.score.setPlayerState === "function") return api.score.setPlayerState(guildId, userId, patch);
  const cfg = getScoreConfig(guildId);
  const id = String(userId);
  const playerState = { ...(cfg.playerState || {}) };
  playerState[id] = {
    lastMatchAt: null,
    lastResult: null,
    cooldownUntil: null,
    autowinStrikes: 0,
    ...(playerState[id] || {}),
    ...patch,
  };
  return updateScoreConfig(guildId, { playerState });
}

function pushMatch(guildId, match) {
  if (typeof api.score.pushMatch === "function") return api.score.pushMatch(guildId, match);
  const cfg = getScoreConfig(guildId);
  const matches = [match, ...(cfg.matches || [])].slice(0, 100);
  return updateScoreConfig(guildId, { matches });
}

module.exports = {
  defaultConfig,
  getScoreConfig,
  setScoreConfig,
  updateScoreConfig,
  resetScoreConfig,
  getPlayerState,
  setPlayerState,
  pushMatch,
};
