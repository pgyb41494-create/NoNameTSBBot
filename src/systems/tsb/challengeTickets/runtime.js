const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const api = require("../../../utils/loadApi");
const { brand } = api;
const { tsbEmbed, COLOR_PRIMARY, COLOR_SURFACE, COLOR_SUCCESS, COLOR_DANGER, COLOR_WARN } = require("../shared/embeds");
const { isAdminOrOwner, memberHasAnyRole } = require("../shared/permissions");
const { getLeaderboardConfig, updateLeaderboardConfig, challengeTicketsOf, spotsAheadFor, formatChallengeRules, challengeStaffRoleIds, boardsForUser, getBoardById, filledSlotsOf } = require("../leaderboard/config");
const { getOrCreateNamedChannel } = require("../shared/channelReuse");
const { applyMatchResult, canUseScore, parseScore } = require("../score/system");
const { getScoreConfig } = require("../score/config");
const { setTicket, getTicket, setPending, findOpenTicket, ensureNoStaleOpenTicket } = require("./store");
const { buildTicketTranscript, transcriptAuditEmbed } = require("../shared/transcript");

const START_ID = "tsb:chaltix:start";
const BOARD_PICK_ID = "tsb:chaltix:board";
const PICK_ID = "tsb:chaltix:pick";
const PICK_BTN_PREFIX = "tsb:chaltix:pickbtn:";
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
const AUTOWIN_ID = "tsb:chaltix:autowin";
const POST_ID = "tsb:chaltix:post";
const SCORE_MODAL_ID = "tsb:chaltix:scoremodal";

async function filledSlots(guildId, boardId = "main") {
  const cfg = await getLeaderboardConfig(guildId);
  const board = getBoardById(cfg, boardId || "main");
  return filledSlotsOf(board);
}

function positionOf(slots, userId) {
  return slots.find((slot) => slot.discordId === String(userId))?.position || null;
}

