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
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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
          .filter((ch) => ch && (ch.type === 0 || ch.type === 5))
          .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
          .map((ch) => ({
            id: ch.id,
            name: ch.name,
            type: ch.type === 5 ? "announcement" : "text",
          }))
      );
    }

    const memberMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/members$/);
    if (req.method === "GET" && memberMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const guild = await c.guilds.fetch(memberMatch[1]);
      const q = String(url.searchParams.get("q") || "").trim();
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
              avatar: m.displayAvatarURL({ size: 64 }),
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
            avatar: m.displayAvatarURL({ size: 64 }),
          }))
      );
    }

    const userMatch = pathname.match(/^\/discord\/users\/([^/]+)$/);
    if (req.method === "GET" && userMatch) {
      const c = requireDiscord(res);
      if (!c) return;
      const user = await c.users.fetch(userMatch[1]);
      return json(res, 200, {
        id: user.id,
        username: user.username,
        displayName: user.globalName || user.username,
        avatar: user.displayAvatarURL({ size: 128 }),
      });
    }

    const msgChannelMatch = pathname.match(/^\/discord\/guilds\/([^/]+)\/channels\/([^/]+)\/messages$/);
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
      return json(res, 200, { id: sent.id, channelId: sent.channelId });
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
