const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
} = require("discord.js");

const api = require("./src/utils/loadApi");
const { brand } = api;
const loadCommands = require("./src/handlers/loadCommands");
const { deployCommands, deployGuildCommands } = require("./src/deploy-commands");

const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
if (!token || token.length < 50) {
  console.error("Missing DISCORD_TOKEN. Copy .env.example to .env and paste your bot token.");
  process.exit(1);
}

if (process.env.EMBED_API !== "0") {
  try {
    api.startServer();
  } catch (err) {
    console.warn("API already running or failed to bind:", err.message);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.GuildMember],
});

client.commands = new Collection();
client.prefix = brand.prefix;
loadCommands(client);

client.on("messageCreate", (message) => {
  require("./src/events/messageCreate").execute(message, client);
});

client.on("interactionCreate", async (interaction) => {
  try {
    await require("./src/events/interactionCreate").execute(interaction, client);
  } catch (err) {
    console.error("Interaction error:", err);
    const payload = { content: "Something went wrong running that.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.on("guildCreate", async (guild) => {
  api.guilds.updateGuild(guild.id, { name: guild.name });
  if (process.env.CLIENT_ID) {
    try {
      await deployGuildCommands(guild.id);
      console.log(`Slash commands registered for ${guild.name}`);
    } catch (err) {
      console.error(`Slash sync failed for ${guild.name}:`, err.message);
    }
  }
});

client.once("ready", async () => {
  api.botBridge.setClient(client);
  console.log(`${brand.name} online as ${client.user.tag}`);
  client.user.setActivity(`${brand.prefix}help · /profile`, { type: 3 });
  if (process.env.CLIENT_ID) {
    try {
      await deployCommands();
      console.log("Slash commands deployed.");
    } catch (err) {
      console.warn("Slash deploy skipped:", err.message);
    }
  }
});

client.login(token);
