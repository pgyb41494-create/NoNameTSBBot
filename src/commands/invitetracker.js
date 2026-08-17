const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { isAdminOrOwner } = require("../utils/permissions");
const { applyInvitesPatch, publicInvites } = require("../systems/tsb/ops/store");
const { refreshGuild } = require("../systems/tsb/ops/invites");
const { tsbEmbed, COLOR_PRIMARY } = require("../systems/tsb/shared/embeds");

function website() {
  return String(process.env.WEBSITE_URL || process.env.FRONTEND_URL || "https://no-name-tsb-website.vercel.app").replace(
    /\/$/,
    ""
  );
}

function canManage(member, guild) {
  if (isAdminOrOwner(member, guild)) return true;
  return member?.permissions?.has?.(PermissionFlagsBits.ManageGuild);
}

module.exports = {
  name: "invitetracker",
  aliases: ["invites"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("invitetracker")
      .setDescription("Turn invite tracking on or off")
      .addBooleanOption((o) => o.setName("enabled").setDescription("On or off").setRequired(true)),

  async executePrefix(message, args) {
    if (!canManage(message.member, message.guild)) {
      return message.reply("You need **Manage Server** to use this.");
    }
    const raw = String(args[0] || "").toLowerCase();
    const enabled = ["on", "true", "1", "enable"].includes(raw)
      ? true
      : ["off", "false", "0", "disable"].includes(raw)
        ? false
        : !publicInvites(message.guild.id).enabled;
    applyInvitesPatch(message.guild.id, { enabled });
    if (enabled) await refreshGuild(message.guild);
    return message.reply({ embeds: [statusEmbed(enabled)], components: [dashRow()] });
  },

  async executeSlash(interaction) {
    if (!canManage(interaction.member, interaction.guild)) {
      return interaction.reply({ content: "You need **Manage Server** to use this.", ephemeral: true });
    }
    const enabled = interaction.options.getBoolean("enabled", true);
    applyInvitesPatch(interaction.guild.id, { enabled });
    if (enabled) await refreshGuild(interaction.guild);
    return interaction.reply({
      embeds: [statusEmbed(enabled)],
      components: [dashRow()],
      ephemeral: true,
    });
  },
};

function statusEmbed(enabled) {
  return tsbEmbed({
    title: enabled ? "Invite tracker on" : "Invite tracker off",
    color: COLOR_PRIMARY,
    description: enabled
      ? "Joins will be tracked. Open the dashboard to pick the channel and the message template.\n\nVariables: `{userinvited}` `{user}` `{invites}` `{server}` `{code}`"
      : "Invite tracking is off. Turn it on again with `/invitetracker`.",
  });
}

function dashRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open dashboard").setURL(`${website()}/dashboard`)
  );
}
