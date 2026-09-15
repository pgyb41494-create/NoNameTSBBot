const api = require("../../../utils/loadApi");
const { resolveMaybe } = require("../../../utils/resolveMaybe");
const { normalizeTopBoardRoles } = require("./boardRoles");

function defaultChallengeTickets() {
  return {
    enabled: false,
    channelId: "",
    categoryId: "",
    panelMessageId: "",
    auditLogChannelId: "",
    spotsAhead: 3,
    ranges: [],
    supportRoleIds: [],
  };
}

function parseChallengeRanges(raw) {
  return String(raw || "")
    .split(",")
    .map((part) => {
      const m = String(part || "").trim().match(/^(\d+)\s*-\s*(\d+)\s*:\s*(\d+)$/);
      if (!m) return null;
      const from = Number(m[1]);
      const to = Number(m[2]);
      const spots = Math.max(1, Math.min(15, Number(m[3])));
      if (!from || !to || !spots) return null;
      return { from, to, spots };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function challengeTicketsOf(cfg = {}) {
  const raw = cfg.challengeTickets && typeof cfg.challengeTickets === "object" ? cfg.challengeTickets : {};
  const spotsAhead = Math.max(1, Math.min(15, Number(raw.spotsAhead) || 3));
  return {
    ...defaultChallengeTickets(),
    ...raw,
    enabled: !!raw.enabled,
    channelId: String(raw.channelId || ""),
    categoryId: String(raw.categoryId || ""),
    panelMessageId: String(raw.panelMessageId || ""),
    auditLogChannelId: String(raw.auditLogChannelId || ""),
    spotsAhead,
    ranges: Array.isArray(raw.ranges) ? raw.ranges.filter((r) => r && r.from && r.to && r.spots) : [],
    supportRoleIds: Array.isArray(raw.supportRoleIds)
      ? [...new Set(raw.supportRoleIds.map((id) => String(id || "")).filter(Boolean))]
      : [],
  };
}

function challengeStaffRoleIds(tickets, fallbackRoles = []) {
  const inner = tickets && Array.isArray(tickets.supportRoleIds)
    ? tickets
    : challengeTicketsOf({ challengeTickets: tickets });
  if (inner.supportRoleIds?.length) return inner.supportRoleIds.map(String);
  return (fallbackRoles || []).map((id) => String(id)).filter(Boolean);
}

function spotsAheadFor(position, tickets) {
  const pos = Number(position);
  for (const range of tickets?.ranges || []) {
    const a = Math.min(Number(range.from), Number(range.to));
    const b = Math.max(Number(range.from), Number(range.to));
    if (pos >= a && pos <= b) return Math.max(1, Math.min(15, Number(range.spots) || tickets.spotsAhead || 3));
  }
  return Math.max(1, Math.min(15, Number(tickets?.spotsAhead) || 3));
}

function formatChallengeRules(tickets) {
  const cfg = challengeTicketsOf({ challengeTickets: tickets });
  if (!cfg.ranges.length) return `up to **${cfg.spotsAhead}** spots ahead of you`;
  const ranges = cfg.ranges.map((r) => `#${r.from}–#${r.to}: ${r.spots}`).join(", ");
  return `${ranges} · default **${cfg.spotsAhead}** spots ahead`;
}

const MAX_EXTRA_BOARDS = 8;

function emptyBoardSlots(count) {
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

function normalizeExtraBoard(raw, fallbackId = "board") {
  const id = sanitizeBoardId(raw?.id || raw?.suffix || raw?.title) || fallbackId;
  const slotCount = Math.max(1, Math.min(50, Number(raw?.slotCount) || 10));
  const slots = Array.isArray(raw?.slots) ? [...raw.slots] : [];
  while (slots.length < slotCount) slots.push({ position: slots.length + 1, discordId: null });
  return {
    id,
    title: String(raw?.title || "").trim().slice(0, 80),
    showTitle: raw?.showTitle !== false,
    slotCount,
    suffix: sanitizeBoardId(raw?.suffix) || id,
    slots: slots.slice(0, slotCount).map((s, i) => ({ position: i + 1, discordId: s?.discordId || null })),
    publicChannelIds: Array.isArray(raw?.publicChannelIds) ? raw.publicChannelIds.map(String).filter(Boolean) : [],
    boardPages: Array.isArray(raw?.boardPages) ? raw.boardPages : [],
    messageIds: raw?.messageIds && typeof raw.messageIds === "object" ? { ...raw.messageIds } : {},
  };
}

function extraBoardsOf(cfg = {}) {
  const seen = new Set();
  return (Array.isArray(cfg.extraBoards) ? cfg.extraBoards : [])
    .slice(0, MAX_EXTRA_BOARDS)
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

function uniqueBoardId(desired, existing) {
  const taken = new Set((existing || []).map((board) => board.id));
  let id = sanitizeBoardId(desired) || "board";
  if (id === "main" || id === "default") id = "board";
  let next = id;
  let n = 2;
  while (taken.has(next)) {
    next = `${id}-${n}`.slice(0, 24);
    n += 1;
  }
  return next;
}

function headingTextOf(cfg, guildName) {
  const custom = String(cfg?.headingText || "").trim();
  return custom || `${guildName || "Server"} Leaderboard`;
}

function listBoards(cfg) {
  const mainTitle = String(cfg?.headingText || "").trim() || "Main board";
  return [
    {
      id: "main",
      title: mainTitle,
      slots: Array.isArray(cfg?.slots) ? cfg.slots : [],
    },
    ...extraBoardsOf(cfg).map((board) => ({
      id: board.id,
      title: board.title || board.id,
      slots: Array.isArray(board.slots) ? board.slots : [],
    })),
  ];
}

function getBoardById(cfg, boardId = "main") {
  const id = String(boardId || "main");
  return listBoards(cfg).find((board) => board.id === id) || null;
}

function boardsForUser(cfg, userId) {
  const uid = String(userId || "");
  if (!uid) return [];
  return listBoards(cfg).filter((board) =>
    (board.slots || []).some((slot) => slot?.discordId && String(slot.discordId) === uid)
  );
}

function filledSlotsOf(board) {
  return (board?.slots || [])
    .filter((slot) => slot?.discordId)
    .map((slot) => ({
      position: Number(slot.position) || 0,
      discordId: String(slot.discordId),
    }))
    .filter((slot) => slot.position > 0)
    .sort((a, b) => a.position - b.position);
}

function defaultConfig(guildId) {
  return api.leaderboard.defaultConfig
    ? api.leaderboard.defaultConfig(guildId)
    : api.leaderboard.getConfig(guildId);
}

function normalizeLeaderboardConfig(cfg) {
  if (!cfg.topPerChannel) cfg.topPerChannel = cfg.slotCount || 10;
  if (cfg.suffix == null) cfg.suffix = "default";
  if (cfg.showHeading == null) cfg.showHeading = true;
  if (cfg.headingText == null) cfg.headingText = "";
  if (!cfg.rankLabel || /^phase$/i.test(String(cfg.rankLabel).trim())) cfg.rankLabel = "Stage";
  if (!cfg.allowedRoles) cfg.allowedRoles = [];
  if (!cfg.rankRequirements) cfg.rankRequirements = [];
  if (!cfg.boardPages) cfg.boardPages = [];
  cfg.extraBoards = extraBoardsOf(cfg);
  cfg.challengeTickets = challengeTicketsOf(cfg);
  cfg.topBoardRoles = normalizeTopBoardRoles(
    cfg.topBoardRoles,
    cfg.topPlayerRoleId,
    cfg.topPerChannel || cfg.slotCount || 10
  );
  return cfg;
}

async function getLeaderboardConfig(guildId) {
  const cfg = await resolveMaybe(api.leaderboard.getConfig(guildId));
  return normalizeLeaderboardConfig(cfg && typeof cfg === "object" ? { ...cfg } : {});
}

async function getLeaderboardConfigAsync(guildId) {
  return getLeaderboardConfig(guildId);
}

async function setLeaderboardConfig(guildId, config) {
  const current = await getLeaderboardConfig(guildId);
  const top = config.topPerChannel || config.slotCount || current.topPerChannel || 10;
  return resolveMaybe(api.leaderboard.updateConfig(guildId, {
    ...current,
    ...config,
    setupCompleted: true,
    slotCount: top,
    topPerChannel: top,
  }));
}

async function updateLeaderboardConfig(guildId, patch) {
  const current = await getLeaderboardConfig(guildId);
  let nextPatch = { ...patch };
  if (nextPatch.topPerChannel && !nextPatch.slotCount) nextPatch = { ...nextPatch, slotCount: nextPatch.topPerChannel };
  if (nextPatch.slotCount && !nextPatch.topPerChannel) nextPatch = { ...nextPatch, topPerChannel: nextPatch.slotCount };
  if (nextPatch.extraBoards !== undefined) {
    nextPatch = { ...nextPatch, extraBoards: extraBoardsOf({ extraBoards: nextPatch.extraBoards }) };
  }
  if (nextPatch.challengeTickets) {
    nextPatch = {
      ...nextPatch,
      challengeTickets: challengeTicketsOf({ challengeTickets: { ...current.challengeTickets, ...nextPatch.challengeTickets } }),
    };
  }
  if (
    nextPatch.topBoardRoles !== undefined ||
    nextPatch.topPlayerRoleId !== undefined ||
    nextPatch.topPerChannel ||
    nextPatch.slotCount
  ) {
    const topCount = nextPatch.topPerChannel || nextPatch.slotCount || current.topPerChannel || current.slotCount || 10;
    const rolesSource =
      nextPatch.topBoardRoles !== undefined ? nextPatch.topBoardRoles : current.topBoardRoles;
    // Once topBoardRoles is explicitly set (even []), stop re-applying legacy topPlayerRoleId.
    const legacy =
      Array.isArray(rolesSource)
        ? null
        : nextPatch.topPlayerRoleId !== undefined
          ? nextPatch.topPlayerRoleId
          : current.topPlayerRoleId;
    nextPatch = {
      ...nextPatch,
      topBoardRoles: normalizeTopBoardRoles(rolesSource, legacy, topCount),
    };
  }
  return resolveMaybe(api.leaderboard.updateConfig(guildId, { ...current, ...nextPatch }));
}

async function ensureSlots(guildId, count) {
  if (typeof api.leaderboard.ensureSlots === "function") {
    return resolveMaybe(api.leaderboard.ensureSlots(guildId, count));
  }
  const cfg = await getLeaderboardConfig(guildId);
  const n = Math.max(1, Math.min(50, count || cfg.slotCount || cfg.topPerChannel || 10));
  const slots = [...(cfg.slots || [])];
  while (slots.length < n) slots.push({ position: slots.length + 1, discordId: null });
  const next = slots.slice(0, n).map((s, i) => ({ position: i + 1, discordId: s.discordId || null }));
  return updateLeaderboardConfig(guildId, { slots: next, slotCount: n, topPerChannel: n });
}

module.exports = {
  getLeaderboardConfig,
  getLeaderboardConfigAsync,
  normalizeLeaderboardConfig,
  setLeaderboardConfig,
  updateLeaderboardConfig,
  ensureSlots,
  defaultConfig,
  defaultChallengeTickets,
  parseChallengeRanges,
  challengeTicketsOf,
  spotsAheadFor,
  formatChallengeRules,
  extraBoardsOf,
  normalizeExtraBoard,
  sanitizeBoardId,
  uniqueBoardId,
  emptyBoardSlots,
  headingTextOf,
  listBoards,
  getBoardById,
  boardsForUser,
  filledSlotsOf,
  MAX_EXTRA_BOARDS,
  challengeStaffRoleIds,
};
