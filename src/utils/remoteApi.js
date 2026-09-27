/**
 * Obscura-style remote API client.
 * Used when API_SERVER_URL points at the separate website API service.
 */
const BASE = (process.env.API_SERVER_URL || "").replace(/\/$/, "");
const TOKEN = process.env.API_TOKEN || process.env.BOT_API_TOKEN || "";

const TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS) || 15000;
const GET_CACHE_MS = Number(process.env.API_GET_CACHE_MS) || 4000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

const getCache = new Map();
const inflight = new Map();

function isNetworkError(err) {
  if (!err) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  const code = err.code || err.cause?.code;
  if (code && NETWORK_CODES.has(code)) return true;
  return /fetch failed/i.test(String(err.message || ""));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function guildIdFromPath(pathname) {
  const m = String(pathname).match(/\/(\d{15,22})(?:\/|\?|$)/);
  return m ? m[1] : null;
}

function invalidateGuild(pathname) {
  const gid = guildIdFromPath(pathname);
  if (!gid) {
    getCache.clear();
    return;
  }
  for (const key of getCache.keys()) {
    if (key.includes(gid)) getCache.delete(key);
  }
}

async function rawRequest(pathname, { method, body, allowNull }) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { "x-bot-token": TOKEN } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (allowNull && res.status === 404) return { ok: true, data: null };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `API ${res.status}`);
    err.status = res.status;
    return { ok: false, err };
  }
  return { ok: true, data };
}

async function withRetry(pathname, opts) {
  // Writes only retry once: a reset on a reused keep-alive socket usually means the request never landed.
  const attempts = opts.method === "GET" ? 4 : 2;
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const out = await rawRequest(pathname, opts);
      if (out.ok) return out.data;
      lastErr = out.err;
      if (!RETRYABLE_STATUS.has(out.err.status)) throw out.err;
    } catch (err) {
      lastErr = err;
      if (err.status && !RETRYABLE_STATUS.has(err.status)) throw err;
      if (!err.status && !isNetworkError(err)) throw err;
    }
    if (i < attempts - 1) await sleep(250 * 2 ** i + Math.floor(Math.random() * 150));
  }
  const final = new Error(
    `API unreachable (${opts.method} ${pathname.split("?")[0]}): ${lastErr?.cause?.code || lastErr?.message || "unknown"}`
  );
  final.cause = lastErr;
  final.code = "API_UNREACHABLE";
  throw final;
}

