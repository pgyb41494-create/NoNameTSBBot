/**
 * Parse emoji for Discord components: unicode, <:name:id>, raw ID, or :name:
 */
function parseEmojiInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const mention = text.match(/<(a)?:([a-zA-Z0-9_]+):(\d{17,20})>/);
  if (mention) {
    return { id: mention[3], name: mention[2], animated: Boolean(mention[1]) };
  }

  if (/^\d{17,20}$/.test(text)) {
    return { id: text, name: null, animated: false };
  }

  const colon = text.match(/^:([a-zA-Z0-9_]{2,32}):$/);
  if (colon) {
    return { id: null, name: colon[1], animated: false };
  }

  return { unicode: text };
}

function fromGuild(guild, id, name) {
  if (!guild?.emojis?.cache) return null;
  if (id) {
    const hit = guild.emojis.cache.get(id);
    if (hit) return { id: hit.id, name: hit.name, animated: hit.animated };
  }
  if (name) {
    const hit = guild.emojis.cache.find((e) => e.name === name);
    if (hit) return { id: hit.id, name: hit.name, animated: hit.animated };
  }
  return null;
}

function toComponentEmoji(resolved) {
  if (!resolved) return null;
  if (resolved.unicode) return resolved.unicode;
  if (resolved.id && resolved.name) {
    return { id: resolved.id, name: resolved.name, animated: Boolean(resolved.animated) };
  }
  if (resolved.id) return { id: resolved.id };
  return null;
}

/** Sync — uses guild emoji cache when available. */
function parseEmoji(raw, guild = null) {
  const parsed = parseEmojiInput(raw);
  if (!parsed) return null;
  if (parsed.unicode) return parsed.unicode;

  const hit = guild ? fromGuild(guild, parsed.id, parsed.name) : null;
  if (hit) return toComponentEmoji(hit);
  if (parsed.id && parsed.name) return toComponentEmoji(parsed);
  if (parsed.id) return { id: parsed.id };
  return null;
}

/** Async — fetches custom emoji by ID from the guild when needed. */
async function resolveEmojiStorage(raw, guild) {
  const parsed = parseEmojiInput(raw);
  if (!parsed) return "";

  if (parsed.unicode) return parsed.unicode;

  let hit = guild ? fromGuild(guild, parsed.id, parsed.name) : null;
  if (!hit && guild?.emojis?.fetch && parsed.id) {
    const fetched = await guild.emojis.fetch(parsed.id).catch(() => null);
    if (fetched) hit = { id: fetched.id, name: fetched.name, animated: fetched.animated };
  }
  if (!hit && guild?.emojis?.cache && parsed.name) {
    hit = fromGuild(guild, null, parsed.name);
  }

  if (hit) {
    const prefix = hit.animated ? "a" : "";
    return `<${prefix ? "a:" : ":"}${hit.name}:${hit.id}>`;
  }
  if (parsed.id) return parsed.id;
  return String(raw).trim();
}

function formatEmojiLabel(raw, guild = null) {
  const parsed = parseEmojiInput(raw);
  if (!parsed) return "";
  if (parsed.unicode) return parsed.unicode;
  const hit = guild ? fromGuild(guild, parsed.id, parsed.name) : null;
  if (hit?.name) return `:${hit.name}:`;
  if (parsed.name) return `:${parsed.name}:`;
  if (parsed.id) return `:${parsed.id}:`;
  return String(raw || "");
}

module.exports = {
  parseEmojiInput,
  parseEmoji,
  resolveEmojiStorage,
  formatEmojiLabel,
};
