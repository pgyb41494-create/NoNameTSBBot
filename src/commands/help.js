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
      `\`${p}tsbsetup\` / \`/tsbsetup\` (alias \`${p}serversetup\` / \`/serversetup\`) — leaderboard, ranking, score, lineups, tryouts, verification`,
      `\`${p}access @user\` / \`/access\` — grant TSB staff access (phase, boards, lineups, score, tryouts, verify)`,
      `\`${p}verify\` / \`/verify\` — staff posts the panel · members get \`/profile\` in DMs`,
      `\`${p}invitetracker on|off\` / \`/invitetracker\` — join tracking · channel + message on the dashboard`,
      "",
      "**Profile & coach**",
      `\`/profile\` · \`${p}profile\``,
      `\`/tsbcoach\` · \`${p}tsbcoach\` (aliases: coach, vod)`,
      `\`${p}ask\` / \`/ask\` — TSBCC rules questions (English by default; \`'ask es …\` for Spanish)`,
      `\`${p}rules\` / \`/rules\` — TSBCC rulebook (English; Spanish button / \`'rules es\`)`,
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
