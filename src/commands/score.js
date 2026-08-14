const { SlashCommandBuilder } = require("discord.js");
const api = require("../utils/loadApi");
const { danger, ok } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");
const { publishLeaderboard } = require("../systems/boardPublish");

module.exports = {
  name: "score",
  slash: () =>
    new SlashCommandBuilder()
      .setName("score")
      .setDescription("Record a 1v1 result")
      .addUserOption((o) => o.setName("winner").setDescription("Winner").setRequired(true))
      .addUserOption((o) => o.setName("loser").setDescription("Loser").setRequired(true))
      .addStringOption((o) => o.setName("score").setDescription("e.g. 10-7").setRequired(true))
      .addStringOption((o) => o.setName("region").setDescription("Region").setRequired(false)),

  async executePrefix(message, args) {
    if (!isAdminOrOwner(message.member, message.guild)) {
      return message.reply({ embeds: [danger("Missing permissions", "Staff only.")] });
    }
    const users = [...message.mentions.users.values()];
    if (users.length < 2) return message.reply({ embeds: [danger("Usage", "`'score @winner @loser 10-7`")] });
    const score = args.find((a) => /\d+\s*-\s*\d+/.test(a)) || "1-0";
    api.score.recordMatch(message.guild.id, {
      winnerId: users[0].id,
      loserId: users[1].id,
      score,
    });
    await publishLeaderboard(message.guild).catch(() => {});
    return message.reply({ embeds: [ok("Match recorded", `${users[0]} beat ${users[1]} · \`${score}\``)] });
  },

  async executeSlash(interaction) {
    const winner = interaction.options.getUser("winner");
    const loser = interaction.options.getUser("loser");
    const score = interaction.options.getString("score");
    api.score.recordMatch(interaction.guildId, {
      winnerId: winner.id,
      loserId: loser.id,
      score,
      region: interaction.options.getString("region"),
    });
    await publishLeaderboard(interaction.guild).catch(() => {});
    return interaction.reply({ embeds: [ok("Match recorded", `${winner} beat ${loser} · \`${score}\``)] });
  },
};
