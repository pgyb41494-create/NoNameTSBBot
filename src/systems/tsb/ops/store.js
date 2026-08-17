const { createJsonStore } = require("../../../../api/store/jsonStore");

const store = createJsonStore("guild-ops.json", {});

const DEFAULT_INVITE_MESSAGE =
  "{userinvited} was invited by {user} and now has {invites} invites.";

function defaultGuild() {
  return {
    auditChannelId: "",
    invites: {
      enabled: false,
      channelId: "",
      message: DEFAULT_INVITE_MESSAGE,
      joins: {},
    },
  };
}

function safeText(value, max) {
  return String(value || "").slice(0, max);
}

function getConfig(guildId) {
  const db = store.load();
  const current = db[String(guildId)] || {};
  const defaults = defaultGuild();
  return {
    ...defaults,
    ...current,
    invites: {
      ...defaults.invites,
      ...(current.invites || {}),
      joins: (current.invites && current.invites.joins) || {},
    },
  };
}

function updateConfig(guildId, patch) {
  let next = null;
  store.updateSync((db) => {
    const current = getConfig(guildId);
    next = { ...current, ...patch };
    if (patch.invites) {
      next.invites = {
        ...current.invites,
        ...patch.invites,
        joins: patch.invites.joins || current.invites.joins,
      };
    }
    db[String(guildId)] = next;
    return db;
  });
  return next;
}

function publicAudit(guildId) {
  const cfg = getConfig(guildId);
  return { channelId: cfg.auditChannelId || "" };
}

function publicInvites(guildId) {
  const cfg = getConfig(guildId);
  return {
    enabled: !!cfg.invites.enabled,
    channelId: cfg.invites.channelId || "",
    message: cfg.invites.message || DEFAULT_INVITE_MESSAGE,
  };
}

function applyAuditPatch(guildId, body = {}) {
  const channelId = String(body.channelId || "").replace(/\D/g, "").slice(0, 22);
  updateConfig(guildId, { auditChannelId: channelId });
  return publicAudit(guildId);
}

function applyInvitesPatch(guildId, body = {}) {
  const current = getConfig(guildId).invites;
  const next = {
    enabled: body.enabled != null ? !!body.enabled : current.enabled,
    channelId:
      body.channelId != null
        ? String(body.channelId || "").replace(/\D/g, "").slice(0, 22)
        : current.channelId,
    message: body.message != null ? safeText(body.message, 1800) || DEFAULT_INVITE_MESSAGE : current.message,
  };
  updateConfig(guildId, { invites: next });
  return publicInvites(guildId);
}

function setJoin(guildId, userId, data) {
  const cfg = getConfig(guildId);
  const joins = { ...cfg.invites.joins };
  if (!data) delete joins[String(userId)];
  else joins[String(userId)] = { ...(joins[String(userId)] || {}), ...data };
  updateConfig(guildId, { invites: { joins } });
}

function getJoin(guildId, userId) {
  return getConfig(guildId).invites.joins[String(userId)] || null;
}

function inviteCount(guildId, inviterId) {
  const joins = getConfig(guildId).invites.joins;
  return Object.values(joins).filter((row) => String(row.inviterId) === String(inviterId) && !row.fake).length;
}

module.exports = {
  DEFAULT_INVITE_MESSAGE,
  getConfig,
  updateConfig,
  publicAudit,
  publicInvites,
  applyAuditPatch,
  applyInvitesPatch,
  setJoin,
  getJoin,
  inviteCount,
};
