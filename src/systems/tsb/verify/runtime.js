const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
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
} = require("./store");

const START_ID = "tsb:verify:start";
const APPROVE_ID = "tsb:verify:approve";
const DENY_ID = "tsb:verify:deny";
const CLOSE_ID = "tsb:verify:close";

function canPostPanel(member, guild) {
  if (isAdminOrOwner(member, guild)) return true;
  return hasAccessPerm(guild.id, member.id, "VERIFY");
}

function canStaffTicket(member, guild, cfg) {
  if (isAdminOrOwner(member, guild)) return true;
  if (hasAccessPerm(guild.id, member.id, "VERIFY")) return true;
  if (cfg.staffRoleId && member.roles?.cache?.has(cfg.staffRoleId)) return true;
  return false;
}

function panelPayload() {
  const p = brand.prefix || "'";
  return {
    embeds: [
      tsbEmbed({
        title: "Verification",
        color: COLOR_PRIMARY,
        description:
          "Click **Start verification** and I’ll DM you the `/profile` steps.\n\n" +
          "When your profile is finished, a private ticket opens so staff can verify you.\n\n" +
          `You can also run \`${p}profile\` / \`/profile\` anytime.`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(START_ID).setLabel("Start verification").setStyle(ButtonStyle.Primary)
      ),
    ],
  };
}

function stepsText() {
  const p = brand.prefix || "'";
  return [
    "**Profile steps**",
    "",
    `1. Go back to the server and run \`/profile\` or \`${p}profile\`.`,
    "2. Press **Yes** / create profile.",
    "3. Enter your **display name** and **Roblox username**.",
    "4. Pick your **region**, then type your **country**.",
    "5. Pick your **main character**.",
    "6. If asked, paste the code into your Roblox **About / bio** and press **I added it**.",
    "",
    "When that’s done, I’ll open a verification ticket automatically.",
  ].join("\n");
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

async function dmSteps(user) {
  try {
    await user.send({
      embeds: [
        tsbEmbed({
          title: "Verification",
          color: COLOR_PRIMARY,
          description: stepsText(),
        }),
      ],
    });
    return true;
  } catch {
    return false;
  }
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
  if (cfg.staffRoleId) {
    overwrites.push({
      id: cfg.staffRoleId,
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

  const staffPing = cfg.staffRoleId ? `<@&${cfg.staffRoleId}>` : "";
  await channel.send({
    content: `${user} ${staffPing}`.trim(),
    embeds: [
      tsbEmbed({
        title: "Verification ticket",
        color: COLOR_PRIMARY,
        description:
          `${user} finished \`/profile\`.\n\n` +
          "Staff: check the profile, then **Approve** or **Deny**.",
      }),
      ...(profilePayload.embeds || []),
    ],
    files: profilePayload.files || [],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(APPROVE_ID).setLabel("Approve").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(DENY_ID).setLabel("Deny").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(CLOSE_ID).setLabel("Close").setStyle(ButtonStyle.Secondary)
      ),
    ],
  });

  return channel;
}

async function startVerification(interaction) {
  const guild = interaction.guild;
  const user = interaction.user;
  const cfg = getConfig(guild.id);
  const member = interaction.member;
  if (cfg.verifiedRoleId && member?.roles?.cache?.has(cfg.verifiedRoleId)) {
    return interaction.reply({ content: "You're already verified.", ephemeral: true });
  }
  const open = findOpenTicket(guild.id, user.id);
  if (open?.ticketChannelId) {
    const ch = await guild.channels.fetch(open.ticketChannelId).catch(() => null);
    if (ch) {
      return interaction.reply({
        content: `You already have a ticket: ${ch}`,
        ephemeral: true,
      });
    }
  }

  const profile = await Promise.resolve(api.profiles.getProfile(guild.id, user.id)).catch(() => null);
  const dmOk = await dmSteps(user);
  setPending(guild.id, user.id, {
    status: profile?.roblox_username ? "ticket_open" : "pending_profile",
    startedAt: Date.now(),
    ticketChannelId: null,
  });

  if (profile?.roblox_username) {
    const channel = await openTicket(guild, user);
    const extra = dmOk
      ? `Ticket opened: ${channel}`
      : `I couldn't DM you (enable DMs). Ticket opened: ${channel}`;
    return interaction.reply({ content: extra, ephemeral: true });
  }

  if (!dmOk) {
    return interaction.reply({
      ephemeral: true,
      content:
        "I couldn't DM you — enable DMs from server members, then press **Start verification** again.\n\n" +
        stepsText(),
    });
  }

  return interaction.reply({
    content: "Check your DMs for the `/profile` steps. A ticket will open when you finish.",
    ephemeral: true,
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
  if (!canStaffTicket(interaction.member, interaction.guild, cfg)) {
    return interaction.reply({ content: "Staff only.", ephemeral: true });
  }
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const userId = ticket?.userId || interaction.channel.topic?.replace(/^verify:/, "");
  if (!userId) {
    return interaction.reply({ content: "This is not a verification ticket.", ephemeral: true });
  }
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (cfg.verifiedRoleId && member) {
    await member.roles.add(cfg.verifiedRoleId, `Verified by ${interaction.user.tag}`).catch(() => {});
  }
  setTicket(interaction.guild.id, interaction.channel.id, { status: "approved" });
  setPending(interaction.guild.id, userId, { status: "approved" });
  await interaction.update({
    components: [],
  }).catch(() => {});
  await interaction.channel.send({
    embeds: [
      tsbEmbed({
        title: "Approved",
        color: COLOR_SUCCESS,
        description: `${member || `<@${userId}>`} is verified.${cfg.verifiedRoleId ? ` Role <@&${cfg.verifiedRoleId}> added.` : ""}`,
      }),
    ],
  });
  await interaction.channel.permissionOverwrites.edit(userId, { SendMessages: false }).catch(() => {});
  const user = await interaction.client.users.fetch(userId).catch(() => null);
  await user?.send({
    embeds: [
      tsbEmbed({
        title: "Verification",
        color: COLOR_SUCCESS,
        description: `You’re verified in **${interaction.guild.name}**.`,
      }),
    ],
  }).catch(() => {});
}

async function handleDeny(interaction) {
  const cfg = getConfig(interaction.guild.id);
  if (!canStaffTicket(interaction.member, interaction.guild, cfg)) {
    return interaction.reply({ content: "Staff only.", ephemeral: true });
  }
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const userId = ticket?.userId || interaction.channel.topic?.replace(/^verify:/, "");
  if (!userId) {
    return interaction.reply({ content: "This is not a verification ticket.", ephemeral: true });
  }
  setTicket(interaction.guild.id, interaction.channel.id, { status: "denied" });
  setPending(interaction.guild.id, userId, { status: "denied" });
  await interaction.update({ components: [] }).catch(() => {});
  await interaction.channel.send({
    embeds: [
      tsbEmbed({
        title: "Denied",
        color: COLOR_DANGER,
        description: `<@${userId}> was denied.`,
      }),
    ],
  });
  await interaction.channel.permissionOverwrites.edit(userId, { SendMessages: false }).catch(() => {});
  const user = await interaction.client.users.fetch(userId).catch(() => null);
  await user?.send({
    embeds: [
      tsbEmbed({
        title: "Verification",
        color: COLOR_DANGER,
        description: `Your verification in **${interaction.guild.name}** was denied. You can start again with the verification button.`,
      }),
    ],
  }).catch(() => {});
}

async function handleClose(interaction) {
  const cfg = getConfig(interaction.guild.id);
  if (!canStaffTicket(interaction.member, interaction.guild, cfg)) {
    return interaction.reply({ content: "Staff only.", ephemeral: true });
  }
  const ticket = getTicket(interaction.guild.id, interaction.channel.id);
  const userId = ticket?.userId || interaction.channel.topic?.replace(/^verify:/, "");
  setTicket(interaction.guild.id, interaction.channel.id, { status: "closed" });
  if (userId) setPending(interaction.guild.id, userId, { status: "closed", ticketChannelId: null });
  await interaction.reply({ content: "Closing this ticket in 5 seconds." });
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
  canPostPanel,
  startVerification,
  onProfileCompleted,
  handleVerifyInteraction,
  ensureCategory,
};
