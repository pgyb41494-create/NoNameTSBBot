const api = require("../../../utils/loadApi");

function getProfileByDiscordId(guildId, userId) {
  if (!userId) return Promise.resolve(null);
  return Promise.resolve(api.profiles.getProfile(guildId, userId));
}

function resolveRobloxUser(query) {
  return Promise.resolve(api.roblox.resolveRobloxUser(query));
}

module.exports = {
  getProfileByDiscordId,
  resolveRobloxUser,
  REGIONS: api.regions.REGIONS,
};
