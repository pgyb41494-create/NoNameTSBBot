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
    let command;
    try {
      command = require(path.join(dir, file));
    } catch (err) {
      console.warn(`Skip ${file}: ${err.message}`);
      continue;
    }
    try {
      if (typeof command.slash === "function") {
        const built = command.slash();
        const list = Array.isArray(built) ? built : [built];
        for (const item of list) {
          if (!item) continue;
          body.push(item.toJSON ? item.toJSON() : item);
        }
      } else if (command.slash) {
        const list = Array.isArray(command.slash) ? command.slash : [command.slash];
        for (const item of list) {
          if (!item) continue;
          body.push(item.toJSON ? item.toJSON() : item);
        }
      }
    } catch (err) {
      console.warn(`Skip slash for ${file}: ${err.message}`);
    }
  }
  return body;
}

async function deployCommands(client = null) {
  const body = collectSlash();
  if (!body.length) throw new Error("No slash commands found to deploy");

  // Prefer the logged-in application (most reliable on Railway)
  if (client?.application?.commands) {
    await client.application.commands.set(body);
    return body.length;
  }

  const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
  const clientId = String(process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID || "").trim();
  const devGuildId = String(process.env.DEV_GUILD_ID || "").trim();
  if (!token || !clientId) throw new Error("DISCORD_TOKEN and CLIENT_ID required");
  const rest = new REST({ version: "10" }).setToken(token);
  if (devGuildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, devGuildId), { body });
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
  }
  return body.length;
}

async function deployGuildCommands(guildId, client = null) {
  const body = collectSlash();
  const gid = String(guildId || "").trim();
  if (!gid || !body.length) return;

  if (client?.application?.commands) {
    await client.application.commands.set(body); // global refresh when joining a guild
    return body.length;
  }

  const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
  const clientId = String(process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID || "").trim();
  if (!token || !clientId) return;
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, gid), { body });
  return body.length;
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
