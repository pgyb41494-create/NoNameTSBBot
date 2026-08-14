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
      `Prefix is \`${p}\` (example \`${p}help\`). Slash works too.\n\n` +
      `**Setup**\n` +
      `\`${p}serversetup\` / \`/serversetup\` — leaderboard, lineup, ranking, score\n\n` +
      `**Profile & coach**\n` +
      \`/profile\` · \`${p}profile\`\n` +
      \`/tsbcoach\` · \`${p}tsbcoach\` (aliases: coach, vod)\n\n` +
      `**Boards**\n` +
      `\`${p}tsbtop\` / \`/tsbtop\` (alias: top)\n` +
      `\`${p}lineup\` / \`/lineup\`\n` +
      `\`${p}stage\` / \`/stage\` (aliases: tier, rank)\n` +
      `\`${p}score\` / \`/score\`\n` +
      `\`${p}challenge\` / \`/challenge\`\n` +
      `\`${p}war\` / \`/war\` (alias: wars)\n\n` +
      `**Moderation**\n` +
      \`/kick\` \`/ban\` \`/unban\` \`/timeout\` \`/purge\`\n` +
      `\`${p}blacklist\` / \`/blacklist\`\n\n` +
      `**Info**\n` +
      \`/help\` \`/serverinfo\` \`/userinfo\` \`/avatar\``,
  });
}
