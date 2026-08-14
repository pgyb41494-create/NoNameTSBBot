const { EmbedBuilder } = require("discord.js");
const api = require("../utils/loadApi");
const { formatCardDescription } = api.cards;
const { brand } = api;

function cardEmbed(card) {
  const embed = new EmbedBuilder()
    .setColor(brand.color)
    .setDescription(formatCardDescription(card))
    .setImage(card.gifUrl || brand.defaultGif);

  if (card.avatarUrl) {
    embed.setThumbnail(card.avatarUrl);
    embed.setAuthor({ name: card.name, iconURL: card.avatarUrl });
  }
  return embed;
}

async function publishLeaderboard(guild) {
  const cfg = api.leaderboard.getConfig(guild.id);
  const snap = api.snapshot.publicSnapshot(guild.id);
  const cards = snap.leaderboard.cards || [];
  const channelIds = cfg.publicChannelIds?.length
    ? cfg.publicChannelIds
    : cfg.publicChannelId
      ? [cfg.publicChannelId]
      : [];

  const pages = [];
  for (let i = 0; i < cards.length; i += 10) {
    pages.push(cards.slice(i, i + 10));
  }
  if (!pages.length) pages.push([]);

  const messageIds = { ...(cfg.messageIds || {}) };

  for (let page = 0; page < pages.length; page += 1) {
    const channelId = channelIds[page] || channelIds[0];
    if (!channelId) continue;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) continue;
    const embeds = (pages[page].length ? pages[page] : [{ position: 1, name: "???", robloxTag: ".???.", region: "—", stage: "???", status: "Empty", wins: 0, losses: 0, gifUrl: brand.defaultGif, empty: true }]).map(cardEmbed);
    const heading = `# Top ${pages[page][0]?.position || 1}–${pages[page].at(-1)?.position || pages[page].length || 10}`;
    const existingId = messageIds[`page-${page}`];
    if (existingId) {
      const msg = await channel.messages.fetch(existingId).catch(() => null);
      if (msg) {
        await msg.edit({ content: heading, embeds });
        continue;
      }
    }
    const sent = await channel.send({ content: heading, embeds });
    messageIds[`page-${page}`] = sent.id;
  }

  api.leaderboard.updateConfig(guild.id, { messageIds, setupCompleted: true });
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
    const embeds = (region.main.length ? region.main : []).map(cardEmbed);
    if (!embeds.length) continue;
    const heading = `# Line Up ${region.label}`;
    if (stored.messageId) {
      const msg = await channel.messages.fetch(stored.messageId).catch(() => null);
      if (msg) {
        await msg.edit({ content: heading, embeds: embeds.slice(0, 10) });
        continue;
      }
    }
    const sent = await channel.send({ content: heading, embeds: embeds.slice(0, 10) });
    stored.messageId = sent.id;
  }
  api.lineup.updateConfig(guild.id, { regions: cfg.regions, setupCompleted: true });
}

module.exports = { cardEmbed, publishLeaderboard, publishLineup };