function resolveTicketBoardId(cfg, userId, preferredBoardId = null) {
  const mine = boardsForUser(cfg, userId);
  if (!mine.length) return null;
  if (preferredBoardId && mine.some((board) => board.id === preferredBoardId)) {
    return preferredBoardId;
  }
  if (mine.length === 1) return mine[0].id;
  return preferredBoardId || null;
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

async function clearChallengeTicketRecords(guild, userId, channelId) {
  if (!guild || !userId) return;
  const guildId = guild.id;
  setPending(guildId, userId, null);
  if (channelId) setTicket(guildId, channelId, null);
  try {
    if (api.challenges.clearInvolving) {
      await Promise.resolve(api.challenges.clearInvolving(guildId, userId));
    } else if (api.challenges.clearChallenge) {
      await Promise.resolve(api.challenges.clearChallenge(guildId, userId));
    }
  } catch {}
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

function brandIcon(client) {
  return (
    client?.user?.displayAvatarURL?.({ extension: "png", size: 256 }) ||
    brand?.thumbnail ||
    null
  );
}

function brandBanner() {
  return brand?.banner || brand?.defaultGif || null;
}

async function panelPayload(guild) {
  const thumb = brandIcon(guild.client);
  const banner = brandBanner();
  return {
    embeds: [
      challengeCard({
        title: "Challenge tickets",
        color: COLOR_PRIMARY,
        description: "Challenge someone on the leaderboard.",
        footer: "Leaderboard players only",
        footerIcon: thumb,
        thumbnail: thumb,
        image: banner,
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

function ticketStaffRoles(cfg, guild = null) {
  const tickets = challengeTicketsOf(cfg);
  const ids = [...(tickets.supportRoleIds || []), ...(cfg.allowedRoles || [])]
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const unique = [...new Set(ids)];
  if (!guild) return unique;
  return unique.filter((id) => guild.roles.cache.has(id));
}

function ticketOverwrites(guild, user, staffRoleIds) {
  const botId = guild.members.me?.id || guild.client?.user?.id;
  const overwrites = [
    {
      id: guild.id,
      type: OverwriteType.Role,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: user.id,
      type: OverwriteType.Member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];
  if (botId) {
    overwrites.push({
      id: botId,
      type: OverwriteType.Member,
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
    if (!guild.roles.cache.has(String(roleId))) continue;
    overwrites.push({
      id: String(roleId),
      type: OverwriteType.Role,
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

function pickButtonRows(namedTargets) {
  const rows = [];
  const slice = namedTargets.slice(0, 25);
  for (let i = 0; i < slice.length; i += 5) {
    const chunk = slice.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder().addComponents(
        ...chunk.map((slot) =>
          new ButtonBuilder()
            .setCustomId(`${PICK_BTN_PREFIX}${slot.discordId}`)
            .setLabel(`#${slot.position} ${slot.name}`.slice(0, 80))
            .setStyle(ButtonStyle.Primary)
        )
      )
    );
  }
  return rows;
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

function autowinScoreForFormat(format) {
  return format === "ft5" ? "5-0" : "10-0";
}

function notesWantAutowin(raw) {
  const text = String(raw || "").toLowerCase();
  return /\bautowin\b/.test(text) || /\bauto\s*win\b/.test(text) || /(^|[^\w])auto([^\w]|$)/.test(text);
}

function isCrossRegion(ticket) {
  return Boolean(ticket?.hostCrossRegion);
}

function parseRegionLine(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const match = text.match(/^(.*?)(\d+)\s*[-–—:xX]\s*(\d+)\s*$/);
  if (!match) return null;
  const label = match[1].trim().replace(/[·|,/:;-]+$/, "").trim() || "Region";
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
  if (isAdminOrOwner(member, guild)) return true;
  try {
    const lb = await getLeaderboardConfig(guild.id);
    if (canStaff(member, guild, lb)) return true;
    const score = await getScoreConfig(guild.id);
    return canUseScore(member, guild, score);
  } catch {
    return false;
  }
}

async function ephemeral(interaction, content) {
  const payload = { content, ephemeral: true };
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

async function scoringGuard(interaction, { defer = true } = {}) {
  const ticket = loadLiveTicket(interaction);
  if (!ticket?.targetId) {
    await ephemeral(interaction, "This is not a challenge ticket.");
    return null;
  }
  if (ticket.status !== "scoring") {
    await ephemeral(interaction, "Tap **Record result** first.");
    return null;
  }
  if (defer && !interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }
  if (!(await canFinishMatch(interaction.member, interaction.guild))) {
    await ephemeral(interaction, "Only staff can record this result.");
    return null;
  }
  return ticket;
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

function challengeCard({ title, color, description, fields, footer, footerIcon, thumbnail, image }) {
  return tsbEmbed({
    title,
    color: color ?? COLOR_SURFACE,
    description,
    fields: (fields || []).filter((field) => field && field.value),
    footer: footer ?? "Ascendant · challenge",
    footerIcon,
    timestamp: true,
    thumbnail,
    image,
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
      .setStyle(ticket.format === "ft10" ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CLOSE_ID)
      .setLabel("Close ticket")
      .setStyle(ButtonStyle.Secondary)
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
        description:
          "Queue up and play the set.\n\n" +
          "When you're finished, staff taps **Record result** and fills format, host, winner, and score.",
        fields: [
          fv("Challenger", `<@${ticket.userId}>`),
          fv("Defender", `<@${ticket.targetId}>`),
        ],
        footer: "Staff: Record result after the set",
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(DONE_ID).setLabel("Record result").setStyle(ButtonStyle.Success)
      ),
      closeRow(),
    ],
  };
}

function mark(done, label) {
  return `${done ? "✅" : "⬜"} ${label}`;
}

function missingScoreSteps(ticket, scoreModuleReady = true) {
  const missing = [];
  if (!ticket.format) missing.push("format");
  if (!hasHost(ticket)) missing.push("host");
  if (!ticket.winnerId) missing.push("winner");
  if (!ticket.scoreDisplay) missing.push(isCrossRegion(ticket) ? "region scores" : "score");
  if (!ticket.resultChannelId) missing.push("results channel");
  if (!scoreModuleReady) missing.push("Score setup");
  return missing;
}

function scoringPayload(ticket, names, scoreModuleReady = true, scoreCfg = null) {
  const missing = missingScoreSteps(ticket, scoreModuleReady);
  const ready = missing.length === 0;
  const winnerAvatar =
    String(ticket.winnerId) === String(ticket.userId)
      ? names.challengerAvatar
      : String(ticket.winnerId) === String(ticket.targetId)
        ? names.defenderAvatar
        : null;
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(CHANNEL_ID)
    .setPlaceholder("Required: pick where to post the result")
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (ticket.resultChannelId) {
    try { channelSelect.setDefaultChannels([String(ticket.resultChannelId)]); } catch {}
  }

  const checklist = [
    mark(Boolean(ticket.format), "Format"),
    mark(hasHost(ticket), "Host"),
    mark(Boolean(ticket.winnerId), "Winner"),
    mark(Boolean(ticket.scoreDisplay), ticket.isAutowin ? "Score (autowin)" : "Score"),
    mark(Boolean(ticket.resultChannelId), "Channel"),
  ].join(" · ");

  const threshold = Math.max(1, Number(scoreCfg?.autowinThreshold) || 3);
  const autowinOn = scoreCfg?.autowinEnabled !== false;
  const loserId =
    ticket.winnerId && ticket.userId && ticket.targetId
      ? String(ticket.winnerId) === String(ticket.userId)
        ? ticket.targetId
        : ticket.userId
      : null;

  const fields = [
    fv("Match", `<@${ticket.userId}> vs <@${ticket.targetId}>`, false),
    fv("Progress", checklist, false),
    fv("Format", formatLabel(ticket.format)),
    fv("Host", hostLabel(ticket)),
    fv("Winner", ticket.winnerId ? `<@${ticket.winnerId}>` : "Not set"),
    fv(
      "Score",
      ticket.isAutowin
        ? `Auto win to ${ticket.winnerId ? `<@${ticket.winnerId}>` : "—"}`
        : ticket.scoreDisplay || "Not set"
    ),
  ];
  if (ticket.isAutowin) {
    fields.push(
      fv(
        "Autowin strike",
        !autowinOn
          ? "Strikes disabled in Score setup"
          : loserId
            ? `<@${loserId}> gets +1 · threshold **${threshold}** (change in \`'setup\` → Score)`
            : `Loser gets +1 · threshold **${threshold}** (change in \`'setup\` → Score)`,
        false
      )
    );
  }
  if (isCrossRegion(ticket)) {
    fields.push(fv("Regions", regionLine(ticket) || "Enter both region scores", false));
  }
  fields.push(fv("Post to", ticket.resultChannelId ? `<#${ticket.resultChannelId}>` : "Not set", false));
  if (!scoreModuleReady) {
    fields.push(
      fv(
        "Score module",
        "Not set up — an admin must run `'setup` → **Score** before posting.",
        false
      )
    );
  }

  const stillNeed = missing.length
    ? `**Still need:** ${missing.join(" · ")}\n\n`
    : "";
  const baseDescription = isCrossRegion(ticket)
    ? "Cross-region: tap **Enter region scores** and put winner’s games first (`Chicago 5-3` or just `5-3`). **Post result** turns green only when every step is filled."
    : "Pick winner, score (or Autowin), and the results channel. **Post result** turns green only when every step is filled.";

  return {
    content: null,
    allowedMentions: { users: [] },
    embeds: [
      challengeCard({
        title: "Record result",
        color: ready ? COLOR_SUCCESS : COLOR_PRIMARY,
        description: !scoreModuleReady
          ? `⚠️ **Score isn’t set up yet.**\nAn admin needs to run \`'setup\` → **Score** before this result can be posted.\n\n${stillNeed}${baseDescription}`
          : `${stillNeed}${baseDescription}`,
        fields,
        footer: !scoreModuleReady
          ? "Enable Score in 'setup first"
          : ready
            ? "Ready to post"
            : "Gray Post result = still missing a step",
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
          .setLabel(
            ticket.scoreDisplay
              ? (isCrossRegion(ticket) ? "Edit region scores" : "Edit score")
              : (isCrossRegion(ticket) ? "Enter region scores" : "Enter score")
          )
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(AUTOWIN_ID)
          .setLabel(ticket.isAutowin ? "Autowin ✓" : "Autowin")
          .setStyle(ticket.isAutowin ? ButtonStyle.Danger : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(POST_ID)
          .setLabel(ready ? "Post result" : scoreModuleReady ? "Post when ready" : "Setup Score first")
          .setStyle(ready ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(!ready)
      ),
      new ActionRowBuilder().addComponents(channelSelect),
    ],
  };
}

async function refreshMatchMessage(interaction, ticket) {
  const names = await matchNames(interaction.guild, ticket);
  let scoreModuleReady = true;
  let scoreCfg = null;
  try {
    scoreCfg = await getScoreConfig(interaction.guild.id);
    scoreModuleReady = !!scoreCfg?.setupCompleted;
  } catch {
    scoreModuleReady = false;
  }
  const payload =
    ticket.status === "scoring"
      ? scoringPayload(ticket, names, scoreModuleReady, scoreCfg)
      : setupPayload(ticket, names);
  if (interaction.isModalSubmit?.()) {
    const fromId = ticket.setupMessageId
      ? await interaction.channel.messages.fetch(ticket.setupMessageId).catch(() => null)
      : null;
    const msg = interaction.message || fromId;
    if (msg) await msg.edit(payload).catch(() => {});
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Score saved.", ephemeral: true });
    }
    return;
  }
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }
    return await interaction.update(payload);
  } catch (err) {
    console.error("challenge refresh failed:", err);
    await ephemeral(interaction, err.message || "Could not update the result card.");
  }
}

async function ticketPayload(guild, userId, boardId = null) {
  const cfg = await getLeaderboardConfig(guild.id);
  const tickets = challengeTicketsOf(cfg);
  const mine = boardsForUser(cfg, userId);
  const resolvedBoardId = resolveTicketBoardId(cfg, userId, boardId);

  if (!resolvedBoardId && mine.length > 1) {
    return {
      embeds: [
        challengeCard({
          title: "Pick your board",
          color: COLOR_PRIMARY,
          description:
            "You're on more than one leaderboard. Choose which board this challenge is for.",
          fields: [
            fv("Your boards", mine.map((board) => `• **${board.title}**`).join("\n"), false),
          ],
          footer: "Challenges only use players from the board you pick",
        }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(BOARD_PICK_ID)
            .setPlaceholder("Select a leaderboard")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              mine.slice(0, 25).map((board) => {
                const pos = positionOf(filledSlotsOf(board), userId);
                return {
                  label: String(board.title || board.id).slice(0, 100),
                  value: board.id,
                  description: (pos ? `You're #${pos}` : board.id).slice(0, 100),
                };
              })
            )
        ),
        closeRow(),
      ],
    };
  }

  const activeBoardId = resolvedBoardId || mine[0]?.id || "main";
  const board = getBoardById(cfg, activeBoardId) || mine[0];
  const slots = filledSlotsOf(board);
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
    title: "Pick who to challenge",
    color: COLOR_PRIMARY,
    description:
      `**Board:** ${board?.title || "Main board"}\n\n` +
      `${shortBoardLines(slots, busy)}\n\n` +
      (targets.length
        ? "Tap a **player button** below to challenge **one** player in your range."
        : emptyNote),
    fields: [
      fv("Your spot", myPos ? `#${myPos}` : "—"),
      fv("Your range", `up to ${ahead} ahead (${range})`),
      fv("Available", `${targets.length} player${targets.length === 1 ? "" : "s"}`),
    ],
    footer: targets.length ? "Tap a player · Close or Delete anytime" : emptyNote,
  });

  const components = [];
  if (targets.length) {
    // Discord select menus do not fire when re-selecting the only option.
    // Prefer buttons so one-player ranges always work.
    const named = [];
    for (const slot of targets.slice(0, 25)) {
      const member = await guild.members.fetch(slot.discordId).catch(() => null);
      const name = member?.displayName || member?.user?.username || slot.discordId;
      named.push({ ...slot, name });
    }
    components.push(...pickButtonRows(named));
    if (named.length > 5) {
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(PICK_ID)
            .setPlaceholder("Or choose from the full list")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              named.map((slot) => ({
                label: `#${slot.position} ${slot.name}`.slice(0, 100),
                description: `Spot #${slot.position}`.slice(0, 100),
                value: slot.discordId,
              }))
            )
        )
      );
    }
  }
  components.push(closeRow());
  return { embeds: [embed], components };
}

async function openTicket(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }
  const guild = interaction.guild;
  const cfg = await getLeaderboardConfig(guild.id);
  const ticketsCfg = challengeTicketsOf(cfg);
  if (!ticketsCfg.enabled) {
    return interaction.editReply({ content: "Challenge tickets are not set up." });
  }

  const mine = boardsForUser(cfg, interaction.user.id);
  if (!mine.length) {
    return interaction.editReply({
      content: "You must be on a leaderboard to open a challenge ticket.",
    });
  }
  const boardId = mine.length === 1 ? mine[0].id : null;

  await ensureNoStaleOpenTicket(guild, interaction.user.id);

  const existing = findOpenTicket(guild.id, interaction.user.id);
  if (existing?.ticketChannelId) {
    const ch = await guild.channels.fetch(existing.ticketChannelId).catch(() => null);
    if (ch) {
      return interaction.editReply({ content: `You already have a ticket: ${ch}` });
    }
    await ensureNoStaleOpenTicket(guild, interaction.user.id);
  }

  let busy = await busySet(guild.id);
  if (busy.has(String(interaction.user.id))) {
    const openRow = findOpenTicket(guild.id, interaction.user.id);
    if (!openRow) {
      try {
        if (api.challenges.clearInvolving) {
          await Promise.resolve(api.challenges.clearInvolving(guild.id, interaction.user.id));
        } else if (api.challenges.clearChallenge) {
          await Promise.resolve(api.challenges.clearChallenge(guild.id, interaction.user.id));
        }
      } catch {}
      busy = await busySet(guild.id);
    }
    if (busy.has(String(interaction.user.id)) && findOpenTicket(guild.id, interaction.user.id)) {
      return interaction.editReply({
        content: "You already have an open challenge.",
      });
    }
  }

  try {
    if (guild.roles.cache.size <= 1) {
      await guild.roles.fetch().catch(() => null);
    }
  } catch {}

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

  let channel;
  try {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category?.id || null,
      topic: `challenge:${interaction.user.id}`,
      permissionOverwrites: ticketOverwrites(guild, interaction.user, ticketStaffRoles(cfg, guild)),
      reason: `Challenge ticket for ${interaction.user.tag || interaction.user.username}`,
    });
  } catch (err) {
    const msg = String(err?.message || "");
    const friendly = /cached User or Role/i.test(msg)
      ? "Could not open the ticket — a staff role in challenge setup is missing from this server. Re-save support roles in setup, then try again."
      : (err.message || "Could not create a challenge ticket channel.");
    return interaction.editReply({ content: friendly });
  }

  setPending(guild.id, interaction.user.id, {
    status: "open",
    ticketChannelId: channel.id,
    boardId,
    at: Date.now(),
  });
  setTicket(guild.id, channel.id, { userId: interaction.user.id, status: "open", boardId });

  const payload = await ticketPayload(guild, interaction.user.id, boardId);
  const pingRoles = challengeStaffRoleIds(ticketsCfg, cfg.allowedRoles)
    .map(String)
    .filter((id) => guild.roles.cache.has(id));
  const staffPing = pingRoles.map((id) => `<@&${id}>`).join(" ");
  await channel.send({
    content: `${interaction.user} ${staffPing}`.trim(),
    allowedMentions: { users: [interaction.user.id], roles: pingRoles },
    ...payload,
  });

  return interaction.editReply({ content: `Ticket opened: ${channel}` });
}

async function pickTarget(interaction, forcedTargetId = null) {
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const userId = ticket?.userId || interaction.channel.topic?.replace(/^challenge:/, "");
  if (!userId) {
    return ephemeral(interaction, "This is not a challenge ticket.");
  }
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }
  const cfg = await getLeaderboardConfig(interaction.guild.id);
  if (String(interaction.user.id) !== String(userId) && !canStaff(interaction.member, interaction.guild, cfg)) {
    return ephemeral(interaction, "Only the challenger can pick.");
  }
  if (ticket?.status === "picked" || ticket?.status === "accepted") {
    return ephemeral(interaction, "This ticket already has a challenge.");
  }

  const targetId = forcedTargetId || interaction.values?.[0];
  if (!targetId) {
    return ephemeral(interaction, "Pick a player first.");
  }
  const ticketsCfg = challengeTicketsOf(cfg);
  const boardId = resolveTicketBoardId(cfg, userId, ticket?.boardId);
  if (!boardId) {
    return ephemeral(interaction, "Pick which leaderboard this challenge is for first.");
  }
  const slots = await filledSlots(interaction.guild.id, boardId);
  let busy = await busySet(interaction.guild.id);
  // Clear stale challenge rows that block picks when no live ticket exists.
  if (busy.has(String(userId))) {
    try {
      if (api.challenges.clearInvolving) {
        await Promise.resolve(api.challenges.clearInvolving(interaction.guild.id, userId));
      } else if (api.challenges.clearChallenge) {
        await Promise.resolve(api.challenges.clearChallenge(interaction.guild.id, userId));
      }
      busy = await busySet(interaction.guild.id);
    } catch {}
  }
  const allowed = validTargets(slots, userId, ticketsCfg, busy);
  if (!allowed.some((slot) => slot.discordId === String(targetId))) {
    return ephemeral(
      interaction,
      "You can't challenge that player. They may be behind you, out of range, or already challenged."
    );
  }

  try {
    await Promise.resolve(api.challenges.createChallenge(interaction.guild.id, userId, targetId));
  } catch (err) {
    return ephemeral(interaction, err.message || "Could not create that challenge.");
  }

  setTicket(interaction.guild.id, interaction.channel.id, { status: "picked", targetId, boardId });
  setPending(interaction.guild.id, userId, { status: "picked", targetId, boardId });

  const targetMember = await interaction.guild.members.fetch(String(targetId)).catch(() => null);
  if (targetMember) {
    await interaction.channel.permissionOverwrites
      .edit(
        targetMember,
        {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        },
        "Challenge target access"
      )
      .catch(() => {});
  }

  await refreshBoard(interaction.guild);

  const myPos = positionOf(slots, userId);
  const theirPos = positionOf(slots, targetId);
  const dodge = await dodgeOf(interaction.guild.id, targetId);
  await interaction.editReply({
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
    return ephemeral(interaction, "This is not a challenge ticket.");
  }
  if (String(interaction.user.id) !== String(targetId)) {
    return ephemeral(interaction, "Only the challenged player can accept.");
  }
  if (ticket.status !== "picked") {
    return ephemeral(interaction, "This challenge is no longer waiting for a response.");
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  try {
    if (api.challenges.acceptChallenge) {
      await Promise.resolve(api.challenges.acceptChallenge(interaction.guild.id, challengerId));
    }
  } catch {}

  setTicket(interaction.guild.id, interaction.channel.id, { status: "accepted" });
  setPending(interaction.guild.id, challengerId, { status: "accepted" });

  await interaction.editReply({
    content: `<@${targetId}> accepted.`,
    allowedMentions: { users: [targetId, challengerId] },
    embeds: [
      challengeCard({
        title: "Challenge accepted",
        color: COLOR_SUCCESS,
        description:
          "Play the set now.\n\nWhen finished, staff taps **Record result** to set format, host, winner, score, and post it.",
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
    return ephemeral(interaction, "This is not a challenge ticket.");
  }
  if (String(interaction.user.id) !== String(targetId)) {
    return ephemeral(interaction, "Only the challenged player can decline.");
  }
  if (ticket.status !== "picked") {
    return ephemeral(interaction, "This challenge is no longer waiting for a response.");
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  const before = await dodgeOf(interaction.guild.id, targetId);
  if (before.remaining <= 0) {
    return ephemeral(interaction, "You have no dodges left. You must accept.");
  }

  let after = before;
  try {
    if (api.challenges.useDodge) {
      after = await Promise.resolve(api.challenges.useDodge(interaction.guild.id, targetId));
    } else {
      after = { ...before, used: before.used + 1, remaining: before.remaining - 1 };
    }
  } catch (err) {
    return ephemeral(interaction, err.message || "You must accept.");
  }

  try {
    await Promise.resolve(api.challenges.clearInvolving(interaction.guild.id, challengerId));
  } catch {}
  setTicket(interaction.guild.id, interaction.channel.id, { status: "declined" });
  setPending(interaction.guild.id, challengerId, null);
  await refreshBoard(interaction.guild);

  await interaction.editReply({
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
  const declineGuild = interaction.guild;
  const declineUserId = challengerId;
  const declineChannelId = interaction.channel.id;
  setTimeout(() => {
    interaction.channel.delete("Challenge declined").catch(() => {});
    clearChallengeTicketRecords(declineGuild, declineUserId, declineChannelId).catch(() => {});
  }, 5000);
}

async function closeTicket(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }
  const cfg = await getLeaderboardConfig(interaction.guild.id);
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const userId = ticket?.userId || interaction.channel.topic?.replace(/^challenge:/, "");
  const isTarget = String(interaction.user.id) === String(ticket?.targetId);
  const isChallenger = String(interaction.user.id) === String(userId);
  const staff = canStaff(interaction.member, interaction.guild, cfg);

  if (ticket?.status === "picked" && isTarget && !staff) {
    return ephemeral(interaction, "Use **Yes** or **No** on the challenge. Declining uses a dodge.");
  }

  if (!isChallenger && !isTarget && !staff) {
    return ephemeral(interaction, "You can't close this ticket.");
  }

  if (userId) {
    try {
      if (api.challenges.clearInvolving) {
        await Promise.resolve(api.challenges.clearInvolving(interaction.guild.id, userId));
      } else if (api.challenges.clearChallenge) {
        await Promise.resolve(api.challenges.clearChallenge(interaction.guild.id, userId));
      }
      if (ticket?.targetId && api.challenges.clearInvolving) {
        await Promise.resolve(api.challenges.clearInvolving(interaction.guild.id, ticket.targetId));
      }
    } catch {}
    setPending(interaction.guild.id, userId, null);
  }
  setTicket(interaction.guild.id, interaction.channel.id, null);

  await interaction.editReply({
    content: null,
    allowedMentions: { users: [] },
    embeds: [challengeCard({
      title: "Ticket closed",
      color: COLOR_DANGER,
      description: "Saving transcript, then this channel will be deleted.",
      footer: "Closing in 5 seconds",
    })],
    components: [],
  }).catch(() => {});

  const history = await buildTicketTranscript(interaction.channel, {
    openerId: userId,
    closedById: interaction.user.id,
    panelName: "challenge-tickets",
  }).catch(() => null);

  const ticketsCfg = challengeTicketsOf(cfg);
  const logId = ticketsCfg.auditLogChannelId || cfg.managementChannelId;
  if (logId && history?.file) {
    const logChannel = await interaction.guild.channels.fetch(logId).catch(() => null);
    if (logChannel?.isTextBased?.()) {
      await logChannel.send({
        embeds: [
          transcriptAuditEmbed({
            title: "Challenge ticket closed",
            channel: interaction.channel,
            closedBy: interaction.user,
            openerId: userId,
            panelName: "challenge",
            history,
            extraFields: ticket?.targetId
              ? [{ name: "Target", value: `<@${ticket.targetId}>`, inline: true }]
              : [],
          }),
        ],
        files: [history.file],
      }).catch(() => {});
    }
  }

  await refreshBoard(interaction.guild);
  setTimeout(
    () => interaction.channel.delete("Challenge ticket closed").catch(() => {}),
    5000
  );
}

function loadLiveTicket(interaction) {
  return getTicket(interaction.guild.id, interaction.channel.id);
}

async function handleFormat(interaction, format) {
  const ticket = await scoringGuard(interaction);
  if (!ticket) return;
  const next = { ...ticket, format };
  if (ticket.isAutowin) {
    next.scoreDisplay = autowinScoreForFormat(format);
    next.scoreNotes = "autowin";
  }
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handleHost(interaction, who) {
  const ticket = await scoringGuard(interaction);
  if (!ticket) return;
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
    return ephemeral(interaction, "This is not a challenge ticket.");
  }
  if (ticket.status === "picked") {
    return ephemeral(interaction, "The challenge has to be accepted first.");
  }
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }
  if (!(await canFinishMatch(interaction.member, interaction.guild))) {
    return ephemeral(interaction, "Only staff can record the result.");
  }
  const next = {
    ...ticket,
    status: "scoring",
    setupMessageId: ticket.setupMessageId || interaction.message?.id || null,
  };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handleWinner(interaction, who) {
  const ticket = await scoringGuard(interaction);
  if (!ticket) return;
  const winnerId = who === "chal" ? ticket.userId : ticket.targetId;
  const next = { ...ticket, winnerId };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handleChannelPick(interaction) {
  const ticket = await scoringGuard(interaction);
  if (!ticket) return;
  const resultChannelId = interaction.values?.[0];
  const next = { ...ticket, resultChannelId };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handleEnterScore(interaction) {
  const ticket = await scoringGuard(interaction, { defer: false });
  if (!ticket) return;

  const fields = [];
  const cross = isCrossRegion(ticket);

  if (!cross) {
    const scoreField = new TextInputBuilder()
      .setCustomId("score")
      .setLabel("Score (example 5-3) — replaces autowin")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(12);
    if (ticket.scoreDisplay && !ticket.isAutowin) scoreField.setValue(ticket.scoreDisplay);
    fields.push(new ActionRowBuilder().addComponents(scoreField));
  } else {
    const r1 = new TextInputBuilder()
      .setCustomId("region1")
      .setLabel("Region 1 — Chicago 5-3 or 5-3")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(80);
    const r1Val = [ticket.region1, ticket.region1Score].filter(Boolean).join(" ");
    if (r1Val) r1.setValue(r1Val);

    const r2 = new TextInputBuilder()
      .setCustomId("region2")
      .setLabel("Region 2 — Virginia 5-1 or 5-1")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(80);
    const r2Val = [ticket.region2, ticket.region2Score].filter(Boolean).join(" ");
    if (r2Val) r2.setValue(r2Val);

    fields.push(new ActionRowBuilder().addComponents(r1), new ActionRowBuilder().addComponents(r2));
  }

  const notes = new TextInputBuilder()
    .setCustomId("notes")
    .setLabel("Notes (optional — type autowin to keep it)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(200);
  if (ticket.scoreNotes && !ticket.isAutowin) notes.setValue(ticket.scoreNotes);
  else if (ticket.scoreNotes && ticket.isAutowin && !/^autowin$/i.test(ticket.scoreNotes)) {
    notes.setValue(ticket.scoreNotes.replace(/\bautowin\b/gi, "").trim());
  }
  fields.push(new ActionRowBuilder().addComponents(notes));

  return interaction.showModal(
    new ModalBuilder()
      .setCustomId(SCORE_MODAL_ID)
      .setTitle(cross ? "Cross-region scores" : "Match score")
      .addComponents(...fields)
  );
}

async function handleAutowin(interaction) {
  const ticket = await scoringGuard(interaction);
  if (!ticket) return;
  if (!ticket.format) {
    return ephemeral(interaction, "Pick **FT5** or **FT10** first, then Autowin.");
  }

  if (ticket.isAutowin) {
    const next = {
      ...ticket,
      scoreDisplay: "",
      scoreNotes: "",
      isAutowin: false,
    };
    setTicket(interaction.guild.id, interaction.channel.id, next);
    return refreshMatchMessage(interaction, { ...ticket, ...next });
  }

  const next = {
    ...ticket,
    scoreDisplay: autowinScoreForFormat(ticket.format),
    scoreNotes: "autowin",
    isAutowin: true,
    region1: "",
    region1Score: "",
    region2: "",
    region2Score: "",
  };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handleScoreModal(interaction) {
  const ticket = await scoringGuard(interaction, { defer: false });
  if (!ticket) return;

  let scoreNotes = "";
  try {
    scoreNotes = String(interaction.fields.getTextInputValue("notes") || "").trim();
  } catch {}

  if (isCrossRegion(ticket)) {
    const r1 = parseRegionLine(interaction.fields.getTextInputValue("region1"));
    const r2 = parseRegionLine(interaction.fields.getTextInputValue("region2"));
    if (!r1 || !r2) {
      return ephemeral(
        interaction,
        "Each region needs a score like `5-3` or `Chicago 5-3` (winner's games first)."
      );
    }
    const total = combinedCrossScore(r1, r2);
    const isAutowin = notesWantAutowin(scoreNotes);
    const next = {
      ...ticket,
      scoreDisplay: total.display,
      scoreNotes: isAutowin ? (scoreNotes || "autowin") : scoreNotes,
      isAutowin,
      region1: r1.label,
      region1Score: r1.score.display,
      region2: r2.label,
      region2Score: r2.score.display,
      setupMessageId: ticket.setupMessageId || interaction.message?.id || null,
    };
    setTicket(interaction.guild.id, interaction.channel.id, next);
    return refreshMatchMessage(interaction, { ...ticket, ...next });
  }

  const scoreRaw = interaction.fields.getTextInputValue("score");
  const parsed = parseScore(scoreRaw);
  if (!parsed) {
    return ephemeral(interaction, "Score must look like `5-3` or `10-8`.");
  }

  const isAutowin = notesWantAutowin(scoreNotes);
  const next = {
    ...ticket,
    scoreDisplay: parsed.display,
    scoreNotes: isAutowin ? (scoreNotes || "autowin") : scoreNotes,
    isAutowin,
    region1: "",
    region1Score: "",
    region2: "",
    region2Score: "",
    setupMessageId: ticket.setupMessageId || interaction.message?.id || null,
  };
  setTicket(interaction.guild.id, interaction.channel.id, next);
  return refreshMatchMessage(interaction, { ...ticket, ...next });
}

async function handlePost(interaction) {
  const ticket = await scoringGuard(interaction);
  if (!ticket) return;
  const missing = missingScoreSteps(ticket, true);
  if (missing.length) {
    return ephemeral(interaction, `Still need: **${missing.join(" · ")}**.`);
  }

  let scoreCfg = null;
  try {
    scoreCfg = await getScoreConfig(interaction.guild.id);
  } catch {}
  if (!scoreCfg?.setupCompleted) {
    return ephemeral(
      interaction,
      "Score isn’t set up yet — this result can’t be posted.\n" +
        "An admin needs to run **`'setup`** → **Score** first, then try again."
    );
  }

  const channel = await interaction.guild.channels.fetch(ticket.resultChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return ephemeral(interaction, "That channel is not available.");
  }

  try {
    const hostNote = ticket.hostCrossRegion ? "Host: Cross-region" : ticket.hostId ? `Host: <@${ticket.hostId}>` : "";
    let scoreNotes = String(ticket.scoreNotes || "").trim();
    if (ticket.isAutowin && !notesWantAutowin(scoreNotes)) {
      scoreNotes = [scoreNotes, "autowin"].filter(Boolean).join(" · ");
    }
    const notes = [formatLabel(ticket.format), hostNote, scoreNotes].filter(Boolean).join(" · ");
    const crossregion = isCrossRegion(ticket);

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
      isAutowin: !!ticket.isAutowin,
      boardId: ticket.boardId || "main",
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
    setPending(interaction.guild.id, ticket.userId, null);

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
    const postGuild = interaction.guild;
    const postUserId = ticket.userId;
    const postChannelId = interaction.channel.id;
    setTimeout(() => {
      interaction.channel.delete("Challenge result posted").catch(() => {});
      clearChallengeTicketRecords(postGuild, postUserId, postChannelId).catch(() => {});
    }, 8000);
  } catch (err) {
    console.error("challenge post failed:", err);
    return interaction.followUp({
      content: err.message || "Could not post that result.",
      ephemeral: true,
    }).catch(() => {});
  }
}

async function pickBoard(interaction) {
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const userId = ticket?.userId || interaction.channel.topic?.replace(/^challenge:/, "");
  if (!userId) {
    return ephemeral(interaction, "This is not a challenge ticket.");
  }
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }
  const cfg = await getLeaderboardConfig(interaction.guild.id);
  if (String(interaction.user.id) !== String(userId) && !canStaff(interaction.member, interaction.guild, cfg)) {
    return ephemeral(interaction, "Only the challenger can pick the board.");
  }
  if (ticket?.status === "picked" || ticket?.status === "accepted") {
    return ephemeral(interaction, "This ticket already has a challenge.");
  }
  const boardId = interaction.values?.[0];
  const mine = boardsForUser(cfg, userId);
  if (!boardId || !mine.some((board) => board.id === boardId)) {
    return ephemeral(interaction, "Pick one of your boards.");
  }
  setTicket(interaction.guild.id, interaction.channel.id, {
    userId,
    status: ticket?.status || "open",
    boardId,
  });
  setPending(interaction.guild.id, userId, {
    status: ticket?.status || "open",
    ticketChannelId: interaction.channel.id,
    boardId,
  });
  return interaction.editReply(await ticketPayload(interaction.guild, userId, boardId));
}

async function handleChallengeTickets(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("tsb:chaltix:")) return false;
  try {
    return await routeChallengeTickets(interaction, id);
  } catch (err) {
    console.error("challenge tickets:", err);
    await ephemeral(interaction, err.message || "Something went wrong with this challenge ticket.").catch(() => {});
    return true;
  }
}

async function routeChallengeTickets(interaction, id) {
  if (id === START_ID && interaction.isButton?.()) {
    await openTicket(interaction);
    return true;
  }
  if (id === BOARD_PICK_ID && interaction.isStringSelectMenu?.()) {
    await pickBoard(interaction);
    return true;
  }
  if (id === PICK_ID && interaction.isStringSelectMenu?.()) {
    await pickTarget(interaction);
    return true;
  }
  if (id.startsWith(PICK_BTN_PREFIX) && interaction.isButton?.()) {
    await pickTarget(interaction, id.slice(PICK_BTN_PREFIX.length));
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
  if (id === AUTOWIN_ID && interaction.isButton?.()) {
    await handleAutowin(interaction);
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
