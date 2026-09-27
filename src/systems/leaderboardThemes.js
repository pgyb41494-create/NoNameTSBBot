const {
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  SeparatorSpacingSize,
} = require("discord.js");

const INFO_DIVIDER = "≼──≽・Information・≼──≽";

const THEMES = {
  classic: {
    id: "classic",
    label: "Classic cards",
    description: "GIF footer cards (Discohook style)",
    pageSize: 10,
  },
  metallic: {
    id: "metallic",
    label: "Metallic v2",
    description: "Banner + big-text player cards (no divider lines)",
    pageSize: 10,
  },
  top10: {
    id: "top10",
    label: "Top 10 cards",
    description: "Discohook-style rank cards with mention, Roblox tag, region, and stage",
    pageSize: 10,
  },
  void: {
    id: "void",
    label: "Void roster",
    description: "Dark banner on top, full player cards split by divider lines",
    pageSize: 10,
  },
};

function listThemes() {
  return Object.values(THEMES);
}

function resolveTheme(id) {
  return THEMES[String(id || "").toLowerCase()] || THEMES.classic;
}

function stateLabel(card) {
  if (card.empty) return "Empty";
  if (card.status === "Being Challenged") return "Being Challenged";
  if (card.status === "On Cooldown") return "On Cooldown";
  if (card.status === "Challengeable") return "No Cooldown";
  return card.status || "No Cooldown";
}

function hostLabel(card) {
  if (card.empty) return "-";
  return card.host || card.regionFull || card.region || "-";
}

function countryLabel(card) {
  if (card.empty) return "-";
  if (card.countryFlag) return card.countryFlag;
  return card.country || "-";
}

function robloxLinkLabel(card) {
  if (card.empty) return "Vacant";
  const label = card.robloxUsername || card.name || "player";
  if (card.robloxUrl) return `[${label}](${card.robloxUrl})`;
  return label;
}

function addGap(container) {
  container.addSeparatorComponents((sep) =>
    sep.setDivider(false).setSpacing(SeparatorSpacingSize.Large)
  );
}

/** `#` must be first on the line so Discord renders big heading text. */
function entryBody(card) {
  const mention = card.empty ? "" : (card.discordTag || "");
  const namePart = card.empty ? "Vacant" : robloxLinkLabel(card);
  return [
    `# \`${card.position}.\` ${namePart}${mention ? ` ${mention}` : ""}`,
    INFO_DIVIDER,
    `**Rank:** ${card.empty ? "-" : (card.stage || "Unranked")}`,
    `**Host:** ${hostLabel(card)}`,
    `**State:** ${stateLabel(card)}`,
    `**Country:** ${countryLabel(card)}`,
  ].join("\n");
}

function top10RobloxTag(card) {
  if (card.empty) return "Vacant";
  return card.robloxUsername || card.name || "???";
}

function top10Status(card) {
  if (card.empty) return "Protected (Cant be challenged)";
  if (card.status === "Challengeable") return "Challengeable";
  return "Protected (Cant be challenged)";
}

function top10RobloxLine(card) {
  const inner = `≪≪ | ・${top10RobloxTag(card)}・ | ≫≫`;
  if (card.empty || !card.robloxUrl) return inner;
  return `[${inner}](${card.robloxUrl})`;
}

function top10CardTitle(card) {
  return `### #${card.position} ${card.empty ? "Vacant" : card.name}`;
}

/** Discohook top-10 card body (mention pipes + linked Roblox tag). */
function top10EntryBody(card) {
  const mention = card.empty ? "Vacant" : (card.discordTag || "`empty`");
  const wins = card.empty ? "" : (card.wins ?? 0);
  const losses = card.empty ? "" : (card.losses ?? 0);
  return [
    top10CardTitle(card),
    `| ${mention} |`,
    top10RobloxLine(card),
    `Region: ${card.empty ? "-" : (card.region || "—")}`,
    `Stage: ${card.empty ? "-" : (card.stage || "Unranked")}`,
    `-# Status: ${top10Status(card)}`,
    `-# wins: ${wins} losses: ${losses}`,
  ].join("\n");
}

