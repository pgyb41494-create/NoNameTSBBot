const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { danger, ok } = require("../utils/embeds");
const { hasMod } = require("../utils/permissions");

module.exports = {
  name: "unban",
  slash: () =>
    new SlashCommandBuilder()
      .setName("unban")
      .setDescription("Unban a user by ID")
      .addStringOption((o) => o.setName("userid").setDescription("Discord user ID").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async executePrefix(message, args) {
    if (!hasMod(message.member, PermissionFlagsBits.BanMembers)) {
      return message.reply({ embeds: [danger("Missing permissions", "Need **Ban Members**.")] });
    }
    const id = args[0];
    if (!id) return message.reply({ embeds: [danger("Usage", "`'unban <userId>`")] });
    await message.guild.members.unban(id);
    return message.reply({ embeds: [ok("User unbanned", id)] });
  },

  async executeSlash(interaction) {
    const id = interaction.options.getString("userid");
    await interaction.guild.members.unban(id);
    return interaction.reply({ embeds: [ok("User unbanned", id)] });
  },
};
