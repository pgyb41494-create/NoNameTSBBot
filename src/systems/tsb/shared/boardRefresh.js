const { getLineupConfig } = require("../lineup/config");
const { publishRegionLineup } = require("../lineup/renderer");
const { getLeaderboardConfig } = require("../leaderboard/config");
const { refreshLeaderboard } = require("../leaderboard/renderer");

async function refreshUserBoards(guild, discordId) {
  if (!guild || !discordId) return { lineup: [], leaderboard: null };
  const id = String(discordId);
  const results = { lineup: [], leaderboard: null };

  try {
    const lu = getLineupConfig(guild.id);
    for (const key of lu.enabledRegionKeys || Object.keys(lu.regions || {})) {
      const region = lu.regions?.[key];
      if (!region) continue;
      const onMain = (region.slots || []).some((s) => String(s.discordId || "") === id);
      const onSub = (region.subSlots || []).some((s) => String(s.discordId || "") === id);
      if (!onMain && !onSub) continue;
      await publishRegionLineup(guild, key);
      results.lineup.push(key);
    }
  } catch (err) {
    console.warn("[BoardRefresh] lineup refresh failed:", err.message);
  }

  try {
    const lb = getLeaderboardConfig(guild.id);
    const onBoard = (lb.slots || []).some((s) => String(s.discordId || "") === id);
    if (onBoard) results.leaderboard = await refreshLeaderboard(guild);
  } catch (err) {
    console.warn("[BoardRefresh] leaderboard refresh failed:", err.message);
  }

  return results;
}

function refreshUserBoardsBackground(guild, discordId) {
  setImmediate(() => {
    refreshUserBoards(guild, discordId).catch((err) => {
      console.warn("[BoardRefresh] background failed:", err.message);
    });
  });
}

module.exports = {
  refreshUserBoards,
  refreshUserBoardsBackground,
};
