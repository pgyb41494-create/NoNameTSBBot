const { SlashCommandBuilder } = require("discord.js");
const { surface, brand } = require("../utils/embeds");

module.exports = {
  name: "help",
  slash: () => new SlashCommandBuilder().setName("help").setDescription("Command list"),

  async executePrefix(message) {
    return message.reply({ embeds: [helpEmbed()] });
  },
  async executeSlash(interaction) {
    return interaction.reply({ embeds: [helpEmbed()] });
  },
};

function helpEmbed() {
  const p = brand.prefix;
  return surface({
    title: `${brand.name} commands`,
    description:
      `Prefix is \`${p}\`. Slash works too.\n\n` +
      `**Setup**\n\`${p}serversetup\` · \`/serversetup\`\n\n` +
      `**Profile & coach**\n\`/profile\` · \`/tsbcoach\`\n\n` +
      `**Boards**\n\`${p}tsbtop 1 @user\` · \`${p}lineup add na 1 @user\` · \`${p}stage @user 0 Low Weak\` · \`/score\`\n\n` +
      `**Website**\nBlacklist reports + trainers are managed on the dashboard.\n\n` +
      `**Moderation**\n\`/kick\` \`/ban\` \`/unban\` \`/timeout\` \`/purge\`\n\n` +
      `**Info**\n\`/serverinfo\` \`/userinfo\` \`/avatar\``,
  });
}
