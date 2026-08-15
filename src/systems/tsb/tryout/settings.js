const api = require("../../../utils/loadApi");

function defaultSettings() {
  return {
    channelId: "",
    pingRoleId: "",
    defaultRequiredSignups: 0,
    defaultMaxSignups: 0,
    configured: false,
    sessions: {},
  };
}

function getTryoutSettings(guildId) {
  if (typeof api.tryouts?.getSettings === "function") {
    return api.tryouts.getSettings(guildId);
  }
  const cfg = api.guilds?.getGuild?.(guildId) || {};
  const tryouts = cfg.tryouts || cfg.settings?.tryouts || defaultSettings();
  return {
    ...defaultSettings(),
    ...tryouts,
    configured: Boolean(tryouts.channelId),
  };
}

function patchTryoutSettings(guildId, patch) {
  if (typeof api.tryouts?.patchSettings === "function") {
    return api.tryouts.patchSettings(guildId, patch);
  }
  const current = getTryoutSettings(guildId);
  const next = { ...current, ...patch, configured: Boolean((patch.channelId ?? current.channelId)) };
  if (typeof api.tryouts?.updateSettings === "function") {
    return api.tryouts.updateSettings(guildId, next);
  }
  if (typeof api.guilds?.updateGuild === "function") {
    api.guilds.updateGuild(guildId, { tryouts: next });
  }
  return next;
}

module.exports = {
  getTryoutSettings,
  patchTryoutSettings,
};
