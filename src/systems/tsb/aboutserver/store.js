const { createJsonStore } = require("../../../../api/store/jsonStore");

const store = createJsonStore("aboutserver.json", {});

function safeText(value, max) {
  return String(value ?? "").slice(0, max);
}

function safeUrl(value) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw.slice(0, 500);
}

function parseColor(value) {
  const raw = String(value || "").replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return 0x2b2d31;
  return parseInt(raw, 16);
}

function normalizeName(value) {
  return (
    String(value || "default")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 32) || "default"
  );
}

function defaultConfig(name = "default") {
  return {
    name: normalizeName(name),
    gif: "",
    thumbnail: "",
    title: "",
    body: "",
    footer: "",
    color: "2B2D31",
    channelId: "",
    messageId: "",
  };
}

function isStockTemplate(cfg) {
  const body = String(cfg.body || "");
  return (
    body.includes("official archive that gathers every historical feat") ||
    (body.includes("{v2}") && body.includes("{records}"))
  );
}

function configFromRaw(raw, name) {
  const key = normalizeName(name);
  const embeds = raw?.embeds && typeof raw.embeds === "object" ? raw.embeds : null;
  const current = embeds ? embeds[key] || {} : key === "default" ? raw || {} : {};
  const merged = { ...defaultConfig(key), ...current, name: key };
  if (isStockTemplate(current) && !current.clearedStock) {
    merged.title = "";
    merged.body = "";
    merged.footer = "";
  }
  return merged;
}

function getConfig(guildId, name = "default") {
  const db = store.load();
  return configFromRaw(db[String(guildId)] || {}, name);
}

function updateConfig(guildId, patch, name = "default") {
  const key = normalizeName(name);
  let next = null;
  store.updateSync((db) => {
    const raw = db[String(guildId)] || {};
    next = { ...configFromRaw(raw, key), ...patch, name: key, clearedStock: true };
    delete next.records;
    delete next.v2;
    delete next.recordCount;
    delete next.scorePoints;
    delete next.mvps;
    const embeds = raw.embeds && typeof raw.embeds === "object"
      ? { ...raw.embeds }
      : { default: configFromRaw(raw, "default") };
    embeds[key] = next;
    db[String(guildId)] = { embeds };
    return db;
  });
  return next;
}

function listConfigs(guildId) {
  const db = store.load();
  const raw = db[String(guildId)] || {};
  if (raw.embeds && typeof raw.embeds === "object") {
    const names = Object.keys(raw.embeds).map(normalizeName).filter(Boolean);
    return [...new Set(names.length ? names : ["default"])];
  }
  return ["default"];
}

function deleteConfig(guildId, name) {
  const key = normalizeName(name);
  if (key === "default") return false;
  let deleted = false;
  store.updateSync((db) => {
    const raw = db[String(guildId)] || {};
    const embeds = raw.embeds && typeof raw.embeds === "object" ? { ...raw.embeds } : {};
    if (embeds[key]) {
      delete embeds[key];
      deleted = true;
      db[String(guildId)] = { embeds };
    }
    return db;
  });
  return deleted;
}

module.exports = {
  safeText,
  safeUrl,
  parseColor,
  normalizeName,
  defaultConfig,
  getConfig,
  updateConfig,
  listConfigs,
  deleteConfig,
};
