const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const api = require("../../../utils/loadApi");
const { tsbEmbed, COLOR_PRIMARY, COLOR_SUCCESS, COLOR_DANGER, COLOR_WARN } = require("../shared/embeds");
const { isAdminOrOwner, memberHasAnyRole } = require("../shared/permissions");
const { getLeaderboardConfig, updateLeaderboardConfig, challengeTicketsOf, spotsAheadFor, formatChallengeRules } = require("../leaderboard/config");
const { getOrCreateNamedChannel } = require("../shared/channelReuse");
const { applyMatchResult, canUseScore, parseScore } = require("../score/system");
const { getScoreConfig } = require("../score/config");
const { setTicket, getTicket, setPending, findOpenTicket } = require("./store");

const START_ID = "tsb:chaltix:start";
const PICK_ID = "tsb:chaltix:pick";
const CLOSE_ID = "tsb:chaltix:close";
const YES_ID = "tsb:chaltix:yes";
const NO_ID = "tsb:chaltix:no";
const FMT_FT5_ID = "tsb:chaltix:fmt:ft5";
const FMT_FT10_ID = "tsb:chaltix:fmt:ft10";
const HOST_CHAL_ID = "tsb:chaltix:host:chal";
const HOST_DEF_ID = "tsb:chaltix:host:def";
const HOST_CROSS_ID = "tsb:chaltix:host:cross";
const DONE_ID = "tsb:chaltix:done";
const CHANNEL_ID = "tsb:chaltix:channel";
const WIN_CHAL_ID = "tsb:chaltix:win:chal";
const WIN_DEF_ID = "tsb:chaltix:win:def";
const ENTER_SCORE_ID = "tsb:chaltix:enterscore";
const POST_ID = "tsb:chaltix:post";
const SCORE_MODAL_ID = "tsb:chaltix:scoremodal";

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
      if (row.status && row.status !== "open" && row.status !== "accepted") continue;
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
          "The challenged player has **2 dodges**. After that they must accept.\n" +
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

function acceptRow(remaining) {
  const mustAccept = remaining <= 0;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(YES_ID).setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(NO_ID)
      .setLabel(mustAccept ? "No dodges left" : "No")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(mustAccept)
  );
}

async function dodgeOf(guildId, userId) {
  try {
    if (api.challenges.getDodge) {
      const info = await Promise.resolve(api.challenges.getDodge(guildId, userId));
      if (info && typeof info.remaining === "number") return info;
    }
  } catch {}
  return { used: 0, remaining: 2, max: 2 };
}

async function refreshBoard(guild) {
  try {
    const { refreshLeaderboard } = require("../leaderboard/renderer");
    await refreshLeaderboard(guild);
  } catch {}
}

function formatLabel(format) {
  if (format === "ft10") return "FT10 / Cross-region";
  if (format === "ft5") return "FT5";
  return "not set";
}

function canFinishMatch(member, guild) {
  if (canStaff(member, guild, getLeaderboardConfig(guild.id))) return true;
  return canUseScore(member, guild, getScoreConfig(guild.id));
}

async function matchNames(guild, ticket) {
  const chal = await guild.members.fetch(ticket.userId).catch(() => null);
  const def = await guild.members.fetch(ticket.targetId).catch(() => null);
  return {
    challenger: chal?.displayName || chal?.user?.username || "Challenger",
    defender: def?.displayName || def?.user?.username || "Defender",
  };
}

function hostLabel(ticket) {
  if (ticket?.hostCrossRegion) return "Cross-region";
  if (ticket?.hostId) return `<@${ticket.hostId}>`;
  return "not set";
}

function hasHost(ticket) {
  return Boolean(ticket?.hostCrossRegion || ticket?.hostId);
}

