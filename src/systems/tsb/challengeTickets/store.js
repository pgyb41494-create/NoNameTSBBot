const { createJsonStore } = require("../../../../api/store/jsonStore");

const store = createJsonStore("challenge-tickets.json", {});

function defaultGuild() {
  return { tickets: {}, pending: {} };
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
  if (pending?.ticketChannelId && pending.status !== "closed") return pending;
  for (const [channelId, ticket] of Object.entries(state.tickets)) {
    if (String(ticket.userId) === uid && ticket.status !== "closed") {
      return { ...ticket, ticketChannelId: channelId };
    }
  }
  return null;
}

module.exports = {
  getState,
  setTicket,
  getTicket,
  setPending,
  findOpenTicket,
};
