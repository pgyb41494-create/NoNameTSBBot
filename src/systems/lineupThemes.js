const { EmbedBuilder } = require("discord.js");
const {
  VOID_COLOR,
  voidMemberLine,
  toSmallCaps,
} = require("./leaderboardThemes");

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

function listLineupThemes() {
  return Object.values(LINEUP_THEMES);
}

function resolveLineupTheme(id) {
  return LINEUP_THEMES[String(id || "").toLowerCase()] || LINEUP_THEMES.classic;
}

function sectionHeader(label) {
  const fancy = toSmallCaps(label).slice(0, 28);
  return `━━━━━ ${fancy} ━━━━━`;
}

function boardFlavor(board) {
  if (board === "sub") return "_Waiting in the wings of the void…_";
  return "_They hold the region — bound by rank and resolve…_";
}

function boardSectionEmbed({ label, board, cards, author, banner }) {
  const list = (cards || []).filter((c) => c && !c.empty);
  const source = list.length ? list : (cards || []);
  const lines = source.length
    ? source.map((card, idx) => voidMemberLine(card, idx === source.length - 1))
    : ["┗━ _Empty seat_"];

  const body = [
    sectionHeader(label),
    boardFlavor(board),
    "",
    lines.join("\n"),
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(VOID_COLOR)
    .setDescription(body.slice(0, 4096));

  if (author) embed.setAuthor({ name: author });
  if (banner) embed.setImage("attachment://void-roster-banner.png");
  return embed;
}

/**
 * Build void roster payload for a region.
 * - combined: Main + Sub in one message (same channel)
 * - board "main"|"sub": single section
 */
function voidLineupPayload({
  regionLabel,
  mainCards = [],
  subCards = [],
  mode = "combined",
  hasBanner = false,
} = {}) {
  const title = `${regionLabel} Roster`.slice(0, 256);
  const embeds = [];

  if (mode === "sub") {
    embeds.push(boardSectionEmbed({
      label: "Sub",
      board: "sub",
      cards: subCards,
      author: title,
      banner: hasBanner,
    }));
  } else if (mode === "main") {
    embeds.push(boardSectionEmbed({
      label: "Main",
      board: "main",
      cards: mainCards,
      author: title,
      banner: hasBanner,
    }));
  } else {
    embeds.push(boardSectionEmbed({
      label: "Main",
      board: "main",
      cards: mainCards,
      author: title,
      banner: hasBanner,
    }));
    embeds.push(boardSectionEmbed({
      label: "Sub",
      board: "sub",
      cards: subCards,
      author: null,
      banner: false,
    }));
  }

  const filled = [...mainCards, ...subCards].filter((c) => c && !c.empty).length;
  embeds[embeds.length - 1].setFooter({ text: `${filled} listed · Void roster` });

  return { embeds };
}

module.exports = {
  LINEUP_THEMES,
  listLineupThemes,
  resolveLineupTheme,
  voidLineupPayload,
  sectionHeader,
};
