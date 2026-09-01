const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { brand } = require("../../../utils/loadApi");
const { tsbEmbed, COLOR_PRIMARY } = require("./embeds");

const NAME_HINTS = [
  "community-updates",
  "community_updates",
  "communityupdates",
  "community-update",
  "updates",
  "server-updates",
  "announcements",
];

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function canSend(channel, me) {
  if (!channel?.isTextBased?.() || channel.isThread?.()) return false;
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return false;
  }
  const perms = channel.permissionsFor?.(me);
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages);
}

async function findWelcomeChannel(guild) {
  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  if (!me) return null;

  if (guild.publicUpdatesChannelId) {
    const ch = await guild.channels.fetch(guild.publicUpdatesChannelId).catch(() => null);
    if (canSend(ch, me)) return ch;
  }

  const channels = [...(guild.channels.cache?.values?.() || [])];
  if (!channels.length) {
    await guild.channels.fetch().catch(() => null);
  }
  const list = [...guild.channels.cache.values()];

  for (const hint of NAME_HINTS) {
    const want = normalizeName(hint);
    const match = list.find((ch) => normalizeName(ch.name) === want || normalizeName(ch.name).includes(want));
    if (canSend(match, me)) return match;
  }

  if (guild.systemChannelId) {
    const sys = await guild.channels.fetch(guild.systemChannelId).catch(() => null);
    if (canSend(sys, me)) return sys;
  }

  return (
    list
      .filter((ch) => canSend(ch, me))
      .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))[0] || null
  );
}

function welcomeEmbed(guild, owner) {
  const prefix = brand.prefix || "'";
  const ownerMention = owner ? `<@${owner.id}>` : "server owner";
  const botName = brand.name || "Ascendant";

  return tsbEmbed({
    title: `${botName} is here`,
    color: COLOR_PRIMARY,
    description:
      `Hey ${ownerMention} — thanks for inviting **${botName}** to **${guild.name}**.\n\n` +
      `# Quick next steps\n` +
      `> **1.** Run **\`${prefix}serversetup\`** to finish boards, ranks, and channels\n` +
      `> **2.** Use **\`${prefix}help\`** for commands\n` +
      `> **3.** Give trusted staff **Administrator** if they should manage TSB tools`,
    footer: `${guild.name} · ${prefix}serversetup`,
    timestamp: true,
  });
}

async function sendGuildJoinWelcome(guild) {
  if (!guild?.id) return false;

  const owner = await guild.fetchOwner().catch(() => null);
  const channel = await findWelcomeChannel(guild);
  if (!channel) {
    console.warn(`[welcome] No writable channel in ${guild.name} (${guild.id})`);
    return false;
  }

  await channel.send({
    content: owner ? `<@${owner.id}>` : undefined,
    embeds: [welcomeEmbed(guild, owner)],
    allowedMentions: owner ? { users: [owner.id] } : { parse: [] },
  });
  return true;
}

module.exports = {
  findWelcomeChannel,
  welcomeEmbed,
  sendGuildJoinWelcome,
};
