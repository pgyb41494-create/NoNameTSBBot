const api = require("../../../utils/loadApi");

function getProfileByDiscordId(guildId, userId) {
  if (!userId) return null;
  return api.profiles.getProfile(guildId, userId);
}

async function resolveRobloxUser(query) {
  return api.roblox.resolveRobloxUser(query);
}

module.exports = {
  getProfileByDiscordId,
  resolveRobloxUser,
  REGIONS: api.regions.REGIONS,
};
