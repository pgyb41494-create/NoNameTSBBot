const {
  EmbedBuilder,
  ContainerBuilder,
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
    description: "Server banner + Information separators",
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
  if (card.countryFlag && card.country) return `${card.countryFlag}`;
  return card.countryFlag || card.country || "-";
}

function robloxLinkLabel(card) {
  if (card.empty) return "Vacant";
  const label = card.robloxUsername || card.name || "player";
  if (card.robloxUrl) return `[${label}](${card.robloxUrl})`;
  return label;
}

/** The decorative Information lines from the reference board. */
function informationBlock(card) {
  return [
    "«—» · Information · «—»",
    `╭ Rank: ${card.empty ? "-" : card.stage || "Unranked"}`,
    `┝ Host: ${hostLabel(card)}`,
    `┝ State: ${stateLabel(card)}`,
    `╰ Country: ${countryLabel(card)}`,
  ].join("\n");
}

function metallicEmbed(card, { sanitizeThumbnail }) {
  const mention = card.discordTag || "@unknown-user";
  const head = card.empty
    ? `#${card.position}. Vacant`
    : `#${card.position}. ${robloxLinkLabel(card)} ${mention}`;

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription(`${head}\n${informationBlock(card)}`);

  const thumb = sanitizeThumbnail ? sanitizeThumbnail(card.avatarUrl) : card.avatarUrl;
  if (!card.empty && thumb) embed.setThumbnail(thumb);
  return embed;
}

function classicEmbed(card, helpers) {
  const { formatCardDescription, cardTitle, sanitizeThumbnail, CARD_COLOR, VACANT_COLOR, brand } = helpers;
  const embed = new EmbedBuilder()
    .setColor(card.empty ? VACANT_COLOR : CARD_COLOR)
    .setTitle(cardTitle(card))
    .setDescription(formatCardDescription(card, { mode: "leaderboard" }))
    .setImage(card.gifUrl || brand.defaultGif);
  const thumb = sanitizeThumbnail(card.avatarUrl);
  if (!card.empty && thumb) embed.setThumbnail(thumb);
  return embed;
}

/**
 * Components V2 layout using Separator (type 14) between entries.
 */
function metallicComponentsV2(guildName, start, end, cards, { sanitizeThumbnail }) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents((td) =>
    td.setContent(`**${guildName} Top ${start}-${end}**`)
  );
  container.addSeparatorComponents((sep) =>
    sep.setDivider(true).setSpacing(SeparatorSpacingSize.Large)
  );

  cards.forEach((card, index) => {
    const mention = card.discordTag || "`empty`";
    const head = card.empty
      ? `**#${card.position}. Vacant**`
      : `**#${card.position}. ${robloxLinkLabel(card)}** ${mention}`;
    const body = `${head}\n${informationBlock(card)}`;
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
  informationBlock,
  metallicEmbed,
  classicEmbed,
  metallicComponentsV2,
};
