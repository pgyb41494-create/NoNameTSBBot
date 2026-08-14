const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const http = require("http");
const express = require("express");
const cors = require("cors");

const PORT = Number(process.env.PORT || process.env.BOT_API_PORT || 3002);
const HOST = process.env.API_HOST || "0.0.0.0";

// --- Bind PORT immediately (Railway 502 if we wait for Discord) ---
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

let discordClient = null;

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    role: "discord-bot-api",
    ready: Boolean(discordClient?.user),
    port: PORT,
  });
});

app.get("/", (_req, res) => {
  res.json({ ok: true, role: "discord-bot-api", ready: Boolean(discordClient?.user) });
});

function botAuth(req, res, next) {
  const token = process.env.API_TOKEN || process.env.BOT_API_TOKEN;
  if (!token || token === "change-me-to-a-long-secret") return next();
  const got = req.get("x-bot-token") || req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (got !== token) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function requireDiscord(res) {
  if (!discordClient?.user) {
    res.status(503).json({ error: "Discord client is still connecting. Retry in a few seconds." });
    return null;
  }
  return discordClient;
}

app.get("/discord/guilds", botAuth, (req, res) => {
  const c = requireDiscord(res);
  if (!c) return;
  const guilds = [...c.guilds.cache.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.iconURL({ size: 64, extension: "png" }),
      memberCount: g.memberCount,
    }));
  res.json(guilds);
});

app.get("/discord/guilds/:guildId/channels", botAuth, async (req, res) => {
  try {
    const c = requireDiscord(res);
    if (!c) return;
    const guild = await c.guilds.fetch(req.params.guildId);
    const channels = await guild.channels.fetch();
    res.json(
      [...channels.values()]
        .filter((ch) => ch && (ch.type === 0 || ch.type === 5))
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
        .map((ch) => ({
          id: ch.id,
          name: ch.name,
          type: ch.type === 5 ? "announcement" : "text",
        }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/discord/guilds/:guildId/members", botAuth, async (req, res) => {
  try {
    const c = requireDiscord(res);
    if (!c) return;
    const guild = await c.guilds.fetch(req.params.guildId);
    const q = String(req.query.q || "").trim();
    if (q) {
      const found = await guild.members.search({ query: q, limit: 20 }).catch(() => null);
      if (found) {
        return res.json(
          [...found.values()].map((m) => ({
            id: m.id,
            username: m.user.username,
            displayName: m.displayName,
            avatar: m.displayAvatarURL({ size: 64 }),
          }))
        );
      }
    }
    await guild.members.fetch({ limit: 40 }).catch(() => {});
    res.json(
      [...guild.members.cache.values()]
        .filter((m) => !m.user.bot)
        .slice(0, 40)
        .map((m) => ({
          id: m.id,
          username: m.user.username,
          displayName: m.displayName,
          avatar: m.displayAvatarURL({ size: 64 }),
        }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/discord/users/:userId", botAuth, async (req, res) => {
  try {
    const c = requireDiscord(res);
    if (!c) return;
    const user = await c.users.fetch(req.params.userId);
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.globalName || user.username,
      avatar: user.displayAvatarURL({ size: 128 }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/discord/guilds/:guildId/channels/:channelId/messages", botAuth, async (req, res) => {
  try {
    const c = requireDiscord(res);
    if (!c) return;
    const channel = await c.channels.fetch(req.params.channelId);
    if (!channel || !channel.isTextBased?.()) {
      return res.status(400).json({ error: "That channel cannot receive messages." });
    }
    const sent = await channel.send({ content: String(req.body?.content || "").slice(0, 2000) });
    res.json({ id: sent.id, channelId: sent.channelId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/discord/users/:userId/messages", botAuth, async (req, res) => {
  try {
    const c = requireDiscord(res);
    if (!c) return;
    const user = await c.users.fetch(req.params.userId);
    const sent = await user.send({ content: String(req.body?.content || "").slice(0, 2000) });
    res.json({ id: sent.id, userId: user.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`Discord bot-api listening on http://${HOST}:${PORT}`);
});

process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err);
});

// --- Discord bot ---
const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
if (!token || token.length < 50) {
  console.error("Missing DISCORD_TOKEN — HTTP is up, but Discord will not connect.");
} else {
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
    discordClient = client;
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

  client.login(token).catch((err) => {
    console.error("Discord login failed:", err.message);
  });
}
