const { createJsonStore } = require("../../../../api/store/jsonStore");
const { isAdminOrOwner } = require("../../../utils/permissions");

const PERM_CATEGORIES = [
  { id: "GIVEACCESS", emoji: "🔑", desc: "Grant TSB access to others", hint: "`'access` `/access`" },
  { id: "PHASE", emoji: "🧬", desc: "Assign phase / stage / rank", hint: "`'phase` `/phase`" },
  { id: "LEADERBOARD", emoji: "🏆", desc: "Edit top boards and drafts", hint: "`'tsbtop` · board drafts" },
  { id: "LINEUPS", emoji: "📋", desc: "Edit lineups and drafts", hint: "`'lineup` · lineup drafts" },
  { id: "SCORE", emoji: "📊", desc: "Record 1v1 / clan scores", hint: "`/score`" },
  { id: "TRYOUTS", emoji: "⚔️", desc: "Create and end tryouts", hint: "`'tryout` `/tryout`" },
];

const PERM_IDS = PERM_CATEGORIES.map((p) => p.id);
const store = createJsonStore("access.json", {});

function loadAccessData() {
  const data = store.load();
  return data && typeof data === "object" ? data : {};
}

function getUserPerms(guildId, userId) {
  const data = loadAccessData();
  const list = data[String(guildId)]?.[String(userId)];
  return Array.isArray(list) ? list.filter((id) => PERM_IDS.includes(id)) : [];
}

function setUserPerms(guildId, userId, perms) {
  const next = [...new Set((perms || []).filter((id) => PERM_IDS.includes(id)))];
  store.updateSync((data) => {
    const gid = String(guildId);
    const uid = String(userId);
    if (!data[gid] || typeof data[gid] !== "object") data[gid] = {};
    if (!next.length) delete data[gid][uid];
    else data[gid][uid] = next;
    if (data[gid] && !Object.keys(data[gid]).length) delete data[gid];
    return data;
  });
  return next;
}

function listGuildAccess(guildId) {
  const data = loadAccessData();
  const guild = data[String(guildId)] || {};
  return Object.entries(guild)
    .map(([userId, perms]) => ({
      userId,
      perms: Array.isArray(perms) ? perms.filter((id) => PERM_IDS.includes(id)) : [],
    }))
    .filter((entry) => entry.perms.length);
}

function hasAccessPerm(guildId, userId, perm) {
  const perms = getUserPerms(guildId, userId);
  return perms.includes(perm) || perms.includes("GIVEACCESS");
}

function canGiveAccess(member, guild) {
  if (!member || !guild) return false;
  if (isAdminOrOwner(member, guild)) return true;
  return hasAccessPerm(guild.id, member.id, "GIVEACCESS");
}

function hasTsbAccess(member, guild, perm) {
  if (!member || !guild || !perm) return false;
  if (isAdminOrOwner(member, guild)) return true;
  return hasAccessPerm(guild.id, member.id, perm);
}

function findPerm(raw) {
  const key = String(raw || "").trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!key) return null;
  const aliases = {
    LINEUP: "LINEUPS",
    TOP: "LEADERBOARD",
    BOARD: "LEADERBOARD",
    STAGE: "PHASE",
    RANK: "PHASE",
    TRYOUT: "TRYOUTS",
    GIVE: "GIVEACCESS",
  };
  const id = aliases[key] || key;
  return PERM_CATEGORIES.find((p) => p.id.replace(/_/g, "") === id.replace(/_/g, "")) || null;
}

module.exports = {
  PERM_CATEGORIES,
  PERM_IDS,
  loadAccessData,
  getUserPerms,
  setUserPerms,
  listGuildAccess,
  hasAccessPerm,
  canGiveAccess,
  hasTsbAccess,
  findPerm,
};
