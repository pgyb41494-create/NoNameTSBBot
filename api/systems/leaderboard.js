const { createJsonStore } = require("../store/jsonStore");
const { brand } = require("../brand");

const store = createJsonStore("leaderboard.json", {});

function emptySlots(count) {
  const n = Math.max(1, Math.min(50, Number(count) || 10));
  return Array.from({ length: n }, (_, i) => ({ position: i + 1, discordId: null }));
}

function sanitizeBoardId(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

function padSlots(slots, count) {
  const n = Math.max(1, Math.min(50, Number(count) || 10));
  const next = Array.isArray(slots) ? [...slots] : [];
  while (next.length < n) next.push({ position: next.length + 1, discordId: null });
  return next.slice(0, n).map((s, i) => ({ position: i + 1, discordId: s?.discordId || null }));
}

function normalizeExtraBoard(raw, fallbackId = "board") {
  const id = sanitizeBoardId(raw?.id || raw?.suffix || raw?.title) || fallbackId;
  const slotCount = Math.max(1, Math.min(50, Number(raw?.slotCount) || 10));
  return {
    id,
    title: String(raw?.title || "").trim().slice(0, 80),
    showTitle: raw?.showTitle !== false,
    slotCount,
    suffix: sanitizeBoardId(raw?.suffix) || id,
    slots: padSlots(raw?.slots, slotCount),
    publicChannelIds: Array.isArray(raw?.publicChannelIds) ? raw.publicChannelIds.map(String).filter(Boolean) : [],
    boardPages: Array.isArray(raw?.boardPages) ? raw.boardPages : [],
    messageIds: raw?.messageIds && typeof raw.messageIds === "object" ? raw.messageIds : {},
  };
}

function extraBoardsOf(cfg = {}) {
  const seen = new Set();
  return (Array.isArray(cfg.extraBoards) ? cfg.extraBoards : [])
    .slice(0, 8)
    .map((board, index) => normalizeExtraBoard(board, `board-${index + 1}`))
    .map((board) => {
      let id = board.id === "main" || board.id === "default" ? "board" : board.id;
      let n = 2;
      while (seen.has(id)) {
        id = `${board.id}-${n}`.slice(0, 24);
        n += 1;
      }
      seen.add(id);
      return { ...board, id };
    });
}

function defaultConfig(guildId) {
  return {
    guildId,
    setupCompleted: false,
    managementChannelId: null,
    publicChannelIds: [],
    slotCount: 10,
    topPerChannel: 10,
    suffix: "default",
    showHeading: true,
    headingText: "",
    extraBoards: [],
    rankLabel: "Stage",
    requireRobloxVerification: true,
    topPlayerRoleId: null,
    rankRequirements: [],
    allowedRoles: [],
    boardPages: [],
    cardGifUrl: brand.defaultGif,
    theme: "classic",
    componentsV2: false,
    tipsMessageId: null,
    slots: emptySlots(10),
    messageIds: {},
    challengeTickets: {
      enabled: false,
      channelId: "",
      categoryId: "",
      panelMessageId: "",
      auditLogChannelId: "",
      spotsAhead: 3,
      ranges: [],
      supportRoleIds: [],
    },
    topBoardRoles: [],
  };
}

function getConfig(guildId) {
  const db = store.load();
  const cfg = { ...(db[guildId] || defaultConfig(guildId)) };
  if (!cfg.rankLabel || /^phase$/i.test(String(cfg.rankLabel).trim())) cfg.rankLabel = "Stage";
  if (cfg.showHeading == null) cfg.showHeading = true;
  if (cfg.headingText == null) cfg.headingText = "";
  cfg.extraBoards = extraBoardsOf(cfg);
  return cfg;
}

function updateConfig(guildId, patch) {
  let next = null;
  store.updateSync((db) => {
    const current = db[guildId] || defaultConfig(guildId);
    next = { ...current, ...patch, guildId };
    if (next.showHeading == null) next.showHeading = true;
    if (next.headingText == null) next.headingText = "";
    if (patch.extraBoards !== undefined || !Array.isArray(next.extraBoards)) {
      next.extraBoards = extraBoardsOf(next);
    }
    db[guildId] = next;
    return db;
  });
  return next;
}

function ensureSlots(guildId, count) {
  const cfg = getConfig(guildId);
  const n = Math.max(1, Math.min(50, count || cfg.slotCount || 10));
  const slots = [...(cfg.slots || [])];
  while (slots.length < n) slots.push({ position: slots.length + 1, discordId: null });
  const next = slots.slice(0, n).map((s, i) => ({ position: i + 1, discordId: s.discordId || null }));
  return updateConfig(guildId, { slots: next, slotCount: n });
}

function place(guildId, position, userId) {
  const cfg = ensureSlots(guildId, Math.max(getConfig(guildId).slotCount || 10, position));
  const slots = (cfg.slots || []).map((s) => ({
    position: s.position,
    discordId: String(s.discordId || "") === String(userId) ? null : s.discordId,
  }));
  slots[position - 1] = { position, discordId: userId };
  return updateConfig(guildId, { slots, setupCompleted: true });
}

function clearSlot(guildId, position) {
  const cfg = getConfig(guildId);
  const slots = [...(cfg.slots || [])];
  if (!slots[position - 1]) return cfg;
  slots[position - 1] = { position, discordId: null };
  return updateConfig(guildId, { slots });
}

module.exports = {
  getConfig,
  updateConfig,
  ensureSlots,
  place,
  clearSlot,
  defaultConfig,
  emptySlots,
  extraBoardsOf,
  normalizeExtraBoard,
  sanitizeBoardId,
  padSlots,
};
