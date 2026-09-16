const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const api = require("../utils/loadApi");
const { resolveMaybe } = require("../utils/resolveMaybe");
const { formatCardDescription, cardTitle, sanitizeThumbnail, CARD_COLOR, VACANT_COLOR } = api.cards;
const { brand } = api;
const { generateLeaderboardBanner, generateVoidRosterBanner } = require("./bannerGenerate");
const { extraBoardsOf, headingTextOf } = require("./tsb/leaderboard/config");
const {
  resolveTheme,
  metallicComponentsV2,
  entryBody,
  top10EntryBody,
  voidRosterPayload,
} = require("./leaderboardThemes");

function cardEmbed(card, { mode = "leaderboard", themeId = "classic" } = {}) {
  const thumb = sanitizeThumbnail(card.avatarUrl);

  if (mode === "leaderboard" && themeId === "top10") {
    const embed = new EmbedBuilder()
      .setColor(card.empty ? VACANT_COLOR : CARD_COLOR)
      .setDescription(top10EntryBody(card))
      .setImage(card.gifUrl || brand.defaultGif);
    if (!card.empty && thumb) embed.setThumbnail(thumb);
    return embed;
  }

  if (mode === "leaderboard") {
    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setDescription(entryBody(card))
      .setImage(card.gifUrl || brand.defaultGif);
    if (!card.empty && thumb) {
      embed.setThumbnail(thumb);
      embed.setAuthor({ name: card.name, iconURL: thumb });
    }
    return embed;
  }

  const embed = new EmbedBuilder()
    .setColor(card.empty ? VACANT_COLOR : CARD_COLOR)
    .setTitle(cardTitle(card))
    .setDescription(formatCardDescription(card, { mode }))
    .setImage(card.gifUrl || brand.defaultGif);

  if (!card.empty && thumb) embed.setThumbnail(thumb);
  return embed;
}

async function enrichCardsFromGuild(guild, cards) {
  for (const card of cards) {
    if (card.empty || !card.discordId) continue;
    const member = await guild.members.fetch(card.discordId).catch(() => null);
    if (!member) continue;
    const discordAvatar = member.displayAvatarURL({ extension: "png", size: 256 });
    if (discordAvatar) card.avatarUrl = card.avatarUrl || discordAvatar;
    if (!card.discordTag) card.discordTag = `<@${card.discordId}>`;
    if (!card.robloxUsername) {
      card.name = member.displayName || member.user.username || card.name;
    }
  }
  return cards;
}

async function enrichCardsFromRoblox(guild, cards) {
  const robloxIds = [];
  const usernameCards = [];
  for (const card of cards) {
    if (card.empty) continue;
    if (card.robloxId) robloxIds.push(String(card.robloxId));
    else if (card.robloxUsername) usernameCards.push(card);
  }

  if (robloxIds.length && api.roblox?.fetchRobloxHeadshots) {
    try {
      const headshots = await api.roblox.fetchRobloxHeadshots(robloxIds);
      for (const card of cards) {
        if (card.empty || !card.robloxId) continue;
        const fresh = headshots[String(card.robloxId)];
        if (fresh) card.avatarUrl = fresh;
      }
    } catch (err) {
      console.warn("[BoardPublish] Roblox headshot batch failed:", err.message);
    }
  }

  for (const card of usernameCards) {
    if (card.robloxId) continue;
    try {
      const roblox = await api.roblox.resolveRobloxUser(card.robloxUsername);
      if (roblox?.avatarUrl) card.avatarUrl = roblox.avatarUrl;
      if (roblox?.displayName) card.name = roblox.displayName;
      if (roblox?.name) {
        card.robloxUsername = roblox.name;
        card.robloxId = roblox.id;
      }
    } catch {}
  }

  syncRobloxAvatarsToProfiles(guild.id, cards).catch(() => {});
  return cards;
}

async function syncRobloxAvatarsToProfiles(guildId, cards) {
  for (const card of cards) {
    if (card.empty || !card.discordId || !card.avatarUrl) continue;
    const profile = await resolveMaybe(api.profiles.getProfile(guildId, card.discordId)).catch(() => null);
    if (!profile || profile.roblox_avatar_url === card.avatarUrl) continue;
    await resolveMaybe(
      api.profiles.saveProfile(guildId, card.discordId, {
        roblox_avatar_url: card.avatarUrl,
        skipBoardRefresh: true,
      })
    ).catch(() => {});
  }
}

