function pageRangesFor(total) {
  const n = Math.max(1, Math.min(50, Number(total) || 10));
  const ranges = [];
  for (let start = 1; start <= n; start += 10) {
    ranges.push({ start, end: Math.min(start + 9, n) });
  }
  return ranges;
}

function normalizeTopBoardRoles(raw, legacyTopRoleId = null, topCount = 10) {
  // Explicit array (including []) wins — only migrate when the field was never saved.
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => ({
        start: Number(entry?.start),
        end: Number(entry?.end),
        roleId: String(entry?.roleId || "").trim(),
      }))
      .filter((entry) => entry.start >= 1 && entry.end >= entry.start && entry.roleId);
  }

  // Migrate old single topPlayerRoleId → first page (usually 1–10)
  if (legacyTopRoleId) {
    const first = pageRangesFor(topCount)[0] || { start: 1, end: Math.min(10, topCount) };
    return [{ start: first.start, end: first.end, roleId: String(legacyTopRoleId) }];
  }
  return [];
}

function roleIdForPosition(roles, position) {
  const pos = Number(position);
  const hit = (roles || []).find((entry) => pos >= entry.start && pos <= entry.end);
  return hit?.roleId || null;
}

function formatTopBoardRoles(roles) {
  if (!roles?.length) return "none";
  return roles
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((entry) => `#${entry.start}–#${entry.end}: <@&${entry.roleId}>`)
    .join("\n");
}

/**
 * Keep Discord roles aligned with board pages (1–10, 11–20, …).
 * Each configured range role is given to everyone currently in that range
 * and removed from anyone who left it.
 */
async function syncBoardRangeRoles(guild) {
  if (!guild?.id) return { skipped: true };

  const { getLeaderboardConfig } = require("./config");
  const cfg = await getLeaderboardConfig(guild.id);
  const roles = normalizeTopBoardRoles(
    cfg.topBoardRoles,
    cfg.topPlayerRoleId,
    cfg.topPerChannel || cfg.slotCount || 10
  );
  if (!roles.length) return { skipped: true, reason: "no roles configured" };

  const slots = (cfg.slots || [])
    .filter((slot) => slot?.discordId)
    .map((slot) => ({
      position: Number(slot.position),
      discordId: String(slot.discordId),
    }));

  const wantedByRole = new Map();
  for (const entry of roles) {
    wantedByRole.set(entry.roleId, new Set());
  }
  for (const slot of slots) {
    const roleId = roleIdForPosition(roles, slot.position);
    if (!roleId || !wantedByRole.has(roleId)) continue;
    wantedByRole.get(roleId).add(slot.discordId);
  }

  const managedRoleIds = [...wantedByRole.keys()];
    for (const roleId of managedRoleIds) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) continue;

    const wanted = wantedByRole.get(roleId) || new Set();
    const holders =
      role.members?.size > 0
        ? [...role.members.values()]
        : [...guild.members.cache.values()].filter((member) => member.roles.cache.has(roleId));

    for (const member of holders) {
      if (wanted.has(member.id)) continue;
      await member.roles.remove(role, "Left this top board range").catch(() => {});
    }

    for (const userId of wanted) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;
      if (member.roles.cache.has(roleId)) continue;
      await member.roles.add(role, "On this top board range").catch(() => {});
    }
  }

  return { ok: true, roles: managedRoleIds.length, players: slots.length };
}

module.exports = {
  pageRangesFor,
  normalizeTopBoardRoles,
  roleIdForPosition,
  formatTopBoardRoles,
  syncBoardRangeRoles,
};
