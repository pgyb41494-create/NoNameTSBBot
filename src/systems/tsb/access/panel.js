const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");
const { tsbEmbed, COLOR_PRIMARY, COLOR_DANGER } = require("../shared/embeds");
const { brand } = require("../../../utils/loadApi");
const {
  PERM_CATEGORIES,
  getUserPerms,
  setUserPerms,
  listGuildAccess,
  canGiveAccess,
} = require("./store");

const accessSessions = new Map();

function sessionKeyFor(adminId, targetId, guildId) {
  return `${adminId}_${targetId}_${guildId}`;
}

function parseSessionKey(customId, prefix) {
  return customId.slice(prefix.length);
}

function buildAccessPanelContent(targetUser, guildName, guildId, pendingPerms, savedBanner) {
  const current = getUserPerms(guildId, targetUser.id);
  const display = pendingPerms !== null ? pendingPerms : current;
  const unsaved =
    pendingPerms !== null &&
    JSON.stringify([...pendingPerms].sort()) !== JSON.stringify([...current].sort());
  const p = brand.prefix || "'";

  const lines = [];
  if (savedBanner) lines.push(savedBanner, "");
  lines.push(
    "🔐 **Access Management**",
    "",
    `📝 **User:** ${targetUser.username} (<@${targetUser.id}>)`,
    `🌐 **Server:** ${guildName}`,
    "",
    `✅ **Selected:** ${display.length ? display.map((perm) => `\`${perm}\``).join(", ") : "*None*"}`,
    "",
    "👇 Use the **select menu** below (emoji + name + description).",
    "Then click **Save Changes**."
  );
  if (unsaved) lines.push("", "⚠️ *Unsaved changes.*");
  lines.push("", `⚡ \`${p}access @user PERMISSION\` · \`${p}access remove @user\` · \`${p}access view @user\``);
  return lines.join("\n");
}

function buildAccessComponents(sessionKey, guildId, targetUserId) {
  const session = accessSessions.get(sessionKey);
  const selected = session?.pendingPerms || getUserPerms(guildId, targetUserId);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`access_select_${sessionKey}`)
    .setPlaceholder("Select permissions...")
    .setMinValues(0)
    .setMaxValues(PERM_CATEGORIES.length)
    .addOptions(
      PERM_CATEGORIES.map((perm) => {
        const opt = new StringSelectMenuOptionBuilder()
          .setLabel(perm.id)
          .setValue(perm.id)
          .setDescription(perm.desc.slice(0, 100))
          .setDefault(selected.includes(perm.id));
        if (perm.emoji) opt.setEmoji(perm.emoji);
        return opt;
      })
    );

  return [
    new ActionRowBuilder().addComponents(selectMenu),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`access_save_${sessionKey}`).setLabel("Save Changes").setStyle(ButtonStyle.Success).setEmoji("💾"),
      new ButtonBuilder().setCustomId(`access_details_${sessionKey}`).setLabel("View Details").setStyle(ButtonStyle.Secondary).setEmoji("👁️"),
      new ButtonBuilder().setCustomId(`access_cancel_${sessionKey}`).setLabel("Cancel").setStyle(ButtonStyle.Danger).setEmoji("❌")
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`access_list_${sessionKey}`).setLabel("View List").setStyle(ButtonStyle.Primary).setEmoji("📋"),
      new ButtonBuilder().setCustomId(`access_clear_${sessionKey}`).setLabel("Clear All").setStyle(ButtonStyle.Secondary).setEmoji("🧹")
    ),
  ];
}

function deniedPayload() {
  return {
    embeds: [
      tsbEmbed({
        title: "Permission Denied",
        description: "> You need **GIVEACCESS** or **Administrator** to manage TSB access.",
        color: COLOR_DANGER,
      }),
    ],
  };
}

function openAccessSession({ adminId, target, guild }) {
  const sessionKey = sessionKeyFor(adminId, target.id, guild.id);
  accessSessions.set(sessionKey, {
    targetId: target.id,
    targetName: target.username,
    guildId: guild.id,
    guildName: guild.name,
    pendingPerms: null,
  });
  return {
    content: buildAccessPanelContent(target, guild.name, guild.id, null, null),
    components: buildAccessComponents(sessionKey, guild.id, target.id),
    embeds: [],
  };
}

function detailsEmbed(targetUser, guildId) {
  const perms = getUserPerms(guildId, targetUser.id);
  const lines = PERM_CATEGORIES.map(
    (perm) => `${perms.includes(perm.id) ? "✅" : "⬜"} ${perm.emoji} **${perm.id}** — ${perm.desc}`
  ).join("\n");
  return tsbEmbed({
    color: COLOR_PRIMARY,
    title: `Access details — ${targetUser.username}`,
    description: `${lines}\n\nActive permissions: **${perms.length} / ${PERM_CATEGORIES.length}**`,
    thumbnail: targetUser.displayAvatarURL?.({ size: 128 }) || null,
  });
}

