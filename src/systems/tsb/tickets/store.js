const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "../../../../data");

const FILE = path.join(DATA_DIR, "tickets.json");
const COLOR = 0x5865f2;

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { guilds: {} };
  }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function slug(name) {
  return String(name || "tickets")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "tickets";
}

function emptyPanel(name) {
  return {
    name: slug(name),
    title: "Support tickets",
    body: "Pick an option below to open a private ticket with staff.",
    color: COLOR,
    footer: "",
    thumbnail: "",
    image: "",
    fields: [],
    items: [],
    componentMode: null,
    dropdownPlaceholder: "Choose a reason",
    sendChannelId: null,
    categoryId: null,
    auditLogChannelId: null,
    staffRoleIds: [],
    messageId: null,
    ticketTitle: "Ticket",
    ticketBody: "Hey {user} — staff will be with you shortly.\n> Reason: {reason}",
  };
}

function guildStore(guildId) {
  const data = load();
  if (!data.guilds[guildId]) data.guilds[guildId] = { panels: {} };
  return { data, store: data.guilds[guildId] };
}

function listPanels(guildId) {
  return Object.values(guildStore(guildId).store.panels || {});
}

function getPanel(guildId, name) {
  const panel = guildStore(guildId).store.panels[slug(name)];
  return panel || null;
}

function savePanel(guildId, panel) {
  const { data, store } = guildStore(guildId);
  panel.name = slug(panel.name);
  store.panels[panel.name] = panel;
  save(data);
  return panel;
}

function deletePanel(guildId, name) {
  const { data, store } = guildStore(guildId);
  delete store.panels[slug(name)];
  save(data);
}

function staffIds(panel) {
  return Array.isArray(panel?.staffRoleIds) ? panel.staffRoleIds.filter(Boolean) : [];
}

module.exports = {
  COLOR,
  slug,
  emptyPanel,
  listPanels,
  getPanel,
  savePanel,
  deletePanel,
  staffIds,
  guildStore,
};
