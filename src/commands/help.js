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
      `\`${p}serversetup\` / \`/serversetup\` / \`/tsbsetup\` (alias \`${p}tsbsetup\`) — leaderboard, ranking, score, lineups, tryouts`,
      "",
      "**Profile & coach**",
      `\`/profile\` · \`${p}profile\``,
      `\`/tsbcoach\` · \`${p}tsbcoach\` (aliases: coach, vod)`,
      `\`${p}ask\` / \`/ask\` — preguntas TSBL (español por defecto; \`'ask en …\` en inglés)`,
      `\`${p}rules\` / \`/rules\` — reglamento TSBL (español; botón English / \`'rules en\`)`,
      "",
      "**Boards**",
      `\`${p}tsbtop\` / \`/tsbtop\` (aliases: \`${p}top\`, \`${p}lbset\`)`,
      `\`${p}lineup add <region> <pos> @user\` / \`/lineup\` — add · replace · remove · sub · publish`,
      `\`${p}phase @user 2 high strong\` / \`/phase\` (aliases: stage, tier, rank)`,
      `\`/score\` — 1v1 / clan match (prefix not used; same options as Obscura)`,
      `\`${p}tryout\` / \`/tryout\` — create · list · end`,
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