function listEmbed(guild) {
  const entries = listGuildAccess(guild.id);
  return tsbEmbed({
    color: COLOR_PRIMARY,
    title: `Access list — ${guild.name}`,
    description: entries.length
      ? entries.map((entry) => `<@${entry.userId}> — ${entry.perms.join(", ")}`).join("\n")
      : "*No users have TSB access assigned.*",
  });
}

async function resolveTargetUser(client, targetId) {
  try {
    return await client.users.fetch(targetId);
  } catch {
    return { id: targetId, username: targetId, displayAvatarURL: () => null };
  }
}

function ensureSession(sessionKey, targetId, guild) {
  let session = accessSessions.get(sessionKey);
  if (!session) {
    session = {
      targetId,
      guildId: guild.id,
      guildName: guild.name,
      pendingPerms: null,
    };
    accessSessions.set(sessionKey, session);
  }
  return session;
}

async function handleAccessInteraction(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("access_")) return false;

  if (interaction.isStringSelectMenu?.() && id.startsWith("access_select_")) {
    const sessionKey = parseSessionKey(id, "access_select_");
    const [adminId, targetId] = sessionKey.split("_");
    if (interaction.user.id !== adminId) {
      await interaction.reply({ content: "Only the person who opened this panel can use it.", ephemeral: true });
      return true;
    }
    await interaction.deferUpdate();
    const selected = interaction.values || [];
    const session = ensureSession(sessionKey, targetId, interaction.guild);
    session.pendingPerms = selected;
    accessSessions.set(sessionKey, session);
    const targetUser = await resolveTargetUser(interaction.client, targetId);
    await interaction.editReply({
      content: buildAccessPanelContent(targetUser, interaction.guild.name, interaction.guild.id, selected, null),
      components: buildAccessComponents(sessionKey, interaction.guild.id, targetId),
      embeds: [],
    });
    return true;
  }

  if (!interaction.isButton?.()) return false;

  const prefix = id.startsWith("access_save_")
    ? "access_save_"
    : id.startsWith("access_cancel_")
      ? "access_cancel_"
      : id.startsWith("access_details_")
        ? "access_details_"
        : id.startsWith("access_list_")
          ? "access_list_"
          : id.startsWith("access_clear_")
            ? "access_clear_"
            : null;
  if (!prefix) return false;

  const sessionKey = parseSessionKey(id, prefix);
  const [adminId, targetId, guildId] = sessionKey.split("_");
  if (interaction.user.id !== adminId) {
    await interaction.reply({ content: "Only the person who opened this panel can use it.", ephemeral: true });
    return true;
  }
  if (!canGiveAccess(interaction.member, interaction.guild)) {
    await interaction.reply({ ...deniedPayload(), ephemeral: true });
    return true;
  }

  const session = ensureSession(sessionKey, targetId, interaction.guild);

  if (prefix === "access_save_") {
    await interaction.deferUpdate();
    const permsToSave = session.pendingPerms ?? getUserPerms(guildId, targetId);
    setUserPerms(guildId, targetId, permsToSave);
    session.pendingPerms = null;
    const targetUser = await resolveTargetUser(interaction.client, targetId);
    const banner = `✅ **Saved** — \`${permsToSave.join(", ") || "None"}\``;
    await interaction.editReply({
      content: buildAccessPanelContent(targetUser, interaction.guild.name, guildId, null, banner),
      components: buildAccessComponents(sessionKey, guildId, targetId),
      embeds: [],
    });
    return true;
  }

  if (prefix === "access_cancel_") {
    accessSessions.delete(sessionKey);
    await interaction.update({
      content: "❌ **Panel closed** — No changes were saved.",
      embeds: [],
      components: [],
    });
    const msg = interaction.message;
    if (msg && typeof msg.delete === "function") {
      setTimeout(() => msg.delete().catch(() => {}), 3000);
    }
    return true;
  }

  if (prefix === "access_clear_") {
    await interaction.deferUpdate();
    session.pendingPerms = [];
    accessSessions.set(sessionKey, session);
    const targetUser = await resolveTargetUser(interaction.client, targetId);
    await interaction.editReply({
      content: buildAccessPanelContent(targetUser, interaction.guild.name, guildId, [], null),
      components: buildAccessComponents(sessionKey, guildId, targetId),
      embeds: [],
    });
    return true;
  }

  if (prefix === "access_details_") {
    await interaction.deferReply({ ephemeral: true });
    const targetUser = await resolveTargetUser(interaction.client, targetId);
    await interaction.editReply({ embeds: [detailsEmbed(targetUser, guildId)] });
    return true;
  }

  if (prefix === "access_list_") {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({ embeds: [listEmbed(interaction.guild)] });
    return true;
  }

  return true;
}

module.exports = {
  accessSessions,
  deniedPayload,
  openAccessSession,
  detailsEmbed,
  listEmbed,
  handleAccessInteraction,
};
