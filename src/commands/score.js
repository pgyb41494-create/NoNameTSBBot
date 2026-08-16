const { SlashCommandBuilder } = require("discord.js");
const { recordScore, canUseScore } = require("../systems/tsb/score/system");
const { getScoreConfig } = require("../systems/tsb/score/config");
const { danger } = require("../utils/embeds");

module.exports = {
  name: "score",
  slash: () =>
    new SlashCommandBuilder()
      .setName("score")
      .setDescription("Record a TSB 1v1 / clan match (bumps leaderboard when configured)")
      .addStringOption((o) => o.setName("match_type").setDescription("Match type").setRequired(true)
        .addChoices({ name: "1v1", value: "1v1" }, { name: "Clan", value: "Clan" }))
      .addUserOption((o) => o.setName("participant_1").setDescription("First participant").setRequired(true))
      .addUserOption((o) => o.setName("participant_2").setDescription("Second participant").setRequired(true))
      .addStringOption((o) => o.setName("score").setDescription("Score e.g. 10-0").setRequired(true))
      .addUserOption((o) => o.setName("winner").setDescription("Winner").setRequired(true))
      .addStringOption((o) => o.setName("region").setDescription("Region label").setRequired(false))
      .addBooleanOption((o) => o.setName("crossregion").setDescription("Include cross-region details").setRequired(false))
      .addStringOption((o) => o.setName("region_1").setDescription("Cross-region side 1 label").setRequired(false))
      .addStringOption((o) => o.setName("region_1_score").setDescription("Cross-region side 1 score").setRequired(false))
      .addUserOption((o) => o.setName("region_1_winner").setDescription("Cross-region side 1 winner").setRequired(false))
      .addStringOption((o) => o.setName("region_2").setDescription("Cross-region side 2 label").setRequired(false))
      .addStringOption((o) => o.setName("region_2_score").setDescription("Cross-region side 2 score").setRequired(false))
      .addUserOption((o) => o.setName("region_2_winner").setDescription("Cross-region side 2 winner").setRequired(false))
      .addStringOption((o) => o.setName("referees").setDescription("Referee mentions / names").setRequired(false))
      .addStringOption((o) => o.setName("notes").setDescription("Notes (include auto for autowin)").setRequired(false)),

  async executePrefix(message) {
    if (!canUseScore(message.member, message.guild, getScoreConfig(message.guild.id))) {
      return message.reply({ embeds: [danger("Missing permissions", "You need **SCORE** access or an allowed score role.")] });
    }
    return message.reply({
      embeds: [danger("Use slash", "Use `/score` with match type, participants, score, and winner.")],
    });
  },

  async executeSlash(interaction) {
    return recordScore(interaction);
  },
};
