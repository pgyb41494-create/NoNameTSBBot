const { createJsonStore } = require("../../../../api/store/jsonStore");

const store = createJsonStore("verify.json", {});

function defaultGuild() {
  return {
    categoryId: "",
    staffRoleId: "",
    verifiedRoleId: "",
    panelChannelId: "",
    setupCompleted: false,
    pending: {},
    tickets: {},
  };
}

function getConfig(guildId) {
  const db = store.load();
  const current = db[String(guildId)] || {};
  return { ...defaultGuild(), ...current, pending: current.pending || {}, tickets: current.tickets || {} };
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
};
