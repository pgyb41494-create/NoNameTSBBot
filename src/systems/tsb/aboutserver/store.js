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
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 32)
  );
}

function defaultConfig(name = "") {
  return {
    name: normalizeName(name),
    gif: "",
    thumbnail: "",
    title: "",
    body: "",
    footer: "",
    sections: [],
    sectionThumbnails: [],
    color: "2B2D31",
    channelId: "",
    messageId: "",
    updatedAt: 0,
  };
}

function configFromRaw(raw, name) {
  const key = normalizeName(name);
  if (!key) return defaultConfig();
  const embeds = raw?.embeds && typeof raw.embeds === "object" ? raw.embeds : null;
  const current = embeds?.[key] && typeof embeds[key] === "object" ? embeds[key] : {};
  return {
    ...defaultConfig(key),
    ...current,
    name: key,
    sections: Array.isArray(current.sections) ? current.sections : [],
    sectionThumbnails: Array.isArray(current.sectionThumbnails) ? current.sectionThumbnails : [],
  };
}

function normalizeGuild(raw) {
  const source = raw?.embeds && typeof raw.embeds === "object" ? raw.embeds : {};
  const embeds = {};
  for (const [rawName, value] of Object.entries(source)) {
    const key = normalizeName(rawName);
    if (!key || key === "default" || !value || typeof value !== "object") continue;
    embeds[key] = {
      ...defaultConfig(key),
      ...value,
      name: key,
      sections: Array.isArray(value.sections) ? value.sections : [],
      sectionThumbnails: Array.isArray(value.sectionThumbnails) ? value.sectionThumbnails : [],
    };
  }
  return { embeds };
}

function loadNormalizedDb() {
  const db = store.load();
  let changed = false;
  for (const [guildId, raw] of Object.entries(db)) {
    const normalized = normalizeGuild(raw);
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      db[guildId] = normalized;
      changed = true;
    }
  }
  if (changed) store.save(db);
  return db;
}

function getConfig(guildId, name = "") {
  const key = normalizeName(name);
  if (!key) return defaultConfig();
  const db = loadNormalizedDb();
  return configFromRaw(db[String(guildId)] || {}, key);
}

function hasConfig(guildId, name) {
  const key = normalizeName(name);
  if (!key || key === "default") return false;
  const db = loadNormalizedDb();
  return Boolean(db[String(guildId)]?.embeds?.[key]);
}

function createConfig(guildId, name, patch = {}) {
  const key = normalizeName(name);
  if (!key) return { ok: false, reason: "Choose a name using letters, numbers, `_`, or `-`." };
  if (key === "default") return { ok: false, reason: "The name `default` is reserved. Choose a specific name." };
  if (hasConfig(guildId, key)) return { ok: false, reason: `An embed named \`${key}\` already exists.` };
  return { ok: true, config: updateConfig(guildId, patch, key) };
}

function updateConfig(guildId, patch, name) {
  const key = normalizeName(name);
  if (!key) throw new Error("An embed name is required.");
  if (key === "default") throw new Error("The name `default` is reserved.");
  let next = null;
  store.updateSync((db) => {
    const raw = normalizeGuild(db[String(guildId)] || {});
    next = {
      ...configFromRaw(raw, key),
      ...patch,
      name: key,
      updatedAt: Date.now(),
    };
    delete next.records;
    delete next.v2;
    delete next.recordCount;
    delete next.scorePoints;
    delete next.mvps;
    const embeds = { ...raw.embeds };
    embeds[key] = next;
    db[String(guildId)] = { embeds };
    return db;
  });
  return next;
}

function listConfigs(guildId) {
  const db = loadNormalizedDb();
  return Object.keys(db[String(guildId)]?.embeds || {}).sort();
}

function deleteConfig(guildId, name) {
  const key = normalizeName(name);
  if (!key || key === "default") return false;
  let deleted = false;
  store.updateSync((db) => {
    const raw = normalizeGuild(db[String(guildId)] || {});
    const embeds = { ...raw.embeds };
    if (embeds[key]) {
      delete embeds[key];
      deleted = true;
      db[String(guildId)] = { embeds };
    }
    return db;
  });
  return deleted;
}

function renameConfig(guildId, name, nextName) {
  const from = normalizeName(name);
  const to = normalizeName(nextName);
  if (!from || !to) return { ok: false, reason: "Both embed names are required." };
  if (from === "default" || to === "default") return { ok: false, reason: "The name `default` is reserved. Choose a specific name." };
  if (from === to) return { ok: true, name: to };

  let result = { ok: false, reason: "Embed not found." };
  store.updateSync((db) => {
    const raw = normalizeGuild(db[String(guildId)] || {});
    const embeds = { ...raw.embeds };
    if (!embeds[from]) return db;
    if (embeds[to]) {
      result = { ok: false, reason: `An embed named \`${to}\` already exists.` };
      return db;
    }
    embeds[to] = { ...embeds[from], name: to };
    delete embeds[from];
    db[String(guildId)] = { embeds };
    result = { ok: true, name: to };
    return db;
  });
  return result;
}

function duplicateConfig(guildId, name, nextName) {
  const source = normalizeName(name);
  const target = normalizeName(nextName);
  if (!source || !target) return { ok: false, reason: "Both embed names are required." };
  if (source === "default" || target === "default") return { ok: false, reason: "The name `default` is reserved. Choose a specific name." };
  if (!hasConfig(guildId, source)) return { ok: false, reason: `No embed named \`${source}\` exists.` };
  if (hasConfig(guildId, target)) return { ok: false, reason: `An embed named \`${target}\` already exists.` };
  return {
    ok: true,
    config: updateConfig(guildId, {
      ...getConfig(guildId, source),
      name: target,
      channelId: "",
      messageId: "",
      updatedAt: 0,
    }, target),
  };
}

module.exports = {
  safeText,
  safeUrl,
  parseColor,
  normalizeName,
  defaultConfig,
  getConfig,
  hasConfig,
  createConfig,
  updateConfig,
  listConfigs,
  deleteConfig,
  renameConfig,
  duplicateConfig,
};
