const { PermissionFlagsBits } = require("discord.js");

/** Roles carrying any of these are staff roles; the bot must never hand them out automatically. */
const ELEVATED_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ViewAuditLog,
];

/** Permissions for roles the bot creates itself (rank / cosmetic roles). */
const NO_PERMISSIONS = [];

function isElevatedRole(role) {
  const perms = role?.permissions;
  if (!perms?.has) return false;
  return ELEVATED_PERMISSIONS.some((perm) => perms.has(perm, false));
}

function isAssignableRole(role) {
  if (!role) return false;
  if (role.managed) return false;
  if (role.id === role.guild?.id) return false;
  return !isElevatedRole(role);
}

async function resolveRole(guild, roleOrId) {
  if (!roleOrId) return null;
  if (typeof roleOrId === "object" && roleOrId.id && roleOrId.permissions) return roleOrId;
  const id = String(roleOrId?.id || roleOrId);
  return guild.roles.cache.get(id) || (await guild.roles.fetch(id).catch(() => null));
}

/**
 * Drop-in for `member.roles.add` that refuses staff/admin roles.
 * Returns the roles actually added and the ones refused; still throws on Discord errors.
 */
async function safeRoleAdd(member, roles, reason) {
  const list = Array.isArray(roles) ? roles : [roles];
  const allowed = [];
  const blocked = [];
  for (const entry of list) {
    const role = await resolveRole(member.guild, entry);
    if (!role) continue;
    if (isAssignableRole(role)) allowed.push(role);
    else blocked.push(role);
  }
  if (blocked.length) {
    console.warn(
      `[roles] refused to give ${member.user?.tag || member.id} staff role(s) in ${member.guild?.name}: ${blocked.map((r) => r.name).join(", ")}`
    );
  }
  if (allowed.length) await member.roles.add(allowed, reason);
  return { added: allowed, blocked };
}

module.exports = {
  ELEVATED_PERMISSIONS,
  NO_PERMISSIONS,
  isElevatedRole,
  isAssignableRole,
  safeRoleAdd,
};
