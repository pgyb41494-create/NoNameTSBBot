const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { danger, ok } = require("../utils/embeds");
const { hasMod } = require("../utils/permissions");

function snowflake(value) {
  const id = String(value || "").replace(/[<@!>]/g, "").trim();
  return /^\d{17,20}$/.test(id) ? id : "";
}

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
    const mentioned = message.mentions.users.first();
    const id = snowflake(mentioned?.id || args[0]);
    if (!id) return message.reply({ embeds: [danger("Usage", "`'ban @user [reason]` or `'ban <userId> [reason]`")] });
    const member = await message.guild.members.fetch(id).catch(() => null);
    const reason = args.filter((a) => snowflake(a) !== id).join(" ").trim() || "No reason provided";
    if (member && !member.bannable) {
      return message.reply({ embeds: [danger("Failed", "I cannot ban that member.")] });
    }
    try {
      await message.guild.members.ban(id, { reason });
    } catch (err) {
      return message.reply({ embeds: [danger("Failed", err.message)] });
    }
    const tag = member?.user?.tag || id;
    return message.reply({ embeds: [ok("Member banned", `**${tag}** · ${reason}`)] });
  },

  async executeSlash(interaction) {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason provided";
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member && !member.bannable) {
      return interaction.reply({ embeds: [danger("Failed", "I cannot ban that member.")], ephemeral: true });
    }
    try {
      await interaction.guild.members.ban(user.id, { reason });
    } catch (err) {
      return interaction.reply({ embeds: [danger("Failed", err.message)], ephemeral: true });
    }
    return interaction.reply({ embeds: [ok("Member banned", `**${user.tag}** · ${reason}`)] });
  },
};
