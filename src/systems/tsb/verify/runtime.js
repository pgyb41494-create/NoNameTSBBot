const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");
const api = require("../../../utils/loadApi");
const { tsbEmbed, COLOR_PRIMARY, COLOR_SUCCESS, COLOR_DANGER } = require("../shared/embeds");
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

const START_ID = "tsb:verify:start";
const APPROVE_ID = "tsb:verify:approve";
const DENY_ID = "tsb:verify:deny";
const CLOSE_ID = "tsb:verify:close";

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

async function ackButton(interaction) {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferUpdate();
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

function panelPayload(guild) {
  const cfg = guild?.id ? publicConfig(guild.id) : { panel: {} };
  const panel = cfg.panel || {};
  const vars = panelVars(guild);
  const p = brand.prefix || "'";
  const title = fillVars(panel.title || "Verification", vars).slice(0, 256);
  const description = fillVars(
    panel.description ||
      "Click **Start verification** and I’ll DM you `/profile`.\n\n" +
        "Finish it in DMs and a private ticket opens for staff.\n\n" +
        `You can also run \`${p}profile\` / \`/profile\` in the server.`,
    vars
  ).slice(0, 4000);
  const embed = tsbEmbed({
    title,
    color: parseColor(panel.color, COLOR_PRIMARY),
    description,
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
          .setLabel(String(panel.button || "Start verification").slice(0, 80))
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  };
}

async function upsertPanel(channel, guild) {
  const cfg = getConfig(guild.id);
  const payload = panelPayload(guild);
  let message = null;
  if (cfg.panelMessageId && (!cfg.panelChannelId || cfg.panelChannelId === channel.id)) {
    message = await channel.messages.fetch(cfg.panelMessageId).catch(() => null);
    if (message) await message.edit(payload).catch(() => { message = null; });
  }
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
    const existing = recent
      ? [...recent.values()]
          .filter((msg) =>
            msg.author?.id === guild.client.user.id &&
            msg.components?.some((row) =>
              (row.components || []).some((c) => c.customId === START_ID)
            )
          )
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

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(APPROVE_ID).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(DENY_ID).setLabel("Deny").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CLOSE_ID).setLabel("Close ticket").setStyle(ButtonStyle.Secondary)
  );
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

function scheduleClose(channel, reason = "Verification ticket closed") {
  setTimeout(() => channel.delete(reason).catch(() => {}), 5000);
}

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

async function openTicket(guild, user) {
  const cfg = getConfig(guild.id);
  const existing = findOpenTicket(guild.id, user.id);
  if (existing?.ticketChannelId) {
    const ch = await guild.channels.fetch(existing.ticketChannelId).catch(() => null);
    if (ch) return ch;
  }

  const category = await ensureCategory(guild, cfg);
  const me = guild.members.me;
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
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
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }
  const pingRoles = pingRoleIdsOf(cfg);
  for (const roleId of pingRoles) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    });
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
  setTicket(guild.id, channel.id, { userId: user.id, status: "open" });

  let profilePayload = { embeds: [] };
  try {
    const { payloadFor } = require("../../profileUI");
    profilePayload = (await payloadFor(guild, user.id)) || { embeds: [] };
  } catch {}

  const staffPing = pingRoles.map((id) => `<@&${id}>`).join(" ");
  let profile = null;
  try {
    profile = await Promise.resolve(api.profiles.getProfile(guild.id, user.id));
  } catch {}
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
  const ticket = publicConfig(guild.id).ticket || {};
  await channel.send({
    content: `${user} ${staffPing}`.trim(),
    allowedMentions: { users: [user.id], roles: pingRoles },
    embeds: [
      tsbEmbed({
        title: fillVars(ticket.title || "Verification ticket", vars).slice(0, 256),
        color: parseColor(ticket.color, COLOR_PRIMARY),
        description: fillVars(
          ticket.description || "{mention} finished `/profile`.\n\nStaff: check the profile, then **Approve** or **Deny**.",
          vars
        ).slice(0, 4000),
        footer: ticket.footer ? fillVars(ticket.footer, vars) : undefined,
        footerIcon: ticket.footerIcon || undefined,
        thumbnail: ticket.thumbnail || undefined,
        image: ticket.image || undefined,
      }),
      ...(profilePayload.embeds || []),
    ],
    files: profilePayload.files || [],
    components: [ticketButtons()],
  });

  return channel;
}

