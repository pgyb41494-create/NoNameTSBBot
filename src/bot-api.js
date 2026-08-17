/**
 * Thin Discord HTTP API (Obscura-style bot-api).
 * Always started so the separate website API can call Discord via DISCORD_BOT_API.
 */
const express = require("express");
const cors = require("cors");
const botBridge = require("../api/botBridge");

function botAuth(req, res, next) {
  const token = process.env.API_TOKEN || process.env.BOT_API_TOKEN;
  if (!token || token === "change-me-to-a-long-secret") return next();
  const got = req.get("x-bot-token") || req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (got !== token) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function createBotApi(client) {
  if (client) botBridge.setClient(client);
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  // Public health for Railway — must stay unauthenticated
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      role: "discord-bot-api",
      ready: Boolean(botBridge.getClient()?.user),
    });
  });
  app.get("/", (_req, res) => {
    res.json({ ok: true, role: "discord-bot-api" });
  });

  app.use(botAuth);

  app.get("/discord/guilds", (_req, res) => {
    try {
      res.json(botBridge.listGuilds());
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get("/discord/guilds/:guildId/channels", async (req, res) => {
    try {
      res.json(await botBridge.listChannels(req.params.guildId));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get("/discord/guilds/:guildId/roles", async (req, res) => {
    try {
      res.json(await botBridge.listRoles(req.params.guildId));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get("/discord/guilds/:guildId/verify", (req, res) => {
    try {
      const { publicConfig } = require("./systems/tsb/verify/store");
      res.json(publicConfig(req.params.guildId));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.put("/discord/guilds/:guildId/verify", (req, res) => {
    try {
      const { applyPublicPatch, publicConfig } = require("./systems/tsb/verify/store");
      applyPublicPatch(req.params.guildId, req.body || {});
      res.json(publicConfig(req.params.guildId));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get("/discord/guilds/:guildId/audit", (req, res) => {
    try {
      const { publicAudit } = require("./systems/tsb/ops/store");
      res.json(publicAudit(req.params.guildId));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.put("/discord/guilds/:guildId/audit", (req, res) => {
    try {
      const { applyAuditPatch, publicAudit } = require("./systems/tsb/ops/store");
      applyAuditPatch(req.params.guildId, req.body || {});
      res.json(publicAudit(req.params.guildId));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get("/discord/guilds/:guildId/invites", (req, res) => {
    try {
      const { publicInvites } = require("./systems/tsb/ops/store");
      res.json(publicInvites(req.params.guildId));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.put("/discord/guilds/:guildId/invites", async (req, res) => {
    try {
      const { applyInvitesPatch, publicInvites } = require("./systems/tsb/ops/store");
      applyInvitesPatch(req.params.guildId, req.body || {});
      const next = publicInvites(req.params.guildId);
      if (next.enabled) {
        const c = botBridge.getClient();
        const guild = await c?.guilds?.fetch(req.params.guildId).catch(() => null);
        if (guild) await require("./systems/tsb/ops/invites").refreshGuild(guild);
      }
      res.json(next);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get("/discord/guilds/:guildId/panels", (req, res) => {
    try {
      const store = require("./systems/tsb/panels/store");
      res.json({ panels: store.list(req.params.guildId) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.put("/discord/guilds/:guildId/panels", (req, res) => {
    try {
      const store = require("./systems/tsb/panels/store");
      res.json({ panels: store.replaceAll(req.params.guildId, req.body || {}) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post("/discord/guilds/:guildId/channels", async (req, res) => {
    try {
      res.json(await botBridge.createChannel(req.params.guildId, req.body || {}));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get("/discord/guilds/:guildId/members", async (req, res) => {
    try {
      res.json(await botBridge.searchMembers(req.params.guildId, req.query.q || ""));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get("/discord/users/:userId", async (req, res) => {
    try {
      res.json(await botBridge.fetchUser(req.params.userId));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post("/discord/guilds/:guildId/channels/:channelId/messages", async (req, res) => {
    try {
      res.json(
        await botBridge.sendChannelMessage(req.params.guildId, req.params.channelId, req.body || {})
      );
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post("/discord/users/:userId/messages", async (req, res) => {
    try {
      res.json(await botBridge.sendDirectMessage(req.params.userId, req.body || {}));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  return app;
}

function startBotApi(client) {
  const app = createBotApi(client);
  const port = Number(process.env.PORT || process.env.BOT_API_PORT || 3002);
  const host = process.env.API_HOST || "0.0.0.0";
  return app.listen(port, host, () => {
    console.log(`Discord bot-api listening on http://${host}:${port}`);
  });
}

module.exports = { createBotApi, startBotApi };
