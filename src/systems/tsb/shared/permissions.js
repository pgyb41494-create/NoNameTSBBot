const { isAdminOrOwner } = require("../../../utils/permissions");

function memberHasAnyRole(member, roleIds = []) {
  if (!member?.roles?.cache) return false;
  return (roleIds || []).some((id) => id && member.roles.cache.has(id));
}

module.exports = {
  isAdminOrOwner,
  memberHasAnyRole,
};
