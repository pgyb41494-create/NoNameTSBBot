const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");
const api = require("../../../utils/loadApi");
const { tsbEmbed, COLOR_PRIMARY, COLOR_SUCCESS, COLOR_DANGER, COLOR_WARN } = require("../shared/embeds");
const { isAdminOrOwner } = require("../shared/permissions");
const { hasAccessPerm } = require("../access/store");
const { brand } = require("../../../utils/loadApi");
const {
  getConfig,
  updateConfig,
  setPending,
  getPending,
  setTicket,
  getTicket,
  findOpenTicket,
  publicConfig,
  pingRoleIdsOf,
} = require("./store");
const { postAudit } = require("../ops/audit");
const { beginClose, scheduleChannelDelete } = require("../shared/ticketClose");
const { safeRoleAdd } = require("../shared/roleSafety");
const { buildTicketTranscript, transcriptAuditEmbed } = require("../shared/transcript");

const START_ID = "tsb:verify:start";
const CLAIM_ID = "tsb:verify:claim";
const APPROVE_ID = "tsb:verify:approve";
const DENY_ID = "tsb:verify:deny";
const CLOSE_ID = "tsb:verify:close";

const CLAIM_FIELD = "Claimed by";
const RESULT_FIELD = "Result";

async function deferPrivately(interaction) {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

async function replyPrivately(interaction, payload) {
  const data = { ...payload };
  delete data.ephemeral;
  data.flags = MessageFlags.Ephemeral;
  if (interaction.deferred) return interaction.editReply(data);
  if (interaction.replied) return interaction.followUp(data);
  return interaction.reply(data);
}

function canPostPanel(member, guild) {
  if (isAdminOrOwner(member, guild)) return true;
  return hasAccessPerm(guild.id, member.id, "VERIFY");
}

function canStaffTicket(member, guild, cfg) {
  if (isAdminOrOwner(member, guild)) return true;
  if (hasAccessPerm(guild.id, member.id, "VERIFY")) return true;
  return pingRoleIdsOf(cfg).some((id) => member.roles?.cache?.has(id));
}

function fillVars(text, vars) {
  return String(text || "").replace(/\{(\w+)\}/g, (full, key) => {
    const value = vars[String(key).toLowerCase()];
    return value == null || value === "" ? full : String(value);
  });
}

function parseColor(value, fallback) {
  const raw = String(value || "").replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return parseInt(raw, 16);
  return fallback;
}

function panelVars(guild) {
  const p = brand.prefix || "'";
  return {
    server: guild?.name || "",
    guild: guild?.name || "",
    prefix: p,
    bot: brand.name || "Ascendant",
    botname: brand.name || "Ascendant",
    membercount: guild?.memberCount != null ? String(guild.memberCount) : "",
    members: guild?.memberCount != null ? String(guild.memberCount) : "",
  };
}

function ticketUserId(guildId, channel) {
  const ticket = getTicket(guildId, channel.id);
  return ticket?.userId || channel.topic?.replace(/^verify:/, "") || null;
}

/* ── Panel ─────────────────────────────────────────────────────────────── */

function panelPayload(guild) {
  const cfg = guild?.id ? publicConfig(guild.id) : { panel: {} };
  const panel = cfg.panel || {};
  const vars = panelVars(guild);
  const embed = tsbEmbed({
    title: fillVars(panel.title || "Verification", vars).slice(0, 256),
    color: parseColor(panel.color, COLOR_PRIMARY),
    description: fillVars(panel.description, vars).slice(0, 4000),
    footer: panel.footer ? fillVars(panel.footer, vars) : undefined,
    footerIcon: panel.footerIcon || undefined,
    thumbnail: panel.thumbnail || undefined,
    image: panel.image || undefined,
  });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(START_ID)
          .setLabel(String(panel.button || "Verify").slice(0, 80))
          .setStyle(ButtonStyle.Success)
      ),
    ],
  };
}

function isPanelMessage(msg, botId) {
  return msg.author?.id === botId
    && msg.components?.some((row) => (row.components || []).some((c) => c.customId === START_ID));
}

