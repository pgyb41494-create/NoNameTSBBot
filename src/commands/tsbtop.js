const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const api = require("../utils/loadApi");
const { danger, ok } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");
const { publishLeaderboard } = require("../systems/boardPublish");

module.exports = {
  name: "tsbtop",
  aliases: ["top"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("tsbtop")
      .setDescription("Place a player on the top leaderboard")
      .addIntegerOption((o) => o.setName("position").setDescription("1-50").setRequired(true).setMinValue(1).setMaxValue(50))
      .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async executePrefix(message, args) {
    if (!isAdminOrOwner(message.member, message.guild)) {
      return message.reply({ embeds: [danger("Missing permissions", "Administrator only.")] });
    }
    const pos = Number(args[0]);
    const user = message.mentions.users.first();
    if (!pos || !user) return message.reply({ embeds: [danger("Usage", "`'tsbtop 1 @user`")] });
    api.leaderboard.place(message.guild.id, pos, user.id);
    await publishLeaderboard(message.guild).catch(() => {});
    return message.reply({ embeds: [ok("Board updated", `#${pos} ${user}`)] });
  },

  async executeSlash(interaction) {
    const pos = interaction.options.getInteger("position");
    const user = interaction.options.getUser("user");
    api.leaderboard.place(interaction.guildId, pos, user.id);
    await publishLeaderboard(interaction.guild).catch(() => {});
    return interaction.reply({ embeds: [ok("Board updated", `#${pos} ${user}`)] });
  },
};
