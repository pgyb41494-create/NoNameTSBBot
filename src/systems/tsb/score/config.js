const api = require("../../../utils/loadApi");
const { resolveMaybe } = require("../../../utils/resolveMaybe");

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

async function getScoreConfig(guildId) {
  const cfg = await resolveMaybe(api.score.getConfig(guildId));
  const next = cfg && typeof cfg === "object" ? { ...cfg } : {};
  if (next.winnerCooldownDays == null) next.winnerCooldownDays = 4;
  if (next.loserCooldownDays == null) next.loserCooldownDays = 7;
  if (next.autowinEnabled == null) next.autowinEnabled = true;
  if (next.autowinThreshold == null) next.autowinThreshold = 3;
  if (!next.autowinSuccessBehavior) next.autowinSuccessBehavior = "reset";
  if (!next.allowedRoleIds) next.allowedRoleIds = [];
  if (!next.playerState) next.playerState = {};
  return next;
}

async function setScoreConfig(guildId, config) {
  const current = await getScoreConfig(guildId);
  return resolveMaybe(api.score.updateConfig(guildId, { ...current, ...config, setupCompleted: true }));
}

async function updateScoreConfig(guildId, patch) {
  const current = await getScoreConfig(guildId);
  return resolveMaybe(api.score.updateConfig(guildId, { ...current, ...patch }));
}

function resetScoreConfig(guildId) {
  if (typeof api.score.resetConfig === "function") return api.score.resetConfig(guildId);
  return api.score.updateConfig(guildId, defaultConfig());
}

async function getPlayerState(guildId, userId) {
  if (typeof api.score.getPlayerState === "function") {
    return resolveMaybe(api.score.getPlayerState(guildId, userId));
  }
  const cfg = await getScoreConfig(guildId);
  return cfg.playerState?.[String(userId)] || {
    lastMatchAt: null,
    lastResult: null,
    cooldownUntil: null,
    autowinStrikes: 0,
  };
}

async function setPlayerState(guildId, userId, patch) {
  if (typeof api.score.setPlayerState === "function") {
    return resolveMaybe(api.score.setPlayerState(guildId, userId, patch));
  }
  const cfg = await getScoreConfig(guildId);
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

async function pushMatch(guildId, match) {
  if (typeof api.score.pushMatch === "function") {
    return resolveMaybe(api.score.pushMatch(guildId, match));
  }
  const cfg = await getScoreConfig(guildId);
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
