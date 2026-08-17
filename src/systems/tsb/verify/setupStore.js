const { ChannelType } = require("discord.js");
const { tsbEmbed, COLOR_PRIMARY } = require("../shared/embeds");
const { isAdminOrOwner } = require("../shared/permissions");
const { getConfig, updateConfig } = require("./store");
const { panelPayload } = require("./runtime");

function summary(guildId) {
  const cfg = getConfig(guildId);
  return (
    "**Current Configuration**\n" +
    `> **Ticket category:** ${cfg.categoryId ? `<#${cfg.categoryId}>` : "`auto-create`"}\n` +
    `> **Staff role:** ${cfg.staffRoleId ? `<@&${cfg.staffRoleId}>` : "`admins`"}\n` +
    `> **Verified role:** ${cfg.verifiedRoleId ? `<@&${cfg.verifiedRoleId}>` : "`none`"}\n\n` +
    "Members press **Start verification** → DM `/profile` steps → ticket opens when the profile is done."
  );
}

function overviewPayload(guildId) {
  return {
    embeds: [
      tsbEmbed({
        title: "Verification",
        color: COLOR_PRIMARY,
        description: "Configure verification tickets and roles.\n\n" + summary(guildId),
      }),
    ],
    components: [
      {
        type: 1,
        components: [{
          type: 8,
          custom_id: "tsb:verify:cfg_category",
          placeholder: "Ticket category",
          channel_types: [ChannelType.GuildCategory],
          min_values: 0,
          max_values: 1,
        }],
      },
      {
        type: 1,
        components: [{
          type: 6,
          custom_id: "tsb:verify:cfg_staff",
          placeholder: "Staff role (optional)",
          min_values: 0,
          max_values: 1,
        }],
      },
      {
        type: 1,
        components: [{
          type: 6,
          custom_id: "tsb:verify:cfg_role",
          placeholder: "Verified role (optional)",
          min_values: 0,
          max_values: 1,
        }],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 1, label: "Post panel here", custom_id: "tsb:verify:cfg_panel" },
          { type: 2, style: 2, label: "TSB Menu", custom_id: "tsb:verify:cfg_menu" },
        ],
      },
    ],
  };
}

function openVerifyModule(interaction) {
  if (!isAdminOrOwner(interaction.member, interaction.guild)) {
    return interaction.reply({
      content: "You need **Administrator** to configure verification.",
      ephemeral: true,
    });
  }
  const payload = overviewPayload(interaction.guild.id);
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  if (interaction.message) return interaction.update(payload);
  return interaction.reply({ ...payload, ephemeral: true });
}

async function handleVerifySetupButton(interaction) {
  const id = interaction.customId || "";
  if (id === "tsb:verify:cfg_menu") {
    const { openHub } = require("../hub");
    return openHub(interaction);
  }
  if (id === "tsb:verify:cfg_panel") {
    await interaction.channel.send(panelPayload());
    updateConfig(interaction.guild.id, { panelChannelId: interaction.channel.id, setupCompleted: true });
    return interaction.reply({ content: "Verification panel posted in this channel.", ephemeral: true });
  }
  return false;
}

async function handleVerifySetupSelect(interaction) {
  const id = interaction.customId || "";
  if (id === "tsb:verify:cfg_category") {
    updateConfig(interaction.guild.id, {
      categoryId: interaction.values?.[0] || "",
      setupCompleted: true,
    });
    return interaction.update(overviewPayload(interaction.guild.id));
  }
  if (id === "tsb:verify:cfg_staff") {
    updateConfig(interaction.guild.id, {
      staffRoleId: interaction.values?.[0] || "",
      setupCompleted: true,
    });
    return interaction.update(overviewPayload(interaction.guild.id));
  }
  if (id === "tsb:verify:cfg_role") {
    updateConfig(interaction.guild.id, {
      verifiedRoleId: interaction.values?.[0] || "",
      setupCompleted: true,
    });
    return interaction.update(overviewPayload(interaction.guild.id));
  }
  return false;
}

module.exports = {
  openVerifyModule,
  handleVerifySetupButton,
  handleVerifySetupSelect,
  overviewPayload,
};
