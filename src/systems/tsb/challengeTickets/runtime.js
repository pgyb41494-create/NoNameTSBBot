const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} = require("discord.js");
const api = require("../../../utils/loadApi");
const { tsbEmbed, COLOR_PRIMARY, COLOR_SUCCESS, COLOR_DANGER } = require("../shared/embeds");
const { isAdminOrOwner, memberHasAnyRole } = require("../shared/permissions");
const { getLeaderboardConfig, updateLeaderboardConfig, challengeTicketsOf, spotsAheadFor, formatChallengeRules } = require("../leaderboard/config");
const { getOrCreateNamedChannel } = require("../shared/channelReuse");
const { setTicket, getTicket, setPending, findOpenTicket } = require("./store");

const START_ID = "tsb:chaltix:start";
const PICK_ID = "tsb:chaltix:pick";
const CLOSE_ID = "tsb:chaltix:close";

function filledSlots(guildId) {
  const cfg = getLeaderboardConfig(guildId);
  return (cfg.slots || [])
    .filter((slot) => slot?.discordId)
    .map((slot) => ({ position: Number(slot.position), discordId: String(slot.discordId) }))
    .sort((a, b) => a.position - b.position);
}

function positionOf(slots, userId) {
  return slots.find((slot) => slot.discordId === String(userId))?.position || null;
}

async function busySet(guildId) {
  try {
    if (api.challenges.busyIds) {
      const ids = await Promise.resolve(api.challenges.busyIds(guildId));
      return new Set((ids || []).map(String));
    }
    const state = await Promise.resolve(api.challenges.getState(guildId));
    const ids = new Set();
    for (const [fromId, row] of Object.entries(state?.active || {})) {
      if (row.status && row.status !== "open") continue;
      ids.add(String(fromId));
      if (row.targetId) ids.add(String(row.targetId));
    }
    return ids;
  } catch {
    return new Set();
  }
}

function validTargets(slots, challengerId, tickets, busy) {
  const myPos = positionOf(slots, challengerId);
  if (!myPos) return [];
  const ahead = spotsAheadFor(myPos, tickets);
  const minPos = Math.max(1, myPos - ahead);
  return slots.filter((slot) => {
    if (slot.discordId === String(challengerId)) return false;
    if (slot.position >= myPos) return false;
    if (slot.position < minPos) return false;
    if (busy.has(slot.discordId)) return false;
    return true;
  });
}

function shortBoardLines(slots, busy, limit = 15) {
  const lines = slots.slice(0, limit).map((slot) => {
    const tag = busy.has(slot.discordId) ? " · challenged" : "";
    return `**#${slot.position}** <@${slot.discordId}>${tag}`;
  });
  if (slots.length > limit) lines.push(`…and ${slots.length - limit} more`);
  return lines.join("\n") || "*Board is empty.*";
}

function panelPayload(guild) {
  const tickets = challengeTicketsOf(getLeaderboardConfig(guild.id));
  return {
    embeds: [
      tsbEmbed({
        title: "Challenge tickets",
        color: COLOR_PRIMARY,
        description:
          "Click **Challenge** to open a private ticket and pick **one** player ahead of you on the leaderboard.\n\n" +
          `**Rules:** ${formatChallengeRules(tickets)}\n` +
          "You cannot challenge people behind you, yourself, or anyone already in a challenge.",
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(START_ID).setLabel("Challenge").setStyle(ButtonStyle.Primary)
      ),
    ],
  };
}

async function publishPanel(guild) {
  const cfg = getLeaderboardConfig(guild.id);
  const tickets = challengeTicketsOf(cfg);
  if (!tickets.enabled) return null;

  const channel = await getOrCreateNamedChannel(guild, {
    channelId: tickets.channelId,
    names: ["challenge-tickets", "challenges"],
    pattern: /^(?:challenge-tickets|challenges)$/,
    createName: "challenge-tickets",
    topic: "Leaderboard challenge tickets",
    reason: "Ascendant challenge tickets panel",
  });
  if (!channel) return null;

  const payload = panelPayload(guild);
  let message = null;
  if (tickets.panelMessageId) {
    message = await channel.messages.fetch(tickets.panelMessageId).catch(() => null);
    if (message) await message.edit(payload).catch(() => { message = null; });
  }
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
    const existing = recent
      ? [...recent.values()]
          .filter((msg) => msg.author?.id === guild.client.user.id && msg.embeds?.[0]?.title === "Challenge tickets")
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      : [];
    message = existing[0] || null;
    if (message) await message.edit(payload).catch(() => { message = null; });
    for (const extra of existing.slice(1)) await extra.delete().catch(() => {});
  }
  if (!message) message = await channel.send(payload);

  updateLeaderboardConfig(guild.id, {
    challengeTickets: {
      ...tickets,
      enabled: true,
      channelId: channel.id,
      panelMessageId: message.id,
    },
  });
  return { channel, message };
}

