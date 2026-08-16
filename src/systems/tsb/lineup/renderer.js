const {
  getLineupConfig,
  updateLineupConfig,
  getRegion,
  ensureRegions,
} = require("./config");
const { publishLineup } = require("../../boardPublish");
const { getOrCreateNamedChannel } = require("../shared/channelReuse");
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

function lineupChannelNames(regionKey, isSub) {
  const key = String(regionKey || "").toLowerCase();
  const suffix = isSub ? "-sub" : "";
  return [
    `lineup-${key}${suffix}`,
    `tsb-lineup-${key}${suffix}`,
    `ascendant-lineup-${key}${suffix}`,
  ];
}

async function resolveOrCreateLineupChannel(guild, region, board, { create = true } = {}) {
  const cfg = getLineupConfig(guild.id);
  const separateSub = !!cfg.separateSubChannels;
  const isSub = board === "sub";
  if (isSub && !separateSub) {
    return resolveOrCreateLineupChannel(guild, region, "main", { create });
  }

  const storedId = isSub ? region.subChannelId : region.channelId;
  const skipStored = isSub && separateSub && storedId && storedId === region.channelId;
  const key = String(region.key || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = lineupChannelNames(region.key, isSub);

  return getOrCreateNamedChannel(guild, {
    channelId: skipStored ? null : storedId,
    names,
    pattern: new RegExp(`^(?:tsb-|ascendant-)?lineup-${key}${isSub ? "-sub" : ""}$`),
    createName: names[0],
    topic: isSub ? `Sub Line Up ${region.label}` : `Line Up ${region.label}`,
    reason: "TSB lineup publish",
    create,
  });
}

async function publishRegionLineup(guild, regionKey, { createChannels = true } = {}) {
  const cfg = getLineupConfig(guild.id);
  ensureRegions(
    guild.id,
    cfg.enabledRegionKeys || Object.keys(cfg.regions || {}),
    cfg.slotsPerRegion,
    cfg.subSlotsPerRegion
  );
  let region = getRegion(guild.id, regionKey);
  if (!region) throw new Error(`Unknown region: ${regionKey}`);

  if (!createChannels && !region.channelId && !region.subChannelId) return null;

  const separateSub = !!cfg.separateSubChannels;
  const mainChannel = await resolveOrCreateLineupChannel(guild, region, "main", {
    create: createChannels,
  });
  if (!mainChannel) return null;
  const subChannel = separateSub
    ? await resolveOrCreateLineupChannel(guild, region, "sub", { create: createChannels })
    : mainChannel;

  const regions = { ...getLineupConfig(guild.id).regions };
  regions[regionKey] = {
    ...regions[regionKey],
    channelId: mainChannel.id,
    subChannelId: (separateSub ? subChannel?.id : mainChannel.id) || mainChannel.id,
  };
  updateLineupConfig(guild.id, { regions, setupCompleted: createChannels ? true : cfg.setupCompleted });

  await publishLineup(guild, regionKey);
  return { channel: mainChannel, subChannel };
}

async function publishAllLineups(guild, { createChannels = true } = {}) {
  const cfg = getLineupConfig(guild.id);
  if (!createChannels && !cfg.setupCompleted) return [];
  const results = [];
  for (const key of cfg.enabledRegionKeys || Object.keys(cfg.regions || {})) {
    const published = await publishRegionLineup(guild, key, { createChannels });
    if (published) results.push(published);
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
