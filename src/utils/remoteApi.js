/**
 * Obscura-style remote API client.
 * Used when API_SERVER_URL points at the separate website API service.
 */
const BASE = (process.env.API_SERVER_URL || "").replace(/\/$/, "");
const TOKEN = process.env.API_TOKEN || process.env.BOT_TOKEN || process.env.DISCORD_TOKEN || "";

async function req(pathname, { method = "GET", body, allowNull = false } = {}) {
  if (!BASE) throw new Error("API_SERVER_URL is not set");
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { "x-bot-token": TOKEN } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (allowNull && res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `API ${res.status}`);
  return data;
}

function syncWarn(name) {
  // Many bot call sites are sync; for remote mode they must be awaited.
  // Provide async methods and thin sync wrappers that throw a clear error if used sync incorrectly.
  return async (...args) => {
    throw new Error(`Remote API method ${name} must be awaited. Args=${JSON.stringify(args).slice(0, 120)}`);
  };
}

const brandMod = {
  name: process.env.BOT_NAME || "Ascendant",
  prefix: process.env.BOT_PREFIX || "'",
  color: parseInt(String(process.env.BOT_COLOR || "2B2D31"), 16) || 0x2b2d31,
  accent: 0x7c9cff,
  success: 0x57f287,
  warn: 0xfee75c,
  danger: 0xed4245,
  website: process.env.WEBSITE_URL || "",
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