function formatRow(ticket = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(FMT_FT5_ID)
      .setLabel("FT5")
      .setStyle(ticket.format === "ft5" ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(FMT_FT10_ID)
      .setLabel("FT10 / Cross-region")
      .setStyle(ticket.format === "ft10" ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
}

function hostRow(ticket, names) {
  const chalSelected = !ticket.hostCrossRegion && String(ticket.hostId) === String(ticket.userId);
  const defSelected = !ticket.hostCrossRegion && String(ticket.hostId) === String(ticket.targetId);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(HOST_CHAL_ID)
      .setLabel(`${names.challenger} hosts`.slice(0, 80))
      .setStyle(chalSelected ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(HOST_DEF_ID)
      .setLabel(`${names.defender} hosts`.slice(0, 80))
      .setStyle(defSelected ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(HOST_CROSS_ID)
      .setLabel("Cross-region")
      .setStyle(ticket.hostCrossRegion ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
}

function setupPayload(ticket) {
  const users = [ticket.userId, ticket.targetId].filter(Boolean);
  return {
    content: users.map((id) => `<@${id}>`).join(" "),
    allowedMentions: { users },
    embeds: [
      tsbEmbed({
        title: "Match accepted",
        color: COLOR_PRIMARY,
        description:
          `<@${ticket.userId}> vs <@${ticket.targetId}>\n\n` +
          "Play the set. Staff press **Done** to pick host, format, score, and where it posts.",
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(DONE_ID).setLabel("Done").setStyle(ButtonStyle.Success)
      ),
    ],
  };
}

function scoringPayload(ticket, names) {
  const ready = ticket.format && hasHost(ticket) && ticket.winnerId && ticket.scoreDisplay && ticket.resultChannelId;
  const regionLine =
    (ticket.format === "ft10" || ticket.hostCrossRegion) && (ticket.region1Score || ticket.region2Score)
      ? `\n**Regions:** ${ticket.region1 || "—"} ${ticket.region1Score || ""} / ${ticket.region2 || "—"} ${ticket.region2Score || ""}`
      : "";
  return {
    content: "Staff: finish the pre-filled score and choose a channel.",
    allowedMentions: { users: [] },
    embeds: [
      tsbEmbed({
        title: "Record score",
        color: COLOR_PRIMARY,
        description:
          `<@${ticket.userId}> vs <@${ticket.targetId}>\n` +
          `**Format:** ${formatLabel(ticket.format)}\n` +
          `**Host:** ${hostLabel(ticket)}\n` +
          `**Winner:** ${ticket.winnerId ? `<@${ticket.winnerId}>` : "not set"}\n` +
          `**Score:** ${ticket.scoreDisplay || "not set"}` +
          regionLine +
          `\n**Post to:** ${ticket.resultChannelId ? `<#${ticket.resultChannelId}>` : "not set"}\n\n` +
          "Staff: pick format, host, winner, score, and the channel to post.",
      }),
    ],
    components: [
      formatRow(ticket),
      hostRow(ticket, names),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(WIN_CHAL_ID)
          .setLabel(`${names.challenger} won`.slice(0, 80))
          .setStyle(String(ticket.winnerId) === String(ticket.userId) ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(WIN_DEF_ID)
          .setLabel(`${names.defender} won`.slice(0, 80))
          .setStyle(String(ticket.winnerId) === String(ticket.targetId) ? ButtonStyle.Success : ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ENTER_SCORE_ID)
          .setLabel(ticket.scoreDisplay ? "Edit score" : "Enter score")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(POST_ID)
          .setLabel("Post result")
          .setStyle(ButtonStyle.Success)
          .setDisabled(!ready)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(CHANNEL_ID)
          .setPlaceholder("Choose channel to post the score")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
    ],
  };
}

async function refreshMatchMessage(interaction, ticket) {
  const names = await matchNames(interaction.guild, ticket);
  const payload = ticket.status === "scoring" ? scoringPayload(ticket, names) : setupPayload(ticket, names);
  if (interaction.isModalSubmit?.()) {
    const msg = ticket.setupMessageId
      ? await interaction.channel.messages.fetch(ticket.setupMessageId).catch(() => null)
      : null;
    if (msg) await msg.edit(payload).catch(() => {});
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Score saved.", ephemeral: true });
    }
    return;
  }
  return interaction.update(payload);
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
  if (ticket?.status === "picked" || ticket?.status === "accepted") {
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

  await refreshBoard(interaction.guild);

  const myPos = positionOf(slots, userId);
  const theirPos = positionOf(slots, targetId);
  const dodge = await dodgeOf(interaction.guild.id, targetId);
  await interaction.update({
    embeds: [
      tsbEmbed({
        title: "Challenge sent",
        color: COLOR_SUCCESS,
        description:
          `<@${userId}> (#${myPos}) challenged <@${targetId}> (#${theirPos}).\n\n` +
          "Waiting for them to accept.",
      }),
    ],
    components: [closeRow()],
  });

  const must = dodge.remaining <= 0;
  await interaction.channel.send({
    content: `<@${targetId}> do you accept this challenge?`,
    allowedMentions: { users: [targetId] },
    embeds: [
      tsbEmbed({
        title: must ? "You must accept" : "Accept challenge?",
        color: must ? COLOR_WARN : COLOR_PRIMARY,
        description: must
          ? `<@${targetId}> you already used both dodges (**${dodge.used}/${dodge.max}**). You have to accept.`
          : `<@${targetId}> <@${userId}> challenged you for **#${theirPos}**.\n\nDodges left: **${dodge.remaining}/${dodge.max}**`,
      }),
    ],
    components: [acceptRow(dodge.remaining)],
  }).catch(() => {});
}

async function handleAccept(interaction) {
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const challengerId = ticket?.userId;
  const targetId = ticket?.targetId;
  if (!challengerId || !targetId) {
    return interaction.reply({ content: "This is not a challenge ticket.", ephemeral: true });
  }
  if (String(interaction.user.id) !== String(targetId)) {
    return interaction.reply({ content: "Only the challenged player can accept.", ephemeral: true });
  }
  if (ticket.status !== "picked") {
    return interaction.reply({ content: "This challenge is no longer waiting for a response.", ephemeral: true });
  }

  try {
    if (api.challenges.acceptChallenge) {
      await Promise.resolve(api.challenges.acceptChallenge(interaction.guild.id, challengerId));
    }
  } catch {}

  setTicket(interaction.guild.id, interaction.channel.id, { status: "accepted" });
  setPending(interaction.guild.id, challengerId, { status: "accepted" });

  await interaction.update({
    content: `<@${targetId}> accepted.`,
    allowedMentions: { users: [targetId, challengerId] },
    embeds: [
      tsbEmbed({
        title: "Challenge accepted",
        color: COLOR_SUCCESS,
        description:
          `<@${targetId}> accepted <@${challengerId}>'s challenge.\n\n` +
          "Next: play the set. Staff will pick host, format, and post the score.",
      }),
    ],
    components: [closeRow()],
  });

  const names = await matchNames(interaction.guild, { userId: challengerId, targetId });
  const setup = await interaction.channel.send(setupPayload({ userId: challengerId, targetId }, names)).catch(() => null);
  if (setup) {
    setTicket(interaction.guild.id, interaction.channel.id, { setupMessageId: setup.id });
  }
}

async function handleDecline(interaction) {
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const challengerId = ticket?.userId;
  const targetId = ticket?.targetId;
  if (!challengerId || !targetId) {
    return interaction.reply({ content: "This is not a challenge ticket.", ephemeral: true });
  }
  if (String(interaction.user.id) !== String(targetId)) {
    return interaction.reply({ content: "Only the challenged player can decline.", ephemeral: true });
  }
  if (ticket.status !== "picked") {
    return interaction.reply({ content: "This challenge is no longer waiting for a response.", ephemeral: true });
  }

  const before = await dodgeOf(interaction.guild.id, targetId);
  if (before.remaining <= 0) {
    return interaction.reply({
      content: "You have no dodges left. You must accept.",
      ephemeral: true,
    });
  }

  let after = before;
  try {
    if (api.challenges.useDodge) {
      after = await Promise.resolve(api.challenges.useDodge(interaction.guild.id, targetId));
    } else {
      after = { ...before, used: before.used + 1, remaining: before.remaining - 1 };
    }
  } catch (err) {
    return interaction.reply({ content: err.message || "You must accept.", ephemeral: true });
  }

  try {
    await Promise.resolve(api.challenges.clearInvolving(interaction.guild.id, challengerId));
  } catch {}
  setTicket(interaction.guild.id, interaction.channel.id, { status: "declined" });
  setPending(interaction.guild.id, challengerId, null);
  await refreshBoard(interaction.guild);

  await interaction.update({
    content: `<@${targetId}> declined.`,
    allowedMentions: { users: [targetId, challengerId] },
    embeds: [
      tsbEmbed({
        title: "Challenge declined",
        color: COLOR_DANGER,
        description:
          `<@${targetId}> used a dodge (**${after.used}/${after.max}** used, **${after.remaining}** left).\n` +
          (after.remaining <= 0
            ? "That was their last dodge — they must accept the next challenge."
            : "Both players are free again."),
      }),
    ],
    components: [],
  });
  await interaction.channel.send({
    content: "Closing this ticket in 5 seconds.",
  }).catch(() => {});
  setTimeout(() => interaction.channel.delete("Challenge declined").catch(() => {}), 5000);
}

async function closeTicket(interaction) {
  const cfg = getLeaderboardConfig(interaction.guild.id);
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const userId = ticket?.userId || interaction.channel.topic?.replace(/^challenge:/, "");
  const isTarget = String(interaction.user.id) === String(ticket?.targetId);
  const isChallenger = String(interaction.user.id) === String(userId);
  const staff = canStaff(interaction.member, interaction.guild, cfg);

  if (ticket?.status === "picked" && isTarget && !staff) {
    return interaction.reply({
      content: "Use **Yes** or **No** on the challenge. Declining uses a dodge.",
      ephemeral: true,
    });
  }

  if (!isChallenger && !isTarget && !staff) {
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
  await refreshBoard(interaction.guild);

  await interaction.reply({
    embeds: [tsbEmbed({ title: "Ticket closed", color: COLOR_DANGER, description: "Closing this channel in 5 seconds." })],
  });
  setTimeout(() => interaction.channel.delete("Challenge ticket closed").catch(() => {}), 5000);
}

function loadLiveTicket(interaction) {
  return getTicket(interaction.guild.id, interaction.channel.id);
}

async function handleFormat(interaction, format) {
  const ticket = loadLiveTicket(interaction);
  if (!ticket?.targetId) {
    return interaction.reply({ content: "This is not a challenge ticket.", ephemeral: true });
  }
  if (!canFinishMatch(interaction.member, interaction.guild)) {
    return interaction.reply({ content: "Only staff picks the format.", ephemeral: true });
  }
  if (ticket.status !== "scoring") {
    return interaction.reply({ content: "Press Done first, then pick FT5 or FT10.", ephemeral: true });
  }
  const next = { ...ticket, format };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handleHost(interaction, who) {
  const ticket = loadLiveTicket(interaction);
  if (!ticket?.targetId) {
    return interaction.reply({ content: "This is not a challenge ticket.", ephemeral: true });
  }
  if (!canFinishMatch(interaction.member, interaction.guild)) {
    return interaction.reply({ content: "Only staff picks the host.", ephemeral: true });
  }
  if (ticket.status !== "scoring") {
    return interaction.reply({ content: "Press Done first, then pick the host.", ephemeral: true });
  }
  const next = {
    ...ticket,
    hostId: who === "cross" ? null : who === "chal" ? ticket.userId : ticket.targetId,
    hostCrossRegion: who === "cross",
  };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handleDone(interaction) {
  const ticket = loadLiveTicket(interaction);
  if (!ticket?.targetId) {
    return interaction.reply({ content: "This is not a challenge ticket.", ephemeral: true });
  }
  if (!canFinishMatch(interaction.member, interaction.guild)) {
    return interaction.reply({ content: "Only staff can press Done.", ephemeral: true });
  }
  if (ticket.status === "picked") {
    return interaction.reply({ content: "The challenge has to be accepted first.", ephemeral: true });
  }
  const next = { ...ticket, status: "scoring" };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handleWinner(interaction, who) {
  const ticket = loadLiveTicket(interaction);
  if (!canFinishMatch(interaction.member, interaction.guild)) {
    return interaction.reply({ content: "Only staff can pick the winner.", ephemeral: true });
  }
  if (ticket?.status !== "scoring") {
    return interaction.reply({ content: "Press Done first.", ephemeral: true });
  }
  const winnerId = who === "chal" ? ticket.userId : ticket.targetId;
  const next = { ...ticket, winnerId };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handleChannelPick(interaction) {
  const ticket = loadLiveTicket(interaction);
  if (!canFinishMatch(interaction.member, interaction.guild)) {
    return interaction.reply({ content: "Only staff can choose the channel.", ephemeral: true });
  }
  if (ticket?.status !== "scoring") {
    return interaction.reply({ content: "Press Done first.", ephemeral: true });
  }
  const resultChannelId = interaction.values?.[0];
  const next = { ...ticket, resultChannelId };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handleEnterScore(interaction) {
  const ticket = loadLiveTicket(interaction);
  if (!canFinishMatch(interaction.member, interaction.guild)) {
    return interaction.reply({ content: "Only staff can enter the score.", ephemeral: true });
  }
  if (ticket?.status !== "scoring") {
    return interaction.reply({ content: "Press Done first.", ephemeral: true });
  }

  const scoreField = new TextInputBuilder()
    .setCustomId("score")
    .setLabel("Score (example 5-3)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(12);
  if (ticket.scoreDisplay) scoreField.setValue(ticket.scoreDisplay);

  const fields = [new ActionRowBuilder().addComponents(scoreField)];

  if (ticket.format === "ft10" || ticket.hostCrossRegion) {
    const r1 = new TextInputBuilder()
      .setCustomId("region1")
      .setLabel("Region 1 (optional, e.g. NA 5-2)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(80);
    const r1Val = [ticket.region1, ticket.region1Score].filter(Boolean).join(" ");
    if (r1Val) r1.setValue(r1Val);

    const r2 = new TextInputBuilder()
      .setCustomId("region2")
      .setLabel("Region 2 (optional, e.g. EU 5-3)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(80);
    const r2Val = [ticket.region2, ticket.region2Score].filter(Boolean).join(" ");
    if (r2Val) r2.setValue(r2Val);

    fields.push(new ActionRowBuilder().addComponents(r1), new ActionRowBuilder().addComponents(r2));
  }

  const notes = new TextInputBuilder()
    .setCustomId("notes")
    .setLabel("Notes (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(200);
  if (ticket.scoreNotes) notes.setValue(ticket.scoreNotes);
  fields.push(new ActionRowBuilder().addComponents(notes));

  return interaction.showModal(
    new ModalBuilder()
      .setCustomId(SCORE_MODAL_ID)
      .setTitle("Match score")
      .addComponents(...fields)
  );
}

async function handleScoreModal(interaction) {
  const ticket = loadLiveTicket(interaction);
  if (!canFinishMatch(interaction.member, interaction.guild)) {
    return interaction.reply({ content: "Only staff can enter the score.", ephemeral: true });
  }
  if (ticket?.status !== "scoring") {
    return interaction.reply({ content: "Press Done first.", ephemeral: true });
  }

  const scoreRaw = interaction.fields.getTextInputValue("score");
  if (!parseScore(scoreRaw)) {
    return interaction.reply({ content: "Score must look like `5-3` or `10-8`.", ephemeral: true });
  }

  let region1 = "";
  let region1Score = "";
  let region2 = "";
  let region2Score = "";
  if (ticket.format === "ft10" || ticket.hostCrossRegion) {
    const r1 = String(interaction.fields.getTextInputValue("region1") || "").trim();
    const r2 = String(interaction.fields.getTextInputValue("region2") || "").trim();
    const split = (raw) => {
      const m = raw.match(/^(.+?)\s+(\d+\s*[-–—:]\s*\d+)$/);
      if (!m) return { label: raw, score: "" };
      return { label: m[1].trim(), score: m[2].replace(/\s+/g, "") };
    };
    if (r1) {
      const parsed = split(r1);
      region1 = parsed.label;
      region1Score = parsed.score || r1;
    }
    if (r2) {
      const parsed = split(r2);
      region2 = parsed.label;
      region2Score = parsed.score || r2;
    }
  }

  let scoreNotes = "";
  try {
    scoreNotes = String(interaction.fields.getTextInputValue("notes") || "").trim();
  } catch {}

  const parsed = parseScore(scoreRaw);
  const next = {
    ...ticket,
    scoreDisplay: parsed.display,
    scoreNotes,
    region1,
    region1Score,
    region2,
    region2Score,
  };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handlePost(interaction) {
  const ticket = loadLiveTicket(interaction);
  if (!canFinishMatch(interaction.member, interaction.guild)) {
    return interaction.reply({ content: "Only staff can post the result.", ephemeral: true });
  }
  if (ticket?.status !== "scoring") {
    return interaction.reply({ content: "Press Done first.", ephemeral: true });
  }
  if (!ticket.winnerId || !ticket.scoreDisplay || !ticket.resultChannelId || !ticket.format || !hasHost(ticket)) {
    return interaction.reply({ content: "Set format, host, winner, score, and channel first.", ephemeral: true });
  }

  const channel = await interaction.guild.channels.fetch(ticket.resultChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return interaction.reply({ content: "That channel is not available.", ephemeral: true });
  }

  await interaction.deferUpdate();

  const hostNote = ticket.hostCrossRegion ? "Host: Cross-region" : ticket.hostId ? `Host: <@${ticket.hostId}>` : "";
  const notes = [formatLabel(ticket.format), hostNote, ticket.scoreNotes].filter(Boolean).join(" · ");
  const crossregion = ticket.format === "ft10" || ticket.hostCrossRegion;

  const result = await applyMatchResult({
    guild: interaction.guild,
    recorderId: interaction.user.id,
    participant1Id: ticket.userId,
    participant2Id: ticket.targetId,
    winnerId: ticket.winnerId,
    scoreRaw: ticket.scoreDisplay,
    matchType: "1v1",
    notes,
    crossregion,
    region1: crossregion ? ticket.region1 || null : null,
    region1Score: crossregion ? ticket.region1Score || null : null,
    region2: crossregion ? ticket.region2 || null : null,
    region2Score: crossregion ? ticket.region2Score || null : null,
  });

  if (result.error) {
    return interaction.followUp({ content: result.error, ephemeral: true });
  }

  try {
    await channel.send({
      content: result.body,
      allowedMentions: result.allowedMentions,
    });
  } catch (err) {
    await interaction.followUp({
      content: `Match was recorded, but posting to ${channel} failed: ${err.message}`,
      ephemeral: true,
    });
    await interaction.followUp({ content: result.body, allowedMentions: result.allowedMentions });
  }

  setTicket(interaction.guild.id, interaction.channel.id, { status: "posted" });
  setPending(interaction.guild.id, ticket.userId, { status: "posted" });

  await interaction.editReply({
    content: `Result posted in ${channel}. Closing this ticket in 8 seconds.`,
    allowedMentions: { users: [] },
    embeds: [
      tsbEmbed({
        title: "Result posted",
        color: COLOR_SUCCESS,
        description: `Posted to ${channel}.\n**${ticket.scoreDisplay}** to <@${ticket.winnerId}>.`,
      }),
    ],
    components: [],
  });
  setTimeout(() => interaction.channel.delete("Challenge result posted").catch(() => {}), 8000);
}

async function handleChallengeTickets(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("tsb:chaltix:")) return false;
  if (id === START_ID && interaction.isButton?.()) {
    await openTicket(interaction);
    return true;
  }
  if (id === PICK_ID && interaction.isStringSelectMenu?.()) {
    await pickTarget(interaction);
    return true;
  }
  if (id === YES_ID && interaction.isButton?.()) {
    await handleAccept(interaction);
    return true;
  }
  if (id === NO_ID && interaction.isButton?.()) {
    await handleDecline(interaction);
    return true;
  }
  if (id === CLOSE_ID && interaction.isButton?.()) {
    await closeTicket(interaction);
    return true;
  }
  if (id === FMT_FT5_ID && interaction.isButton?.()) {
    await handleFormat(interaction, "ft5");
    return true;
  }
  if (id === FMT_FT10_ID && interaction.isButton?.()) {
    await handleFormat(interaction, "ft10");
    return true;
  }
  if (id === HOST_CHAL_ID && interaction.isButton?.()) {
    await handleHost(interaction, "chal");
    return true;
  }
  if (id === HOST_DEF_ID && interaction.isButton?.()) {
    await handleHost(interaction, "def");
    return true;
  }
  if (id === HOST_CROSS_ID && interaction.isButton?.()) {
    await handleHost(interaction, "cross");
    return true;
  }
  if (id === DONE_ID && interaction.isButton?.()) {
    await handleDone(interaction);
    return true;
  }
  if (id === WIN_CHAL_ID && interaction.isButton?.()) {
    await handleWinner(interaction, "chal");
    return true;
  }
  if (id === WIN_DEF_ID && interaction.isButton?.()) {
    await handleWinner(interaction, "def");
    return true;
  }
  if (id === CHANNEL_ID && interaction.isChannelSelectMenu?.()) {
    await handleChannelPick(interaction);
    return true;
  }
  if (id === ENTER_SCORE_ID && interaction.isButton?.()) {
    await handleEnterScore(interaction);
    return true;
  }
  if (id === POST_ID && interaction.isButton?.()) {
    await handlePost(interaction);
    return true;
  }
  if (id === SCORE_MODAL_ID && interaction.isModalSubmit?.()) {
    await handleScoreModal(interaction);
    return true;
  }
  return false;
}

module.exports = {
  publishPanel,
  panelPayload,
  handleChallengeTickets,
};
