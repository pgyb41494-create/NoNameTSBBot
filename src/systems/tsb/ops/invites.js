const { publicInvites, setJoin, inviteCount, DEFAULT_INVITE_MESSAGE } = require("./store");

const cache = new Map();

function fillVars(text, vars) {
  return String(text || "").replace(/\{(\w+)\}/gi, (full, key) => {
    const value = vars[String(key).toLowerCase()];
    return value == null || value === "" ? full : String(value);
  });
}

async function refreshGuild(guild) {
  if (!guild?.invites) return;
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return;
  const map = new Map();
  for (const inv of invites.values()) map.set(inv.code, inv.uses || 0);
  cache.set(guild.id, map);
}

async function refreshEnabled(client) {
  for (const guild of client.guilds.cache.values()) {
    if (!publicInvites(guild.id).enabled) continue;
    await refreshGuild(guild);
  }
}

function onInviteChange(invite) {
  if (!invite?.guild) return;
  const map = cache.get(invite.guild.id) || new Map();
  if (invite.uses == null) map.delete(invite.code);
  else map.set(invite.code, invite.uses || 0);
  cache.set(invite.guild.id, map);
}

async function onMemberAdd(member) {
  if (!member?.guild || member.user?.bot) return;
  const cfg = publicInvites(member.guild.id);
  if (!cfg.enabled) return;

  const oldMap = cache.get(member.guild.id) || new Map();
  const invites = await member.guild.invites.fetch().catch(() => null);
  let used = null;
  if (invites) {
    const next = new Map();
    for (const inv of invites.values()) {
      next.set(inv.code, inv.uses || 0);
      const before = oldMap.get(inv.code) || 0;
      if ((inv.uses || 0) > before) used = inv;
    }
    cache.set(member.guild.id, next);
  }

  const inviter = used?.inviter || null;
  if (inviter) {
    setJoin(member.guild.id, member.id, {
      inviterId: inviter.id,
      inviterTag: inviter.tag || inviter.username,
      code: used.code,
      at: Date.now(),
      fake: Date.now() - member.user.createdTimestamp < 7 * 86400000,
    });
  }

  if (!cfg.channelId) return;
  const channel = await member.guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  const count = inviter ? inviteCount(member.guild.id, inviter.id) : 0;
  const invitedMention = `<@${member.id}>`;
  const inviterMention = inviter ? `<@${inviter.id}>` : "Unknown";
  const vars = {
    userinvited: invitedMention,
    userinvitied: invitedMention,
    invited: invitedMention,
    mention: invitedMention,
    invitedname: member.displayName || member.user.globalName || member.user.username,
    user: inviterMention,
    inviter: inviterMention,
    invitador: inviterMention,
    invitername: inviter?.globalName || inviter?.username || "Unknown",
    username: member.user.username,
    invites: String(count),
    count: String(count),
    invitaciones: String(count),
    server: member.guild.name,
    code: used?.code || "",
  };
  const text = fillVars(cfg.message || DEFAULT_INVITE_MESSAGE, vars).slice(0, 1800);
  await channel
    .send({
      content: text,
      allowedMentions: { users: [member.id, inviter?.id].filter(Boolean) },
    })
    .catch(() => {});
}

module.exports = {
  refreshGuild,
  refreshEnabled,
  onInviteChange,
  onMemberAdd,
};
