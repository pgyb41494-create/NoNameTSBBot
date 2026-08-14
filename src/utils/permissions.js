const { PermissionFlagsBits } = require("discord.js");

function isOwner(userId) {
  return process.env.OWNER_ID && String(process.env.OWNER_ID) === String(userId);
}

function isAdminOrOwner(member, guild) {
  if (!member || !guild) return false;
  if (isOwner(member.id)) return true;
  if (guild.ownerId === member.id) return true;
  return member.permissions?.has(PermissionFlagsBits.Administrator);
}

function hasMod(member, flag) {
  if (!member) return false;
  if (isAdminOrOwner(member, member.guild)) return true;
  return member.permissions?.has(flag);
}

module.exports = { isOwner, isAdminOrOwner, hasMod };
