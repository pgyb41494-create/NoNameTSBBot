const fs = require("fs");
const path = require("path");
const {
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  SeparatorSpacingSize,
} = require("discord.js");
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
    : ["┗━ _Empty_"];

  const parts = [VOID_FLAVOR[board] || VOID_FLAVOR.main, ""];
  if (roleId) parts.push(`<@&${roleId}>`);
  parts.push(lines.join("\n"));
  return parts.join("\n").slice(0, 3800);
}

function addBoardSection(container, { board, cards, roleId, footer }) {
  const headerFile = board === "sub" ? "void-header-sub.png" : "void-header-main.png";
  const sigilFile = board === "sub" ? "void-sigil-sub.png" : "void-sigil-main.png";

  // Media galleries render full container width (unlike image-only embeds).
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems((item) => item.setURL(`attachment://${headerFile}`))
  );

  let body = boardBody({ board, cards, roleId });
  if (footer) body = `${body}\n\n-# ${footer}`;

  container.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((td) => td.setContent(body))
      .setThumbnailAccessory((acc) => acc.setURL(`attachment://${sigilFile}`))
  );
}

/**
 * Void roster as Components V2 so banner + MAIN/SUB strips share one full width.
 * mode: combined | main | sub
 */
function voidLineupPayload({
  mainCards = [],
  subCards = [],
  mode = "combined",
  hasBanner = true,
  mainRoleId = null,
  subRoleId = null,
} = {}) {
  const container = new ContainerBuilder().setAccentColor(VOID_COLOR);

  if (hasBanner) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems((item) =>
        item.setURL("attachment://void-roster-banner.png")
      )
    );
    container.addSeparatorComponents((sep) =>
      sep.setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    );
  }

  const filledMain = (mainCards || []).filter((c) => c && !c.empty).length;
  const filledSub = (subCards || []).filter((c) => c && !c.empty).length;

  if (mode === "sub") {
    addBoardSection(container, {
      board: "sub",
      cards: subCards,
      roleId: subRoleId,
      footer: `${filledSub} listed · Void roster`,
    });
  } else if (mode === "main") {
    addBoardSection(container, {
      board: "main",
      cards: mainCards,
      roleId: mainRoleId,
      footer: `${filledMain} listed · Void roster`,
    });
  } else {
    addBoardSection(container, {
      board: "main",
      cards: mainCards,
      roleId: mainRoleId,
    });
    container.addSeparatorComponents((sep) =>
      sep.setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    );
    addBoardSection(container, {
      board: "sub",
      cards: subCards,
      roleId: subRoleId,
      footer: `${filledMain + filledSub} listed · Void roster`,
    });
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
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
