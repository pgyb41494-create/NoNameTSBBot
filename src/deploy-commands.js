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

function credentials() {
  const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
  const clientId = String(
    process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID || ""
  ).trim();
  return { token, clientId };
}

/** Wipe global application commands so only per-guild commands remain. */
async function clearGlobalCommands(client = null) {
  if (client?.application?.commands) {
    await client.application.commands.set([]);
    return;
  }
  const { token, clientId } = credentials();
  if (!token || !clientId) throw new Error("DISCORD_TOKEN and CLIENT_ID required");
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: [] });
}

async function bodyForGuild(guildId) {
  const body = collectSlash().map((cmd) => JSON.parse(JSON.stringify(cmd)));
  try {
    const { getGuildConfig, normalizeCommandName } = require("./systems/tsb/ranking/config");
    const cfg = await getGuildConfig(guildId);
    const name = normalizeCommandName(cfg.commandName);
    if (name && name !== "stage" && !body.some((cmd) => cmd.name === name)) {
      const stage = body.find((cmd) => cmd.name === "stage");
      if (stage) body.push({ ...stage, name });
    }
  } catch {}
  return body;
}

/** Register slash commands for one guild only. */
async function deployGuildCommands(guildId, client = null) {
  const gid = String(guildId || "").trim();
  const body = gid ? await bodyForGuild(gid) : collectSlash();
  if (!gid || !body.length) return 0;

  if (client?.guilds?.cache?.has(gid)) {
    const guild = client.guilds.cache.get(gid);
    await guild.commands.set(body);
    return body.length;
  }

  const { token, clientId } = credentials();
  if (!token || !clientId) return 0;
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, gid), { body });
  return body.length;
}

/**
 * Clear globals, then register commands in every guild the bot is in.
 * Returns { commands, guilds }.
 */
async function deployCommands(client = null) {
  const body = collectSlash();
  if (!body.length) throw new Error("No slash commands found to deploy");

  await clearGlobalCommands(client);

  if (client?.guilds) {
    let guilds = 0;
    for (const guild of client.guilds.cache.values()) {
      try {
        const guildBody = await bodyForGuild(guild.id);
        await guild.commands.set(guildBody);
        guilds += 1;
      } catch (err) {
        console.warn(`Guild slash deploy failed for ${guild.name}:`, err.message);
      }
    }
    return { commands: body.length, guilds };
  }

  // CLI / no client: deploy to DEV_GUILD_ID only if set
  const devGuildId = String(process.env.DEV_GUILD_ID || "").trim();
  if (!devGuildId) {
    throw new Error("No Discord client and no DEV_GUILD_ID — cannot deploy per-guild commands.");
  }
  const n = await deployGuildCommands(devGuildId, null);
  return { commands: n, guilds: 1 };
}

if (require.main === module) {
  deployCommands()
    .then((result) => {
      console.log(`Deployed ${result.commands} slash commands to ${result.guilds} guild(s); globals cleared.`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  collectSlash,
  clearGlobalCommands,
  deployCommands,
  deployGuildCommands,
};