async function req(pathname, { method = "GET", body, allowNull = false, fresh = false } = {}) {
  if (!BASE) throw new Error("API_SERVER_URL is not set");
  const opts = { method, body, allowNull };

  if (method !== "GET") {
    invalidateGuild(pathname);
    try {
      return await withRetry(pathname, opts);
    } finally {
      invalidateGuild(pathname);
    }
  }

  const key = `${pathname}|${allowNull ? 1 : 0}`;
  if (!fresh) {
    const hit = getCache.get(key);
    if (hit && hit.expires > Date.now()) return structuredClone(hit.data);
    const pending = inflight.get(key);
    if (pending) return pending.then((d) => structuredClone(d));
  }

  const promise = withRetry(pathname, opts)
    .then((data) => {
      getCache.set(key, { data, expires: Date.now() + GET_CACHE_MS });
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise.then((d) => structuredClone(d));
}

function syncWarn(name) {
  // Many bot call sites are sync; for remote mode they must be awaited.
  // Provide async methods and thin sync wrappers that throw a clear error if used sync incorrectly.
  return async (...args) => {
    throw new Error(`Remote API method ${name} must be awaited. Args=${JSON.stringify(args).slice(0, 120)}`);
  };
}

const site = String(process.env.WEBSITE_URL || "https://no-name-tsb-website.vercel.app").replace(/\/$/, "");

const brandMod = {
  name: process.env.BOT_NAME || "Ascendant",
  prefix: process.env.BOT_PREFIX || "'",
  color: parseInt(String(process.env.BOT_COLOR || "2B2D31"), 16) || 0x2b2d31,
  accent: 0x7c9cff,
  success: 0x57f287,
  warn: 0xfee75c,
  danger: 0xed4245,
  website: site,
  thumbnail: process.env.BOT_THUMBNAIL || `${site}/icon.jpg`,
  banner:
    process.env.BOT_BANNER ||
    "https://cdn.discordapp.com/banners/1537642166627729478/8fc066b313aa999e1a43fc3ef45d2b12.webp?size=4096",
  defaultGif:
    process.env.DEFAULT_CARD_GIF ||
    "https://developers.oneway.lat/evidencias/asa_3_1.gif",
  tagline: "TSB clan ops — profiles, boards, lineups, and an AI coach.",
};

function authorName(suffix = "TSB") {
  return `${brandMod.name} · ${suffix}`;
}

// Prefer vendored helpers for pure functions when available
let cards; let regions; let characters; let roblox;
try {
  cards = require("../../api/lib/cards");
  regions = require("../../api/lib/regions");
  characters = require("../../api/lib/characters");
  roblox = require("../../api/lib/roblox");
} catch {
  cards = { formatCardDescription: (c) => String(c?.name || "") };
  regions = { REGIONS: [], regionLabel: (v) => v || "—", regionShort: (v) => v || "—" };
  characters = { CHARACTERS: [], getCharacterLabel: (v) => v || "—" };
  roblox = {
    resolveRobloxUser: async () => {
      throw new Error("Roblox helper unavailable");
    },
    checkRobloxBio: async () => false,
  };
}

module.exports = {
  brand: brandMod,
  authorName,
  startServer: () => {
    console.warn("[remoteApi] API server is external at", BASE);
  },
  cards,
  regions,
  characters,
  roblox,
  botBridge: {
    setClient() {},
  },
  profiles: {
    getProfile: (guildId, userId) => req(`/api/bot/profiles/${guildId}/${userId}`, { allowNull: true }),
    saveProfile: (guildId, userId, body) => req(`/api/bot/profiles/${guildId}/${userId}`, { method: "POST", body }),
    deleteProfile: (guildId, userId) => req(`/api/bot/profiles/${guildId}/${userId}`, { method: "DELETE" }),
    findByRoblox: (guildId, q) => req(`/api/bot/profiles/lookup/${guildId}?q=${encodeURIComponent(q)}`, { allowNull: true }),
    searchProfiles: (guildId, q, limit = 25) =>
      req(`/api/bot/profiles/search/${guildId}?q=${encodeURIComponent(q || "")}&limit=${encodeURIComponent(limit)}`).catch(() => []),
    findDuplicateRoblox: (guildId, robloxId, excludeDiscordId) =>
      req(
        `/api/bot/profiles/${guildId}/duplicates?robloxId=${encodeURIComponent(robloxId || "")}&exclude=${encodeURIComponent(excludeDiscordId || "")}`
      ).then((data) => data?.matches || []),
    listDuplicateRobloxGroups: (guildId) =>
      req(`/api/bot/profiles/${guildId}/duplicates`).then((data) => data?.groups || []),
  },
  guilds: {
    updateGuild: (guildId, body) => req(`/api/bot/guilds/${guildId}`, { method: "POST", body }),
    listGuilds: () => req(`/api/bot/guilds-list`).catch(() => []),
  },
  leaderboard: {
    getConfig: (guildId) => req(`/api/bot/leaderboard/${guildId}`),
    updateConfig: (guildId, body) => req(`/api/bot/leaderboard/${guildId}`, { method: "POST", body }),
    place: (guildId, position, userId) =>
      req(`/api/bot/leaderboard/${guildId}/place`, { method: "POST", body: { position, userId } }),
    ensureSlots: (guildId, count) =>
      req(`/api/bot/leaderboard/${guildId}/ensure-slots`, { method: "POST", body: { count } }),
  },
  lineup: {
    getConfig: (guildId) => req(`/api/bot/lineup/${guildId}`),
    updateConfig: (guildId, body) => req(`/api/bot/lineup/${guildId}`, { method: "POST", body }),
    setSlot: (guildId, region, board, position, userId) =>
      req(`/api/bot/lineup/${guildId}/slot`, { method: "POST", body: { region, board, position, userId } }),
  },
  ranking: {
    getConfig: (guildId) => req(`/api/bot/ranking/${guildId}`),
    updateConfig: (guildId, body) => req(`/api/bot/ranking/${guildId}`, { method: "POST", body }),
    setConfig: (guildId, body) => req(`/api/bot/ranking/${guildId}`, { method: "POST", body: { ...body, setupCompleted: true } }),
    resetConfig: (guildId) => req(`/api/bot/ranking/${guildId}`, { method: "POST", body: { setupCompleted: false } }),
    setStage: (guildId, userId, stage, moderatorId) =>
      req(`/api/bot/ranking/${guildId}/stage`, { method: "POST", body: { userId, stage, moderatorId } }),
    getStage: async (guildId, userId) => {
      const cfg = await req(`/api/bot/ranking/${guildId}`);
      return cfg.stages?.[String(userId)]?.text || null;
    },
  },
  score: {
    getConfig: (guildId) => req(`/api/bot/score-config/${guildId}`).catch(async () => ({ setupCompleted: false })),
    updateConfig: (guildId, body) => req(`/api/bot/score-config/${guildId}`, { method: "POST", body }),
    getRecord: (guildId, userId) => req(`/api/bot/score/${guildId}/${userId}`),
    recordMatch: (guildId, body) => req(`/api/bot/score/${guildId}`, { method: "POST", body }),
    getPlayerState: async (guildId, userId) => {
      const cfg = await req(`/api/bot/score-config/${guildId}`).catch(() => ({ playerState: {} }));
      return cfg.playerState?.[String(userId)] || {
        lastMatchAt: null,
        lastResult: null,
        cooldownUntil: null,
        autowinStrikes: 0,
      };
    },
    setPlayerState: async (guildId, userId, patch) => {
      const cfg = await req(`/api/bot/score-config/${guildId}`).catch(() => ({ playerState: {} }));
      const playerState = { ...(cfg.playerState || {}) };
      playerState[String(userId)] = { ...(playerState[String(userId)] || {}), ...patch };
      return req(`/api/bot/score-config/${guildId}`, { method: "POST", body: { playerState } });
    },
    pushMatch: async (guildId, match) => {
      const cfg = await req(`/api/bot/score-config/${guildId}`).catch(() => ({ matches: [] }));
      const matches = [match, ...(cfg.matches || [])].slice(0, 100);
      return req(`/api/bot/score-config/${guildId}`, { method: "POST", body: { matches } });
    },
  },
  tryouts: {
    getSettings: (guildId) => req(`/api/bot/tryouts/${guildId}`),
    patchSettings: (guildId, body) => req(`/api/bot/tryouts/${guildId}`, { method: "POST", body }),
    saveSession: (guildId, session) => req(`/api/bot/tryouts/${guildId}/session`, { method: "POST", body: session }),
    listSessions: async (guildId) => {
      const cfg = await req(`/api/bot/tryouts/${guildId}`).catch(() => ({ sessions: {} }));
      return Object.values(cfg.sessions || {});
    },
  },
  blacklist: {
    getList: (guildId) => req(`/api/bot/blacklist/${guildId}`),
    addEntry: (guildId, body) => req(`/api/bot/blacklist/${guildId}`, { method: "POST", body }),
    removeEntry: (guildId, userId) => req(`/api/bot/blacklist/${guildId}/${userId}`, { method: "DELETE" }),
  },
  trainers: {
    getList: (guildId) => req(`/api/bot/trainers/${guildId}`),
    upsert: (guildId, body) => req(`/api/bot/trainers/${guildId}`, { method: "POST", body }),
    remove: (guildId, userId) => req(`/api/bot/trainers/${guildId}/${userId}`, { method: "DELETE" }),
  },
  challenges: {
    getState: (guildId) => req(`/api/bot/challenges/${guildId}`),
    busyIds: async (guildId) => {
      const state = await req(`/api/bot/challenges/${guildId}`);
      return state.busy || [];
    },
    createChallenge: (guildId, fromId, targetId) =>
      req(`/api/bot/challenges/${guildId}`, { method: "POST", body: { fromId, targetId } }),
    clearChallenge: (guildId, fromId) =>
      req(`/api/bot/challenges/${guildId}/clear`, { method: "POST", body: { fromId } }),
    clearInvolving: (guildId, userId) =>
      req(`/api/bot/challenges/${guildId}/clear`, { method: "POST", body: { userId } }),
    getDodge: (guildId, userId) => req(`/api/bot/challenges/${guildId}/dodges/${userId}`),
    useDodge: (guildId, userId) =>
      req(`/api/bot/challenges/${guildId}/dodge`, { method: "POST", body: { userId } }),
    acceptChallenge: (guildId, fromId) =>
      req(`/api/bot/challenges/${guildId}/accept`, { method: "POST", body: { fromId } }),
  },
  wars: {
    addWar: (guildId, body) => req(`/api/bot/wars/${guildId}`, { method: "POST", body }),
  },
  coach: {
    reviewClip: (body) => req(`/api/bot/coach/review`, { method: "POST", body }),
    askTsbl: (body) => req(`/api/bot/coach/ask`, { method: "POST", body }),
  },
  snapshot: {
    publicSnapshot: (guildId) => req(`/api/bot/snapshot/${guildId}`),
    playerBundle: (guildId, userId) => req(`/api/bot/player/${guildId}/${userId}`),
  },
  panels: {
    list: async (guildId) => {
      const data = await req(`/api/bot/panels/${guildId}`).catch(() => ({ panels: [] }));
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.panels)) return data.panels;
      if (data && typeof data === "object") {
        return Object.entries(data)
          .filter(([, panel]) => panel && typeof panel === "object" && !Array.isArray(panel) && panel.title !== undefined)
          .map(([key, panel]) => ({ ...panel, key: panel.key || key }));
      }
      return [];
    },
    map: (guildId) => req(`/api/bot/panels/${guildId}`).catch(() => ({})),
    get: (guildId, key) =>
      req(`/api/bot/panels/${guildId}/${encodeURIComponent(key)}`, { allowNull: true }),
  },
};
