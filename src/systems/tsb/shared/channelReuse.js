const { ChannelType } = require("discord.js");

const locks = new Map();

async function withChannelLock(guildId, fn) {
  const key = String(guildId || "unknown");
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => fn());
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}

async function refreshChannelCache(guild) {
  await guild.channels.fetch().catch(() => null);
}

function isGuildText(channel) {
  return Boolean(
    channel
    && channel.isTextBased?.()
    && !channel.isThread?.()
    && channel.type !== ChannelType.GuildVoice
  );
}

function findTextByNames(guild, names) {
  for (const name of names || []) {
    const wanted = String(name || "").toLowerCase().trim();
    if (!wanted) continue;
    const found = guild.channels.cache.find(
      (c) => isGuildText(c) && c.name.toLowerCase() === wanted
    );
    if (found) return found;
  }
  return null;
}

function findTextByRegex(guild, regex) {
  if (!regex) return null;
  return [...guild.channels.cache.values()]
    .filter((c) => isGuildText(c) && regex.test(c.name.toLowerCase()))
    .sort((a, b) => a.name.length - b.name.length)[0] || null;
}

async function resolveExistingChannel(guild, channelId) {
  if (!channelId) return null;
  const existing = await guild.channels.fetch(channelId).catch(() => null);
  return isGuildText(existing) ? existing : null;
}

/**
 * Reuse a stored or same-named text channel. Never create a second copy.
 */
async function getOrCreateNamedChannel(guild, {
  channelId = null,
  names = [],
  pattern = null,
  createName,
  topic,
  reason,
  create = true,
} = {}) {
  return withChannelLock(guild.id, async () => {
    await refreshChannelCache(guild);

    const stored = await resolveExistingChannel(guild, channelId);
    if (stored) return stored;

    const existing = findTextByNames(guild, names) || findTextByRegex(guild, pattern);
    if (existing) return existing;

    if (!create) return null;

    const name = String(createName || names[0] || "").toLowerCase().trim();
    if (!name) return null;

    const raced = findTextByNames(guild, [name, ...names]) || findTextByRegex(guild, pattern);
    if (raced) return raced;

    return guild.channels.create({
      name,
      type: ChannelType.GuildText,
      topic: topic || undefined,
      reason: reason || "Ascendant board channel",
    });
  });
}

module.exports = {
  refreshChannelCache,
  isGuildText,
  findTextByNames,
  findTextByRegex,
  resolveExistingChannel,
  getOrCreateNamedChannel,
};
