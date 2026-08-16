const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} = require("discord.js");
const {
  tsbEmbed,
  COLOR_PRIMARY,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_DANGER,
} = require("../shared/embeds");
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

function prefix() {
  return brand.prefix || "'";
}

function permLine(perm, on) {
  return `${on ? "✅" : "⬜"} ${perm.emoji} **${perm.id}** — ${perm.hint || perm.desc}`;
}

function formatPerms(permIds) {
  if (!permIds?.length) return "*None*";
  return permIds
    .map((id) => {
      const perm = PERM_CATEGORIES.find((item) => item.id === id);
      return perm ? `${perm.emoji} \`${id}\`` : `\`${id}\``;
    })
    .join("  ");
}

function buildAccessEmbed(targetUser, guild, pendingPerms, savedBanner) {
  const current = getUserPerms(guild.id, targetUser.id);
  const display = pendingPerms !== null ? pendingPerms : current;
  const unsaved =
    pendingPerms !== null &&
    JSON.stringify([...pendingPerms].sort()) !== JSON.stringify([...current].sort());

  const checklist = PERM_CATEGORIES.map((perm) => permLine(perm, display.includes(perm.id))).join("\n");

  let color = COLOR_PRIMARY;
  let status = `**${display.length} / ${PERM_CATEGORIES.length}** selected`;
  if (savedBanner) {
    color = COLOR_SUCCESS;
    status = savedBanner;
  } else if (unsaved) {
    color = COLOR_WARN;
    status = "Unsaved changes — press **Save Changes** to apply.";
  }

  return tsbEmbed({
    title: "Access",
    color,
    description: `Editing <@${targetUser.id}> in **${guild.name}**.\nUse the menu to toggle permissions, then save.`,
    thumbnail: targetUser.displayAvatarURL?.({ size: 128 }) || null,
    fields: [
      { name: "Permissions", value: checklist },
      { name: "Status", value: status },
    ],
    footer: `${prefix()}access @user PHASE · ${prefix()}access remove @user · ${prefix()}access list`,
  });
}

function detailsEmbed(targetUser, guildId) {
  const perms = getUserPerms(guildId, targetUser.id);
  return tsbEmbed({
    color: COLOR_PRIMARY,
    title: "Access",
    description: `Current access for <@${targetUser.id}>.`,
    thumbnail: targetUser.displayAvatarURL?.({ size: 128 }) || null,
    fields: [
      {
        name: "Permissions",
        value: PERM_CATEGORIES.map((perm) => permLine(perm, perms.includes(perm.id))).join("\n"),
      },
      {
        name: "Status",
        value: `**${perms.length} / ${PERM_CATEGORIES.length}** assigned`,
      },
    ],
  });
}

function listEmbed(guild) {
  const entries = listGuildAccess(guild.id);
  return tsbEmbed({
    color: COLOR_PRIMARY,
    title: "Access list",
    description: entries.length
      ? entries
          .map((entry) => `<@${entry.userId}>\n${formatPerms(entry.perms)}`)
          .join("\n\n")
      : "*No members have TSB access assigned.*",
    footer: `${entries.length} member${entries.length === 1 ? "" : "s"}`,
  });
}

function buildAccessComponents(sessionKey, guildId, targetUserId) {
  const session = accessSessions.get(sessionKey);
  const selected = session?.pendingPerms || getUserPerms(guildId, targetUserId);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`access_select_${sessionKey}`)
    .setPlaceholder("Toggle permissions…")
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
      new UserSelectMenuBuilder()
        .setCustomId(`access_user_${sessionKey}`)
        .setPlaceholder("Switch member…")
        .setMinValues(1)
        .setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`access_save_${sessionKey}`).setLabel("Save").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`access_cancel_${sessionKey}`).setLabel("Cancel").setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`access_clear_${sessionKey}`)
        .setLabel("Clear")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(selected.length === 0)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`access_list_${sessionKey}`).setLabel("View list").setStyle(ButtonStyle.Primary)
    ),
  ];
}

function buildListComponents(sessionKey) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`access_back_${sessionKey}`).setLabel("Back").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function panelPayload(sessionKey, targetUser, guild, pendingPerms, savedBanner) {
  return {
    content: "",
    embeds: [buildAccessEmbed(targetUser, guild, pendingPerms, savedBanner)],
    components: buildAccessComponents(sessionKey, guild.id, targetUser.id),
  };
}

function deniedPayload() {
  return {
    embeds: [
      tsbEmbed({
        title: "Access",
        description: "> You need **GIVEACCESS** or **Administrator** to manage TSB access.",
        color: COLOR_DANGER,
      }),
    ],
  };
}