/**
 * Banner + title + player cards. Spacing only — no Type 14 divider lines.
 */
function metallicComponentsV2(guildName, start, end, cards, { sanitizeThumbnail, hasBanner, showTitle = true, title } = {}) {
  const container = new ContainerBuilder().setAccentColor(0x2b2d31);

  if (hasBanner) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems((item) => item.setURL("attachment://leaderboard-banner.png"))
    );
    container.addSeparatorComponents((sep) =>
      sep.setDivider(true).setSpacing(SeparatorSpacingSize.Large)
    );
  }

  if (showTitle !== false) {
    container.addTextDisplayComponents((td) =>
      td.setContent(`# ${title || `${guildName} Leaderboard`}`)
    );
    container.addSeparatorComponents((sep) =>
      sep.setDivider(true).setSpacing(SeparatorSpacingSize.Large)
    );
  }

  cards.forEach((card, index) => {
    const body = entryBody(card);
    const thumb = sanitizeThumbnail ? sanitizeThumbnail(card.avatarUrl) : card.avatarUrl;

    if (!card.empty && thumb) {
      container.addSectionComponents((section) =>
        section
          .addTextDisplayComponents((td) => td.setContent(body))
          .setThumbnailAccessory((acc) => acc.setURL(thumb))
      );
    } else {
      container.addTextDisplayComponents((td) => td.setContent(body));
    }

    if (index < cards.length - 1) addGap(container);
  });

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

const VOID_COLOR = 0x111111;

const SMALL_CAPS = {
  A: "ᴀ", B: "ʙ", C: "ᴄ", D: "ᴅ", E: "ᴇ", F: "ғ", G: "ɢ", H: "ʜ", I: "ɪ",
  J: "ᴊ", K: "ᴋ", L: "ʟ", M: "ᴍ", N: "ɴ", O: "ᴏ", P: "ᴘ", Q: "ǫ", R: "ʀ",
  S: "s", T: "ᴛ", U: "ᴜ", V: "ᴠ", W: "ᴡ", X: "x", Y: "ʏ", Z: "ᴢ",
};

function toSmallCaps(text) {
  return String(text || "")
    .toUpperCase()
    .split("")
    .map((ch) => SMALL_CAPS[ch] || ch)
    .join("");
}

function voidSectionHeader(label) {
  const fancy = toSmallCaps(label).slice(0, 24);
  return `━━━━━ ${fancy} ━━━━━`;
}

function voidFlavorForStage(stageKey) {
  if (stageKey === "vacant") return "_Seats left open in the dark…_";
  if (stageKey === "applicant") return "_Those still seeking the climb…_";
  const n = Number(String(stageKey).replace(/\D/g, ""));
  if (n === 0) return "_They stand beyond the boundary of the board…_";
  if (n === 1) return "_Harbingers of the void, they rise beyond all boundaries…_";
  if (n === 2) return "_Forged in pressure — steady hands, sharper edges…_";
  return "_Bound by rank and resolve…_";
}

function voidStageKey(card) {
  if (card.empty) return "vacant";
  const stage = String(card.stage || "Unranked").trim();
  if (/applicant/i.test(stage)) return "applicant";
  const m = stage.match(/(?:stage|phase|tier)?\s*(\d+)/i);
  if (m) return `stage-${m[1]}`;
  if (!stage || /^unranked$/i.test(stage)) return "unranked";
  return stage.toLowerCase().slice(0, 32);
}

function voidStageLabel(key, sampleStage) {
  if (key === "vacant") return "Vacant";
  if (key === "applicant") return "Applicant";
  if (key === "unranked") return "Unranked";
  const m = String(key).match(/^stage-(\d+)$/);
  if (m) return `Stage ${m[1]}`;
  return sampleStage || key;
}

function voidMemberLine(card, isLast) {
  const branch = isLast ? "┗━" : "┣━";
  if (card.empty) return `${branch} \`#${card.position}\` Vacant`;
  const name = card.robloxUsername || card.name || "???";
  const mention = card.discordTag || (card.discordId ? `<@${card.discordId}>` : "");
  const mark = card.countryFlag || "◆";
  return `${branch} **${name}** ➵ ${mark} ${mention}`.trim();
}

