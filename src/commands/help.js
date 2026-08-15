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
    description: [
      `Prefix is \`${p}\` (example \`${p}help\`). Slash works too.`,
      "",
      "**Setup**",
      `\`${p}serversetup\` / \`/serversetup\` — leaderboard, lineup, ranking, score`,
      "",
      "**Profile & coach**",
      `\`/profile\` · \`${p}profile\``,
      `\`/tsbcoach\` · \`${p}tsbcoach\` (aliases: coach, vod)`,
      `\`${p}ask\` / \`/ask\` — TSBL competitive rules Q&A`,
      `\`${p}rules\` / \`/rules\` — official TSBL rulebook (no AI)`,
      "",
      "**Boards**",
      `\`${p}tsbtop\` / \`/tsbtop\` (alias: top)`,
      `\`${p}lineup\` / \`/lineup\``,
      `\`${p}stage\` / \`/stage\` (aliases: tier, rank)`,
      `\`${p}score\` / \`/score\``,
      `\`${p}challenge\` / \`/challenge\``,
      "",
      "**Moderation**",
      "`/kick` `/ban` `/unban` `/timeout` `/purge`",
      "",
      "**Info**",
      "`/help` `/serverinfo` `/userinfo` `/avatar`",
      "",
      "Blacklist + wars are managed on the website dashboard.",
    ].join("\n"),
  });
}
