/**
 * Assign / remove Ranking Setup tryout cooldown roles.
 */

function getCooldownRole(guild, rankingCfg) {
    const id = rankingCfg?.tryoutCooldownRoleId;
    if (!id) return null;
    return guild.roles.cache.get(id) || null;
}

async function addTryoutCooldownRole(member, rankingCfg, reason = "Joined TSB tryout") {
    if (!member || !rankingCfg?.tryoutCooldownDays) return false;
    const role = getCooldownRole(member.guild, rankingCfg);
    if (!role) return false;
    if (member.roles.cache.has(role.id)) return false;
    const me = member.guild.members.me;
    if (me && role.position >= me.roles.highest.position) return false;
    try {
        await member.roles.add(role, reason);
        return true;
    } catch {
        return false;
    }
}

async function removeTryoutCooldownRole(member, rankingCfg, reason = "Stage assigned") {
    if (!member) return false;
    const role = getCooldownRole(member.guild, rankingCfg);
    if (!role) return false;
    if (!member.roles.cache.has(role.id)) return false;
    try {
        await member.roles.remove(role, reason);
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    getCooldownRole,
    addTryoutCooldownRole,
    removeTryoutCooldownRole,
};