function groupVoidCards(cards) {
  const groups = new Map();
  for (const card of cards) {
    const key = voidStageKey(card);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }
  const rank = (key) => {
    if (key === "vacant") return 900;
    if (key === "unranked") return 800;
    if (key === "applicant") return 700;
    const m = String(key).match(/^stage-(\d+)$/);
    if (m) return Number(m[1]);
    return 500;
  };
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([key, list]) => ({
      key,
      label: voidStageLabel(key, list.find((c) => !c.empty)?.stage),
      cards: list,
    }));
}

const V2_COMPONENT_LIMIT = 40;

function voidCardBody(card) {
  if (card.empty) {
    return [`### #${card.position} Vacant`, "-# An open seat in the dark…"].join("\n");
  }
  const flag = card.countryFlag ? ` ${card.countryFlag}` : "";
  const mention = card.discordTag || (card.discordId ? `<@${card.discordId}>` : "`empty`");
  return [
    `### #${card.position} ${card.name || card.robloxUsername || "???"}${flag}`,
    `| ${mention} |`,
    top10RobloxLine(card),
    `**Region:** ${card.regionFull || card.region || "—"}`,
    `**Stage:** ${card.stage || "Unranked"}`,
    `-# Status: ${card.status || "Challengeable"}`,
    `-# wins: ${card.wins ?? 0} losses: ${card.losses ?? 0}`,
  ].join("\n");
}

/**
 * Void leaderboard — banner on top, then one full player card per rank split by divider lines.
 * Discord caps V2 messages at 40 components (nested included), so avatars are dropped when they wouldn't fit.
 */
function voidRosterPayload(guildName, cards, { title, showHeading = true, hasBanner = false, sanitizeThumbnail, pageLabel } = {}) {
  const list = cards || [];
  const boardTitle = title || `${guildName} Leaderboard`;
  const container = new ContainerBuilder().setAccentColor(VOID_COLOR);
  const thumbOf = (card) => {
    if (card.empty || !card.avatarUrl) return null;
    return sanitizeThumbnail ? sanitizeThumbnail(card.avatarUrl) : card.avatarUrl;
  };

  const headerCost = hasBanner || showHeading !== false ? 2 : 0;
  const thumbCount = list.filter((card) => thumbOf(card)).length;
  const baseCost = 1 + headerCost + list.length + Math.max(0, list.length - 1) + 1;
  const useThumbs = baseCost + thumbCount * 2 <= V2_COMPONENT_LIMIT;

  if (hasBanner) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems((item) => item.setURL("attachment://void-roster-banner.png"))
    );
  } else if (showHeading !== false) {
    container.addTextDisplayComponents((td) => td.setContent(`# ${boardTitle}`));
  }
  if (headerCost) {
    container.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Large));
  }

  list.forEach((card, index) => {
    const body = voidCardBody(card);
    const thumb = useThumbs ? thumbOf(card) : null;
    if (thumb) {
      container.addSectionComponents((section) =>
        section
          .addTextDisplayComponents((td) => td.setContent(body))
          .setThumbnailAccessory((acc) => acc.setURL(thumb))
      );
    } else {
      container.addTextDisplayComponents((td) => td.setContent(body));
    }
    if (index < list.length - 1) {
      container.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Large));
    }
  });

  const filled = list.filter((card) => !card.empty).length;
  const footer = list.length
    ? `-# ${filled} listed${pageLabel ? ` · ${pageLabel}` : ""} · Void roster`
    : "_No one stands on this board yet._";
  container.addTextDisplayComponents((td) => td.setContent(footer));

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

module.exports = {
  THEMES,
  INFO_DIVIDER,
  VOID_COLOR,
  listThemes,
  resolveTheme,
  metallicComponentsV2,
  entryBody,
  top10EntryBody,
  top10CardTitle,
  voidRosterPayload,
  voidMemberLine,
  groupVoidCards,
  toSmallCaps,
};