async function enrichBoardCards(guild, cards) {
  let next = await enrichCardsFromGuild(guild, [...cards]);
  next = await enrichCardsFromRoblox(guild, next);
  return next;
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

async function publishBoardMessages({
  guild,
  theme,
  cards,
  channelIds,
  messageIds,
  showHeading,
  heading,
  bannerBuffer,
  pageSize,
}) {
  const pages = [];
  for (let i = 0; i < cards.length; i += pageSize) {
    pages.push(cards.slice(i, i + pageSize));
  }
  if (!pages.length) pages.push([]);

  const nextIds = { ...(messageIds || {}) };
  const title = heading || `${guild.name} Leaderboard`;

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
        showTitle: showHeading !== false,
        title,
      });
      payload = { ...v2, files };
    } else if (theme.id === "void") {
      const roster = voidRosterPayload(guild.name, slice, {
        title,
        showHeading,
        hasBanner: Boolean(bannerBuffer),
      });
      const files = bannerBuffer
        ? [new AttachmentBuilder(bannerBuffer, { name: "void-roster-banner.png" })]
        : [];
      payload = {
        content: "",
        embeds: roster.embeds,
        files,
      };
    } else {
      payload = {
        content: showHeading !== false ? `# ${title}` : "",
        embeds: slice.map((card) => cardEmbed(card, {
          mode: "leaderboard",
          themeId: theme.id === "top10" ? "top10" : "classic",
        })),
      };
    }

    nextIds[`page-${page}`] = await replaceMessage(channel, nextIds[`page-${page}`], payload);
  }

  return nextIds;
}

async function publishLeaderboard(guild) {
  const cfg = await resolveMaybe(api.leaderboard.getConfig(guild.id));
  const theme = resolveTheme(cfg.theme || "classic");
  const snap = await resolveMaybe(api.snapshot.publicSnapshot(guild.id));
  const cards = await enrichBoardCards(guild, snap.leaderboard.cards || []);
  const channelIds = cfg.publicChannelIds?.length
    ? cfg.publicChannelIds
    : cfg.publicChannelId
      ? [cfg.publicChannelId]
      : [];

  const pageSize = theme.pageSize || 10;
  let bannerBuffer = null;
  if (theme.id === "metallic") {
    bannerBuffer = await generateLeaderboardBanner(guild.name).catch(() => null);
  } else if (theme.id === "void") {
    bannerBuffer = await generateVoidRosterBanner(
      headingTextOf(cfg, guild.name).replace(/leaderboard/i, "ROSTER") || `${guild.name} Roster`
    ).catch(() => null);
  }

  const messageIds = await publishBoardMessages({
    guild,
    theme,
    cards,
    channelIds,
    messageIds: cfg.messageIds || {},
    showHeading: cfg.showHeading !== false,
    heading: headingTextOf(cfg, guild.name),
    bannerBuffer,
    pageSize,
  });

  const extraBoards = extraBoardsOf(cfg);
  const snapExtras = Array.isArray(snap.leaderboard?.extraBoards) ? snap.leaderboard.extraBoards : [];
  const nextExtras = [];
  for (const board of extraBoards) {
    const snapBoard = snapExtras.find((entry) => entry.id === board.id);
    const extraCardSource = snapBoard?.cards?.length
      ? snapBoard.cards
      : (typeof api.snapshot.cardsFromSlots === "function"
        ? api.snapshot.cardsFromSlots(guild.id, board.slots, cfg.cardGifUrl)
        : (board.slots || []).map((slot) => emptyPlaceholder(slot.position)));
    const extraCards = await enrichBoardCards(guild, extraCardSource);
    const extraChannelIds = board.publicChannelIds?.length
      ? board.publicChannelIds
      : (board.boardPages || []).map((page) => page.channelId).filter(Boolean);
    const extraMessageIds = await publishBoardMessages({
      guild,
      theme,
      cards: extraCards,
      channelIds: extraChannelIds,
      messageIds: board.messageIds || {},
      showHeading: board.showTitle !== false,
      heading: board.title || headingTextOf(cfg, guild.name),
      bannerBuffer,
      pageSize,
    });
    nextExtras.push({ ...board, messageIds: extraMessageIds });
  }

  await resolveMaybe(
    api.leaderboard.updateConfig(guild.id, {
      messageIds,
      extraBoards: nextExtras,
      setupCompleted: true,
      theme: theme.id,
    })
  );
}