async function ensureCategory(guild, tickets) {
  if (tickets.categoryId) {
    const existing = await guild.channels.fetch(tickets.categoryId).catch(() => null);
    if (existing?.type === ChannelType.GuildCategory) return existing;
  }
  const found = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && /challenge/.test(ch.name.toLowerCase())
  );
  if (found) return found;
  return guild.channels.create({
    name: "Challenge Tickets",
    type: ChannelType.GuildCategory,
    reason: "Challenge ticket category",
  });
}

function sanitizeName(user) {
  const base = String(user?.username || user?.globalName || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  return `chal-${base || "user"}`;
}

function canStaff(member, guild, cfg) {
  if (isAdminOrOwner(member, guild)) return true;
  return memberHasAnyRole(member, cfg.allowedRoles || []);
}

function ticketOverwrites(guild, user, staffRoleIds) {
  const me = guild.members.me;
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];
  if (me) {
    overwrites.push({
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.EmbedLinks,
      ],
    });
  }
  for (const roleId of staffRoleIds || []) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }
  return overwrites;
}

function closeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CLOSE_ID).setLabel("Close ticket").setStyle(ButtonStyle.Secondary)
  );
}

async function ticketPayload(guild, userId) {
  const cfg = getLeaderboardConfig(guild.id);
  const tickets = challengeTicketsOf(cfg);
  const slots = filledSlots(guild.id);
  const busy = await busySet(guild.id);
  const myPos = positionOf(slots, userId);
  const targets = validTargets(slots, userId, tickets, busy);
  const ahead = myPos ? spotsAheadFor(myPos, tickets) : tickets.spotsAhead;
  const minPos = myPos ? Math.max(1, myPos - ahead) : null;

  let note = `Your spot: **#${myPos}** · you can challenge **${ahead}** spot(s) ahead`;
  if (minPos) note += ` (**#${minPos}–#${myPos - 1}**)`;
  if (!targets.length) {
    note += myPos === 1
      ? "\n\nYou're **#1** — nobody is ahead of you."
      : "\n\nNobody you can challenge right now (ahead of you, in range, and not already challenged).";
  }

  const embed = tsbEmbed({
    title: "Pick a challenge",
    color: COLOR_PRIMARY,
    description: `${shortBoardLines(slots, busy)}\n\n${note}`,
  });

  const components = [];
  if (targets.length) {
    const options = [];
    for (const slot of targets.slice(0, 25)) {
      const member = await guild.members.fetch(slot.discordId).catch(() => null);
      const name = member?.displayName || member?.user?.username || slot.discordId;
      options.push({
        label: `#${slot.position} ${name}`.slice(0, 100),
        description: `Spot #${slot.position}`.slice(0, 100),
        value: slot.discordId,
      });
    }
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(PICK_ID)
          .setPlaceholder("Select one player to challenge")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(options)
      )
    );
  }
  components.push(closeRow());
  return { embeds: [embed], components };
}

async function openTicket(interaction) {
  const guild = interaction.guild;
  const cfg = getLeaderboardConfig(guild.id);
  const ticketsCfg = challengeTicketsOf(cfg);
  if (!ticketsCfg.enabled) {
    return interaction.reply({ content: "Challenge tickets are not set up.", ephemeral: true });
  }

  const slots = filledSlots(guild.id);
  const myPos = positionOf(slots, interaction.user.id);
  if (!myPos) {
    return interaction.reply({
      content: "You must be on the leaderboard to open a challenge ticket.",
      ephemeral: true,
    });
  }

  const busy = await busySet(guild.id);
  if (busy.has(String(interaction.user.id))) {
    return interaction.reply({
      content: "You already have an open challenge.",
      ephemeral: true,
    });
  }

  const existing = findOpenTicket(guild.id, interaction.user.id);
  if (existing?.ticketChannelId) {
    const ch = await guild.channels.fetch(existing.ticketChannelId).catch(() => null);
    if (ch) {
      return interaction.reply({ content: `You already have a ticket: ${ch}`, ephemeral: true });
    }
  }

  await interaction.deferReply({ ephemeral: true });

  const category = await ensureCategory(guild, ticketsCfg);
  if (category?.id && category.id !== ticketsCfg.categoryId) {
    updateLeaderboardConfig(guild.id, {
      challengeTickets: { ...ticketsCfg, categoryId: category.id },
    });
  }

  let name = sanitizeName(interaction.user);
  if (guild.channels.cache.some((ch) => ch.name === name)) {
    name = `${name}-${String(interaction.user.id).slice(-4)}`;
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category?.id || null,
    topic: `challenge:${interaction.user.id}`,
    permissionOverwrites: ticketOverwrites(guild, interaction.user, cfg.allowedRoles),
    reason: `Challenge ticket for ${interaction.user.tag || interaction.user.username}`,
  });

  setPending(guild.id, interaction.user.id, {
    status: "open",
    ticketChannelId: channel.id,
    at: Date.now(),
  });
  setTicket(guild.id, channel.id, { userId: interaction.user.id, status: "open" });

  const payload = await ticketPayload(guild, interaction.user.id);
  const staffPing = (cfg.allowedRoles || []).map((id) => `<@&${id}>`).join(" ");
  await channel.send({
    content: `${interaction.user} ${staffPing}`.trim(),
    allowedMentions: { users: [interaction.user.id], roles: cfg.allowedRoles || [] },
    ...payload,
  });

  return interaction.editReply({ content: `Ticket opened: ${channel}` });
}