async function startVerification(interaction) {
  const guild = interaction.guild;
  const user = interaction.user;
  const actions = publicConfig(guild.id);
  const member = interaction.member;
  const addIds = actions.approve.addRoleIds;
  if (addIds.length && addIds.every((id) => member?.roles?.cache?.has(id))) {
    return replyPrivately(interaction, { content: "You're already verified." });
  }

  await deferPrivately(interaction);

  const open = findOpenTicket(guild.id, user.id);
  if (open?.ticketChannelId) {
    const ch = await guild.channels.fetch(open.ticketChannelId).catch(() => null);
    if (ch) {
      return replyPrivately(interaction, { content: `You already have a ticket: ${ch}` });
    }
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
    dmOk = false;
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
    if (!dmOk) {
      return replyPrivately(interaction, {
        content: `I couldn't DM you (enable DMs from server members). Ticket opened: ${channel}`,
      });
    }
    return replyPrivately(interaction, { content: `Check your DMs. Ticket opened: ${channel}` });
  }

  if (!dmOk) {
    const prompt = registerPrompt(user.id);
    return replyPrivately(interaction, {
      ...prompt,
      content: "I couldn't DM you — enable DMs from server members, then press **Start verification** again.",
    });
  }

  return replyPrivately(interaction, {
    content: "Check your DMs and finish `/profile` there. A ticket opens when you're done.",
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
    embeds: [
      tsbEmbed({
        title: "Verification",
        color: COLOR_SUCCESS,
        description: `Profile complete. Ticket opened: ${channel}`,
      }),
    ],
  }).catch(() => {});
}

async function handleApprove(interaction) {
  const cfg = getConfig(interaction.guild.id);
  const actions = publicConfig(interaction.guild.id);
  if (!canStaffTicket(interaction.member, interaction.guild, cfg)) {
    return replyPrivately(interaction, { content: "Staff only." });
  }
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const userId = ticket?.userId || interaction.channel.topic?.replace(/^verify:/, "");
  if (!userId) {
    return replyPrivately(interaction, { content: "This is not a verification ticket." });
  }
  await ackButton(interaction);
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const profile = await Promise.resolve(api.profiles.getProfile(interaction.guild.id, userId)).catch(() => null);
  const reason = `Verified by ${interaction.user.tag}`;
  if (member) {
    const addIds = actions.approve.addRoleIds;
    const removeIds = actions.approve.removeRoleIds;
    if (addIds.length) await member.roles.add(addIds, reason).catch(() => {});
    if (removeIds.length) await member.roles.remove(removeIds, reason).catch(() => {});
    if (actions.approve.nickname) {
      const nick = renderNickname(actions.approve.nickname, { member, profile, user: member.user });
      if (nick) await member.setNickname(nick, reason).catch(() => {});
    }
  }
  setTicket(interaction.guild.id, interaction.channel.id, { status: "approved" });
  setPending(interaction.guild.id, userId, { status: "approved" });
  await interaction.message.edit({ components: [] }).catch(() => {});
  const added = actions.approve.addRoleIds.map((id) => `<@&${id}>`).join(" ") || "none";
  const removed = actions.approve.removeRoleIds.map((id) => `<@&${id}>`).join(" ");
  await interaction.channel.send({
    embeds: [
      tsbEmbed({
        title: "Approved",
        color: COLOR_SUCCESS,
        description:
          `${member || `<@${userId}>`} is verified.\n` +
          `Roles added: ${added}` +
          (removed ? `\nRoles removed: ${removed}` : ""),
      }),
    ],
  });
  await interaction.channel.permissionOverwrites.edit(userId, { SendMessages: false }).catch(() => {});
  const user = await interaction.client.users.fetch(userId).catch(() => null);
  const dmText = actions.approve.dmMessage || `You’re verified in **${interaction.guild.name}**.`;
  await user?.send({
    embeds: [tsbEmbed({ title: "Verification", color: COLOR_SUCCESS, description: dmText })],
  }).catch(() => {});
  if (actions.approve.closeTicket) {
    await interaction.channel.send({ content: "Closing this ticket in 5 seconds." }).catch(() => {});
    scheduleClose(interaction.channel);
  }
  await postAudit(interaction.guild, {
    title: "Verification approved",
    color: COLOR_SUCCESS,
    description: `${member || `<@${userId}>`} was verified by ${interaction.user}.`,
    user: interaction.user,
  });
}

