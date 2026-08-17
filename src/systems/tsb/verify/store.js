const { createJsonStore } = require("../../../../api/store/jsonStore");

const store = createJsonStore("verify.json", {});

function safeUrl(value) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw.slice(0, 500);
}

function safeText(value, max) {
  return String(value || "").slice(0, max);
}

function defaultPanel() {
  const p = "'";
  return {
    title: "Verification",
    description:
      "Click **Start verification** and I’ll DM you `/profile`.\n\n" +
      "Finish it in DMs and a private ticket opens for staff.\n\n" +
      `You can also run \`${p}profile\` / \`/profile\` in the server.`,
    footer: "",
    footerIcon: "",
    thumbnail: "",
    image: "",
    color: "",
    button: "Start verification",
  };
}

function defaultTicket() {
  return {
    title: "Verification ticket",
    description: "{mention} finished `/profile`.\n\nStaff: check the profile, then **Approve** or **Deny**.",
    footer: "",
    footerIcon: "",
    thumbnail: "",
    image: "",
    color: "",
  };
}

function normalizeEmbed(value, fallback, { button } = {}) {
  const src = value && typeof value === "object" ? value : {};
  const next = {
    title: safeText(src.title != null ? src.title : fallback.title, 256),
    description: safeText(src.description != null ? src.description : fallback.description, 4000),
    footer: safeText(src.footer, 2048),
    footerIcon: safeUrl(src.footerIcon),
    thumbnail: safeUrl(src.thumbnail),
    image: safeUrl(src.image || src.gif),
    color: String(src.color || "").replace(/^#/, "").slice(0, 6),
  };
  if (button) next.button = safeText(src.button || fallback.button, 80) || fallback.button;
  return next;
}

function defaultGuild() {
  return {
    categoryId: "",
    staffRoleId: "",
    verifiedRoleId: "",
    panelChannelId: "",
    panelMessageId: "",
    setupCompleted: false,
    pending: {},
    tickets: {},
    panel: defaultPanel(),
    ticket: defaultTicket(),
    pingRoleIds: [],
    approve: {
      addRoleIds: [],
      removeRoleIds: [],
      nickname: "",
      dmMessage: "",
      closeTicket: false,
    },
    deny: {
      mode: "close",
      dmMessage: "",
    },
  };
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id || "").trim()).filter((id) => /^\d{10,22}$/.test(id)))];
}

function getConfig(guildId) {
  const db = store.load();
  const current = db[String(guildId)] || {};
  const defaults = defaultGuild();
  return {
    ...defaults,
    ...current,
    pending: current.pending || {},
    tickets: current.tickets || {},
    panel: normalizeEmbed(current.panel, defaults.panel, { button: true }),
    ticket: normalizeEmbed(current.ticket, defaults.ticket),
    pingRoleIds: normalizeIdList(current.pingRoleIds),
    approve: { ...defaults.approve, ...(current.approve || {}) },
    deny: { ...defaults.deny, ...(current.deny || {}) },
  };
}

function pingRoleIdsOf(cfg) {
  const ids = normalizeIdList(cfg.pingRoleIds);
  if (cfg.staffRoleId && !ids.includes(String(cfg.staffRoleId))) ids.push(String(cfg.staffRoleId));
  return ids;
}

function publicConfig(guildId) {
  const cfg = getConfig(guildId);
  const addRoleIds = normalizeIdList(cfg.approve?.addRoleIds);
  if (cfg.verifiedRoleId && !addRoleIds.includes(String(cfg.verifiedRoleId))) {
    addRoleIds.unshift(String(cfg.verifiedRoleId));
  }
  const pingRoleIds = pingRoleIdsOf(cfg);
  return {
    categoryId: cfg.categoryId || "",
    staffRoleId: cfg.staffRoleId || pingRoleIds[0] || "",
    pingRoleIds,
    verifiedRoleId: cfg.verifiedRoleId || addRoleIds[0] || "",
    panel: cfg.panel,
    ticket: cfg.ticket,
    approve: {
      addRoleIds,
      removeRoleIds: normalizeIdList(cfg.approve?.removeRoleIds),
      nickname: String(cfg.approve?.nickname || "").slice(0, 32),
      dmMessage: String(cfg.approve?.dmMessage || "").slice(0, 1000),
      closeTicket: !!cfg.approve?.closeTicket,
    },
    deny: {
      mode: cfg.deny?.mode === "private" ? "private" : "close",
      dmMessage: String(cfg.deny?.dmMessage || "").slice(0, 1000),
    },
  };
}