async function publishLineup(guild, regionKey = null) {
  const cfg = await resolveMaybe(api.lineup.getConfig(guild.id));
  const snap = await resolveMaybe(api.snapshot.publicSnapshot(guild.id));
  const {
    resolveLineupTheme,
    voidLineupPayload,
    voidBannerTitle,
    findBoardRoleId,
    loadVoidStaticFiles,
  } = require("./lineupThemes");
  const theme = resolveLineupTheme(cfg.theme || "classic");
  const regions = regionKey
    ? snap.lineup.regions.filter((r) => r.key === regionKey)
    : snap.lineup.regions;

  for (const region of regions) {
    const stored = cfg.regions[region.key];
    if (!stored?.channelId) continue;
    const channel = await guild.channels.fetch(stored.channelId).catch(() => null);
    if (!channel) continue;

    const mainCards = region.main.length ? await enrichBoardCards(guild, region.main) : [];
    const subCards = region.sub?.length ? await enrichBoardCards(guild, region.sub) : [];
    const separateSub = !!cfg.separateSubChannels
      && stored.subChannelId
      && stored.subChannelId !== stored.channelId;

    if (theme.id === "void") {
      const bannerTitle = voidBannerTitle(region.key, region.label);
      const bannerForRegion = await generateVoidRosterBanner(bannerTitle).catch(() => null);
      const mainRoleId = findBoardRoleId(guild, region.label, "main");
      const subRoleId = findBoardRoleId(guild, region.label, "sub");

      if (!separateSub) {
        const files = [
          ...(bannerForRegion
            ? [new AttachmentBuilder(bannerForRegion, { name: "void-roster-banner.png" })]
            : []),
          ...loadVoidStaticFiles({ includeMain: true, includeSub: true }),
        ];
        const roster = voidLineupPayload({
          mainCards,
          subCards,
          mode: "combined",
          hasBanner: Boolean(bannerForRegion),
          mainRoleId,
          subRoleId,
        });
        stored.messageId = await replaceMessage(channel, stored.messageId, {
          ...roster,
          files,
        });
        // Drop the old separate sub message if we previously posted one
        if (stored.subMessageId && stored.subMessageId !== stored.messageId) {
          const old = await channel.messages.fetch(stored.subMessageId).catch(() => null);
          if (old) await old.delete().catch(() => {});
        }
        stored.subMessageId = null;
      } else {
        const mainFiles = [
          ...(bannerForRegion
            ? [new AttachmentBuilder(bannerForRegion, { name: "void-roster-banner.png" })]
            : []),
          ...loadVoidStaticFiles({ includeMain: true, includeSub: false }),
        ];
        const mainRoster = voidLineupPayload({
          mainCards,
          mode: "main",
          hasBanner: Boolean(bannerForRegion),
          mainRoleId,
        });
        stored.messageId = await replaceMessage(channel, stored.messageId, {
          ...mainRoster,
          files: mainFiles,
        });

        const subChannel = await guild.channels.fetch(stored.subChannelId).catch(() => null);
        if (subChannel) {
          const subBanner = await generateVoidRosterBanner(bannerTitle).catch(() => null)
            || bannerForRegion;
          const subFiles = [
            ...(subBanner
              ? [new AttachmentBuilder(subBanner, { name: "void-roster-banner.png" })]
              : []),
            ...loadVoidStaticFiles({ includeMain: false, includeSub: true }),
          ];
          const subRoster = voidLineupPayload({
            subCards,
            mode: "sub",
            hasBanner: Boolean(subBanner),
            subRoleId,
          });
          stored.subMessageId = await replaceMessage(subChannel, stored.subMessageId, {
            ...subRoster,
            files: subFiles,
          });
        }
      }
      continue;
    }

    const mainEmbeds = mainCards.map((card) => cardEmbed(card, { mode: "lineup" }));
    if (mainEmbeds.length) {
      const heading = `# Line Up - ${region.label}`;
      stored.messageId = await replaceMessage(channel, stored.messageId, {
        content: heading,
        embeds: mainEmbeds.slice(0, 10),
      });
    }

    const subEmbeds = subCards.map((card) => cardEmbed(card, { mode: "lineup" }));
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
  await resolveMaybe(api.lineup.updateConfig(guild.id, {
    regions: cfg.regions,
    setupCompleted: true,
    theme: theme.id,
  }));
}

module.exports = { cardEmbed, publishLeaderboard, publishLineup };
