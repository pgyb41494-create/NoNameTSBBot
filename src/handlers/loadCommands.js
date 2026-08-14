const fs = require("fs");
const path = require("path");

module.exports = function loadCommands(client) {
  const dir = path.join(__dirname, "..", "commands");
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;
    const command = require(path.join(dir, file));
    if (!command?.name) continue;
    client.commands.set(command.name, command);
    for (const alias of command.aliases || []) {
      client.commands.set(alias, command);
    }
  }
  console.log(`Loaded ${client.commands.size} command names`);
};