function applyPublicPatch(guildId, body = {}) {
  const current = publicConfig(guildId);
  const approve = { ...current.approve, ...(body.approve && typeof body.approve === "object" ? body.approve : {}) };
  const deny = { ...current.deny, ...(body.deny && typeof body.deny === "object" ? body.deny : {}) };
  approve.addRoleIds = normalizeIdList(approve.addRoleIds);
  approve.removeRoleIds = normalizeIdList(approve.removeRoleIds);
  approve.nickname = String(approve.nickname || "").slice(0, 32);
  approve.dmMessage = String(approve.dmMessage || "").slice(0, 1000);
  approve.closeTicket = !!approve.closeTicket;
  deny.mode = deny.mode === "private" ? "private" : "close";
  deny.dmMessage = String(deny.dmMessage || "").slice(0, 1000);
  const pingRoleIds = body.pingRoleIds != null ? normalizeIdList(body.pingRoleIds) : current.pingRoleIds;
  return updateConfig(guildId, {
    verifiedRoleId: approve.addRoleIds[0] || "",
    panel: normalizeEmbed(body.panel != null ? { ...current.panel, ...body.panel } : current.panel, defaultPanel(), { button: true }),
    ticket: normalizeEmbed(body.ticket != null ? { ...current.ticket, ...body.ticket } : current.ticket, defaultTicket()),
    pingRoleIds,
    staffRoleId: pingRoleIds[0] || "",
    approve,
    deny,
    setupCompleted: true,
  });
}

function updateConfig(guildId, patch) {
  let next = null;
  store.updateSync((db) => {
    const current = getConfig(guildId);
    next = { ...current, ...patch };
    if (patch.pending) next.pending = patch.pending;
    if (patch.tickets) next.tickets = patch.tickets;
    db[String(guildId)] = next;
    return db;
  });
  return next;
}

function setPending(guildId, userId, data) {
  const cfg = getConfig(guildId);
  const pending = { ...cfg.pending };
  if (!data) delete pending[String(userId)];
  else pending[String(userId)] = { ...(pending[String(userId)] || {}), ...data };
  return updateConfig(guildId, { pending });
}

function getPending(guildId, userId) {
  return getConfig(guildId).pending[String(userId)] || null;
}

function setTicket(guildId, channelId, data) {
  const cfg = getConfig(guildId);
  const tickets = { ...cfg.tickets };
  if (!data) delete tickets[String(channelId)];
  else tickets[String(channelId)] = { ...(tickets[String(channelId)] || {}), ...data };
  return updateConfig(guildId, { tickets });
}

function getTicket(guildId, channelId) {
  return getConfig(guildId).tickets[String(channelId)] || null;
}

function findOpenTicket(guildId, userId) {
  const cfg = getConfig(guildId);
  const uid = String(userId);
  const pending = cfg.pending[uid];
  if (pending?.ticketChannelId && pending.status === "ticket_open") return pending;
  for (const [channelId, ticket] of Object.entries(cfg.tickets)) {
    if (String(ticket.userId) === uid && ticket.status === "open") {
      return { ...ticket, ticketChannelId: channelId };
    }
  }
  return null;
}

module.exports = {
  getConfig,
  updateConfig,
  setPending,
  getPending,
  setTicket,
  getTicket,
  findOpenTicket,
  publicConfig,
  applyPublicPatch,
  pingRoleIdsOf,
};
