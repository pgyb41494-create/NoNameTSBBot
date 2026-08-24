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
const { tsbEmbed, COLOR_PRIMARY, COLOR_SURFACE, COLOR_SUCCESS, COLOR_DANGER, COLOR_WARN } = require("../shared/embeds");
const { isAdminOrOwner, memberHasAnyRole } = require("../shared/permissions");
const { getLeaderboardConfig, updateLeaderboardConfig, challengeTicketsOf, spotsAheadFor, formatChallengeRules, challengeStaffRoleIds } = require("../leaderboard/config");
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

async function filledSlots(guildId) {
  const cfg = await getLeaderboardConfig(guildId);
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

async function panelPayload(guild) {
  const tickets = challengeTicketsOf(await getLeaderboardConfig(guild.id));
  return {
    embeds: [
      challengeCard({
        title: "Challenge tickets",
        color: COLOR_PRIMARY,
        description: "Open a private ticket and challenge **one** player ahead of you.",
        fields: [
          fv("Rules", formatChallengeRules(tickets), false),
          fv("Dodges", "2 per player — after that they have to accept"),
          fv("Blocked", "People behind you, yourself, or anyone already in a challenge"),
        ],
        footer: "Click Challenge to open a ticket",
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(START_ID).setLabel("Challenge").setStyle(ButtonStyle.Primary)
      ),
    ],
  };
}

async function publishPanel(guild, ticketOverride) {
  const cfg = await getLeaderboardConfig(guild.id);
  const tickets = challengeTicketsOf({
    challengeTickets: { ...challengeTicketsOf(cfg), ...(ticketOverride || {}) },
  });
  if (!tickets.enabled && !tickets.channelId) return null;

  const channel = await getOrCreateNamedChannel(guild, {
    channelId: tickets.channelId,
    names: ["challenge-tickets", "challenges"],
    pattern: /^(?:challenge-tickets|challenges)$/,
    createName: "challenge-tickets",
    topic: "Leaderboard challenge tickets",
    reason: "Ascendant challenge tickets panel",
    create: true,
  });
  if (!channel) return null;

  const payload = await panelPayload(guild);
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

  await updateLeaderboardConfig(guild.id, {
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
  const tickets = challengeTicketsOf(cfg);
  return memberHasAnyRole(member, [
    ...(cfg.allowedRoles || []),
    ...(tickets.supportRoleIds || []),
  ]);
}

function ticketStaffRoles(cfg) {
  const tickets = challengeTicketsOf(cfg);
  const ids = [...(tickets.supportRoleIds || []), ...(cfg.allowedRoles || [])];
  return [...new Set(ids.map((id) => String(id)).filter(Boolean))];
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
  if (format === "ft10") return "FT10";
  if (format === "ft5") return "FT5";
  return "Not set";
}

function isCrossRegion(ticket) {
  return Boolean(ticket?.hostCrossRegion);
}

function parseRegionLine(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const match = text.match(/^(.*?)(\d+)\s*[-–—:]\s*(\d+)\s*$/);
  if (!match) return null;
  const label = match[1].trim().replace(/[·|,/-]+$/, "").trim() || "Region";
  const score = parseScore(`${match[2]}-${match[3]}`);
  if (!score) return null;
  return { label, score };
}

function combinedCrossScore(regionA, regionB) {
  if (!regionA?.score || !regionB?.score) return null;
  const left = regionA.score.left + regionB.score.left;
  const right = regionA.score.right + regionB.score.right;
  return { left, right, display: `${left}-${right}` };
}

async function canFinishMatch(member, guild) {
  const lb = await getLeaderboardConfig(guild.id);
  if (canStaff(member, guild, lb)) return true;
  const score = await getScoreConfig(guild.id);
  return canUseScore(member, guild, score);
}

async function matchNames(guild, ticket) {
  const chal = await guild.members.fetch(ticket.userId).catch(() => null);
  const def = await guild.members.fetch(ticket.targetId).catch(() => null);
  return {
    challenger: chal?.displayName || chal?.user?.username || "Challenger",
    defender: def?.displayName || def?.user?.username || "Defender",
    challengerAvatar: chal?.displayAvatarURL?.({ size: 128 }) || null,
    defenderAvatar: def?.displayAvatarURL?.({ size: 128 }) || null,
  };
}

function hostLabel(ticket) {
  if (ticket?.hostCrossRegion) return "Cross-region";
  if (ticket?.hostId) return `<@${ticket.hostId}>`;
  return "Not set";
}

function hasHost(ticket) {
  return Boolean(ticket?.hostCrossRegion || ticket?.hostId);
}

function regionLine(ticket) {
  if (!isCrossRegion(ticket)) return null;
  const a = [ticket.region1, ticket.region1Score].filter(Boolean).join(" ");
  const b = [ticket.region2, ticket.region2Score].filter(Boolean).join(" ");
  if (!a && !b) return null;
  return `${a || "—"}  ·  ${b || "—"}`;
}

function fv(name, value, inline = true) {
  const text = value == null || value === "" ? "—" : String(value);
  return { name, value: text.slice(0, 1024), inline };
}

function challengeCard({ title, color, description, fields, footer, thumbnail }) {
  return tsbEmbed({
    title,
    color: color ?? COLOR_SURFACE,
    description,
    fields: (fields || []).filter((field) => field && field.value),
    footer: footer ?? "Ascendant · challenge",
    timestamp: true,
    thumbnail,
  });
}

function formatRow(ticket = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(FMT_FT5_ID)
      .setLabel("FT5")
      .setStyle(ticket.format === "ft5" ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(FMT_FT10_ID)
      .setLabel("FT10")
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
      challengeCard({
        title: "Ready to play",
        color: COLOR_PRIMARY,
        description: "Queue up and play. Staff will lock in host, format, and the result when you're done.",
        fields: [
          fv("Challenger", `<@${ticket.userId}>`),
          fv("Defender", `<@${ticket.targetId}>`),
        ],
        footer: "Staff: press Done after the set",
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
  const winnerAvatar =
    String(ticket.winnerId) === String(ticket.userId)
      ? names.challengerAvatar
      : String(ticket.winnerId) === String(ticket.targetId)
        ? names.defenderAvatar
        : null;
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(CHANNEL_ID)
    .setPlaceholder("Post result to…")
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (ticket.resultChannelId) {
    try { channelSelect.setDefaultChannels(ticket.resultChannelId); } catch {}
  }

  const fields = [
    fv("Match", `<@${ticket.userId}> vs <@${ticket.targetId}>`, false),
    fv("Format", formatLabel(ticket.format)),
    fv("Host", hostLabel(ticket)),
    fv("Winner", ticket.winnerId ? `<@${ticket.winnerId}>` : "Not set"),
    fv("Score", ticket.scoreDisplay || "Not set"),
  ];
  if (isCrossRegion(ticket)) {
    fields.push(fv("Regions", regionLine(ticket) || "Enter both region scores", false));
  }
  fields.push(fv("Post to", ticket.resultChannelId ? `<#${ticket.resultChannelId}>` : "Not set", false));

  return {
    content: "",
    allowedMentions: { users: [] },
    embeds: [
      challengeCard({
        title: "Record result",
        color: COLOR_PRIMARY,
        description: isCrossRegion(ticket)
          ? "Cross-region totals from the two region scores. Winner's games first, like `Chicago 5-3`."
          : "Pick format, host, winner, score, and the channel to announce it.",
        fields,
        footer: "Same result /score posts — already filled from this ticket",
        thumbnail: winnerAvatar,
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
      new ActionRowBuilder().addComponents(channelSelect),
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
  const cfg = await getLeaderboardConfig(guild.id);
  const tickets = challengeTicketsOf(cfg);
  const slots = await filledSlots(guild.id);
  const busy = await busySet(guild.id);
  const myPos = positionOf(slots, userId);
  const targets = validTargets(slots, userId, tickets, busy);
  const ahead = myPos ? spotsAheadFor(myPos, tickets) : tickets.spotsAhead;
  const minPos = myPos ? Math.max(1, myPos - ahead) : null;

  const range = minPos ? `#${minPos}–#${myPos - 1}` : "—";
  let emptyNote = "Select one player ahead of you.";
  if (!targets.length) {
    emptyNote = myPos === 1
      ? "You're #1 — nobody is ahead of you."
      : "Nobody you can challenge right now.";
  }

  const embed = challengeCard({
    title: "Pick a challenge",
    color: COLOR_PRIMARY,
    description: shortBoardLines(slots, busy),
    fields: [
      fv("Your spot", myPos ? `#${myPos}` : "—"),
      fv("Range", `up to ${ahead} ahead (${range})`),
      fv("Available", `${targets.length} player${targets.length === 1 ? "" : "s"}`),
    ],
    footer: emptyNote,
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
  const cfg = await getLeaderboardConfig(guild.id);
  const ticketsCfg = challengeTicketsOf(cfg);
  if (!ticketsCfg.enabled) {
    return interaction.reply({ content: "Challenge tickets are not set up.", ephemeral: true });
  }

  const slots = await filledSlots(guild.id);
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
    await updateLeaderboardConfig(guild.id, {
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
    permissionOverwrites: ticketOverwrites(guild, interaction.user, ticketStaffRoles(cfg)),
    reason: `Challenge ticket for ${interaction.user.tag || interaction.user.username}`,
  });

  setPending(guild.id, interaction.user.id, {
    status: "open",
    ticketChannelId: channel.id,
    at: Date.now(),
  });
  setTicket(guild.id, channel.id, { userId: interaction.user.id, status: "open" });

  const payload = await ticketPayload(guild, interaction.user.id);
  const pingRoles = challengeStaffRoleIds(ticketsCfg, cfg.allowedRoles);
  const staffPing = pingRoles.map((id) => `<@&${id}>`).join(" ");
  await channel.send({
    content: `${interaction.user} ${staffPing}`.trim(),
    allowedMentions: { users: [interaction.user.id], roles: pingRoles },
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
  const cfg = await getLeaderboardConfig(interaction.guild.id);
  if (String(interaction.user.id) !== String(userId) && !canStaff(interaction.member, interaction.guild, cfg)) {
    return interaction.reply({ content: "Only the challenger can pick.", ephemeral: true });
  }
  if (ticket?.status === "picked" || ticket?.status === "accepted") {
    return interaction.reply({ content: "This ticket already has a challenge.", ephemeral: true });
  }

  const targetId = interaction.values[0];
  const ticketsCfg = challengeTicketsOf(cfg);
  const slots = await filledSlots(interaction.guild.id);
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
      challengeCard({
        title: "Challenge sent",
        color: COLOR_SUCCESS,
        description: "Waiting for them to accept.",
        fields: [
          fv("Challenger", `<@${userId}>  ·  #${myPos}`),
          fv("Defender", `<@${targetId}>  ·  #${theirPos}`),
        ],
        footer: "They have Yes / No on the ping below",
      }),
    ],
    components: [closeRow()],
  });

  const must = dodge.remaining <= 0;
  await interaction.channel.send({
    content: `<@${targetId}> do you accept this challenge?`,
    allowedMentions: { users: [targetId] },
    embeds: [
      challengeCard({
        title: must ? "You have to accept" : "Accept this challenge?",
        color: must ? COLOR_WARN : COLOR_PRIMARY,
        description: must
          ? "Both dodges are already used. **No** is locked."
          : `<@${userId}> challenged you for **#${theirPos}**.`,
        fields: [
          fv("Spot on the line", `#${theirPos}`),
          fv("Dodges left", `${dodge.remaining}/${dodge.max}`),
        ],
        footer: must ? "Press Yes to continue" : "Yes accepts · No uses a dodge",
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
      challengeCard({
        title: "Challenge accepted",
        color: COLOR_SUCCESS,
        description: "Play the set. Staff will pick host, format, and post the result.",
        fields: [
          fv("Challenger", `<@${challengerId}>`),
          fv("Defender", `<@${targetId}>`),
        ],
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
      challengeCard({
        title: "Challenge declined",
        color: COLOR_DANGER,
        description: after.remaining <= 0
          ? "That was their last dodge — they must accept the next one."
          : "Both players are free again.",
        fields: [
          fv("Dodge used", `<@${targetId}>`),
          fv("Dodges", `${after.used}/${after.max} used · ${after.remaining} left`),
        ],
        footer: "Ticket closes in 5 seconds",
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
  const cfg = await getLeaderboardConfig(interaction.guild.id);
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
    embeds: [challengeCard({
      title: "Ticket closed",
      color: COLOR_DANGER,
      description: "This channel will be deleted shortly.",
      footer: "Closing in 5 seconds",
    })],
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
  if (!(await canFinishMatch(interaction.member, interaction.guild))) {
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
  if (!(await canFinishMatch(interaction.member, interaction.guild))) {
    return interaction.reply({ content: "Only staff picks the host.", ephemeral: true });
  }
  if (ticket.status !== "scoring") {
    return interaction.reply({ content: "Press Done first, then pick the host.", ephemeral: true });
  }
  const next = {
    ...ticket,
    hostId: who === "cross" ? null : who === "chal" ? ticket.userId : ticket.targetId,
    hostCrossRegion: who === "cross",
    format: who === "cross" ? (ticket.format || "ft10") : ticket.format,
  };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handleDone(interaction) {
  const ticket = loadLiveTicket(interaction);
  if (!ticket?.targetId) {
    return interaction.reply({ content: "This is not a challenge ticket.", ephemeral: true });
  }
  if (!(await canFinishMatch(interaction.member, interaction.guild))) {
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
  if (!(await canFinishMatch(interaction.member, interaction.guild))) {
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
  if (!(await canFinishMatch(interaction.member, interaction.guild))) {
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
  if (!(await canFinishMatch(interaction.member, interaction.guild))) {
    return interaction.reply({ content: "Only staff can enter the score.", ephemeral: true });
  }
  if (ticket?.status !== "scoring") {
    return interaction.reply({ content: "Press Done first.", ephemeral: true });
  }

  const fields = [];
  const cross = isCrossRegion(ticket);

  if (!cross) {
    const scoreField = new TextInputBuilder()
      .setCustomId("score")
      .setLabel("Score (example 5-3)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(12);
    if (ticket.scoreDisplay) scoreField.setValue(ticket.scoreDisplay);
    fields.push(new ActionRowBuilder().addComponents(scoreField));
  } else {
    const r1 = new TextInputBuilder()
      .setCustomId("region1")
      .setLabel("Region 1 (e.g. Chicago 5-3)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(80);
    const r1Val = [ticket.region1, ticket.region1Score].filter(Boolean).join(" ");
    if (r1Val) r1.setValue(r1Val);

    const r2 = new TextInputBuilder()
      .setCustomId("region2")
      .setLabel("Region 2 (e.g. Virginia 5-1)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
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
      .setTitle(cross ? "Cross-region scores" : "Match score")
      .addComponents(...fields)
  );
}

async function handleScoreModal(interaction) {
  const ticket = loadLiveTicket(interaction);
  if (!(await canFinishMatch(interaction.member, interaction.guild))) {
    return interaction.reply({ content: "Only staff can enter the score.", ephemeral: true });
  }
  if (ticket?.status !== "scoring") {
    return interaction.reply({ content: "Press Done first.", ephemeral: true });
  }

  let scoreNotes = "";
  try {
    scoreNotes = String(interaction.fields.getTextInputValue("notes") || "").trim();
  } catch {}

  if (isCrossRegion(ticket)) {
    const r1 = parseRegionLine(interaction.fields.getTextInputValue("region1"));
    const r2 = parseRegionLine(interaction.fields.getTextInputValue("region2"));
    if (!r1 || !r2) {
      return interaction.reply({
        content: "Each region needs a name and score like `Chicago 5-3` (winner's games first).",
        ephemeral: true,
      });
    }
    const total = combinedCrossScore(r1, r2);
    const next = {
      ...ticket,
      scoreDisplay: total.display,
      scoreNotes,
      region1: r1.label,
      region1Score: r1.score.display,
      region2: r2.label,
      region2Score: r2.score.display,
    };
    setTicket(interaction.guild.id, interaction.channel.id, next);
    return refreshMatchMessage(interaction, { ...ticket, ...next });
  }

  const scoreRaw = interaction.fields.getTextInputValue("score");
  const parsed = parseScore(scoreRaw);
  if (!parsed) {
    return interaction.reply({ content: "Score must look like `5-3` or `10-8`.", ephemeral: true });
  }

  const next = {
    ...ticket,
    scoreDisplay: parsed.display,
    scoreNotes,
    region1: "",
    region1Score: "",
    region2: "",
    region2Score: "",
  };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handlePost(interaction) {
  const ticket = loadLiveTicket(interaction);
  if (!(await canFinishMatch(interaction.member, interaction.guild))) {
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

  try {
    const hostNote = ticket.hostCrossRegion ? "Host: Cross-region" : ticket.hostId ? `Host: <@${ticket.hostId}>` : "";
    const notes = [formatLabel(ticket.format), hostNote, ticket.scoreNotes].filter(Boolean).join(" · ");
    const crossregion = isCrossRegion(ticket) || ticket.format === "ft10";

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
      }).catch(() => {});
    }

    setTicket(interaction.guild.id, interaction.channel.id, { status: "posted" });
    setPending(interaction.guild.id, ticket.userId, { status: "posted" });

    await interaction.editReply({
      content: `Result posted in ${channel}. This ticket closes in 8 seconds.`,
      allowedMentions: { parse: [] },
      embeds: [
        challengeCard({
          title: "Result posted",
          color: COLOR_SUCCESS,
          description: `Sent to ${channel}.`,
          fields: [
            fv("Winner", `<@${ticket.winnerId}>`),
            fv("Score", ticket.scoreDisplay),
            ...(isCrossRegion(ticket) ? [fv("Regions", regionLine(ticket), false)] : []),
          ],
          footer: "Ticket closes in 8 seconds",
        }),
      ],
      components: [],
    });
    setTimeout(() => interaction.channel.delete("Challenge result posted").catch(() => {}), 8000);
  } catch (err) {
    console.error("challenge post failed:", err);
    return interaction.followUp({
      content: err.message || "Could not post that result.",
      ephemeral: true,
    }).catch(() => {});
  }
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
