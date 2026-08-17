const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { danger, ok } = require("../utils/embeds");
const {
  canSendPanel,
  listPanels,
  fetchPanel,
  sendPanel,
  isTextChannel,
  denied,
} = require("../systems/tsb/panels/runtime");

function sanitizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 40);
}

module.exports = {
  name: "panel",
  aliases: ["pannel", "sendpanel"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Send a saved panel from the dashboard")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addStringOption((o) =>
        o.setName("panel").setDescription("Panel (autocomplete)").setRequired(true).setAutocomplete(true)
      )
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Channel to post in (defaults to here)")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      ),

  async autocomplete(interaction) {
    try {
      const focused = String(interaction.options.getFocused() || "").toLowerCase();
      const listed = await listPanels(interaction.guild.id);
      const choices = listed
        .filter((p) => {
          const title = String(p.title || p.name || p.key || "").toLowerCase();
          const key = String(p.key || "").toLowerCase();
          return !focused || title.includes(focused) || key.includes(focused);
        })
        .slice(0, 25)
        .map((p) => ({
          name: `${p.title || p.name || p.key} — ${p.key}`.slice(0, 100),
          value: String(p.key || "").slice(0, 100),
        }));
      await interaction.respond(choices);
    } catch {
      await interaction.respond([]);
    }
  },

  async executePrefix(message, args) {
    if (!canSendPanel(message.member)) {
      return message.reply({ ...denied(), allowedMentions: { repliedUser: false } });
    }
    const key = sanitizeKey(args[0] || "");
    if (!key) {
      return message.reply({
        embeds: [danger("Usage", `\`'panel <key>\` — pick a panel from the dashboard, then send it here.`)],
        allowedMentions: { repliedUser: false },
      });
    }
    const panel = await fetchPanel(message.guild.id, key);
    if (!panel) {
      return message.reply({
        embeds: [danger("Not found", `No saved panel named **${args[0]}**. Create it on the dashboard Panels tab.`)],
        allowedMentions: { repliedUser: false },
      });
    }
    const channel = message.mentions.channels.first() || message.channel;
    if (!isTextChannel(channel)) {
      return message.reply({ embeds: [danger("Channel", "Pick a text channel.")] });
    }
    await sendPanel(channel, message.guild.id, panel, panel.key);
    return message.reply({
      embeds: [ok("Panel sent", `Posted **${panel.title || panel.key}** to ${channel}.`)],
      allowedMentions: { repliedUser: false },
    });
  },

  async executeSlash(interaction) {
    if (!canSendPanel(interaction.member)) {
      return interaction.reply({ ...denied(), ephemeral: true });
    }
    const raw = interaction.options.getString("panel");
    const key = sanitizeKey(raw || "");
    const panel = await fetchPanel(interaction.guild.id, key);
    if (!panel) {
      return interaction.reply({
        embeds: [danger("Not found", `No saved panel named **${raw || key}**. Create it on the dashboard Panels tab.`)],
        ephemeral: true,
      });
    }
    const channel = interaction.options.getChannel("channel") || interaction.channel;
    if (!isTextChannel(channel)) {
      return interaction.reply({ embeds: [danger("Channel", "Pick a text channel.")], ephemeral: true });
    }
    await sendPanel(channel, interaction.guild.id, panel, panel.key);
    return interaction.reply({
      content: `Panel **${panel.title || panel.key}** sent to ${channel}.`,
      ephemeral: true,
    });
  },
};