function resultEmbed(title, description, color = COLOR_SUCCESS) {
  return tsbEmbed({ title, description, color });
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
  return panelPayload(sessionKey, target, guild, null, null);
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

function notOwnerReply() {
  return {
    content: "",
    embeds: [
      tsbEmbed({
        title: "Access",
        description: "> Only the person who opened this panel can use it.",
        color: COLOR_DANGER,
      }),
    ],
    ephemeral: true,
  };
}

async function handleAccessInteraction(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("access_")) return false;

  if (interaction.isUserSelectMenu?.() && id.startsWith("access_user_")) {
    const oldKey = parseSessionKey(id, "access_user_");
    const [adminId] = oldKey.split("_");
    if (interaction.user.id !== adminId) {
      await interaction.reply(notOwnerReply());
      return true;
    }
    if (!canGiveAccess(interaction.member, interaction.guild)) {
      await interaction.reply({ ...deniedPayload(), ephemeral: true });
      return true;
    }
    const target = interaction.users.first();
    if (!target || target.bot) {
      await interaction.reply({
        embeds: [resultEmbed("Access", "> Pick a real member, not a bot.", COLOR_DANGER)],
        ephemeral: true,
      });
      return true;
    }
    await interaction.deferUpdate();
    accessSessions.delete(oldKey);
    const payload = openAccessSession({
      adminId: interaction.user.id,
      target,
      guild: interaction.guild,
    });
    await interaction.editReply(payload);
    return true;
  }

  if (interaction.isStringSelectMenu?.() && id.startsWith("access_select_")) {
    const sessionKey = parseSessionKey(id, "access_select_");
    const [adminId, targetId] = sessionKey.split("_");
    if (interaction.user.id !== adminId) {
      await interaction.reply(notOwnerReply());
      return true;
    }
    await interaction.deferUpdate();
    const selected = interaction.values || [];
    const session = ensureSession(sessionKey, targetId, interaction.guild);
    session.pendingPerms = selected;
    accessSessions.set(sessionKey, session);
    const targetUser = await resolveTargetUser(interaction.client, targetId);
    await interaction.editReply(panelPayload(sessionKey, targetUser, interaction.guild, selected, null));
    return true;
  }

  if (!interaction.isButton?.()) return false;

  const buttonPrefix = id.startsWith("access_save_")
    ? "access_save_"
    : id.startsWith("access_cancel_")
      ? "access_cancel_"
      : id.startsWith("access_list_")
        ? "access_list_"
        : id.startsWith("access_clear_")
          ? "access_clear_"
          : id.startsWith("access_back_")
            ? "access_back_"
            : null;
  if (!buttonPrefix) return false;

  const sessionKey = parseSessionKey(id, buttonPrefix);
  const [adminId, targetId, guildId] = sessionKey.split("_");
  if (interaction.user.id !== adminId) {
    await interaction.reply(notOwnerReply());
    return true;
  }
  if (!canGiveAccess(interaction.member, interaction.guild)) {
    await interaction.reply({ ...deniedPayload(), ephemeral: true });
    return true;
  }

  const session = ensureSession(sessionKey, targetId, interaction.guild);

  if (buttonPrefix === "access_save_") {
    await interaction.deferUpdate();
    const permsToSave = session.pendingPerms ?? getUserPerms(guildId, targetId);
    setUserPerms(guildId, targetId, permsToSave);
    session.pendingPerms = null;
    const targetUser = await resolveTargetUser(interaction.client, targetId);
    const banner = `Saved — ${formatPerms(permsToSave)}`;
    await interaction.editReply(panelPayload(sessionKey, targetUser, interaction.guild, null, banner));
    return true;
  }

  if (buttonPrefix === "access_cancel_") {
    accessSessions.delete(sessionKey);
    await interaction.update({
      content: "",
      embeds: [
        tsbEmbed({
          title: "Access",
          description: "Panel closed. No changes were saved.",
          color: COLOR_DANGER,
        }),
      ],
      components: [],
    });
    const msg = interaction.message;
    if (msg && typeof msg.delete === "function") {
      setTimeout(() => msg.delete().catch(() => {}), 3000);
    }
    return true;
  }

  if (buttonPrefix === "access_clear_") {
    await interaction.deferUpdate();
    session.pendingPerms = [];
    accessSessions.set(sessionKey, session);
    const targetUser = await resolveTargetUser(interaction.client, targetId);
    await interaction.editReply(panelPayload(sessionKey, targetUser, interaction.guild, [], null));
    return true;
  }

  if (buttonPrefix === "access_list_") {
    await interaction.deferUpdate();
    await interaction.editReply({
      content: "",
      embeds: [listEmbed(interaction.guild)],
      components: buildListComponents(sessionKey),
    });
    return true;
  }

  if (buttonPrefix === "access_back_") {
    await interaction.deferUpdate();
    const targetUser = await resolveTargetUser(interaction.client, targetId);
    await interaction.editReply(
      panelPayload(sessionKey, targetUser, interaction.guild, session.pendingPerms, null)
    );
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
  resultEmbed,
  formatPerms,
  handleAccessInteraction,
};
