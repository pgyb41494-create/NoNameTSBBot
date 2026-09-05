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
    mode: "components",
    content: "",
    gif: "",
    thumbnail: "",
    title: "",
    body: "",
    footer: "",
    sections: [],
    sectionThumbnails: [],
    components: [],
    blocks: [],
    color: "2B2D31",
    channelId: "",
    messageId: "",
    updatedAt: 0,
  };
}

function normalizeAction(action) {
  const key = String(action || "ephemeral").toLowerCase();
  if (key === "embed") return "embed";
  if (key === "url" || key === "link") return "url";
  if (key === "reply" || key === "ephemeral" || key === "message") return "ephemeral";
  return "ephemeral";
}

function normalizeReplyFormat(value) {
  return String(value || "text").toLowerCase() === "embed" ? "embed" : "text";
}

function normalizeReplyEmbed(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const colorRaw = String(source.color || "5865F2").replace(/^#/, "").trim();
  const color = /^[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw.toUpperCase() : "5865F2";
  const sections = Array.isArray(source.sections)
    ? source.sections
        .map((section, index) => {
          if (!section || typeof section !== "object") return null;
          const text = safeText(section.text, 4000).trim();
          if (!text) return null;
          return {
            id: String(section.id || `rs${index + 1}`).slice(0, 40),
            text,
            thumbnail: safeUrl(section.thumbnail),
            components: [],
          };
        })
        .filter(Boolean)
        .slice(0, 25)
    : [];
  return {
    title: safeText(source.title || "", 256),
    body: safeText(source.body || "", 3900),
    footer: safeText(source.footer || "", 2048),
    gif: safeUrl(source.gif || ""),
    thumbnail: safeUrl(source.thumbnail || ""),
    color,
    sections,
    components: [],
  };
}

function normalizeSelectOption(opt = {}, index = 0) {
  return {
    id: String(opt.id || `opt${index + 1}`).slice(0, 40),
    label: safeText(opt.label || `Option ${index + 1}`, 100).trim() || `Option ${index + 1}`,
    description: safeText(opt.description || "", 100),
    emoji: safeText(opt.emoji || "", 80),
    action: normalizeAction(opt.action),
    reply: safeText(opt.reply || "", 2000),
    replyFormat: normalizeReplyFormat(opt.replyFormat),
    replyEmbed: normalizeReplyEmbed(opt.replyEmbed),
    targetEmbed: normalizeName(opt.targetEmbed || ""),
    includeComponents: Boolean(opt.includeComponents),
  };
}

function normalizeComponent(comp = {}, index = 0) {
  const kind = String(comp.kind || comp.type || "button").toLowerCase() === "select" ? "select" : "button";
  let action = normalizeAction(comp.action);
  if (kind === "select" && action === "url") action = "ephemeral";
  const styleRaw = String(comp.style || (action === "url" ? "LINK" : "PRIMARY")).toUpperCase();
  const style = action === "url" ? "LINK" : ["PRIMARY", "SECONDARY", "SUCCESS", "DANGER"].includes(styleRaw) ? styleRaw : "PRIMARY";
  const out = {
    id: String(comp.id || `c${index + 1}`).slice(0, 40),
    kind,
    label: safeText(comp.label || (kind === "select" ? "Choose an option" : "Button"), 80).trim() || (kind === "select" ? "Choose an option" : "Button"),
    style,
    emoji: safeText(comp.emoji || "", 80),
    action,
    reply: safeText(comp.reply || "", 2000),
    replyFormat: normalizeReplyFormat(comp.replyFormat),
    replyEmbed: normalizeReplyEmbed(comp.replyEmbed),
    targetEmbed: normalizeName(comp.targetEmbed || ""),
    includeComponents: Boolean(comp.includeComponents),
    url: safeUrl(comp.url || ""),
    options: [],
  };
  if (kind === "select") {
    out.options = (Array.isArray(comp.options) ? comp.options : [])
      .slice(0, 25)
      .map((option, i) => normalizeSelectOption(option, i));
    if (!out.options.length) {
      out.options = [normalizeSelectOption({ label: "Option 1", reply: "Selected." }, 0)];
    }
  }
  return out;
}

function normalizeComponents(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((comp, index) => (comp && typeof comp === "object" ? normalizeComponent(comp, index) : null))
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeBlock(block, index = 0) {
  if (!block || typeof block !== "object") return null;
  const id = String(block.id || `b${index + 1}`).slice(0, 40);
  const type = String(block.type || "text").toLowerCase();
  if (type === "media" || type === "gallery" || type === "image") {
    return { id, type: "media", url: safeUrl(block.url || block.gif || "") };
  }
  if (type === "separator" || type === "divider") {
    return {
      id,
      type: "separator",
      divider: block.divider !== false,
      spacing: String(block.spacing || "small").toLowerCase() === "large" ? "large" : "small",
    };
  }
  if (type === "row" || type === "actions" || type === "buttons") {
    return { id, type: "row", components: normalizeComponents(block.components || block.buttons) };
  }
  return {
    id,
    type: "text",
    content: safeText(block.content != null ? block.content : block.text, 4000),
    thumbnail: safeUrl(block.thumbnail),
  };
}

function normalizeBlocks(list) {
  if (!Array.isArray(list)) return [];
  return list.map((block, index) => normalizeBlock(block, index)).filter(Boolean).slice(0, 40);
}

function blocksFromLegacy(cfg = {}) {
  if (Array.isArray(cfg.blocks) && cfg.blocks.length) return normalizeBlocks(cfg.blocks);
  const blocks = [];
  let n = 0;
  const push = (block) => {
    n += 1;
    blocks.push(normalizeBlock({ ...block, id: block.id || `legacy${n}` }, n - 1));
  };
  if (cfg.gif) push({ type: "media", url: cfg.gif });
  if (cfg.title) push({ type: "text", content: `# ${cfg.title}`, thumbnail: cfg.thumbnail || "" });
  if (cfg.body) push({ type: "text", content: cfg.body });
  const sections = Array.isArray(cfg.sections) ? cfg.sections : [];
  sections.forEach((section, index) => {
    if (index > 0 || cfg.title || cfg.body || cfg.gif) push({ type: "separator", divider: true, spacing: "small" });
    push({ type: "text", content: section.text || "", thumbnail: section.thumbnail || "" });
    if (Array.isArray(section.components) && section.components.length) {
      push({ type: "row", components: section.components });
    }
  });
  if (cfg.footer) {
    push({ type: "separator", divider: true, spacing: "small" });
    push({ type: "text", content: `-# ${cfg.footer}` });
  }
  if (Array.isArray(cfg.components) && cfg.components.length) {
    push({ type: "row", components: cfg.components });
  }
  return blocks.filter(Boolean);
}

function normalizeSection(section, index = 0) {
  if (!section || typeof section !== "object") return null;
  const text = safeText(section.text, 4000).trim();
  if (!text) return null;
  return {
    id: String(section.id || `s${index + 1}`).slice(0, 40),
    text,
    thumbnail: safeUrl(section.thumbnail),
    components: normalizeComponents(section.components),
  };
}

function configFromRaw(raw, name) {
  const key = normalizeName(name);
  if (!key) return defaultConfig();
  const embeds = raw?.embeds && typeof raw.embeds === "object" ? raw.embeds : null;
  const current = embeds?.[key] && typeof embeds[key] === "object" ? embeds[key] : {};
  const base = {
    ...defaultConfig(key),
    ...current,
    name: key,
    mode: String(current.mode || "components").toLowerCase() === "standard" ? "standard" : "components",
    content: safeText(current.content || "", 2000),
    sections: Array.isArray(current.sections)
      ? current.sections.map((section, index) => normalizeSection(section, index)).filter(Boolean)
      : [],
    sectionThumbnails: Array.isArray(current.sectionThumbnails) ? current.sectionThumbnails : [],
    components: normalizeComponents(current.components),
    blocks: [],
  };
  base.blocks = blocksFromLegacy(base);
  return base;
}

function normalizeGuild(raw) {
  const source = raw?.embeds && typeof raw.embeds === "object" ? raw.embeds : {};
  const embeds = {};
  for (const [rawName, value] of Object.entries(source)) {
    const key = normalizeName(rawName);
    if (!key || key === "default" || !value || typeof value !== "object") continue;
    embeds[key] = configFromRaw({ embeds: { [key]: value } }, key);
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
    const incoming = { ...patch };
    if (incoming.gif != null) incoming.gif = safeUrl(incoming.gif);
    if (incoming.thumbnail != null) incoming.thumbnail = safeUrl(incoming.thumbnail);
    if (Array.isArray(incoming.sections)) {
      incoming.sections = incoming.sections
        .map((section, index) => normalizeSection(section, index))
        .filter(Boolean)
        .slice(0, 25);
    }
    if (Array.isArray(incoming.components)) {
      incoming.components = normalizeComponents(incoming.components);
    }
    if (Array.isArray(incoming.blocks)) {
      incoming.blocks = normalizeBlocks(incoming.blocks);
    }
    if (incoming.content != null) incoming.content = safeText(incoming.content, 2000);
    if (incoming.mode != null) {
      incoming.mode = String(incoming.mode).toLowerCase() === "standard" ? "standard" : "components";
    }
    if (incoming.body != null) incoming.body = safeText(incoming.body, 3900);
    if (incoming.title != null) incoming.title = safeText(incoming.title, 256);
    if (incoming.footer != null) incoming.footer = safeText(incoming.footer, 2048);
    if (incoming.color != null) {
      const hex = String(incoming.color || "").replace(/^#/, "").trim();
      incoming.color = /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : "2B2D31";
    }
    next = {
      ...configFromRaw(raw, key),
      ...incoming,
      name: key,
      updatedAt: Date.now(),
    };
    if (Array.isArray(incoming.blocks)) {
      next.blocks = normalizeBlocks(incoming.blocks);
    } else {
      next.blocks = blocksFromLegacy(next);
    }
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
  normalizeAction,
  normalizeReplyFormat,
  normalizeReplyEmbed,
  normalizeComponent,
  normalizeComponents,
  normalizeBlock,
  normalizeBlocks,
  blocksFromLegacy,
  normalizeSection,
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
