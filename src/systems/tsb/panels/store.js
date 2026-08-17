const panels = require("../../../../api/systems/panels");

module.exports = {
  list: (guildId) => panels.list(guildId),
  map: (guildId) => panels.map(guildId),
  get: (guildId, key) => panels.get(guildId, key),
  dump: (guildId) => panels.dump(guildId),
  replaceAll: (guildId, next) => panels.replaceAll(guildId, next),
};
