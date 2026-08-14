const {
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  SeparatorSpacingSize,
} = require("discord.js");

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
    description: "One Components V2 message + Type 14 separators",
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

function entryBody(card) {
  const mention = card.discordTag || "`empty`";
  if (card.empty) {
    return [
      `**#${card.position}. Vacant**`,
      `╭ Rank: -`,
      `┝ Host: -`,
      `┝ State: Empty`,
      `╰ Country: -`,
    ].join("\n");
  }
  return [
    `**#${card.position}. ${robloxLinkLabel(card)}** ${mention}`,
    `╭ Rank: ${card.stage || "Unranked"}`,
    `┝ Host: ${hostLabel(card)}`,
    `┝ State: ${stateLabel(card)}`,
    `╰ Country: ${countryLabel(card)}`,
  ].join("\n");
}

/**
 * Single Components V2 message:
 * banner → Type-14 Separator → title → Separator → each player → Separator
 * (those horizontal lines in Discord = Separator type 14)
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
    td.setContent(`# ${guildName} Top ${start}-${end}`)
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

    if (index < cards.length - 1) {
      container.addSeparatorComponents((sep) =>
        sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      );
    }
  });

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

module.exports = {
  THEMES,
  listThemes,
  resolveTheme,
  metallicComponentsV2,
  entryBody,
};
