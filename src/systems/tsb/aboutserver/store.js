const { createJsonStore } = require("../../../../api/store/jsonStore");

const store = createJsonStore("aboutserver.json", {});

const DEFAULT_BODY = [
  "**Wars Records** is the official archive that gathers every historical feat and competitive record of the clan, preserving each victory for the ages.",
  "",
  "{records}",
  "",
  "{v2}",
].join("\n");

const DEFAULT_RECORDS = [
  "> **5-0** to **{server}** against **Silence**",
  "> **5-1** to **{server}** against **iHeavenly**",
  ">",
].join("\n");

const DEFAULT_V2 = [
  "┌ Records: {record_count}",
  "├ Total Score Points: {score_points}",
  "└ MVPS: {mvps}",
].join("\n");

function safeText(value, max) {
  return String(value ?? "").slice(0, max);
}

function safeUrl(value) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw.slice(0, 500);
}

function defaultConfig() {
  return {
    gif: "",
    body: DEFAULT_BODY,
    records: DEFAULT_RECORDS,
    v2: DEFAULT_V2,
    recordCount: "",
    scorePoints: "",
    mvps: "",
    channelId: "",
    messageId: "",
  };
}

function getConfig(guildId) {
  const db = store.load();
  const current = db[String(guildId)] || {};
  return { ...defaultConfig(), ...current };
}

function updateConfig(guildId, patch) {
  let next = null;
  store.updateSync((db) => {
    next = { ...getConfig(guildId), ...patch };
    db[String(guildId)] = next;
    return db;
  });
  return next;
}

module.exports = {
  DEFAULT_BODY,
  DEFAULT_RECORDS,
  DEFAULT_V2,
  safeText,
  safeUrl,
  defaultConfig,
  getConfig,
  updateConfig,
};
