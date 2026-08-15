const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const api = require("../utils/loadApi");
const { formatCardDescription, cardTitle, sanitizeThumbnail, CARD_COLOR, VACANT_COLOR } = api.cards;
const { brand } = api;
const { generateLeaderboardBanner } = require("./bannerGenerate");
const { resolveTheme, metallicComponentsV2 } = require("./leaderboardThemes");

function cardEmbed(card, { mode = "leaderboard" } = {}) {
  const embed = new EmbedBuilder()
    .setColor(card.empty ? VACANT_COLOR : CARD_COLOR)
    .setTitle(cardTitle(card))
    .setDescription(formatCardDescription(card, { mode }))
    .setImage(card.gifUrl || brand.defaultGif);

  const thumb = sanitizeThumbnail(card.avatarUrl);
  if (!card.empty && thumb) embed.setThumbnail(thumb);
  return embed;
}

function emptyPlaceholder(position) {
  return {
    position,
    name: "Vacant",
    robloxTag: ".Vacant.",
    region: "-",
    regionFull: "-",
    stage: "-",
    status: "Empty",
    wins: 0,
    losses: 0,
    gifUrl: brand.defaultGif,
    empty: true,
    color: VACANT_COLOR,
    country: null,
    countryFlag: null,
    host: null,
  };
}

async function replaceMessage(channel, existingId, payload) {
  if (existingId) {
    const msg = await channel.messages.fetch(existingId).catch(() => null);
    if (msg) {
      try {
        await msg.edit(payload);
        return msg.id;
      } catch {
        // Classic embeds ↔ Components V2 can't always edit in place
        await msg.delete().catch(() => {});
      }
    }
  }
  const sent = await channel.send(payload);
  return sent.id;
}

async function publishLeaderboard(guild) {
  const cfg = api.leaderboard.getConfig(guild.id);
  const theme = resolveTheme(cfg.theme || "classic");
  const snap = api.snapshot.publicSnapshot(guild.id);
  const cards = snap.leaderboard.cards || [];
  const channelIds = cfg.publicChannelIds?.length
    ? cfg.publicChannelIds
    : cfg.publicChannelId
      ? [cfg.publicChannelId]
      : [];

  const pageSize = theme.pageSize || 10;
  const pages = [];
  for (let i = 0; i < cards.length; i += pageSize) {
    pages.push(cards.slice(i, i + pageSize));
  }
  if (!pages.length) pages.push([]);

  const messageIds = { ...(cfg.messageIds || {}) };

  let bannerBuffer = null;
  if (theme.id === "metallic") {
    bannerBuffer = await generateLeaderboardBanner(guild.name).catch(() => null);
  }

  for (let page = 0; page < pages.length; page += 1) {
    const channelId = channelIds[page] || channelIds[0];
    if (!channelId) continue;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) continue;

    const slice = pages[page].length
      ? pages[page]
      : Array.from({ length: pageSize }, (_, i) => emptyPlaceholder(page * pageSize + i + 1));
    const start = slice[0]?.position || page * pageSize + 1;
    const end = slice.at(-1)?.position || start + slice.length - 1;

    let payload;

    if (theme.id === "metallic") {
      const files = bannerBuffer
        ? [new AttachmentBuilder(bannerBuffer, { name: "leaderboard-banner.png" })]
        : [];
      const v2 = metallicComponentsV2(guild.name, start, end, slice, {
        sanitizeThumbnail,
        hasBanner: Boolean(bannerBuffer),
      });
      payload = { ...v2, files };
    } else {
      payload = {
        content: `# Top ${start}-${end}`,
        embeds: slice.map((card) => cardEmbed(card, { mode: "leaderboard" })),
      };
    }

    messageIds[`page-${page}`] = await replaceMessage(channel, messageIds[`page-${page}`], payload);
  }

  api.leaderboard.updateConfig(guild.id, {
    messageIds,
    setupCompleted: true,
    theme: theme.id,
  });
}

async function publishLineup(guild, regionKey = null) {
  const cfg = api.lineup.getConfig(guild.id);
  const snap = api.snapshot.publicSnapshot(guild.id);
  const regions = regionKey
    ? snap.lineup.regions.filter((r) => r.key === regionKey)
    : snap.lineup.regions;

  for (const region of regions) {
    const stored = cfg.regions[region.key];
    if (!stored?.channelId) continue;
    const channel = await guild.channels.fetch(stored.channelId).catch(() => null);
    if (!channel) continue;
    const mainEmbeds = (region.main.length ? region.main : []).map((card) =>
      cardEmbed(card, { mode: "lineup" })
    );
    if (mainEmbeds.length) {
      const heading = `# Line Up - ${region.label}`;
      stored.messageId = await replaceMessage(channel, stored.messageId, {
        content: heading,
        embeds: mainEmbeds.slice(0, 10),
      });
    }

    const subEmbeds = (region.sub?.length ? region.sub : []).map((card) =>
      cardEmbed(card, { mode: "lineup" })
    );
    if (subEmbeds.length) {
      const subChannelId = stored.subChannelId && stored.subChannelId !== stored.channelId
        ? stored.subChannelId
        : stored.channelId;
      const subChannel = subChannelId === channel.id
        ? channel
        : await guild.channels.fetch(subChannelId).catch(() => null);
      if (subChannel) {
        stored.subMessageId = await replaceMessage(subChannel, stored.subMessageId, {
          content: `# Sub Line Up - ${region.label}`,
          embeds: subEmbeds.slice(0, 10),
        });
      }
    }
  }
  api.lineup.updateConfig(guild.id, { regions: cfg.regions, setupCompleted: true });
}

module.exports = { cardEmbed, publishLeaderboard, publishLineup };
