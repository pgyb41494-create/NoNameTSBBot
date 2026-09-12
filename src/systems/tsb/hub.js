const { isAdminOrOwner } = require("./shared/permissions");
const { brand } = require("../../utils/loadApi");

const HUB_CUSTOM_ID = "tsb:hub";

function statusEmoji(ok) {
  return ok ? "✅" : "❌";
}

function statusLabel(ok) {
  return ok ? "In use · configured" : "Not set up yet";
}

async function buildModuleOptions(guildId) {
  let lb = false;
  let rank = false;
  let score = false;
  let lineup = false;
  let tryout = false;
  let verify = false;
  try {
    const { getLeaderboardConfig } = require("./leaderboard/config");
    lb = !!(await getLeaderboardConfig(guildId)).setupCompleted;
  } catch {}
  try {
    const { isSetupCompleted } = require("./ranking/config");
    rank = !!(await isSetupCompleted(guildId));
  } catch {}
  try {
    const { getScoreConfig } = require("./score/config");
    score = !!(await getScoreConfig(guildId)).setupCompleted;
  } catch {}
  try {
    const { getLineupConfig } = require("./lineup/config");
    lineup = !!(await getLineupConfig(guildId)).setupCompleted;
  } catch {}
  try {
    const { getTryoutSettings } = require("./tryout/settings");
    tryout = !!getTryoutSettings(guildId).configured;
  } catch {}
  try {
    const { getConfig } = require("./verify/store");
    verify = !!getConfig(guildId).setupCompleted;
  } catch {}
  let alerts = false;
  try {
    const { publicStaffAlerts } = require("./ops/store");
    const cfg = publicStaffAlerts(guildId);
    alerts = !!(cfg.channelId || cfg.fallbackChannelId);
  } catch {}

  const modules = [
    { label: "Top Leaderboard", value: "leaderboard_setup", ok: lb },
    { label: "Ranking Setup", value: "ranking_setup", ok: rank },
    { label: "1v1 Score Setup", value: "score_setup", ok: score },
    { label: "Line Up Management", value: "lineup_setup", ok: lineup },
    { label: "Tryouts", value: "tryout_setup", ok: tryout },
    { label: "Verification", value: "verify_setup", ok: verify },
    { label: "Staff Alerts", value: "alerts_setup", ok: alerts },
  ];

  return modules.map((mod) => ({
    label: `${statusEmoji(mod.ok)} ${mod.label}`.slice(0, 100),
    value: mod.value,
    description: statusLabel(mod.ok).slice(0, 100),
  }));
}

async function hubPayload(guildId = null) {
  const { tsbEmbed, COLOR_PRIMARY } = require("./shared/embeds");
  const options = guildId
    ? await buildModuleOptions(guildId)
    : [
        { label: "❌ Top Leaderboard", value: "leaderboard_setup", description: "Not set up yet" },
        { label: "❌ Ranking Setup", value: "ranking_setup", description: "Not set up yet" },
        { label: "❌ 1v1 Score Setup", value: "score_setup", description: "Not set up yet" },
        { label: "❌ Line Up Management", value: "lineup_setup", description: "Not set up yet" },
        { label: "❌ Tryouts", value: "tryout_setup", description: "Not set up yet" },
        { label: "❌ Verification", value: "verify_setup", description: "Not set up yet" },
        { label: "❌ Staff Alerts", value: "alerts_setup", description: "Not set up yet" },
      ];

  return {
    embeds: [
      tsbEmbed({
        title: "Server setup",
        color: COLOR_PRIMARY,
        thumbnail: brand.thumbnail,
        image: brand.banner,
        description:
          "Set up Ascendant for this server in a few short steps.\n\n" +
          "**1.** Pick a module below\n" +
          "**2.** Follow the buttons in that module\n" +
          "**3.** Come back here until everything shows ✅\n\n" +
          "✅ = already in use · ❌ = still needs setup\n\n" +
          "> Tip: start with **Top Leaderboard**, then Ranking / Score if you need them.",
        footer: "Administrator or server owner required",
      }),
    ],
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: HUB_CUSTOM_ID,
        placeholder: "Choose a module to set up",
        options,
      }],
    }],
  };
}

async function openHub(interaction) {
  const payload = await hubPayload(interaction.guild?.id);
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
  if (selected === "verify_setup") {
    const { openVerifyModule } = require("./verify/setupStore");
    return openVerifyModule(interaction);
  }
  if (selected === "alerts_setup") {
    const { openAlertsModule } = require("./ops/setupStore");
    return openAlertsModule(interaction);
  }

  return false;
}

module.exports = {
  HUB_CUSTOM_ID,
  hubPayload,
  openHub,
  handleHubSelect,
};
