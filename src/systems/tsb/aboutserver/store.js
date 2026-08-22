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

function defaultConfig() {
  return {
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

function getConfig(guildId) {
  const db = store.load();
  const current = db[String(guildId)] || {};
  const merged = { ...defaultConfig(), ...current };
  if (isStockTemplate(current) && !current.clearedStock) {
    merged.title = "";
    merged.body = "";
    merged.footer = "";
  }
  return merged;
}

function updateConfig(guildId, patch) {
  let next = null;
  store.updateSync((db) => {
    next = { ...getConfig(guildId), ...patch, clearedStock: true };
    delete next.records;
    delete next.v2;
    delete next.recordCount;
    delete next.scorePoints;
    delete next.mvps;
    db[String(guildId)] = next;
    return db;
  });
  return next;
}

module.exports = {
  safeText,
  safeUrl,
  parseColor,
  defaultConfig,
  getConfig,
  updateConfig,
};
