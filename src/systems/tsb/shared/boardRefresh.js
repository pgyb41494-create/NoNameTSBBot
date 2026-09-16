const { getLineupConfigAsync } = require("../lineup/config");
const { publishRegionLineup, publishAllLineups } = require("../lineup/renderer");
const { getLeaderboardConfigAsync, extraBoardsOf } = require("../leaderboard/config");
const { refreshLeaderboard } = require("../leaderboard/renderer");

const guildTimers = new Map();
const DEBOUNCE_MS = 1800;

function userOnLineup(lu, userId) {
  const id = String(userId);
  const keys = [];
  for (const key of lu.enabledRegionKeys || Object.keys(lu.regions || {})) {
    const region = lu.regions?.[key];
    if (!region) continue;
    const onMain = (region.slots || []).some((s) => String(s.discordId || "") === id);
    const onSub = (region.subSlots || []).some((s) => String(s.discordId || "") === id);
    if (onMain || onSub) keys.push(key);
  }
  return keys;
}

function userOnLeaderboard(lb, userId) {
  const id = String(userId);
  if ((lb.slots || []).some((s) => String(s.discordId || "") === id)) return true;
  return extraBoardsOf(lb).some((board) =>
    (board.slots || []).some((s) => String(s.discordId || "") === id)
  );
}

/** Republish every configured lineup + the top boards. */
async function refreshGuildBoards(guild) {
  if (!guild) return { lineup: [], leaderboard: null };
  const results = { lineup: [], leaderboard: null };

  try {
    const lu = await getLineupConfigAsync(guild.id);
    if (lu.setupCompleted) {
      await publishAllLineups(guild, { createChannels: false });
      results.lineup = lu.enabledRegionKeys || Object.keys(lu.regions || {});
    }
  } catch (err) {
    console.warn("[BoardRefresh] lineup refresh failed:", err.message);
  }

  try {
    const lb = await getLeaderboardConfigAsync(guild.id);
    if (lb.setupCompleted) {
      results.leaderboard = await refreshLeaderboard(guild);
    }
  } catch (err) {
    console.warn("[BoardRefresh] leaderboard refresh failed:", err.message);
  }

  return results;
}

/**
 * Refresh boards for a player.
 * Always refreshes full guild boards when the player is on lineup or leaderboard
 * (including extra top boards). If they are not on any board, still refreshes
 * when `force` is true (profile create / stage change / explicit refresh).
 */
async function refreshUserBoards(guild, discordId, { force = false } = {}) {
  if (!guild) return { lineup: [], leaderboard: null };
  if (!discordId) return refreshGuildBoards(guild);

  const id = String(discordId);
  let onLineup = [];
  let onLb = false;

  try {
    const lu = await getLineupConfigAsync(guild.id);
    onLineup = userOnLineup(lu, id);
  } catch {}

  try {
    const lb = await getLeaderboardConfigAsync(guild.id);
    onLb = userOnLeaderboard(lb, id);
  } catch {}

  if (!force && !onLineup.length && !onLb) {
    return { lineup: [], leaderboard: null, skipped: true };
  }

  // Full guild refresh keeps every page / region in sync (avatars, stage, names).
  return refreshGuildBoards(guild);
}

function refreshGuildBoardsBackground(guild) {
  if (!guild?.id) return;
  const key = `guild:${guild.id}`;
  const prev = guildTimers.get(key);
  if (prev) clearTimeout(prev);
  guildTimers.set(
    key,
    setTimeout(() => {
      guildTimers.delete(key);
      refreshGuildBoards(guild).catch((err) => {
        console.warn("[BoardRefresh] background guild failed:", err.message);
      });
    }, DEBOUNCE_MS)
  );
}

function refreshUserBoardsBackground(guild, discordId, { force = false } = {}) {
  if (!guild?.id) return;
  // Profile / stage / score events: always refresh both board systems (debounced).
  if (force || !discordId) {
    refreshGuildBoardsBackground(guild);
    return;
  }

  const key = `user:${guild.id}:${discordId}:${force ? 1 : 0}`;
  const prev = guildTimers.get(key);
  if (prev) clearTimeout(prev);
  guildTimers.set(
    key,
    setTimeout(() => {
      guildTimers.delete(key);
      refreshUserBoards(guild, discordId, { force }).catch((err) => {
        console.warn("[BoardRefresh] background user failed:", err.message);
      });
    }, DEBOUNCE_MS)
  );
}

/** Profile create, stage change, and similar — always refresh lineup + leaderboard. */
function refreshBoardsAfterProfileOrStage(guild, discordId = null) {
  refreshUserBoardsBackground(guild, discordId, { force: true });
}

module.exports = {
  refreshUserBoards,
  refreshUserBoardsBackground,
  refreshGuildBoards,
  refreshGuildBoardsBackground,
  refreshBoardsAfterProfileOrStage,
  userOnLineup,
  userOnLeaderboard,
};
