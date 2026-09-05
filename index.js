/**
 * Entry: bind Railway PORT with zero deps first, then load Discord.
 * This prevents "Application failed to respond" when heavier requires crash.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const http = require("http");
const { URL } = require("url");

const PORT = Number(process.env.PORT || process.env.BOT_API_PORT || 3002);
const HOST = "0.0.0.0";

let discordClient = null;
let startedAt = Date.now();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-bot-token, Authorization",
    "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function checkAuth(req) {
  const token = process.env.API_TOKEN || process.env.BOT_API_TOKEN;
  if (!token || token === "change-me-to-a-long-secret") return true;
  const got = req.headers["x-bot-token"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return got === token;
}

function requireDiscord(res) {
  if (!discordClient?.user) {
    json(res, 503, { error: "Discord client is still connecting. Retry in a few seconds." });
    return null;
  }
  return discordClient;
}

async function handle(req, res) {
  if (req.method === "OPTIONS") {
    return json(res, 204, {});
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/health" || pathname === "/") {
    return json(res, 200, {
      ok: true,
      role: "discord-bot-api",
      ready: Boolean(discordClient?.user),
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      port: PORT,
    });
  }

  if (!checkAuth(req)) {
    return json(res, 401, { error: "Unauthorized" });
  }

  try {
    if (req.method === "GET" && pathname === "/discord/guilds") {
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
      return json(res, 200, guilds);
    }

    const channelMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/channels$/);
    if (req.method === "GET" && channelMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const guild = await c.guilds.fetch(channelMatch[1]);
      const channels = await guild.channels.fetch();
      return json(
        res,
        200,
        [...channels.values()]
          .filter((ch) => ch && (ch.type === 0 || ch.type === 4 || ch.type === 5 || ch.type === 15 || ch.type === 16))
          .map((ch) => ({
            id: ch.id,
            name: ch.name,
            type:
              ch.type === 4
                ? "category"
                : ch.type === 5
                  ? "announcement"
                  : ch.type === 15
                    ? "forum"
                    : ch.type === 16
                      ? "media"
                      : "text",
            parentId: ch.parentId || null,
            position: ch.rawPosition ?? ch.position ?? 0,
            topic: ch.topic || null,
            availableTags: Array.isArray(ch.availableTags)
              ? ch.availableTags.map((tag) => ({
                  id: String(tag.id),
                  name: tag.name,
                  emoji: tag.emoji?.name || tag.emoji?.id || null,
                  moderated: !!tag.moderated,
                }))
              : [],
          }))
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name))
      );
    }
    if (req.method === "POST" && channelMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const body = await readBody(req);
      const guild = await c.guilds.fetch(channelMatch[1]);
      const name =
        String(body.name || "logs")
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 90) || "logs";
      const created = await guild.channels.create({
        name,
        type: 0,
        reason: "Created from Ascendant dashboard",
      });
      return json(res, 200, { id: created.id, name: created.name, type: "text" });
    }

    const roleMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/roles$/);
    if (req.method === "GET" && roleMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const guild = await c.guilds.fetch(roleMatch[1]);
      const roles = await guild.roles.fetch();
      return json(
        res,
        200,
        [...roles.values()]
          .filter((role) => role && role.id !== guild.id && !role.managed)
          .sort((a, b) => b.position - a.position)
          .map((role) => ({
            id: role.id,
            name: role.name,
            color: role.hexColor || null,
            hoisted: !!role.hoist,
          }))
      );
    }

    const verifyMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/verify$/);
    if (verifyMatch) {
      const { publicConfig, applyPublicPatch } = require("./src/systems/tsb/verify/store");
      const guildId = verifyMatch[1];
      if (req.method === "GET") return json(res, 200, publicConfig(guildId));
      if (req.method === "PUT") {
        const body = await readBody(req);
        applyPublicPatch(guildId, body || {});
        return json(res, 200, publicConfig(guildId));
      }
    }

    const auditMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/audit$/);
    if (auditMatch) {
      const { publicAudit, applyAuditPatch } = require("./src/systems/tsb/ops/store");
      const guildId = auditMatch[1];
      if (req.method === "GET") return json(res, 200, publicAudit(guildId));
      if (req.method === "PUT") {
        const body = await readBody(req);
        applyAuditPatch(guildId, body || {});
        return json(res, 200, publicAudit(guildId));
      }
    }

    const invitesMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/invites$/);
    if (invitesMatch) {
      const { publicInvites, applyInvitesPatch } = require("./src/systems/tsb/ops/store");
      const guildId = invitesMatch[1];
      if (req.method === "GET") return json(res, 200, publicInvites(guildId));
      if (req.method === "PUT") {
        const body = await readBody(req);
        applyInvitesPatch(guildId, body || {});
        const next = publicInvites(guildId);
        if (next.enabled && discordClient) {
          const guild = await discordClient.guilds.fetch(guildId).catch(() => null);
          if (guild) await require("./src/systems/tsb/ops/invites").refreshGuild(guild);
        }
        return json(res, 200, next);
      }
    }

    const panelsMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/panels$/);
    if (panelsMatch) {
      const store = require("./src/systems/tsb/panels/store");
      const guildId = panelsMatch[1];
      if (req.method === "GET") return json(res, 200, { panels: store.list(guildId) });
      if (req.method === "PUT") {
        const body = await readBody(req);
        return json(res, 200, { panels: store.replaceAll(guildId, body || {}) });
      }
    }

    const embedsListMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/embeds$/);
    if (embedsListMatch) {
      const store = require("./src/systems/tsb/aboutserver/store");
      const guildId = embedsListMatch[1];
      if (req.method === "GET") {
        const embeds = store.listConfigs(guildId).map((name) => store.getConfig(guildId, name));
        return json(res, 200, { embeds });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        const created = store.createConfig(guildId, body.name || body.key, body || {});
        if (!created.ok) return json(res, 400, { error: created.reason });
        return json(res, 200, { embed: created.config });
      }
    }

    const embedsOneMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/embeds\/([^/]+)$/);
    if (embedsOneMatch) {
      const store = require("./src/systems/tsb/aboutserver/store");
      const guildId = embedsOneMatch[1];
      const name = decodeURIComponent(embedsOneMatch[2]);
      if (req.method === "GET") {
        if (!store.hasConfig(guildId, name)) return json(res, 404, { error: "Embed not found" });
        return json(res, 200, { embed: store.getConfig(guildId, name) });
      }
      if (req.method === "PUT") {
        if (!store.hasConfig(guildId, name)) return json(res, 404, { error: "Embed not found" });
        const body = { ...(await readBody(req)) };
        delete body.name;
        delete body.channelId;
        delete body.messageId;
        return json(res, 200, { embed: store.updateConfig(guildId, body, name) });
      }
      if (req.method === "DELETE") {
        const removed = store.deleteConfig(guildId, name);
        if (!removed) return json(res, 404, { error: "Embed not found" });
        return json(res, 200, { ok: true });
      }
    }

    const embedsSendMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/embeds\/([^/]+)\/send$/);
    if (req.method === "POST" && embedsSendMatch) {
      const store = require("./src/systems/tsb/aboutserver/store");
      const { postOrEdit } = require("./src/systems/tsb/aboutserver/runtime");
      const guildId = embedsSendMatch[1];
      const name = decodeURIComponent(embedsSendMatch[2]);
      if (!store.hasConfig(guildId, name)) return json(res, 404, { error: "Embed not found" });
      const body = await readBody(req);
      const channelId = String(body?.channelId || body?.channel || "").trim();
      if (!channelId) return json(res, 400, { error: "channelId is required" });
      const c = requireDiscord(res);
      if (!c) return;
      const guild = await c.guilds.fetch(guildId).catch(() => null);
      if (!guild) return json(res, 404, { error: "Guild not found" });
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased?.()) return json(res, 400, { error: "Invalid channel" });
      const cfg = store.getConfig(guildId, name);
      const sent = await postOrEdit(channel, guild, cfg);
      return json(res, 200, {
        ok: true,
        messageId: sent.id,
        channelId: channel.id,
        embed: store.getConfig(guildId, name),
      });
    }

    const embedsRefreshMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/embeds\/([^/]+)\/refresh$/);
    if (req.method === "POST" && embedsRefreshMatch) {
      const store = require("./src/systems/tsb/aboutserver/store");
      const { refreshPosted } = require("./src/systems/tsb/aboutserver/runtime");
      const guildId = embedsRefreshMatch[1];
      const name = decodeURIComponent(embedsRefreshMatch[2]);
      if (!store.hasConfig(guildId, name)) return json(res, 404, { error: "Embed not found" });
      const c = requireDiscord(res);
      if (!c) return;
      const guild = await c.guilds.fetch(guildId).catch(() => null);
      if (!guild) return json(res, 404, { error: "Guild not found" });
      const refreshed = await refreshPosted(guild, name);
      if (!refreshed) return json(res, 400, { error: "Nothing posted yet for that embed" });
      return json(res, 200, { ok: true, messageId: refreshed.id, embed: store.getConfig(guildId, name) });
    }

    const memberMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/members$/);
    if (req.method === "GET" && memberMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const guild = await c.guilds.fetch(memberMatch[1]);
      const q = String(url.searchParams.get("q") || "").trim();
      const { userAvatarFromDiscord } = require("./api/lib/discordUser");
      if (q) {
        const found = await guild.members.search({ query: q, limit: 20 }).catch(() => null);
        if (found) {
          return json(
            res,
            200,
            [...found.values()].map((m) => ({
              id: m.id,
              username: m.user.username,
              displayName: m.displayName,
              avatar: userAvatarFromDiscord(m.user, 128),
            }))
          );
        }
      }
      await guild.members.fetch({ limit: 100 }).catch(() => {});
      return json(
        res,
        200,
        [...guild.members.cache.values()]
          .filter((m) => !m.user.bot)
          .sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || "")))
          .slice(0, 100)
          .map((m) => ({
            id: m.id,
            username: m.user.username,
            displayName: m.displayName,
            avatar: userAvatarFromDiscord(m.user, 128),
          }))
      );
    }

    const userMatch = pathname.match(/^\/discord\/users\/([^/]+)$/);
    if (req.method === "GET" && userMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const user = await c.users.fetch(userMatch[1], { force: true });
      const { publicUser } = require("./api/lib/discordUser");
      return json(res, 200, publicUser(user, 256));
    }

    const msgChannelMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/channels\/([^/]+)\/messages$/);
    if (req.method === "GET" && msgChannelMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const channel = await c.channels.fetch(msgChannelMatch[2]);
      if (!channel || !channel.isTextBased?.()) {
        return json(res, 400, { error: "That channel cannot receive messages." });
      }
      if (String(channel.guildId) !== String(msgChannelMatch[1])) {
        return json(res, 400, { error: "Channel is not in that server." });
      }
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
      const before = url.searchParams.get("before") || null;
      const fetched = await channel.messages.fetch({
        limit,
        ...(before ? { before } : {}),
      });
      const { publicMessage } = require("./api/lib/publicMessage");
      const messages = [...fetched.values()]
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(publicMessage);
      return json(res, 200, { messages });
    }
    if (req.method === "POST" && msgChannelMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const body = await readBody(req);
      const { buildMessagePayload } = require("./api/lib/messagePayload");
      const payload = buildMessagePayload(body);
      const channel = await c.channels.fetch(msgChannelMatch[2]);
      if (!channel || !channel.isTextBased?.()) {
        return json(res, 400, { error: "That channel cannot receive messages." });
      }
      const sent = await channel.send(payload);
      const { publicMessage } = require("./api/lib/publicMessage");
      return json(res, 200, publicMessage(sent));
    }

    const forumPostsMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/channels\/([^/]+)\/posts$/);
    if (forumPostsMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const guildId = forumPostsMatch[1];
      const channelId = forumPostsMatch[2];
      const channel = await c.channels.fetch(channelId);
      if (!channel || (channel.type !== 15 && channel.type !== 16)) {
        return json(res, 400, { error: "That channel is not a forum." });
      }
      if (String(channel.guildId) !== String(guildId)) {
        return json(res, 400, { error: "Channel is not in that server." });
      }
      const { userAvatarFromDiscord } = require("./api/lib/discordUser");
      const { publicMessage } = require("./api/lib/publicMessage");

      if (req.method === "GET") {
        const tagMap = new Map(
          (channel.availableTags || []).map((tag) => [
            String(tag.id),
            {
              id: String(tag.id),
              name: tag.name,
              emoji: tag.emoji?.name || tag.emoji?.id || null,
            },
          ])
        );
        const [active, archived] = await Promise.all([
          channel.threads.fetchActive().catch(() => ({ threads: new Map() })),
          channel.threads.fetchArchived({ fetchAll: true }).catch(() => ({ threads: new Map() })),
        ]);
        const threads = [
          ...((active.threads?.values && [...active.threads.values()]) || []),
          ...((archived.threads?.values && [...archived.threads.values()]) || []),
        ];
        const byId = new Map();
        for (const thread of threads) {
          if (thread) byId.set(String(thread.id), thread);
        }
        const posts = [];
        for (const thread of byId.values()) {
          let starter = null;
          try {
            const msg = await thread.fetchStarterMessage().catch(() => null);
            if (msg) {
              const full = publicMessage(msg);
              starter = {
                id: full.id,
                content: String(full.content || "").slice(0, 280),
                createdAt: full.createdAt,
                author: full.author,
              };
            }
          } catch {}
          let owner = starter?.author || null;
          if (!owner && thread.ownerId) {
            const user = await c.users.fetch(thread.ownerId).catch(() => null);
            if (user) {
              owner = {
                id: String(user.id),
                username: user.username,
                displayName: user.globalName || user.username,
                avatar: userAvatarFromDiscord(user, 64),
                bot: !!user.bot,
              };
            }
          }
          posts.push({
            id: String(thread.id),
            name: thread.name,
            parentId: String(thread.parentId || channel.id),
            archived: !!thread.archived,
            locked: !!thread.locked,
            messageCount: Number(thread.messageCount || 0),
            memberCount: Number(thread.memberCount || 0),
            createdAt: thread.createdAt?.toISOString?.() || null,
            lastMessageAt:
              thread.lastMessage?.createdAt?.toISOString?.() ||
              (thread.archiveTimestamp ? new Date(thread.archiveTimestamp).toISOString() : null) ||
              thread.createdAt?.toISOString?.() ||
              null,
            owner,
            starter,
            tags: (thread.appliedTags || [])
              .map((id) => tagMap.get(String(id)))
              .filter(Boolean),
          });
        }
        posts.sort((a, b) => String(b.lastMessageAt || b.createdAt || "").localeCompare(String(a.lastMessageAt || a.createdAt || "")));
        return json(res, 200, {
          posts,
          tags: [...tagMap.values()],
          channel: {
            id: channel.id,
            name: channel.name,
            type: channel.type === 16 ? "media" : "forum",
            topic: channel.topic || null,
          },
        });
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        const title = String(body.name || body.title || "").trim().slice(0, 100);
        if (!title) return json(res, 400, { error: "Post title is required." });
        const { buildMessagePayload } = require("./api/lib/messagePayload");
        const message = buildMessagePayload({
          content: body.content,
          embed: body.embed,
        });
        const created = await channel.threads.create({
          name: title,
          message,
          appliedTags: Array.isArray(body.tagIds) ? body.tagIds.slice(0, 5) : undefined,
          reason: "Created from Ascendant Channel chat",
        });
        return json(res, 200, {
          id: created.id,
          name: created.name,
          parentId: created.parentId,
        });
      }
    }

    const typingMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/channels\/([^/]+)\/typing$/);
    if (req.method === "GET" && typingMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const { listTyping } = require("./src/systems/tsb/ops/typingCache");
      return json(res, 200, {
        typing: listTyping(typingMatch[2], c.user?.id),
      });
    }
    if (req.method === "POST" && typingMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const channel = await c.channels.fetch(typingMatch[2]);
      if (!channel || !channel.isTextBased?.()) {
        return json(res, 400, { error: "That channel cannot receive messages." });
      }
      await channel.sendTyping();
      return json(res, 200, { ok: true });
    }

    const dmMatch = pathname.match(/^\/discord\/users\/([^/]+)\/messages$/);
    if (req.method === "POST" && dmMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const body = await readBody(req);
      const { buildMessagePayload } = require("./api/lib/messagePayload");
      const payload = buildMessagePayload(body);
      const user = await c.users.fetch(dmMatch[1]);
      const sent = await user.send(payload);
      return json(res, 200, { id: sent.id, userId: user.id });
    }

    const alertsPostMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/alerts\/post$/);
    if (req.method === "POST" && alertsPostMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const guild = await c.guilds.fetch(alertsPostMatch[1]).catch(() => null);
      if (!guild) return json(res, 404, { error: "Guild not found or bot not in server." });
      const body = await readBody(req);
      const { event, ...payload } = body || {};
      if (!event) return json(res, 400, { error: "event is required" });
      const { postStaffAlertFromPayload } = require("./src/systems/tsb/ops/alerts");
      await postStaffAlertFromPayload(guild, String(event), payload);
      return json(res, 200, { ok: true });
    }

    const alertsMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/alerts$/);
    if (alertsMatch) {
      const { publicStaffAlerts, applyStaffAlertsPatch } = require("./src/systems/tsb/ops/store");
      const guildId = alertsMatch[1];
      if (req.method === "GET") return json(res, 200, publicStaffAlerts(guildId));
      if (req.method === "PUT") {
        const body = await readBody(req);
        return json(res, 200, applyStaffAlertsPatch(guildId, body || {}));
      }
    }

    const boardsMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/boards\/refresh$/);
    if (req.method === "POST" && boardsMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const guild = await c.guilds.fetch(boardsMatch[1]).catch(() => null);
      if (!guild) return json(res, 404, { error: "Guild not found or bot not in server." });
      const body = await readBody(req);
      const userId = body?.userId ? String(body.userId) : null;
      if (userId) {
        const { refreshUserBoards } = require("./src/systems/tsb/shared/boardRefresh");
        const result = await refreshUserBoards(guild, userId);
        return json(res, 200, { ok: true, ...result });
      }
      const { refreshLeaderboard } = require("./src/systems/tsb/leaderboard/renderer");
      await refreshLeaderboard(guild);
      return json(res, 200, { ok: true, leaderboard: true });
    }

    const networkMatch = pathname === "/discord/network/snapshot";
    if (req.method === "GET" && networkMatch) {
      const api = require("./src/utils/loadApi");
      const profileList =
        typeof api.profiles?.allProfiles === "function" ? api.profiles.allProfiles() || [] : [];
      const stages =
        typeof api.ranking?.listAllStages === "function" ? api.ranking.listAllStages() || [] : [];
      const matches =
        typeof api.score?.listAllMatches === "function" ? api.score.listAllMatches() || [] : [];
      return json(res, 200, {
        profiles: profileList,
        stages,
        matches,
        source: process.env.API_SERVER_URL || process.env.API_URL ? "remote" : "local",
      });
    }

    return json(res, 404, { error: "Not found", path: pathname });
  } catch (err) {
    console.error("bot-api error:", err);
    return json(res, 500, { error: err.message || "Request failed" });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    json(res, 500, { error: "Internal error" });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Discord bot-api listening on http://${HOST}:${PORT}`);
  // Load Discord only after HTTP is confirmed up
  setImmediate(() => {
    try {
      require("./src/bootDiscord")(setClient);
    } catch (err) {
      console.error("Failed to start Discord client:", err);
    }
  });
});

function setClient(client) {
  discordClient = client;
}

process.on("uncaughtException", (err) => console.error("uncaughtException:", err));
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
