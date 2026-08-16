const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { hubPayload } = require("../systems/tsb/hub");
const { danger } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");
const { brand } = require("../utils/loadApi");

module.exports = {
  name: "serversetup",
  aliases: ["setup", "tsbsetup"],
  slash: () => [
    new SlashCommandBuilder()
      .setName("serversetup")
      .setDescription("Configure TSB Systems (leaderboard, ranking, score, lineups, tryouts)")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName("tsbsetup")
      .setDescription("Configure TSB Systems (leaderboard, ranking, score, lineups, tryouts)")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ],

  async executePrefix(message) {
    if (!isAdminOrOwner(message.member, message.guild)) {
      return message.reply({
        embeds: [danger(
          "Missing permissions",
          `You need **Administrator** or server owner to use \`${brand.prefix}tsbsetup\`.`
        )],
        allowedMentions: { repliedUser: false },
      });
    }
    return message.reply({ ...hubPayload(message.guild.id), allowedMentions: { repliedUser: false } });
  },

  async executeSlash(interaction) {
    if (!isAdminOrOwner(interaction.member, interaction.guild)) {
      return interaction.reply({
        embeds: [danger("Missing permissions", "You need **Administrator** or server owner to use `/tsbsetup`.")],
        ephemeral: true,
      });
    }
    return interaction.reply({ ...hubPayload(interaction.guildId), ephemeral: true });
  },
};
