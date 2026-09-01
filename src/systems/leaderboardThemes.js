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

/** Discohook top-10 card body (mention pipes + decorative Roblox tag). */
function top10EntryBody(card) {
  if (card.empty) {
    return [
      "| Vacant |",
      "≪≪ | ・Vacant・ | ≫≫",
      "Region: -",
      "Stage: -",
    ].join("\n");
  }
  const mention = card.discordTag || "`empty`";
  return [
    `| ${mention} |`,
    `≪≪ | ・${top10RobloxTag(card)}・ | ≫≫`,
    `Region: ${card.region || "—"}`,
    `Stage: ${card.stage || "Unranked"}`,
  ].join("\n");
}

function top10CardTitle(card) {
  return `#${card.position} ${card.empty ? "Vacant" : card.name}`;
}

/**
 * Banner + title + player cards. Spacing only — no Type 14 divider lines.
 */
function metallicComponentsV2(guildName, start, end, cards, { sanitizeThumbnail, hasBanner }) {
  const container = new ContainerBuilder().setAccentColor(0x2b2d31);

  if (hasBanner) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems((item) => item.setURL("attachment://leaderboard-banner.png"))
    );
    container.addSeparatorComponents((sep) =>
      sep.setDivider(true).setSpacing(SeparatorSpacingSize.Large)
    );
  }

  container.addTextDisplayComponents((td) =>
    td.setContent(`# ${guildName} Leaderboard`)
  );
  container.addSeparatorComponents((sep) =>
    sep.setDivider(true).setSpacing(SeparatorSpacingSize.Large)
  );

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

module.exports = {
  THEMES,
  INFO_DIVIDER,
  listThemes,
  resolveTheme,
  metallicComponentsV2,
  entryBody,
  top10EntryBody,
  top10CardTitle,
};
