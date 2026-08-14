/**
 * Discord gateway + commands. Loaded after HTTP is listening.
 */
module.exports = function bootDiscord(setClient) {
  const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
  if (!token || token.length < 50) {
    console.error("Missing DISCORD_TOKEN — HTTP is up, but Discord will not connect.");
    return;
  }

  const {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
  } = require("discord.js");

  const api = require("./utils/loadApi");
  const { brand } = api;
  const loadCommands = require("./handlers/loadCommands");
  const { deployCommands, deployGuildCommands } = require("./deploy-commands");

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
  try {
    loadCommands(client);
  } catch (err) {
    console.error("loadCommands failed:", err);
  }

  client.on("messageCreate", (message) => {
    try {
      require("./events/messageCreate").execute(message, client);
    } catch (err) {
      console.error("messageCreate error:", err);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      await require("./events/interactionCreate").execute(interaction, client);
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
    try {
      await Promise.resolve(api.guilds.updateGuild(guild.id, { name: guild.name }));
    } catch (err) {
      console.warn("guildCreate update failed:", err.message);
    }
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
    setClient(client);
    try {
      api.botBridge.setClient(client);
    } catch {}
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

  client.login(token).catch((err) => {
    console.error("Discord login failed:", err.message);
  });
};
