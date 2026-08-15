const { PermissionFlagsBits } = require("discord.js");
const api = require("../../../utils/loadApi");

function normalizeCommandName(value) {
  return api.ranking.normalizeCommandName
    ? api.ranking.normalizeCommandName(value)
    : String(value || "stage").replace(/^[-/>!.]+/, "").trim().toLowerCase() || "stage";
}

function defaultGuildConfig() {
  return api.ranking.defaultConfig ? api.ranking.defaultConfig() : {};
}

function getGuildConfig(guildId) {
  return api.ranking.getConfig(guildId);
}

function setGuildConfig(guildId, config) {
  if (typeof api.ranking.setConfig === "function") {
    return api.ranking.setConfig(guildId, config);
  }
  return api.ranking.updateConfig(guildId, { ...config, setupCompleted: true });
}

function updateGuildConfig(guildId, patch) {
  return api.ranking.updateConfig(guildId, patch);
}

function resetGuildConfig(guildId) {
  if (typeof api.ranking.resetConfig === "function") {
    return api.ranking.resetConfig(guildId);
  }
  return api.ranking.updateConfig(guildId, defaultGuildConfig());
}

function isSetupCompleted(guildId) {
  return !!getGuildConfig(guildId).setupCompleted;
}

function getSafeGuildConfig(guildOrId) {
  const guildId = typeof guildOrId === "string" ? guildOrId : guildOrId?.id;
  if (!guildId || !isSetupCompleted(guildId)) return null;
  return getGuildConfig(guildId);
}

function formatRankPart(part) {
  if (!part) return part;
  return String(part)
    .replace(/\b(Stage|Tier|Phase)\s*(\d+)\b/gi, (_, word, num) => {
      const pretty = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      return `${pretty} ${num}`;
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

function canUseRanking(member, guild, cfg = null) {
  if (!member || !guild) return false;
  if (guild.ownerId === member.id) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const config = cfg || getGuildConfig(guild.id);
  const allowed = config.authorizedRoles || config.authorizedRoleIds || [];
  if (!allowed.length) return false;
  return allowed.some((id) => member.roles.cache.has(id));
}

module.exports = {
  getGuildConfig,
  getRankingConfig: getGuildConfig,
  getSafeGuildConfig,
  setGuildConfig,
  setRankingConfig: setGuildConfig,
  updateGuildConfig,
  resetGuildConfig,
  isSetupCompleted,
  formatRankPart,
  canUseRanking,
  normalizeCommandName,
  defaultGuildConfig,
};
