const { brand } = require("../../../utils/loadApi");

function resolveGuildPrefix() {
  return brand.prefix || "'";
}

function withGuildPrefix(_guildIdOrPrefix, commandName) {
  const cmd = String(commandName || "").replace(/^[-/>!.]+/, "").trim();
  return `${resolveGuildPrefix()}${cmd}`;
}

module.exports = {
  resolveGuildPrefix,
  withGuildPrefix,
};