/** Posts or refreshes the panel in `channel`; moving it to a new channel removes the old one. */
async function upsertPanel(channel, guild) {
  if (!channel?.isTextBased?.()) throw new Error("Pick a text channel for the panel.");
  const cfg = getConfig(guild.id);
  const payload = panelPayload(guild);

  if (cfg.panelChannelId && cfg.panelChannelId !== channel.id && cfg.panelMessageId) {
    const oldChannel = await guild.channels.fetch(cfg.panelChannelId).catch(() => null);
    const oldMessage = oldChannel ? await oldChannel.messages.fetch(cfg.panelMessageId).catch(() => null) : null;
    if (oldMessage) await oldMessage.delete().catch(() => {});
  }

  let message = null;
  if (cfg.panelMessageId && cfg.panelChannelId === channel.id) {
    message = await channel.messages.fetch(cfg.panelMessageId).catch(() => null);
    if (message) await message.edit(payload).catch(() => { message = null; });
  }
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
    const existing = recent
      ? [...recent.values()]
          .filter((msg) => isPanelMessage(msg, guild.client.user.id))
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      : [];
    message = existing[0] || null;
    if (message) await message.edit(payload).catch(() => { message = null; });
    for (const extra of existing.slice(1)) await extra.delete().catch(() => {});
  }
  if (!message) message = await channel.send(payload);
  updateConfig(guild.id, {
    panelChannelId: channel.id,
    panelMessageId: message.id,
    setupCompleted: true,
  });
  return message;
}

/* ── Ticket log ────────────────────────────────────────────────────────── */

