const { ChannelType } = require("discord.js");
const { tsbEmbed, COLOR_PRIMARY } = require("../shared/embeds");
const { isAdminOrOwner } = require("../shared/permissions");
const { getConfig, updateConfig } = require("./store");
const { upsertPanel } = require("./runtime");

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

function summary(guildId) {
  const cfg = getConfig(guildId);
  const line = (label, value) => `> **${label}:** ${value}`;
  return [
    line("Panel", cfg.panelChannelId ? `<#${cfg.panelChannelId}>` : "`not posted`"),
    line("Tickets in", cfg.categoryId ? `<#${cfg.categoryId}>` : "`auto category`"),
    line("Staff", cfg.staffRoleId ? `<@&${cfg.staffRoleId}>` : "`admins`"),
    line("Verified role", cfg.verifiedRoleId ? `<@&${cfg.verifiedRoleId}>` : "`none`"),
    line("Ticket log", cfg.logChannelId ? `<#${cfg.logChannelId}>` : "`server audit log`"),
  ].join("\n");
}

function overviewPayload(guildId, notice = "") {
  return {
    embeds: [
      tsbEmbed({
        title: "Verification",
        color: COLOR_PRIMARY,
        description:
          "**Verify** → profile in DMs → private ticket with **Claim · Approve · Deny · Close**.\n" +
          "Closing saves a transcript to the ticket log.\n\n" +
          summary(guildId) +
          (notice ? `\n\n${notice}` : ""),
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
        components: [{
          type: 8,
          custom_id: "tsb:verify:cfg_log",
          placeholder: "Ticket log channel (transcripts + actions)",
          channel_types: TEXT_CHANNELS,
          min_values: 0,
          max_values: 1,
        }],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 1, label: "Post panel here", custom_id: "tsb:verify:cfg_panel" },
          { type: 2, style: 2, label: "Post panel in…", custom_id: "tsb:verify:cfg_postin" },
          { type: 2, style: 2, label: "TSB Menu", custom_id: "tsb:verify:cfg_menu" },
        ],
      },
    ],
  };
}

function panelChannelPayload() {
  return {
    embeds: [
      tsbEmbed({
        title: "Post verification panel",
        color: COLOR_PRIMARY,
        description: "Pick any channel. If the panel is already posted somewhere else, it moves there.",
      }),
    ],
    components: [
      {
        type: 1,
        components: [{
          type: 8,
          custom_id: "tsb:verify:cfg_panelch",
          placeholder: "Panel channel",
          channel_types: TEXT_CHANNELS,
          min_values: 1,
          max_values: 1,
        }],
      },
      {
        type: 1,
        components: [{ type: 2, style: 2, label: "Back", custom_id: "tsb:verify:cfg_back" }],
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

async function postPanelNotice(channel, guild) {
  try {
    await upsertPanel(channel, guild);
    return `Panel posted in ${channel}.`;
  } catch (err) {
    return `Couldn't post in ${channel || "that channel"}: ${err.message || "check my permissions there"}.`;
  }
}

function denySetup(interaction) {
  return interaction.reply({ content: "You need **Administrator** to configure verification.", ephemeral: true });
}

async function handleVerifySetupButton(interaction) {
  const id = interaction.customId || "";
  if (!isAdminOrOwner(interaction.member, interaction.guild)) return denySetup(interaction);
  if (id === "tsb:verify:cfg_menu") {
    const { openHub } = require("../hub");
    return openHub(interaction);
  }
  if (id === "tsb:verify:cfg_panel") {
    await interaction.deferUpdate();
    const notice = await postPanelNotice(interaction.channel, interaction.guild);
    return interaction.editReply(overviewPayload(interaction.guild.id, notice));
  }
  if (id === "tsb:verify:cfg_postin") return interaction.update(panelChannelPayload());
  if (id === "tsb:verify:cfg_back") return interaction.update(overviewPayload(interaction.guild.id));
  return false;
}

async function handleVerifySetupSelect(interaction) {
  const id = interaction.customId || "";
  if (!isAdminOrOwner(interaction.member, interaction.guild)) return denySetup(interaction);
  const guildId = interaction.guild.id;
  const value = interaction.values?.[0] || "";
  if (id === "tsb:verify:cfg_category") {
    updateConfig(guildId, { categoryId: value, setupCompleted: true });
    return interaction.update(overviewPayload(guildId));
  }
  if (id === "tsb:verify:cfg_staff") {
    updateConfig(guildId, { staffRoleId: value, setupCompleted: true });
    return interaction.update(overviewPayload(guildId));
  }
  if (id === "tsb:verify:cfg_role") {
    updateConfig(guildId, { verifiedRoleId: value, setupCompleted: true });
    return interaction.update(overviewPayload(guildId));
  }
  if (id === "tsb:verify:cfg_log") {
    updateConfig(guildId, { logChannelId: value, setupCompleted: true });
    return interaction.update(overviewPayload(guildId, value ? `Ticket log set to <#${value}>.` : "Ticket log cleared."));
  }
  if (id === "tsb:verify:cfg_panelch") {
    await interaction.deferUpdate();
    const channel = await interaction.guild.channels.fetch(value).catch(() => null);
    const notice = await postPanelNotice(channel, interaction.guild);
    return interaction.editReply(overviewPayload(guildId, notice));
  }
  return false;
}

module.exports = {
  openVerifyModule,
  handleVerifySetupButton,
  handleVerifySetupSelect,
  overviewPayload,
};
