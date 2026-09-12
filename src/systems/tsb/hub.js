const { isAdminOrOwner } = require("./shared/permissions");
const { brand } = require("../../utils/loadApi");

const HUB_CUSTOM_ID = "tsb:hub";

function statusLine(ok) {
  return ok ? "> ✅ Configured" : "> ❌ Not set";
}

function moduleBlock(title, body, ok) {
  return `**${title}**\n${body}\n${statusLine(ok)}`;
}

async function loadModuleStatus(guildId) {
  const status = {
    leaderboard: false,
    ranking: false,
    score: false,
    lineup: false,
    tryout: false,
    verify: false,
    alerts: false,
  };
  if (!guildId) return status;

  try {
    const { getLeaderboardConfig } = require("./leaderboard/config");
    status.leaderboard = !!(await getLeaderboardConfig(guildId)).setupCompleted;
  } catch {}
  try {
    const { isSetupCompleted } = require("./ranking/config");
    status.ranking = !!(await isSetupCompleted(guildId));
  } catch {}
  try {
    const { getScoreConfig } = require("./score/config");
    status.score = !!(await getScoreConfig(guildId)).setupCompleted;
  } catch {}
  try {
    const { getLineupConfig } = require("./lineup/config");
    status.lineup = !!(await getLineupConfig(guildId)).setupCompleted;
  } catch {}
  try {
    const { getTryoutSettings } = require("./tryout/settings");
    status.tryout = !!getTryoutSettings(guildId).configured;
  } catch {}
  try {
    const { getConfig } = require("./verify/store");
    status.verify = !!getConfig(guildId).setupCompleted;
  } catch {}
  try {
    const { publicStaffAlerts } = require("./ops/store");
    const cfg = publicStaffAlerts(guildId);
    status.alerts = !!(cfg.channelId || cfg.fallbackChannelId);
  } catch {}

  return status;
}

function buildHubDescription(status, prefix) {
  const p = prefix || brand.prefix || "'";
  const ready = Object.values(status).filter(Boolean).length;
  const total = 7;

  return [
    `Ranking, boards, lineups, and tryouts for **The Strongest Battlegrounds**.`,
    "",
    `**${ready} / ${total}** modules ready. Pick a module below. Wizards need **Administrator** or server owner.`,
    "",
    moduleBlock(
      "Leaderboard",
      [
        "1. Open the boards channel (`#tsb-boards`)",
        "2. Type `draft` and edit the board",
        "3. Type `send`",
        "4. Confirm to publish",
      ].join("\n"),
      status.leaderboard
    ),
    "",
    moduleBlock(
      "Ranking",
      `Tier roles on boards and lineups (\`${p}stage\` / \`/stage\` — name is set in Ranking Setup).`,
      status.ranking
    ),
    "",
    moduleBlock(
      "Score",
      "`/score` records matches and can auto-bump the board.",
      status.score
    ),
    "",
    moduleBlock(
      "Lineups",
      "`#tsb-lineups` management plus `#lineup-{region}` boards.",
      status.lineup
    ),
    "",
    moduleBlock(
      "Tryouts",
      "Signup channel + ping role · runtime `/tryout`.",
      status.tryout
    ),
    "",
    moduleBlock(
      "Verification",
      "`/verify` · DM `/profile` · staff ticket.",
      status.verify
    ),
    "",
    moduleBlock(
      "Staff Alerts",
      "Profiles, ranks, scores, challenges, and duplicate Roblox.",
      status.alerts
    ),
  ].join("\n");
}

function buildSelectOptions(status) {
  const rows = [
    { label: "Leaderboard", value: "leaderboard_setup", ok: status.leaderboard, hint: "Boards & drafts" },
    { label: "Ranking", value: "ranking_setup", ok: status.ranking, hint: "Tiers & cooldowns" },
    { label: "Score", value: "score_setup", ok: status.score, hint: "Match scoring" },
    { label: "Lineups", value: "lineup_setup", ok: status.lineup, hint: "Regional lineups" },
    { label: "Tryouts", value: "tryout_setup", ok: status.tryout, hint: "Signup sessions" },
    { label: "Verification", value: "verify_setup", ok: status.verify, hint: "Profile tickets" },
    { label: "Staff Alerts", value: "alerts_setup", ok: status.alerts, hint: "TSB staff feed" },
  ];
  return rows.map((row) => ({
    label: `${row.ok ? "✅" : "❌"} ${row.label}`.slice(0, 100),
    value: row.value,
    description: (row.ok ? `Configured · ${row.hint}` : `Not set · ${row.hint}`).slice(0, 100),
  }));
}

async function hubPayload(guildId = null) {
  const { tsbEmbed, COLOR_PRIMARY } = require("./shared/embeds");
  const status = await loadModuleStatus(guildId);
  const options = buildSelectOptions(status);

  return {
    embeds: [
      tsbEmbed({
        title: `${brand.name} Setup`,
        color: COLOR_PRIMARY,
        author: false,
        thumbnail: brand.thumbnail,
        image: brand.banner,
        description: buildHubDescription(status, brand.prefix),
        footer: `${brand.name} · The Strongest Battlegrounds`,
        footerIcon: brand.thumbnail,
      }),
    ],
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: HUB_CUSTOM_ID,
        placeholder: `Select an ${brand.name} module`,
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
      content: "You need **Administrator** or server owner to configure Ascendant modules.",
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
