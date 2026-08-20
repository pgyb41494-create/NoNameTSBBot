const { SlashCommandBuilder } = require("discord.js");
const api = require("../utils/loadApi");
const { danger, ok } = require("../utils/embeds");
const { publishLeaderboard } = require("../systems/boardPublish");

module.exports = {
  name: "challenge",
  slash: () =>
    new SlashCommandBuilder()
      .setName("challenge")
      .setDescription("Mark a board player as being challenged")
      .addUserOption((o) => o.setName("user").setDescription("Target").setRequired(true)),

  async executePrefix(message) {
    const user = message.mentions.users.first();
    if (!user) return message.reply({ embeds: [danger("Usage", "`'challenge @user`")] });
    try {
      await Promise.resolve(api.challenges.createChallenge(message.guild.id, message.author.id, user.id));
      if (!process.env.API_SERVER_URL && !process.env.API_URL) {
        const { alertChallenge } = require("../systems/tsb/ops/alerts");
        await alertChallenge(message.guild, message.author, user).catch(() => {});
      }
      await publishLeaderboard(message.guild).catch(() => {});
      return message.reply({ embeds: [ok("Challenge posted", `${message.author} → ${user}`)] });
    } catch (err) {
      return message.reply({ embeds: [danger("Failed", err.message)] });
    }
  },

  async executeSlash(interaction) {
    const user = interaction.options.getUser("user");
    await Promise.resolve(api.challenges.createChallenge(interaction.guildId, interaction.user.id, user.id));
    if (!process.env.API_SERVER_URL && !process.env.API_URL) {
      const { alertChallenge } = require("../systems/tsb/ops/alerts");
      await alertChallenge(interaction.guild, interaction.user, user).catch(() => {});
    }
    await publishLeaderboard(interaction.guild).catch(() => {});
    return interaction.reply({ embeds: [ok("Challenge posted", `${interaction.user} → ${user}`)] });
  },
};
