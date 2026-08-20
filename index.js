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
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
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
          .filter((ch) => ch && (ch.type === 0 || ch.type === 4 || ch.type === 5))
          .map((ch) => ({
            id: ch.id,
            name: ch.name,
            type: ch.type === 4 ? "category" : ch.type === 5 ? "announcement" : "text",
            parentId: ch.parentId || null,
            position: ch.rawPosition ?? ch.position ?? 0,
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
      await guild.members.fetch({ limit: 40 }).catch(() => {});
      return json(
        res,
        200,
        [...guild.members.cache.values()]
          .filter((m) => !m.user.bot)
          .slice(0, 40)
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
      const { userAvatarFromDiscord } = require("./api/lib/discordUser");
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
      const messages = [...fetched.values()]
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map((message) => ({
          id: String(message.id),
          content: message.content || "",
          createdAt: message.createdAt?.toISOString?.() || null,
          editedAt: message.editedAt?.toISOString?.() || null,
          author: {
            id: String(message.author.id),
            username: message.author.username,
            displayName:
              message.member?.displayName || message.author.globalName || message.author.username,
            avatar: userAvatarFromDiscord(message.author, 64),
            bot: !!message.author.bot,
          },
          embeds: (message.embeds || []).slice(0, 10).map((embed) => {
            try {
              return typeof embed.toJSON === "function" ? embed.toJSON() : embed;
            } catch {
              return {
                title: embed.title || null,
                description: embed.description || null,
                color: embed.color ?? null,
              };
            }
          }),
          attachments: [...message.attachments.values()].map((file) => ({
            id: String(file.id),
            name: file.name,
            url: file.url,
            contentType: file.contentType || null,
            width: file.width || null,
            height: file.height || null,
          })),
          mentions: [...message.mentions.users.values()].map((user) => ({
            id: String(user.id),
            username: user.username,
            displayName: user.globalName || user.username,
          })),
        }));
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
      const { userAvatarFromDiscord } = require("./api/lib/discordUser");
      return json(res, 200, {
        id: sent.id,
        channelId: sent.channelId,
        content: sent.content || "",
        createdAt: sent.createdAt?.toISOString?.() || null,
        author: {
          id: String(sent.author.id),
          username: sent.author.username,
          displayName: sent.author.globalName || sent.author.username,
          avatar: userAvatarFromDiscord(sent.author, 64),
          bot: !!sent.author.bot,
        },
        embeds: (sent.embeds || []).slice(0, 10).map((embed) =>
          typeof embed.toJSON === "function" ? embed.toJSON() : embed
        ),
        attachments: [],
        mentions: [],
      });
    }

    const typingMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/channels\/([^/]+)\/typing$/);
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

    return json(res, 404, { error: "Not found" });
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
