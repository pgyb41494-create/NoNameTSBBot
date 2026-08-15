const api = require("../../../utils/loadApi");

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

function getLineupConfig(guildId) {
  const cfg = api.lineup.getConfig(guildId);
  if (!cfg.enabledRegionKeys) {
    cfg.enabledRegionKeys = Object.keys(cfg.regions || {}).filter((k) => cfg.regions[k]);
  }
  if (!cfg.slotsPerRegion) cfg.slotsPerRegion = 10;
  if (!cfg.subSlotsPerRegion) cfg.subSlotsPerRegion = cfg.slotsPerRegion;
  if (!cfg.allowedRoles) cfg.allowedRoles = [];
  return cfg;
}

function setLineupConfig(guildId, config) {
  return api.lineup.updateConfig(guildId, { ...getLineupConfig(guildId), ...config, setupCompleted: true });
}

function updateLineupConfig(guildId, patch) {
  return api.lineup.updateConfig(guildId, { ...getLineupConfig(guildId), ...patch });
}

function ensureRegions(guildId, keys, slotsPer, subSlotsPer) {
  if (typeof api.lineup.ensureRegions === "function") {
    return api.lineup.ensureRegions(guildId, keys, slotsPer, subSlotsPer);
  }
  const cfg = getLineupConfig(guildId);
  const count = Math.max(1, Math.min(10, slotsPer || cfg.slotsPerRegion || 10));
  const subCount = Math.max(1, Math.min(10, subSlotsPer ?? cfg.subSlotsPerRegion ?? count));
  const regions = { ...(cfg.regions || {}) };
  const empty = (n) => Array.from({ length: n }, (_, i) => ({ position: i + 1, discordId: null }));
  const resize = (existing, n) => {
    const slots = [...(existing || [])];
    while (slots.length < n) slots.push({ position: slots.length + 1, discordId: null });
    return slots.slice(0, n).map((s, i) => ({ position: i + 1, discordId: s.discordId || null }));
  };
  for (const key of keys) {
    const meta = DEFAULT_REGIONS.find((r) => r.key === key) || { key, label: key.toUpperCase() };
    if (!regions[key]) {
      regions[key] = {
        key,
        label: meta.label,
        channelId: null,
        subChannelId: null,
        messageId: null,
        subMessageId: null,
        slots: empty(count),
        subSlots: empty(subCount),
      };
    } else {
      regions[key].slots = resize(regions[key].slots, count);
      regions[key].subSlots = resize(regions[key].subSlots, subCount);
    }
  }
  for (const key of Object.keys(regions)) {
    if (!keys.includes(key)) delete regions[key];
  }
  return updateLineupConfig(guildId, {
    enabledRegionKeys: keys,
    slotsPerRegion: count,
    subSlotsPerRegion: subCount,
    regions,
  });
}

function getRegion(guildId, regionKey) {
  return getLineupConfig(guildId).regions?.[regionKey] || null;
}

function setRegionSlot(guildId, regionKey, position, discordId, board = "main") {
  return api.lineup.setSlot(guildId, regionKey, board, position, discordId);
}

module.exports = {
  DEFAULT_REGIONS,
  getLineupConfig,
  setLineupConfig,
  updateLineupConfig,
  ensureRegions,
  getRegion,
  setRegionSlot,
};
