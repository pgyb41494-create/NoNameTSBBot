const fs = require("fs");
const path = require("path");
const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { VOID_COLOR } = require("./leaderboardThemes");

const LINEUP_THEMES = {
  classic: {
    id: "classic",
    label: "Classic cards",
    description: "One GIF card per player",
  },
  void: {
    id: "void",
    label: "Void roster",
    description: "Gothic tree roster — Main + Sub sections like a clan board",
  },
};

const VOID_ASSETS_DIR = path.join(__dirname, "..", "..", "assets", "lineup", "void");

const VOID_FLAVOR = {
  main: "_Harbingers of the void, they rise beyond all boundaries, leaving only silence in their wake._",
  sub: "_Shadows beneath the veil, they await in silence until the darkness takes hold._",
};

const BANNER_REGION_ALIASES = {
  na: "AMERICA",
  eu: "EUROPE",
  asia: "ASIA",
  east: "EAST",
  west: "WEST",
  central: "CENTRAL",
};

function listLineupThemes() {
  return Object.values(LINEUP_THEMES);
}

function resolveLineupTheme(id) {
  return LINEUP_THEMES[String(id || "").toLowerCase()] || LINEUP_THEMES.classic;
}

function voidAssetPath(name) {
  return path.join(VOID_ASSETS_DIR, name);
}

function voidBannerTitle(regionKey, regionLabel) {
  const key = String(regionKey || "").toLowerCase();
  const alias = BANNER_REGION_ALIASES[key];
  const base = alias || String(regionLabel || key || "ROSTER").trim().toUpperCase();
  return `${base} ROSTER`.slice(0, 32);
}

function lineupMemberLine(card) {
  if (!card || card.empty) return "┗━ _Empty_";
  const name = String(card.robloxUsername || card.name || "???").trim() || "???";
  const mention = card.discordTag || (card.discordId ? `<@${card.discordId}>` : "");
  return `┗━ ${name} ➵ ${mention}`.trim();
}

function requiredLine(cards, board) {
  const stages = (cards || [])
    .filter((c) => c && !c.empty && c.stage && c.stage !== "-" && !/^unranked$/i.test(c.stage))
    .map((c) => String(c.stage).trim());
  if (stages.length) {
    const counts = new Map();
    for (const s of stages) counts.set(s, (counts.get(s) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return `\`Required: ${top}+\``;
  }
  return board === "sub" ? "`Required: Stage 2+`" : "`Required: Stage 1+`";
}

function findBoardRoleId(guild, regionLabel, board) {
  if (!guild?.roles?.cache) return null;
  const label = String(regionLabel || "").trim().toLowerCase();
  const boardWord = board === "sub" ? "sub" : "main";
  const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id);
  const patterns = [
    new RegExp(`^${escapeRe(label)}\\s*${boardWord}$`, "i"),
    new RegExp(`^${escapeRe(label)}\\s*[-–]?\\s*${boardWord}$`, "i"),
    new RegExp(`${escapeRe(label)}.*\\b${boardWord}\\b`, "i"),
    new RegExp(`^${boardWord}\\s*${escapeRe(label)}$`, "i"),
    new RegExp(`^${boardWord}$`, "i"),
  ];
  for (const re of patterns) {
    const hit = roles.find((r) => re.test(r.name));
    if (hit) return hit.id;
  }
  return null;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function boardBody({ board, cards, roleId }) {
  const list = (cards || []).filter((c) => c && !c.empty);
  const source = list.length ? list : (cards || []);
  const lines = source.length
    ? source.map((card) => lineupMemberLine(card))
    : ["┗━ _Empty seat_"];

  const parts = [
    VOID_FLAVOR[board] || VOID_FLAVOR.main,
    requiredLine(list.length ? list : source, board),
    "",
  ];
  if (roleId) parts.push(`<@&${roleId}>`);
  parts.push(lines.join("\n"));
  return parts.join("\n").slice(0, 4096);
}

function bannerEmbed() {
  return new EmbedBuilder()
    .setColor(VOID_COLOR)
    .setImage("attachment://void-roster-banner.png");
}

function headerEmbed(board) {
  const file = board === "sub" ? "void-header-sub.png" : "void-header-main.png";
  return new EmbedBuilder()
    .setColor(VOID_COLOR)
    .setImage(`attachment://${file}`);
}

function sectionBodyEmbed({ board, cards, roleId, footer }) {
  const sigil = board === "sub" ? "void-sigil-sub.png" : "void-sigil-main.png";
  const embed = new EmbedBuilder()
    .setColor(VOID_COLOR)
    .setDescription(boardBody({ board, cards, roleId }))
    .setThumbnail(`attachment://${sigil}`);
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

/**
 * Build void roster payload matching the clan roster layout:
 * banner → MAIN header → MAIN body(+sigil) → SUB header → SUB body(+sigil)
 *
 * mode:
 * - combined: Main + Sub in one message (same channel)
 * - main / sub: single board (separate channels)
 */
function voidLineupPayload({
  mainCards = [],
  subCards = [],
  mode = "combined",
  hasBanner = true,
  mainRoleId = null,
  subRoleId = null,
} = {}) {
  const embeds = [];
  if (hasBanner) embeds.push(bannerEmbed());

  const filledMain = (mainCards || []).filter((c) => c && !c.empty).length;
  const filledSub = (subCards || []).filter((c) => c && !c.empty).length;

  if (mode === "sub") {
    embeds.push(headerEmbed("sub"));
    embeds.push(sectionBodyEmbed({
      board: "sub",
      cards: subCards,
      roleId: subRoleId,
      footer: `${filledSub} listed · Void roster`,
    }));
  } else if (mode === "main") {
    embeds.push(headerEmbed("main"));
    embeds.push(sectionBodyEmbed({
      board: "main",
      cards: mainCards,
      roleId: mainRoleId,
      footer: `${filledMain} listed · Void roster`,
    }));
  } else {
    embeds.push(headerEmbed("main"));
    embeds.push(sectionBodyEmbed({
      board: "main",
      cards: mainCards,
      roleId: mainRoleId,
    }));
    embeds.push(headerEmbed("sub"));
    embeds.push(sectionBodyEmbed({
      board: "sub",
      cards: subCards,
      roleId: subRoleId,
      footer: `${filledMain + filledSub} listed · Void roster`,
    }));
  }

  return { embeds: embeds.slice(0, 10) };
}

function loadVoidStaticFiles({ includeMain = true, includeSub = true } = {}) {
  const files = [];
  const push = (diskName, attachName) => {
    const full = voidAssetPath(diskName);
    if (!fs.existsSync(full)) return;
    files.push(new AttachmentBuilder(full, { name: attachName }));
  };
  if (includeMain) {
    push("header-main.png", "void-header-main.png");
    push("sigil-main.png", "void-sigil-main.png");
  }
  if (includeSub) {
    push("header-sub.png", "void-header-sub.png");
    push("sigil-sub.png", "void-sigil-sub.png");
  }
  return files;
}

module.exports = {
  LINEUP_THEMES,
  listLineupThemes,
  resolveLineupTheme,
  voidLineupPayload,
  voidBannerTitle,
  findBoardRoleId,
  loadVoidStaticFiles,
  VOID_ASSETS_DIR,
};
