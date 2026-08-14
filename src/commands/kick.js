const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { danger, ok } = require("../utils/embeds");
const { hasMod } = require("../utils/permissions");

async function resolveTarget(guild, source, args) {
  if (source.options) return source.options.getMember("user") || source.options.getUser("user");
  const mention = source.mentions?.members?.first();
  if (mention) return mention;
  if (args[0]) return guild.members.fetch(args[0]).catch(() => null);
  return null;
}

function reasonFrom(source, args) {
  if (source.options) return source.options.getString("reason") || "No reason provided";
  return args.slice(1).join(" ") || "No reason provided";
}

module.exports = {
  name: "kick",
  slash: () =>
    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Kick a member")
      .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async executePrefix(message, args) {
    if (!hasMod(message.member, PermissionFlagsBits.KickMembers)) {
      return message.reply({ embeds: [danger("Missing permissions", "Need **Kick Members**.")] });
    }
    const member = await resolveTarget(message.guild, message, args);
    if (!member) return message.reply({ embeds: [danger("Not found", "User not found.")] });
    if (!member.kickable) return message.reply({ embeds: [danger("Failed", "I cannot kick that member.")] });
    const reason = reasonFrom(message, args);
    await member.kick(reason);
    return message.reply({ embeds: [ok("Member kicked", `**${member.user.tag}** · ${reason}`)] });
  },

  async executeSlash(interaction) {
    const member = await interaction.guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
    if (!member?.kickable) {
      return interaction.reply({ embeds: [danger("Failed", "I cannot kick that member.")], ephemeral: true });
    }
    const reason = reasonFrom(interaction);
    await member.kick(reason);
    return interaction.reply({ embeds: [ok("Member kicked", `**${member.user.tag}** · ${reason}`)] });
  },
};
