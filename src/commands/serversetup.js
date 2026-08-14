const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { hubPayload } = require("../systems/setupHub");
const { danger } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");
const { brand } = require("../utils/loadApi");

module.exports = {
  name: "serversetup",
  aliases: ["setup", "tsbsetup"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("serversetup")
      .setDescription("Configure leaderboard, lineup, ranking, and score boards")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async executePrefix(message) {
    if (!isAdminOrOwner(message.member, message.guild)) {
      return message.reply({
        embeds: [danger("Missing permissions", `You need **Administrator** to use \`${brand.prefix}serversetup\`.`)],
      });
    }
    return message.reply(hubPayload(message.guild.id));
  },

  async executeSlash(interaction) {
    if (!isAdminOrOwner(interaction.member, interaction.guild)) {
      return interaction.reply({
        embeds: [danger("Missing permissions", "Administrator only.")],
        ephemeral: true,
      });
    }
    return interaction.reply({ ...hubPayload(interaction.guildId), ephemeral: true });
  },
};
