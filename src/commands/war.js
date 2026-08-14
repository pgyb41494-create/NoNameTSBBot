const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const api = require("../utils/loadApi");
const { danger, ok } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");

module.exports = {
  name: "war",
  aliases: ["wars"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("war")
      .setDescription("Log a clan war on the website")
      .addStringOption((o) => o.setName("opponent").setDescription("Enemy clan").setRequired(true))
      .addStringOption((o) => o.setName("result").setDescription("win / loss / draw").setRequired(true))
      .addStringOption((o) => o.setName("score").setDescription("e.g. 4-2").setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async executePrefix(message, args) {
    if (!isAdminOrOwner(message.member, message.guild)) {
      return message.reply({ embeds: [danger("Missing permissions", "Administrator only.")] });
    }
    const [opponent, result, score] = args;
    if (!opponent || !result) return message.reply({ embeds: [danger("Usage", "`'war ClanName win 4-2`")] });
    api.wars.addWar(message.guild.id, { opponent, result, score });
    return message.reply({ embeds: [ok("War logged", `vs **${opponent}** · ${result}`)] });
  },

  async executeSlash(interaction) {
    api.wars.addWar(interaction.guildId, {
      opponent: interaction.options.getString("opponent"),
      result: interaction.options.getString("result"),
      score: interaction.options.getString("score"),
    });
    return interaction.reply({ embeds: [ok("War logged", "It will show on the Wars tab.")] });
  },
};
