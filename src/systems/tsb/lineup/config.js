const api = require("../../../utils/loadApi");
const { resolveMaybe } = require("../../../utils/resolveMaybe");

const DEFAULT_REGIONS = [
  { key: "na", label: "NA" },
  { key: "east", label: "East" },
  { key: "west", label: "West" },
  { key: "central", label: "Central" },
  { key: "miami", label: "Miami" },
  { key: "texas", label: "Texas" },
  { key: "dallas", label: "Dallas" },
  { key: "los_angeles", label: "Los Angeles" },
  { key: "chicago", label: "Chicago" },
  { key: "virginia", label: "Virginia" },
  { key: "eu", label: "EU" },
  { key: "asia", label: "Asia" },
  { key: "sp", label: "Sao Paulo" },
  { key: "santiago", label: "Santiago" },
  { key: "buenos_aires", label: "Buenos Aires" },
  { key: "mexico_city", label: "Mexico City" },
  { key: "lima", label: "Lima" },
  { key: "bogota", label: "Bogota" },
  { key: "london", label: "London" },
  { key: "frankfurt", label: "Frankfurt" },
  { key: "amsterdam", label: "Amsterdam" },
  { key: "tokyo", label: "Tokyo" },
  { key: "seoul", label: "Seoul" },
  { key: "singapore", label: "Singapore" },
  { key: "sydney", label: "Sydney" },
];

function emptySlots(n) {
  return Array.from({ length: n }, (_, i) => ({ position: i + 1, discordId: null }));
}

function defaultRegion(key, count, subCount) {
  const meta = DEFAULT_REGIONS.find((r) => r.key === key) || { key, label: key.toUpperCase() };
  return {
    key,
    label: meta.label,
    channelId: null,
    subChannelId: null,
    messageId: null,
    subMessageId: null,
    slots: emptySlots(count),
    subSlots: emptySlots(subCount),
  };
}

function normalizeLineupConfig(cfg) {
  const next = cfg && typeof cfg === "object" ? { ...cfg } : {};
  if (!next.slotsPerRegion) next.slotsPerRegion = 10;
  if (!next.subSlotsPerRegion) next.subSlotsPerRegion = next.slotsPerRegion;
  if (!next.allowedRoles) next.allowedRoles = [];
  if (!next.regions || typeof next.regions !== "object") next.regions = {};
  if (!next.enabledRegionKeys) {
    next.enabledRegionKeys = Object.keys(next.regions).filter((k) => next.regions[k]);
  }
  if (!next.enabledRegionKeys.length) {
    next.enabledRegionKeys = ["na", "east", "west", "central", "eu", "asia"];
  }
  const count = next.slotsPerRegion;
  const subCount = next.subSlotsPerRegion;
  for (const key of next.enabledRegionKeys) {
    if (!next.regions[key]) next.regions[key] = defaultRegion(key, count, subCount);
  }
  return next;
}

async function getLineupConfig(guildId) {
  const cfg = await resolveMaybe(api.lineup.getConfig(guildId));
  return normalizeLineupConfig(cfg);
}

async function getLineupConfigAsync(guildId) {
  return getLineupConfig(guildId);
}

async function setLineupConfig(guildId, config) {
  const current = await getLineupConfig(guildId);
  return resolveMaybe(api.lineup.updateConfig(guildId, { ...current, ...config, setupCompleted: true }));
}

async function updateLineupConfig(guildId, patch) {
  const current = await getLineupConfig(guildId);
  const nextPatch = { ...patch };
  if (nextPatch.regions && !Object.keys(nextPatch.regions).length && Object.keys(current.regions || {}).length) {
    delete nextPatch.regions;
  }
  return resolveMaybe(api.lineup.updateConfig(guildId, { ...current, ...nextPatch }));
}

async function ensureRegions(guildId, keys, slotsPer, subSlotsPer) {
  const cfg = await getLineupConfig(guildId);
  const list = Array.isArray(keys) ? keys.filter(Boolean) : [];
  if (!list.length) return cfg;
  const count = Math.max(1, Math.min(10, slotsPer || cfg.slotsPerRegion || 10));
  const subCount = Math.max(1, Math.min(10, subSlotsPer ?? cfg.subSlotsPerRegion ?? count));
  const regions = { ...(cfg.regions || {}) };
  const resize = (existing, n) => {
    const slots = [...(existing || [])];
    while (slots.length < n) slots.push({ position: slots.length + 1, discordId: null });
    return slots.slice(0, n).map((s, i) => ({ position: i + 1, discordId: s.discordId || null }));
  };
  for (const key of list) {
    if (!regions[key]) regions[key] = defaultRegion(key, count, subCount);
    else {
      regions[key].slots = resize(regions[key].slots, count);
      regions[key].subSlots = resize(regions[key].subSlots, subCount);
    }
  }
  return updateLineupConfig(guildId, {
    enabledRegionKeys: list,
    slotsPerRegion: count,
    subSlotsPerRegion: subCount,
    regions,
  });
}

async function getRegion(guildId, regionKey) {
  const cfg = await getLineupConfig(guildId);
  return cfg.regions?.[regionKey] || null;
}

function resizeSlots(existing, count) {
  const slots = [...(existing || [])];
  while (slots.length < count) {
    slots.push({ position: slots.length + 1, discordId: null });
  }
  return slots.slice(0, count).map((s, i) => ({
    position: i + 1,
    discordId: s.discordId || null,
  }));
}

async function updateRegion(guildId, regionKey, patch) {
  const cfg = await getLineupConfig(guildId);
  const regions = { ...(cfg.regions || {}) };
  if (!regions[regionKey]) return null;
  regions[regionKey] = { ...regions[regionKey], ...patch };
  return updateLineupConfig(guildId, { regions });
}

async function setRegionSlot(guildId, regionKey, position, discordId, board = "main") {
  return resolveMaybe(api.lineup.setSlot(guildId, regionKey, board, position, discordId));
}

module.exports = {
  DEFAULT_REGIONS,
  getLineupConfig,
  getLineupConfigAsync,
  normalizeLineupConfig,
  setLineupConfig,
  updateLineupConfig,
  ensureRegions,
  getRegion,
  updateRegion,
  resizeSlots,
  setRegionSlot,
};
