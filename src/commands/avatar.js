const { SlashCommandBuilder } = require("discord.js");
const { surface } = require("../utils/embeds");

module.exports = {
  name: "avatar",
  slash: () =>
    new SlashCommandBuilder()
      .setName("avatar")
      .setDescription("Show a Discord avatar")
      .addUserOption((o) => o.setName("user").setRequired(false)),

  async executePrefix(message) {
    const user = message.mentions.users.first() || message.author;
    return message.reply({ embeds: [card(user)] });
  },
  async executeSlash(interaction) {
    const user = interaction.options.getUser("user") || interaction.user;
    return interaction.reply({ embeds: [card(user)] });
  },
};

function card(user) {
  const url = user.displayAvatarURL({ size: 4096 });
  return surface({
    title: user.tag,
    image: url,
    description: `[Open](${url})`,
  });
}
