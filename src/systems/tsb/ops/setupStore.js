const { ChannelType } = require("discord.js");
const { tsbEmbed, COLOR_PRIMARY } = require("../shared/embeds");
const { isAdminOrOwner } = require("../shared/permissions");
const { publicStaffAlerts, applyStaffAlertsPatch } = require("./store");

const EVENT_OPTIONS = [
  { label: "Profile registered", value: "profile" },
  { label: "Rank / phase change", value: "phase" },
  { label: "Score logged", value: "score" },
  { label: "Challenge opened", value: "challenge" },
  { label: "Duplicate Roblox", value: "duplicateRoblox" },
];

function summary(guildId) {
  const cfg = publicStaffAlerts(guildId);
  const channel = cfg.channelId
    ? `<#${cfg.channelId}>`
    : cfg.fallbackChannelId
      ? `<#${cfg.fallbackChannelId}> (audit fallback)`
      : "`none`";
  const enabled = EVENT_OPTIONS.filter((o) => cfg.events[o.value] !== false).map((o) => o.label);
  return (
    `**Channel:** ${channel}\n` +
    `**Alerts:** ${enabled.length ? enabled.join(" · ") : "all off"}\n\n` +
    "Posts TSB events for staff: profiles, ranks, scores, challenges, duplicate Roblox links.\n" +
    "Also configurable on the website dashboard."
  );
}

function overviewPayload(guildId) {
  const cfg = publicStaffAlerts(guildId);
  return {
    embeds: [
      tsbEmbed({
        title: "Staff alerts",
        color: COLOR_PRIMARY,
        description: summary(guildId),
      }),
    ],
    components: [
      {
        type: 1,
        components: [{
          type: 8,
          custom_id: "tsb:alerts:channel",
          placeholder: "Alert channel",
          channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
          min_values: 0,
          max_values: 1,
        }],
      },
      {
        type: 1,
        components: [{
          type: 3,
          custom_id: "tsb:alerts:events",
          placeholder: "Enabled alert types",
          min_values: 0,
          max_values: EVENT_OPTIONS.length,
          options: EVENT_OPTIONS.map((o) => ({
            ...o,
            default: cfg.events[o.value] !== false,
          })),
        }],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 1, label: "Create #staff-alerts", custom_id: "tsb:alerts:create" },
          { type: 2, style: 2, label: "TSB Menu", custom_id: "tsb:alerts:menu" },
        ],
      },
    ],
  };
}

function openAlertsModule(interaction) {
  if (!isAdminOrOwner(interaction.member, interaction.guild)) {
    return interaction.reply({
      content: "You need **Administrator** to configure staff alerts.",
      ephemeral: true,
    });
  }
  const payload = overviewPayload(interaction.guild.id);
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  if (interaction.message) return interaction.update(payload);
  return interaction.reply({ ...payload, ephemeral: true });
}

async function handleAlertsSetupButton(interaction) {
  const id = interaction.customId || "";
  if (id === "tsb:alerts:menu") {
    const { openHub } = require("../hub");
    return openHub(interaction);
  }
  if (id === "tsb:alerts:create") {
    const existing = interaction.guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildText && ch.name === "staff-alerts"
    );
    const channel =
      existing ||
      (await interaction.guild.channels.create({
        name: "staff-alerts",
        type: ChannelType.GuildText,
        reason: "TSB staff alert feed",
      }));
    applyStaffAlertsPatch(interaction.guild.id, { channelId: channel.id });
    return interaction.update(overviewPayload(interaction.guild.id));
  }
  return false;
}

async function handleAlertsSetupSelect(interaction) {
  const id = interaction.customId || "";
  if (id === "tsb:alerts:channel") {
    const channelId = interaction.values?.[0] || "";
    applyStaffAlertsPatch(interaction.guild.id, { channelId });
    return interaction.update(overviewPayload(interaction.guild.id));
  }
  if (id === "tsb:alerts:events") {
    const selected = new Set(interaction.values || []);
    const events = {};
    for (const opt of EVENT_OPTIONS) events[opt.value] = selected.has(opt.value);
    applyStaffAlertsPatch(interaction.guild.id, { events });
    return interaction.update(overviewPayload(interaction.guild.id));
  }
  return false;
}

module.exports = {
  openAlertsModule,
  handleAlertsSetupButton,
  handleAlertsSetupSelect,
};