async function logChannelOf(guild) {
  const { logChannelId } = getConfig(guild.id);
  if (!logChannelId) return null;
  const channel = await guild.channels.fetch(logChannelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

/** Sends to the verification ticket log; falls back to the server audit feed when none is set. */
async function logEvent(guild, { title, description, color, user, embeds, files }) {
  const channel = await logChannelOf(guild);
  if (!channel) {
    await postAudit(guild, { title, description, color, user });
    return;
  }
  let list = embeds;
  if (!list) {
    const embed = new EmbedBuilder()
      .setColor(color ?? COLOR_PRIMARY)
      .setTitle(String(title || "Verification").slice(0, 256))
      .setDescription(description || null)
      .setTimestamp();
    if (user) {
      embed.setFooter({ text: user.username || user.tag || String(user.id), iconURL: user.displayAvatarURL?.({ size: 32 }) || undefined });
    }
    list = [embed];
  }
  await channel.send({
    embeds: list,
    files: files || [],
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

/* ── Ticket card ───────────────────────────────────────────────────────── */

function ticketButtons({ claimedName = null, resolved = false } = {}) {
  const row = new ActionRowBuilder();
  if (!resolved) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(CLAIM_ID)
        .setLabel(claimedName ? `Claimed · ${claimedName}`.slice(0, 80) : "Claim")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(Boolean(claimedName)),
      new ButtonBuilder().setCustomId(APPROVE_ID).setLabel("Approve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(DENY_ID).setLabel("Deny").setStyle(ButtonStyle.Danger)
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId(CLOSE_ID).setLabel("Close").setStyle(ButtonStyle.Secondary)
  );
  return row;
}

function relativeTime(ms) {
  return ms ? `<t:${Math.floor(ms / 1000)}:R>` : "—";
}

function regionLabel(region) {
  if (!region) return "—";
  try {
    return api.regions?.regionLabel?.(region) || region;
  } catch {
    return region;
  }
}

async function ticketCard(guild, user) {
  const ticket = publicConfig(guild.id).ticket || {};
  const profile = await Promise.resolve(api.profiles.getProfile(guild.id, user.id)).catch(() => null);
  const member = await guild.members.fetch(user.id).catch(() => null);
  const vars = {
    ...panelVars(guild),
    user: user.username || "",
    username: user.username || "",
    mention: `<@${user.id}>`,
    display: member?.displayName || user.globalName || user.username || "",
    roblox: profile?.roblox_username || "",
    id: user.id,
  };
  const robloxName = profile?.roblox_username;
  const robloxUrl = profile?.roblox_id ? `https://www.roblox.com/users/${profile.roblox_id}/profile` : null;
  const country = profile?.country_flag
    ? `${profile.country_flag} ${profile.country || ""}`.trim()
    : profile?.country || null;

  return tsbEmbed({
    author: false,
    title: fillVars(ticket.title, vars).slice(0, 256),
    color: parseColor(ticket.color, COLOR_PRIMARY),
    description: fillVars(ticket.description, vars).slice(0, 4000),
    thumbnail: ticket.thumbnail || profile?.roblox_avatar_url || user.displayAvatarURL?.({ size: 256 }),
    image: ticket.image || undefined,
    footer: ticket.footer ? fillVars(ticket.footer, vars) : undefined,
    footerIcon: ticket.footerIcon || undefined,
    fields: [
      { name: "Roblox", value: robloxName ? (robloxUrl ? `[${robloxName}](${robloxUrl})` : robloxName) : "—", inline: true },
      { name: "Region", value: regionLabel(profile?.region), inline: true },
      { name: "Country", value: country || "—", inline: true },
      { name: "Account", value: relativeTime(user.createdTimestamp), inline: true },
      { name: "Joined", value: relativeTime(member?.joinedTimestamp), inline: true },
      { name: CLAIM_FIELD, value: "Unclaimed", inline: true },
    ],
  });
}

function withField(embedData, name, value, { color } = {}) {
  const embed = EmbedBuilder.from(embedData);
  const fields = [...(embed.data.fields || [])];
  const index = fields.findIndex((f) => f.name === name);
  if (index >= 0) fields[index] = { ...fields[index], value };
  else fields.push({ name, value, inline: false });
  embed.setFields(fields);
  if (color != null) embed.setColor(color);
  return embed;
}

async function findCardMessage(channel, ticket) {
  if (ticket?.cardMessageId) {
    const msg = await channel.messages.fetch(ticket.cardMessageId).catch(() => null);
    if (msg) return msg;
  }
  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (!recent) return null;
  return [...recent.values()].find((msg) =>
    msg.author?.id === channel.client.user.id
    && msg.components?.some((row) => (row.components || []).some((c) => c.customId === CLOSE_ID))
  ) || null;
}

/* ── Opening ───────────────────────────────────────────────────────────── */

function sanitizeName(user) {
  const base = String(user?.username || user?.globalName || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20) || "user";
  return `verify-${base}`.slice(0, 90);
}

async function ensureCategory(guild, cfg) {
  if (cfg.categoryId) {
    const existing = await guild.channels.fetch(cfg.categoryId).catch(() => null);
    if (existing?.type === ChannelType.GuildCategory) return existing;
  }
  const found = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && /verif/i.test(ch.name)
  );
  if (found) {
    updateConfig(guild.id, { categoryId: found.id, setupCompleted: true });
    return found;
  }
  const created = await guild.channels.create({
    name: "verification-tickets",
    type: ChannelType.GuildCategory,
    reason: "TSB verification tickets",
  });
  updateConfig(guild.id, { categoryId: created.id, setupCompleted: true });
  return created;
}

const MEMBER_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

async function openTicket(guild, user) {
  const cfg = getConfig(guild.id);
  const existing = findOpenTicket(guild.id, user.id);
  if (existing?.ticketChannelId) {
    const ch = await guild.channels.fetch(existing.ticketChannelId).catch(() => null);
    if (ch) return ch;
  }

  const category = await ensureCategory(guild, cfg);
  const me = guild.members.me;
  const pingRoles = pingRoleIdsOf(cfg);
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: MEMBER_ALLOW },
    ...pingRoles.map((roleId) => ({ id: roleId, allow: MEMBER_ALLOW })),
  ];
  if (me) {
    overwrites.push({ id: me.id, allow: [...MEMBER_ALLOW, PermissionFlagsBits.ManageChannels] });
  }

  let name = sanitizeName(user);
  if (guild.channels.cache.some((ch) => ch.name === name)) {
    name = `${name}-${String(user.id).slice(-4)}`;
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `verify:${user.id}`,
    permissionOverwrites: overwrites,
    reason: `Verification ticket for ${user.tag || user.username}`,
  });

  setPending(guild.id, user.id, {
    status: "ticket_open",
    ticketChannelId: channel.id,
    startedAt: Date.now(),
  });

  const card = await channel.send({
    content: [`${user}`, ...pingRoles.map((id) => `<@&${id}>`)].join(" "),
    allowedMentions: { users: [user.id], roles: pingRoles },
    embeds: [await ticketCard(guild, user)],
    components: [ticketButtons()],
  });
  setTicket(guild.id, channel.id, { userId: user.id, status: "open", cardMessageId: card.id, openedAt: Date.now() });

  await logEvent(guild, {
    title: "Ticket opened",
    description: `${user} · ${channel}`,
    color: COLOR_PRIMARY,
    user,
  });
  return channel;
}

async function startVerification(interaction) {
  const guild = interaction.guild;
  const user = interaction.user;
  const actions = publicConfig(guild.id);
  const addIds = actions.approve.addRoleIds;
  if (addIds.length && addIds.every((id) => interaction.member?.roles?.cache?.has(id))) {
    return replyPrivately(interaction, { content: "You're already verified." });
  }

  await deferPrivately(interaction);

  const open = findOpenTicket(guild.id, user.id);
  if (open?.ticketChannelId) {
    const ch = await guild.channels.fetch(open.ticketChannelId).catch(() => null);
    if (ch) return replyPrivately(interaction, { content: `You already have a ticket: ${ch}` });
  }

  const { rememberGuild, sendProfileToUser, registerPrompt } = require("../../profileUI");
  rememberGuild(user.id, guild.id);

  let dmOk = false;
  let hasProfile = false;
  try {
    const sent = await sendProfileToUser(user, guild);
    dmOk = true;
    hasProfile = !!sent.hasProfile;
  } catch {
    const profile = await Promise.resolve(api.profiles.getProfile(guild.id, user.id)).catch(() => null);
    hasProfile = !!(profile && profile.roblox_username);
  }

  setPending(guild.id, user.id, {
    status: hasProfile ? "ticket_open" : "pending_profile",
    startedAt: Date.now(),
    ticketChannelId: null,
  });

  if (hasProfile) {
    const channel = await openTicket(guild, user);
    return replyPrivately(interaction, { content: `Ticket opened: ${channel}` });
  }

  if (!dmOk) {
    const prompt = registerPrompt(user.id);
    return replyPrivately(interaction, {
      ...prompt,
      content: "I couldn't DM you. Turn on DMs from server members, then press **Verify** again.",
    });
  }

  return replyPrivately(interaction, {
    content: "Check your DMs. Finish your profile there and your ticket opens automatically.",
  });
}

async function onProfileCompleted(guild, userId) {
  if (!guild || !userId) return;
  const pending = getPending(guild.id, userId);
  if (!pending || pending.status !== "pending_profile") return;
  const user = await guild.client.users.fetch(userId).catch(() => null);
  if (!user) return;
  const channel = await openTicket(guild, user);
  await user.send({
    embeds: [tsbEmbed({ title: "Verification", color: COLOR_SUCCESS, description: `Profile done. Your ticket: ${channel}` })],
  }).catch(() => {});
}

/* ── Staff actions ─────────────────────────────────────────────────────── */

async function staffGuard(interaction) {
  const cfg = getConfig(interaction.guild.id);
  if (!canStaffTicket(interaction.member, interaction.guild, cfg)) {
    await replyPrivately(interaction, { content: "Staff only." });
    return null;
  }
  const userId = ticketUserId(interaction.guild.id, interaction.channel);
  if (!userId) {
    await replyPrivately(interaction, { content: "This is not a verification ticket." });
    return null;
  }
  return { cfg, userId, ticket: getTicket(interaction.guild.id, interaction.channel.id) || {} };
}

async function handleClaim(interaction) {
  const ctx = await staffGuard(interaction);
  if (!ctx) return;
  const { ticket } = ctx;
  if (ticket.claimedBy) {
    return replyPrivately(interaction, { content: `Already claimed by <@${ticket.claimedBy}>.` });
  }
  if (ticket.status && ticket.status !== "open") {
    return replyPrivately(interaction, { content: "This ticket is already handled." });
  }
  setTicket(interaction.guild.id, interaction.channel.id, { claimedBy: interaction.user.id, claimedAt: Date.now() });
  const name = interaction.member?.displayName || interaction.user.username;
  await interaction.update({
    embeds: [withField(interaction.message.embeds[0], CLAIM_FIELD, `${interaction.user}`, { color: COLOR_WARN })],
    components: [ticketButtons({ claimedName: name })],
  });
  await logEvent(interaction.guild, {
    title: "Ticket claimed",
    description: `${interaction.channel} · ${interaction.user}`,
    color: COLOR_WARN,
    user: interaction.user,
  });
}

async function markResolved(interaction, ticket, { label, color }) {
  const card = interaction.message?.id === ticket.cardMessageId || !ticket.cardMessageId
    ? interaction.message
    : await findCardMessage(interaction.channel, ticket);
  if (!card?.embeds?.[0]) return;
  const embed = withField(card.embeds[0], RESULT_FIELD, label, { color });
  await card.edit({ embeds: [embed], components: [ticketButtons({ resolved: true })] }).catch(() => {});
}

/** Transcript to the ticket log, then delete the channel. Safe to call from any close path. */
async function finishTicket(guild, channel, { closedBy, userId, outcome = "Closed", reason = "Verification ticket closed" }) {
  if (!beginClose(channel?.id)) return false;
  const ticket = getTicket(guild.id, channel.id) || {};
  await channel.send({
    embeds: [tsbEmbed({ author: false, color: COLOR_DANGER, description: "Saving transcript · closing in 5 seconds." })],
  }).catch(() => {});

  const history = await buildTicketTranscript(channel, {
    openerId: userId,
    closedById: closedBy?.id,
    panelName: "verification",
  }).catch(() => null);

  const extraFields = [
    { name: "Outcome", value: outcome, inline: true },
    ticket.claimedBy ? { name: "Claimed by", value: `<@${ticket.claimedBy}>`, inline: true } : null,
  ].filter(Boolean);

  if (await logChannelOf(guild)) {
    await logEvent(guild, {
      embeds: [transcriptAuditEmbed({
        title: "Verification ticket closed",
        color: outcome === "Approved" ? COLOR_SUCCESS : outcome === "Denied" ? COLOR_DANGER : COLOR_PRIMARY,
        channel,
        closedBy,
        openerId: userId,
        panelName: "verification",
        history: history || { count: 0, participants: [] },
        extraFields,
      })],
      files: history?.file ? [history.file] : [],
    });
  } else {
    await postAudit(guild, {
      title: "Verification ticket closed",
      color: COLOR_PRIMARY,
      description: `${userId ? `<@${userId}>` : channel.name} · ${outcome} · closed by ${closedBy || "system"}`,
      user: closedBy,
    });
  }

  setTicket(guild.id, channel.id, null);
  if (userId) {
    const pending = getPending(guild.id, userId);
    const keep = pending?.status === "approved" || pending?.status === "denied";
    setPending(guild.id, userId, { ticketChannelId: null, ...(keep ? {} : { status: "closed" }) });
  }
  scheduleChannelDelete(channel, reason, 5000);
  return true;
}

async function handleApprove(interaction) {
  const ctx = await staffGuard(interaction);
  if (!ctx) return;
  const { userId, ticket } = ctx;
  if (ticket.status === "approved" || ticket.status === "denied") {
    return replyPrivately(interaction, { content: "This ticket is already handled." });
  }
  await interaction.deferUpdate();
  const guild = interaction.guild;
  const actions = publicConfig(guild.id);
  const member = await guild.members.fetch(userId).catch(() => null);
  const profile = await Promise.resolve(api.profiles.getProfile(guild.id, userId)).catch(() => null);
  const reason = `Verified by ${interaction.user.tag}`;

  let given = [];
  if (member) {
    if (actions.approve.addRoleIds.length) {
      const result = await safeRoleAdd(member, actions.approve.addRoleIds, reason).catch(() => null);
      given = result?.added || [];
    }
    if (actions.approve.removeRoleIds.length) {
      await member.roles.remove(actions.approve.removeRoleIds, reason).catch(() => {});
    }
    if (actions.approve.nickname) {
      const nick = renderNickname(actions.approve.nickname, { member, profile, user: member.user });
      if (nick) await member.setNickname(nick, reason).catch(() => {});
    }
  }

  setTicket(guild.id, interaction.channel.id, { status: "approved", resolvedBy: interaction.user.id });
  setPending(guild.id, userId, { status: "approved" });
  await markResolved(interaction, ticket, { label: `Approved by ${interaction.user}`, color: COLOR_SUCCESS });

  const roles = given.length ? given.map((r) => `${r}`).join(" ") : "no roles";
  await interaction.channel.send({
    embeds: [tsbEmbed({ author: false, color: COLOR_SUCCESS, description: `<@${userId}> is verified · ${roles}` })],
    allowedMentions: { parse: [] },
  }).catch(() => {});
  await interaction.channel.permissionOverwrites.edit(userId, { SendMessages: false }).catch(() => {});

  const user = await interaction.client.users.fetch(userId).catch(() => null);
  await user?.send({
    embeds: [tsbEmbed({
      title: "Verification",
      color: COLOR_SUCCESS,
      description: actions.approve.dmMessage || `You're verified in **${guild.name}**.`,
    })],
  }).catch(() => {});

  await logEvent(guild, {
    title: "Approved",
    description: `<@${userId}> verified by ${interaction.user}`,
    color: COLOR_SUCCESS,
    user: interaction.user,
  });

  if (actions.approve.closeTicket) {
    await finishTicket(guild, interaction.channel, { closedBy: interaction.user, userId, outcome: "Approved" });
  }
}

async function handleDeny(interaction) {
  const ctx = await staffGuard(interaction);
  if (!ctx) return;
  const { userId, ticket } = ctx;
  if (ticket.status === "approved" || ticket.status === "denied") {
    return replyPrivately(interaction, { content: "This ticket is already handled." });
  }
  await interaction.deferUpdate();
  const guild = interaction.guild;
  const actions = publicConfig(guild.id);
  const privateMode = actions.deny.mode === "private";

  setTicket(guild.id, interaction.channel.id, { status: "denied", resolvedBy: interaction.user.id });
  setPending(guild.id, userId, { status: "denied", ticketChannelId: privateMode ? interaction.channel.id : null });
  await markResolved(interaction, ticket, { label: `Denied by ${interaction.user}`, color: COLOR_DANGER });

  const user = await interaction.client.users.fetch(userId).catch(() => null);
  await user?.send({
    embeds: [tsbEmbed({
      title: "Verification",
      color: COLOR_DANGER,
      description: actions.deny.dmMessage || `Your verification in **${guild.name}** was denied. You can press **Verify** again later.`,
    })],
  }).catch(() => {});

  await logEvent(guild, {
    title: "Denied",
    description: `<@${userId}> denied by ${interaction.user}`,
    color: COLOR_DANGER,
    user: interaction.user,
  });

  if (privateMode) {
    await interaction.channel.permissionOverwrites.delete(userId).catch(async () => {
      await interaction.channel.permissionOverwrites.edit(userId, { ViewChannel: false, SendMessages: false }).catch(() => {});
    });
    await interaction.channel.send({
      embeds: [tsbEmbed({ author: false, color: COLOR_DANGER, description: `<@${userId}> was removed. Staff can keep talking here.` })],
      allowedMentions: { parse: [] },
    }).catch(() => {});
    return;
  }
  await finishTicket(guild, interaction.channel, {
    closedBy: interaction.user,
    userId,
    outcome: "Denied",
    reason: "Verification denied",
  });
}

async function handleClose(interaction) {
  const ctx = await staffGuard(interaction);
  if (!ctx) return;
  await interaction.deferUpdate().catch(() => {});
  const outcome = ctx.ticket.status === "approved" ? "Approved" : ctx.ticket.status === "denied" ? "Denied" : "Closed";
  await finishTicket(interaction.guild, interaction.channel, { closedBy: interaction.user, userId: ctx.userId, outcome });
}

function renderNickname(template, { member, profile, user }) {
  const display = profile?.display_name || member?.displayName || user?.globalName || user?.username || "";
  const roblox = profile?.roblox_username || "";
  return String(template || "")
    .replace(/\{display\}/gi, display)
    .replace(/\{name\}/gi, display)
    .replace(/\{roblox\}/gi, roblox)
    .replace(/\{username\}/gi, user?.username || "")
    .slice(0, 32);
}

const BUTTON_HANDLERS = {
  [START_ID]: startVerification,
  [CLAIM_ID]: handleClaim,
  [APPROVE_ID]: handleApprove,
  [DENY_ID]: handleDeny,
  [CLOSE_ID]: handleClose,
};

async function handleVerifyInteraction(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("tsb:verify:") || !interaction.isButton?.()) return false;
  const handler = BUTTON_HANDLERS[id];
  if (!handler) return false;
  await handler(interaction);
  return true;
}

module.exports = {
  START_ID,
  panelPayload,
  upsertPanel,
  canPostPanel,
  startVerification,
  onProfileCompleted,
  handleVerifyInteraction,
  ensureCategory,
};
