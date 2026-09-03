const { PermissionFlagsBits } = require("discord.js");
const api = require("../../../utils/loadApi");
const { hasAccessPerm } = require("../access/store");
const { resolveMaybe } = require("../../../utils/resolveMaybe");

function normalizeCommandName(value) {
  return api.ranking.normalizeCommandName
    ? api.ranking.normalizeCommandName(value)
    : (() => {
      if (value == null || value === "") return "";
      return String(value)
        .replace(/^[-/>!.]+/, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 32);
    })();
}

function defaultGuildConfig() {
  return api.ranking.defaultConfig ? api.ranking.defaultConfig() : {};
}

async function getGuildConfig(guildId) {
  const cfg = await resolveMaybe(api.ranking.getConfig(guildId));
  const next = cfg && typeof cfg === "object" ? { ...cfg } : {};
  next.commandName = normalizeCommandName(next.commandName || "stage");
  return next;
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

async function isSetupCompleted(guildId) {
  const cfg = await getGuildConfig(guildId);
  return !!cfg.setupCompleted;
}

async function getSafeGuildConfig(guildOrId) {
  const guildId = typeof guildOrId === "string" ? guildOrId : guildOrId?.id;
  if (!guildId) return null;
  const cfg = await getGuildConfig(guildId);
  if (!cfg.setupCompleted) return null;
  return cfg;
}

async function canUseRanking(member, guild, cfg = null) {
  if (!member || !guild) return false;
  if (guild.ownerId === member.id) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  if (hasAccessPerm(guild.id, member.id, "PHASE")) return true;
  const config = cfg || (await getGuildConfig(guild.id));
  const allowed = config.authorizedRoles || config.authorizedRoleIds || [];
  if (!allowed.length) return false;
  return allowed.some((id) => member.roles.cache.has(id));
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
  rankingCommandMatches,
};

async function rankingCommandMatches(guildId, invoked) {
  const want = normalizeCommandName(invoked);
  if (!want) return false;
  const cfg = await getGuildConfig(guildId);
  return normalizeCommandName(cfg.commandName) === want;
}
