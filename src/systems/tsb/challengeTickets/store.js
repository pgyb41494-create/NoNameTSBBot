const { createJsonStore } = require("../../../../api/store/jsonStore");

const store = createJsonStore("challenge-tickets.json", {});

const TERMINAL_TICKET_STATUSES = new Set(["closed", "done", "cancelled", "expired", "posted", "declined"]);

function defaultGuild() {
  return { tickets: {}, pending: {} };
}

function isActiveTicketStatus(status) {
  if (status == null || status === "") return true;
  return !TERMINAL_TICKET_STATUSES.has(String(status).toLowerCase());
}

function getState(guildId) {
  const db = store.load();
  const current = db[String(guildId)] || {};
  return {
    ...defaultGuild(),
    ...current,
    tickets: current.tickets || {},
    pending: current.pending || {},
  };
}

function updateState(guildId, patch) {
  let next = null;
  store.updateSync((db) => {
    const current = getState(guildId);
    next = { ...current, ...patch };
    if (patch.tickets) next.tickets = patch.tickets;
    if (patch.pending) next.pending = patch.pending;
    db[String(guildId)] = next;
    return db;
  });
  return next;
}

function setTicket(guildId, channelId, data) {
  const state = getState(guildId);
  const tickets = { ...state.tickets };
  if (!data) delete tickets[String(channelId)];
  else tickets[String(channelId)] = { ...(tickets[String(channelId)] || {}), ...data };
  return updateState(guildId, { tickets });
}

function getTicket(guildId, channelId) {
  return getState(guildId).tickets[String(channelId)] || null;
}

function setPending(guildId, userId, data) {
  const state = getState(guildId);
  const pending = { ...state.pending };
  if (!data) delete pending[String(userId)];
  else pending[String(userId)] = { ...(pending[String(userId)] || {}), ...data };
  return updateState(guildId, { pending });
}

function findOpenTicket(guildId, userId) {
  const state = getState(guildId);
  const uid = String(userId);
  const pending = state.pending[uid];
  if (pending?.ticketChannelId && isActiveTicketStatus(pending.status)) return pending;
  for (const [channelId, ticket] of Object.entries(state.tickets)) {
    if (String(ticket.userId) === uid && isActiveTicketStatus(ticket.status)) {
      return { ...ticket, ticketChannelId: channelId };
    }
  }
  return null;
}

async function ensureNoStaleOpenTicket(guild, userId) {
  const guildId = guild.id;
  const uid = String(userId);
  let state = getState(guildId);

  const pending = state.pending[uid];
  if (pending) {
    let removePending = false;
    if (!isActiveTicketStatus(pending.status)) {
      removePending = true;
    } else if (!pending.ticketChannelId) {
      removePending = true;
    } else {
      const ch = await guild.channels.fetch(pending.ticketChannelId).catch(() => null);
      if (!ch) {
        removePending = true;
        setTicket(guildId, pending.ticketChannelId, null);
      }
    }
    if (removePending) setPending(guildId, uid, null);
  }

  state = getState(guildId);
  for (const [channelId, ticket] of Object.entries(state.tickets)) {
    if (String(ticket.userId) !== uid) continue;
    if (!isActiveTicketStatus(ticket.status)) continue;
    const ch = await guild.channels.fetch(channelId).catch(() => null);
    if (!ch) setTicket(guildId, channelId, null);
  }

  return findOpenTicket(guildId, userId);
}

module.exports = {
  getState,
  setTicket,
  getTicket,
  setPending,
  findOpenTicket,
  ensureNoStaleOpenTicket,
  isActiveTicketStatus,
};
