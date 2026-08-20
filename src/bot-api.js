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

  app.get("/discord/guilds/:guildId/channels/:channelId/messages", async (req, res) => {
    try {
      const client = botBridge.getClient();
      const channel = await client?.channels?.fetch(req.params.channelId).catch(() => null);
      if (!channel?.isTextBased?.()) {
        return res.status(400).json({ error: "That channel cannot receive messages." });
      }
      const { publicMessage } = require("../api/lib/publicMessage");
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
      const before = req.query.before || null;
      const fetched = await channel.messages.fetch({
        limit,
        ...(before ? { before: String(before) } : {}),
      });
      const messages = [...fetched.values()]
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(publicMessage);
      res.json({ messages });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post("/discord/guilds/:guildId/channels/:channelId/typing", async (req, res) => {
    try {
      const client = botBridge.getClient();
      const channel = await client?.channels?.fetch(req.params.channelId).catch(() => null);
      if (!channel?.isTextBased?.()) return res.status(400).json({ error: "Invalid channel" });
      await channel.sendTyping();
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get("/discord/guilds/:guildId/channels/:channelId/typing", async (req, res) => {
    try {
      const client = botBridge.getClient();
      const { listTyping } = require("./systems/tsb/ops/typingCache");
      res.json({ typing: listTyping(req.params.channelId, client?.user?.id) });
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

  app.post("/discord/guilds/:guildId/alerts/post", async (req, res) => {
    try {
      const client = botBridge.getClient();
      const guild = await client?.guilds?.fetch(req.params.guildId).catch(() => null);
      if (!guild) return res.status(404).json({ error: "Guild not found or bot not in server." });
      const { event, ...payload } = req.body || {};
      if (!event) return res.status(400).json({ error: "event is required" });
      const { postStaffAlertFromPayload } = require("./systems/tsb/ops/alerts");
      await postStaffAlertFromPayload(guild, String(event), payload);
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get("/discord/guilds/:guildId/alerts", (req, res) => {
    try {
      const { publicStaffAlerts } = require("./systems/tsb/ops/store");
      res.json(publicStaffAlerts(req.params.guildId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/discord/guilds/:guildId/alerts", (req, res) => {
    try {
      const { applyStaffAlertsPatch } = require("./systems/tsb/ops/store");
      res.json(applyStaffAlertsPatch(req.params.guildId, req.body || {}));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/discord/guilds/:guildId/boards/refresh", async (req, res) => {
    try {
      const client = botBridge.getClient();
      const guild = await client?.guilds?.fetch(req.params.guildId).catch(() => null);
      if (!guild) return res.status(404).json({ error: "Guild not found or bot not in server." });
      const userId = req.body?.userId ? String(req.body.userId) : null;
      if (userId) {
        const { refreshUserBoards } = require("./systems/tsb/shared/boardRefresh");
        const result = await refreshUserBoards(guild, userId);
        return res.json({ ok: true, ...result });
      }
      const { refreshLeaderboard } = require("./systems/tsb/leaderboard/renderer");
      await refreshLeaderboard(guild);
      res.json({ ok: true, leaderboard: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get("/discord/network/snapshot", (_req, res) => {
    try {
      const api = require("./utils/loadApi");
      const profileList =
        typeof api.profiles?.allProfiles === "function" ? api.profiles.allProfiles() || [] : [];
      const stages =
        typeof api.ranking?.listAllStages === "function" ? api.ranking.listAllStages() || [] : [];
      const matches =
        typeof api.score?.listAllMatches === "function" ? api.score.listAllMatches() || [] : [];
      res.json({
        profiles: profileList,
        stages,
        matches,
        source: process.env.API_SERVER_URL || process.env.API_URL ? "remote" : "local",
      });
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
