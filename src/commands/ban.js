const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { danger, ok } = require("../utils/embeds");
const { hasMod } = require("../utils/permissions");

module.exports = {
  name: "ban",
  slash: () =>
    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban a member")
      .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async executePrefix(message, args) {
    if (!hasMod(message.member, PermissionFlagsBits.BanMembers)) {
      return message.reply({ embeds: [danger("Missing permissions", "Need **Ban Members**.")] });
    }
    const member = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!member) return message.reply({ embeds: [danger("Not found", "User not found.")] });
    if (!member.bannable) return message.reply({ embeds: [danger("Failed", "I cannot ban that member.")] });
    const reason = args.slice(1).join(" ") || "No reason provided";
    await member.ban({ reason });
    return message.reply({ embeds: [ok("Member banned", `**${member.user.tag}** · ${reason}`)] });
  },

  async executeSlash(interaction) {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason provided";
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member && !member.bannable) {
      return interaction.reply({ embeds: [danger("Failed", "I cannot ban that member.")], ephemeral: true });
    }
    await interaction.guild.members.ban(user.id, { reason });
    return interaction.reply({ embeds: [ok("Member banned", `**${user.tag}** · ${reason}`)] });
  },
};