async function pickTarget(interaction) {
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const userId = ticket?.userId || interaction.channel.topic?.replace(/^challenge:/, "");
  if (!userId) {
    return interaction.reply({ content: "This is not a challenge ticket.", ephemeral: true });
  }
  if (String(interaction.user.id) !== String(userId) && !canStaff(interaction.member, interaction.guild, getLeaderboardConfig(interaction.guild.id))) {
    return interaction.reply({ content: "Only the challenger can pick.", ephemeral: true });
  }
  if (ticket?.status === "picked") {
    return interaction.reply({ content: "This ticket already has a challenge.", ephemeral: true });
  }

  const targetId = interaction.values[0];
  const cfg = getLeaderboardConfig(interaction.guild.id);
  const ticketsCfg = challengeTicketsOf(cfg);
  const slots = filledSlots(interaction.guild.id);
  const busy = await busySet(interaction.guild.id);
  const allowed = validTargets(slots, userId, ticketsCfg, busy);
  if (!allowed.some((slot) => slot.discordId === String(targetId))) {
    return interaction.reply({
      content: "You can't challenge that player. They may be behind you, out of range, or already challenged.",
      ephemeral: true,
    });
  }

  try {
    await Promise.resolve(api.challenges.createChallenge(interaction.guild.id, userId, targetId));
  } catch (err) {
    return interaction.reply({ content: err.message || "Could not create that challenge.", ephemeral: true });
  }

  setTicket(interaction.guild.id, interaction.channel.id, { status: "picked", targetId });
  setPending(interaction.guild.id, userId, { status: "picked", targetId });

  await interaction.channel.permissionOverwrites
    .edit(targetId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    })
    .catch(() => {});

  try {
    const { refreshLeaderboard } = require("../leaderboard/renderer");
    await refreshLeaderboard(interaction.guild);
  } catch {}

  const myPos = positionOf(slots, userId);
  const theirPos = positionOf(slots, targetId);
  await interaction.update({
    embeds: [
      tsbEmbed({
        title: "Challenge sent",
        color: COLOR_SUCCESS,
        description:
          `<@${userId}> (#${myPos}) challenged <@${targetId}> (#${theirPos}).\n\n` +
          "Both players can use this ticket. Staff can close it when the match is done.",
      }),
    ],
    components: [closeRow()],
  });
  await interaction.channel.send({
    content: `<@${targetId}> you were challenged by <@${userId}>.`,
    allowedMentions: { users: [targetId, userId] },
  }).catch(() => {});
}

async function closeTicket(interaction) {
  const cfg = getLeaderboardConfig(interaction.guild.id);
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const userId = ticket?.userId || interaction.channel.topic?.replace(/^challenge:/, "");
  const allowed =
    String(interaction.user.id) === String(userId) ||
    String(interaction.user.id) === String(ticket?.targetId) ||
    canStaff(interaction.member, interaction.guild, cfg);
  if (!allowed) {
    return interaction.reply({ content: "You can't close this ticket.", ephemeral: true });
  }

  if (userId) {
    try {
      if (api.challenges.clearInvolving) {
        await Promise.resolve(api.challenges.clearInvolving(interaction.guild.id, userId));
      } else if (api.challenges.clearChallenge) {
        await Promise.resolve(api.challenges.clearChallenge(interaction.guild.id, userId));
      }
    } catch {}
    setPending(interaction.guild.id, userId, null);
  }
  setTicket(interaction.guild.id, interaction.channel.id, { status: "closed" });

  try {
    const { refreshLeaderboard } = require("../leaderboard/renderer");
    await refreshLeaderboard(interaction.guild);
  } catch {}

  await interaction.reply({
    embeds: [tsbEmbed({ title: "Ticket closed", color: COLOR_DANGER, description: "Closing this channel in 5 seconds." })],
  });
  setTimeout(() => interaction.channel.delete("Challenge ticket closed").catch(() => {}), 5000);
}

async function handleChallengeTickets(interaction) {
  const id = interaction.customId || "";
  if (id !== START_ID && id !== PICK_ID && id !== CLOSE_ID) return false;
  if (id === START_ID && interaction.isButton?.()) {
    await openTicket(interaction);
    return true;
  }
  if (id === PICK_ID && interaction.isStringSelectMenu?.()) {
    await pickTarget(interaction);
    return true;
  }
  if (id === CLOSE_ID && interaction.isButton?.()) {
    await closeTicket(interaction);
    return true;
  }
  return false;
}

module.exports = {
  publishPanel,
  panelPayload,
  handleChallengeTickets,
};
