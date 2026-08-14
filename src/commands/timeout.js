const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { danger, ok } = require("../utils/embeds");
const { hasMod } = require("../utils/permissions");

module.exports = {
  name: "timeout",
  aliases: ["mute"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Timeout a member")
      .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
      .addIntegerOption((o) => o.setName("minutes").setDescription("Duration in minutes").setRequired(true).setMinValue(1).setMaxValue(40320))
      .addStringOption((o) => o.setName("reason").setDescription("Reason"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async executePrefix(message, args) {
    if (!hasMod(message.member, PermissionFlagsBits.ModerateMembers)) {
      return message.reply({ embeds: [danger("Missing permissions", "Need **Moderate Members**.")] });
    }
    const member = message.mentions.members.first();
    const minutes = Number(args[1]);
    if (!member || !minutes) return message.reply({ embeds: [danger("Usage", "`'timeout @user <minutes> [reason]`")] });
    await member.timeout(minutes * 60 * 1000, args.slice(2).join(" ") || "No reason provided");
    return message.reply({ embeds: [ok("Timed out", `**${member.user.tag}** for ${minutes}m`)] });
  },

  async executeSlash(interaction) {
    const member = await interaction.guild.members.fetch(interaction.options.getUser("user").id);
    const minutes = interaction.options.getInteger("minutes");
    await member.timeout(minutes * 60 * 1000, interaction.options.getString("reason") || "No reason provided");
    return interaction.reply({ embeds: [ok("Timed out", `**${member.user.tag}** for ${minutes}m`)] });
  },
};
