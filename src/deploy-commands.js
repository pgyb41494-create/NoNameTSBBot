const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config();

function collectSlash() {
  const dir = path.join(__dirname, "commands");
  const body = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;
    const command = require(path.join(dir, file));
    if (typeof command.slash === "function") {
      const built = command.slash();
      const list = Array.isArray(built) ? built : [built];
      for (const item of list) body.push(item.toJSON());
    } else if (command.slash) {
      const list = Array.isArray(command.slash) ? command.slash : [command.slash];
      for (const item of list) body.push(item.toJSON ? item.toJSON() : item);
    }
  }
  return body;
}

async function deployCommands() {
  const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
  const clientId = process.env.CLIENT_ID;
  if (!token || !clientId) throw new Error("DISCORD_TOKEN and CLIENT_ID required");
  const rest = new REST({ version: "10" }).setToken(token);
  const body = collectSlash();
  if (process.env.DEV_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(clientId, process.env.DEV_GUILD_ID), { body });
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
  }
  return body.length;
}

async function deployGuildCommands(guildId) {
  const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
  const clientId = process.env.CLIENT_ID;
  if (!token || !clientId) return;
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: collectSlash() });
}

if (require.main === module) {
  deployCommands()
    .then((n) => {
      console.log(`Deployed ${n} slash commands`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { collectSlash, deployCommands, deployGuildCommands };
