const { ChannelType } = require("discord.js");
const {
  getLineupConfig,
  updateLineupConfig,
  getRegion,
  ensureRegions,
} = require("./config");
const { publishLineup } = require("../../boardPublish");
const api = require("../../../utils/loadApi");

async function loadPlayerCard(guild, userId) {
  const bundle = api.snapshot.playerBundle(guild.id, userId);
  return {
    hasProfile: !!bundle.hasProfile,
    name: bundle.displayName || bundle.robloxUsername || "Unknown",
    host: bundle.host || bundle.region || "—",
    rank: bundle.stage || "—",
    region: bundle.region || "—",
  };
}

function buildLineupListDescription(cfg) {
  const keys = cfg.enabledRegionKeys || Object.keys(cfg.regions || {});
  if (!keys.length) return "No regions configured.";
  return keys
    .map((key) => {
      const r = cfg.regions?.[key];
      if (!r) return `**${key}** — not created`;
      const main = (r.slots || []).filter((s) => s.discordId).length;
      const sub = (r.subSlots || []).filter((s) => s.discordId).length;
      return `**${r.label}** (\`${key}\`) · main ${main}/${r.slots?.length || 0} · sub ${sub}/${r.subSlots?.length || 0}`;
    })
    .join("\n");
}

async function resolveOrCreateLineupChannel(guild, region, board) {
  const cfg = getLineupConfig(guild.id);
  const separateSub = !!cfg.separateSubChannels;
  const isSub = board === "sub";
  const storedId = isSub ? region.subChannelId : region.channelId;
  if (storedId) {
    const existing = await guild.channels.fetch(storedId).catch(() => null);
    if (existing?.isTextBased?.()) {
      if (isSub && separateSub && region.channelId && existing.id === region.channelId) {
        // fall through
      } else {
        return existing;
      }
    }
  }
  if (isSub && !separateSub) {
    return resolveOrCreateLineupChannel(guild, region, "main");
  }
  const name = isSub
    ? `tsb-lineup-${region.key}-sub`.toLowerCase()
    : `tsb-lineup-${region.key}`.toLowerCase();
  return (
    guild.channels.cache.find((c) => c.name === name && c.isTextBased?.()) ||
    guild.channels.create({
      name,
      type: ChannelType.GuildText,
      topic: isSub ? `Sub Line Up ${region.label}` : `Line Up ${region.label}`,
      reason: "TSB lineup publish",
    })
  );
}

async function publishRegionLineup(guild, regionKey) {
  const cfg = getLineupConfig(guild.id);
  ensureRegions(
    guild.id,
    cfg.enabledRegionKeys || Object.keys(cfg.regions || {}),
    cfg.slotsPerRegion,
    cfg.subSlotsPerRegion
  );
  let region = getRegion(guild.id, regionKey);
  if (!region) throw new Error(`Unknown region: ${regionKey}`);

  const separateSub = !!cfg.separateSubChannels;
  const mainChannel = await resolveOrCreateLineupChannel(guild, region, "main");
  const subChannel = separateSub
    ? await resolveOrCreateLineupChannel(guild, region, "sub")
    : mainChannel;

  const regions = { ...getLineupConfig(guild.id).regions };
  regions[regionKey] = {
    ...regions[regionKey],
    channelId: mainChannel.id,
    subChannelId: separateSub ? subChannel.id : mainChannel.id,
  };
  updateLineupConfig(guild.id, { regions, setupCompleted: true });

  await publishLineup(guild, regionKey);
  return { channel: mainChannel, subChannel };
}

async function publishAllLineups(guild) {
  const cfg = getLineupConfig(guild.id);
  const results = [];
  for (const key of cfg.enabledRegionKeys || Object.keys(cfg.regions || {})) {
    results.push(await publishRegionLineup(guild, key));
  }
  return results;
}

module.exports = {
  loadPlayerCard,
  buildLineupListDescription,
  publishRegionLineup,
  refreshRegionSlot: publishRegionLineup,
  publishAllLineups,
};
