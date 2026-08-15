const { getLeaderboardConfig } = require("./config");
const { upsertLeaderboard, getPageRanges, pageChannelName } = require("./renderer");
const { isAdminOrOwner } = require("../shared/permissions");

function canManageLeaderboard(member, guild, cfg) {
  if (isAdminOrOwner(member, guild)) return true;
  return (cfg.allowedRoles || []).some((id) => member?.roles?.cache?.has(id));
}

function describeLeaderboardChannels(cfg) {
  const ranges = getPageRanges(cfg.topPerChannel || 10);
  const suffix = String(cfg.suffix || "default")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "") || "default";
  return ranges.map((r) => `\`#top-${r.start}-${r.end}-${suffix}\``).join(", ");
}

async function publishLiveLeaderboard(interaction) {
  await upsertLeaderboard(interaction.guild);
  return interaction.update({
    embeds: [{
      title: "Board published",
      description: "Leaderboard refreshed with the current draft.",
      color: 0x57F287,
    }],
    components: [],
  });
}

module.exports = {
  canManageLeaderboard,
  describeLeaderboardChannels,
  publishLiveLeaderboard,
  getLeaderboardConfig,
  pageChannelName,
};
