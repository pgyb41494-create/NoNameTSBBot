const { isAdminOrOwner } = require("./shared/permissions");

const HUB_CUSTOM_ID = "tsb:hub";

function statusLabel(ok) {
  return ok ? "Configured" : "Not configured";
}

function buildModuleOptions(guildId) {
  let lb = false;
  let rank = false;
  let score = false;
  let lineup = false;
  let tryout = false;
  try {
    const { getLeaderboardConfig } = require("./leaderboard/config");
    lb = !!getLeaderboardConfig(guildId).setupCompleted;
  } catch {}
  try {
    const { isSetupCompleted } = require("./ranking/config");
    rank = !!isSetupCompleted(guildId);
  } catch {}
  try {
    const { getScoreConfig } = require("./score/config");
    score = !!getScoreConfig(guildId).setupCompleted;
  } catch {}
  try {
    const { getLineupConfig } = require("./lineup/config");
    lineup = !!getLineupConfig(guildId).setupCompleted;
  } catch {}
  try {
    const { getTryoutSettings } = require("./tryout/settings");
    tryout = !!getTryoutSettings(guildId).configured;
  } catch {}

  return [
    { label: "Top Leaderboard", value: "leaderboard_setup", description: statusLabel(lb).slice(0, 100) },
    { label: "Ranking Setup", value: "ranking_setup", description: statusLabel(rank).slice(0, 100) },
    { label: "1v1 Score Setup", value: "score_setup", description: statusLabel(score).slice(0, 100) },
    { label: "Line Up Management", value: "lineup_setup", description: statusLabel(lineup).slice(0, 100) },
    { label: "Tryouts", value: "tryout_setup", description: statusLabel(tryout).slice(0, 100) },
  ];
}

function hubPayload(guildId = null) {
  const { tsbEmbed, COLOR_PRIMARY } = require("./shared/embeds");
  const options = guildId
    ? buildModuleOptions(guildId)
    : [
        { label: "Top Leaderboard", value: "leaderboard_setup", description: "Boards & drafts" },
        { label: "Ranking Setup", value: "ranking_setup", description: "Tiers & cooldowns" },
        { label: "1v1 Score Setup", value: "score_setup", description: "Match scoring" },
        { label: "Line Up Management", value: "lineup_setup", description: "Regional lineups" },
        { label: "Tryouts", value: "tryout_setup", description: "Signup sessions" },
      ];

  return {
    embeds: [
      tsbEmbed({
        title: "TSB Systems",
        color: COLOR_PRIMARY,
        description:
          "Configure **The Strongest Battlegrounds** modules for this server.\n\n" +
          "Pick a module below. Wizards require **Administrator** or server owner.\n\n" +
          "> **Leaderboard:** draft in `#tsb-boards`, type `send`, then **Confirm**\n" +
          "> **Ranking:** tier roles shown on boards and lineups (`'phase` / `/phase`)\n" +
          "> **Score:** `/score` records matches and auto-bumps the board\n" +
          "> **Lineups:** `#tsb-lineups` management + `#lineup-{region}` boards\n" +
          "> **Tryouts:** signup channel + ping role · runtime `/tryout`",
      }),
    ],
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: HUB_CUSTOM_ID,
        placeholder: "Select a TSB module",
        options,
      }],
    }],
  };
}

function openHub(interaction) {
  const payload = hubPayload(interaction.guild?.id);
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  if (interaction.message) return interaction.update(payload);
  return interaction.reply(payload);
}

async function handleHubSelect(interaction) {
  const selected = interaction.values?.[0];
  if (!selected) return false;

  if (!isAdminOrOwner(interaction.member, interaction.guild)) {
    return interaction.reply({
      content: "You need **Administrator** or server owner to configure TSB modules.",
      ephemeral: true,
    });
  }

  if (selected === "leaderboard_setup") {
    const { openLeaderboardModule } = require("./leaderboard/setupStore");
    return openLeaderboardModule(interaction);
  }
  if (selected === "ranking_setup") {
    const { openRankingModule } = require("./ranking/setupStore");
    return openRankingModule(interaction);
  }
  if (selected === "score_setup") {
    const { openScoreModule } = require("./score/setupStore");
    return openScoreModule(interaction);
  }
  if (selected === "lineup_setup") {
    const { openLineupModule } = require("./lineup/setupStore");
    return openLineupModule(interaction);
  }
  if (selected === "tryout_setup") {
    const { openTryoutModule } = require("./tryout/setupStore");
    return openTryoutModule(interaction);
  }

  return false;
}

module.exports = {
  HUB_CUSTOM_ID,
  hubPayload,
  openHub,
  handleHubSelect,
};