async function handleDeny(interaction) {
  const cfg = getConfig(interaction.guild.id);
  const actions = publicConfig(interaction.guild.id);
  if (!canStaffTicket(interaction.member, interaction.guild, cfg)) {
    return replyPrivately(interaction, { content: "Staff only." });
  }
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const userId = ticket?.userId || interaction.channel.topic?.replace(/^verify:/, "");
  if (!userId) {
    return replyPrivately(interaction, { content: "This is not a verification ticket." });
  }
  await ackButton(interaction);
  const privateMode = actions.deny.mode === "private";
  setTicket(interaction.guild.id, interaction.channel.id, { status: "denied" });
  setPending(interaction.guild.id, userId, { status: "denied", ticketChannelId: privateMode ? interaction.channel.id : null });
  await interaction.message.edit({ components: [] }).catch(() => {});

  if (privateMode) {
    await interaction.channel.permissionOverwrites.delete(userId).catch(async () => {
      await interaction.channel.permissionOverwrites.edit(userId, { ViewChannel: false, SendMessages: false }).catch(() => {});
    });
    await interaction.channel.send({
      embeds: [
        tsbEmbed({
          title: "Denied · private",
          color: COLOR_DANGER,
          description: `<@${userId}> was removed from this ticket. Staff can keep talking here.`,
        }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CLOSE_ID).setLabel("Close ticket").setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
  } else {
    await interaction.channel.send({
      embeds: [
        tsbEmbed({
          title: "Denied",
          color: COLOR_DANGER,
          description: `<@${userId}> was denied. Closing this ticket in 5 seconds.`,
        }),
      ],
    });
    scheduleClose(interaction.channel, "Verification denied");
  }

  const user = await interaction.client.users.fetch(userId).catch(() => null);
  const dmText =
    actions.deny.dmMessage ||
    `Your verification in **${interaction.guild.name}** was denied. You can start again with the verification button.`;
  await user?.send({
    embeds: [tsbEmbed({ title: "Verification", color: COLOR_DANGER, description: dmText })],
  }).catch(() => {});
  await postAudit(interaction.guild, {
    title: "Verification denied",
    color: COLOR_DANGER,
    description: `<@${userId}> was denied by ${interaction.user}.`,
    user: interaction.user,
  });
}

async function handleClose(interaction) {
  const cfg = getConfig(interaction.guild.id);
  if (!canStaffTicket(interaction.member, interaction.guild, cfg)) {
    return replyPrivately(interaction, { content: "Staff only." });
  }
  await ackButton(interaction);
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const userId = ticket?.userId || interaction.channel.topic?.replace(/^verify:/, "");
  setTicket(interaction.guild.id, interaction.channel.id, { status: "closed" });
  if (userId) setPending(interaction.guild.id, userId, { status: "closed", ticketChannelId: null });
  await interaction.channel.send({ content: "Closing this ticket in 5 seconds." }).catch(() => {});
  await postAudit(interaction.guild, {
    title: "Verification ticket closed",
    color: COLOR_PRIMARY,
    description: userId ? `<@${userId}> · closed by ${interaction.user}` : `Closed by ${interaction.user}.`,
    user: interaction.user,
  });
  setTimeout(() => interaction.channel.delete("Verification ticket closed").catch(() => {}), 5000);
}

async function handleVerifyInteraction(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("tsb:verify:")) return false;

  if (interaction.isButton?.() && id === START_ID) {
    await startVerification(interaction);
    return true;
  }
  if (interaction.isButton?.() && id === APPROVE_ID) {
    await handleApprove(interaction);
    return true;
  }
  if (interaction.isButton?.() && id === DENY_ID) {
    await handleDeny(interaction);
    return true;
  }
  if (interaction.isButton?.() && id === CLOSE_ID) {
    await handleClose(interaction);
    return true;
  }
  return false;
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
