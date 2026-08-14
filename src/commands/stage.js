const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const api = require("../utils/loadApi");
const { danger, ok } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");
const { publishLeaderboard, publishLineup } = require("../systems/boardPublish");

module.exports = {
  name: "stage",
  aliases: ["tier", "rank"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("stage")
      .setDescription("Set a player's TSB stage")
      .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))
      .addStringOption((o) => o.setName("stage").setDescription("e.g. 0 Low Weak").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async executePrefix(message, args) {
    if (!isAdminOrOwner(message.member, message.guild)) {
      return message.reply({ embeds: [danger("Missing permissions", "Staff only.")] });
    }
    const user = message.mentions.users.first();
    const stage = args.filter((a) => !a.startsWith("<@")).join(" ");
    if (!user || !stage) return message.reply({ embeds: [danger("Usage", "`'stage @user 0 Low Weak`")] });
    api.ranking.setStage(message.guild.id, user.id, stage, message.author.id);
    await publishLeaderboard(message.guild).catch(() => {});
    await publishLineup(message.guild).catch(() => {});
    return message.reply({ embeds: [ok("Stage set", `${user} → **${api.ranking.getStage(message.guild.id, user.id)}**`)] });
  },

  async executeSlash(interaction) {
    const user = interaction.options.getUser("user");
    api.ranking.setStage(interaction.guildId, user.id, interaction.options.getString("stage"), interaction.user.id);
    await publishLeaderboard(interaction.guild).catch(() => {});
    await publishLineup(interaction.guild).catch(() => {});
    return interaction.reply({ embeds: [ok("Stage set", `${user} → **${api.ranking.getStage(interaction.guildId, user.id)}**`)] });
  },
};
