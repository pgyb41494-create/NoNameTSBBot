const api = require("../../../utils/loadApi");
const { resolveMaybe } = require("../../../utils/resolveMaybe");

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

function normalizeSettings(raw) {
  const tryouts = raw && typeof raw === "object" ? raw : {};
  return {
    ...defaultSettings(),
    ...tryouts,
    channelId: String(tryouts.channelId || ""),
    pingRoleId: String(tryouts.pingRoleId || ""),
    defaultRequiredSignups: Math.max(0, Number(tryouts.defaultRequiredSignups) || 0),
    defaultMaxSignups: Math.max(0, Number(tryouts.defaultMaxSignups) || 0),
    configured: Boolean(tryouts.channelId),
    sessions: tryouts.sessions && typeof tryouts.sessions === "object" ? tryouts.sessions : {},
  };
}

async function getTryoutSettings(guildId) {
  if (typeof api.tryouts?.getSettings === "function") {
    return normalizeSettings(await resolveMaybe(api.tryouts.getSettings(guildId)));
  }
  const cfg = (await resolveMaybe(api.guilds?.getGuild?.(guildId))) || {};
  const tryouts = cfg.tryouts || cfg.settings?.tryouts || {};
  return normalizeSettings(tryouts);
}

async function patchTryoutSettings(guildId, patch) {
  if (typeof api.tryouts?.patchSettings === "function") {
    return normalizeSettings(
      await resolveMaybe(api.tryouts.patchSettings(guildId, patch))
    );
  }
  const current = await getTryoutSettings(guildId);
  const next = normalizeSettings({
    ...current,
    ...patch,
    channelId: patch.channelId !== undefined ? patch.channelId : current.channelId,
  });
  if (typeof api.tryouts?.updateSettings === "function") {
    await resolveMaybe(api.tryouts.updateSettings(guildId, next));
  } else if (typeof api.guilds?.updateGuild === "function") {
    await resolveMaybe(api.guilds.updateGuild(guildId, { tryouts: next }));
  }
  return next;
}

module.exports = {
  getTryoutSettings,
  patchTryoutSettings,
};
