const { SlashCommandBuilder, PermissionFlagsBits, StickerFormatType } = require("discord.js");
const { danger, ok } = require("../utils/embeds");
const { hasMod } = require("../utils/permissions");

const CUSTOM_EMOJI = /<(a)?:(\w+):(\d+)>/g;
const EMOJI_CDN = /(?:cdn\.discordapp\.com|media\.discordapp\.net)\/emojis\/(\d+)\.(png|gif|webp)/gi;
const STICKER_CDN = /(?:cdn\.discordapp\.com|media\.discordapp\.net)\/stickers\/(\d+)\.(png|gif|json|webp)/gi;
const MAX_STEAL = 20;
const EMOJI_MAX_BYTES = 256 * 1024;

const FORMAT_LOTTIE = StickerFormatType.Lottie ?? 3;

function parseItems(text) {
  const out = [];
  const seen = new Set();
  const raw = String(text || "");

  for (const match of raw.matchAll(CUSTOM_EMOJI)) {
    pushEmoji(out, seen, { animated: Boolean(match[1]), name: match[2], id: match[3] });
  }

  for (const match of raw.matchAll(EMOJI_CDN)) {
    pushEmoji(out, seen, {
      animated: /\.gif/i.test(match[0]) ? true : /\.png/i.test(match[0]) ? false : null,
      name: `emoji_${match[1].slice(-6)}`,
      id: match[1],
    });
  }

  for (const match of raw.matchAll(STICKER_CDN)) {
    const ext = String(match[2] || "png").toLowerCase();
    pushSticker(out, seen, {
      id: match[1],
      name: `sticker_${match[1].slice(-6)}`,
      url: `https://media.discordapp.net/stickers/${match[1]}.${ext}`,
      format: ext === "gif" ? (StickerFormatType.GIF ?? 4) : ext === "json" ? FORMAT_LOTTIE : StickerFormatType.PNG,
    });
  }

  for (const token of raw.split(/[\s,;|]+/)) {
    const id = token.replace(/[<>:]/g, "").trim();
    if (!/^\d{17,20}$/.test(id)) continue;
    pushEmoji(out, seen, { animated: null, name: `emoji_${id.slice(-6)}`, id });
  }

  return out;
}

function pushEmoji(out, seen, emoji) {
  const id = String(emoji?.id || "");
  if (!id || seen.has(`e:${id}`)) return;
  seen.add(`e:${id}`);
  out.push({ kind: "emoji", animated: emoji.animated ?? null, name: emoji.name || `emoji_${id.slice(-6)}`, id });
}

function pushSticker(out, seen, sticker) {
  const id = String(sticker?.id || "");
  if (!id || seen.has(`s:${id}`)) return;
  seen.add(`s:${id}`);
  out.push({
    kind: "sticker",
    id,
    name: sticker.name || `sticker_${id.slice(-6)}`,
    url: sticker.url,
    format: sticker.format,
  });
}

function emojiUrls(emoji) {
  const id = emoji.id;
  const gif = [
    `https://cdn.discordapp.com/emojis/${id}.gif?size=128&quality=lossless`,
    `https://cdn.discordapp.com/emojis/${id}.gif`,
  ];
  const png = [
    `https://cdn.discordapp.com/emojis/${id}.png?size=128&quality=lossless`,
    `https://cdn.discordapp.com/emojis/${id}.webp?size=128`,
    `https://cdn.discordapp.com/emojis/${id}.png`,
  ];
  if (emoji.animated === true) return [...gif, ...png];
  if (emoji.animated === false) return [...png, ...gif];
  return [...gif, ...png];
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const type = String(res.headers.get("content-type") || "");
  if (type && !/image|octet-stream|json/i.test(type)) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return null;
  return { buf, type, url };
}

async function downloadEmoji(emoji) {
  for (const url of emojiUrls(emoji)) {
    const got = await fetchBuffer(url);
    if (!got) continue;
    const animated = /\.gif(\?|$)/i.test(got.url) || /gif/i.test(got.type);
    if (got.buf.length > EMOJI_MAX_BYTES && animated) continue;
    if (got.buf.length > EMOJI_MAX_BYTES) continue;
    emoji.animated = animated;
    return got.buf;
  }
  throw new Error(`Could not download ${emoji.name}`);
}

async function downloadSticker(sticker) {
  const urls = [
    sticker.url,
    `https://media.discordapp.net/stickers/${sticker.id}.gif`,
    `https://media.discordapp.net/stickers/${sticker.id}.png`,
    `https://cdn.discordapp.com/stickers/${sticker.id}.png`,
  ].filter(Boolean);

  for (const url of urls) {
    const got = await fetchBuffer(url);
    if (got?.buf?.length) return got.buf;
  }
  throw new Error(`Could not download sticker ${sticker.name}`);
}

function safeName(name, max = 32) {
  const cleaned = String(name || "stolen")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, max);
  return cleaned || "stolen";
}

function uniqueEmojiName(guild, base) {
  let name = safeName(base, 32);
  if (!guild.emojis.cache.some((e) => e.name === name)) return name;
  const suffix = Date.now().toString(36).slice(-4);
  return `${name.slice(0, Math.max(1, 32 - suffix.length - 1))}_${suffix}`;
}

function uniqueStickerName(guild, base) {
  let name = safeName(base, 30);
  if (name.length < 2) name = "st";
  if (!guild.stickers.cache.some((s) => s.name === name)) return name;
  const suffix = Date.now().toString(36).slice(-3);
  return `${name.slice(0, Math.max(2, 30 - suffix.length - 1))}_${suffix}`;
}

function collectFromMessage(message) {
  const out = [];
  const seen = new Set();
  const chunks = [message.content];
  for (const embed of message.embeds || []) {
    chunks.push(embed.title, embed.description, embed.footer?.text, embed.author?.name);
    for (const field of embed.fields || []) chunks.push(field.name, field.value);
  }
  for (const item of parseItems(chunks.filter(Boolean).join(" "))) {
    if (item.kind === "sticker") pushSticker(out, seen, item);
    else pushEmoji(out, seen, item);
  }

  for (const sticker of message.stickers?.cache?.values?.() || []) {
    pushSticker(out, seen, sticker);
  }

  for (const reaction of message.reactions?.cache?.values?.() || []) {
    const e = reaction.emoji;
    if (e?.id) pushEmoji(out, seen, { id: e.id, name: e.name, animated: e.animated });
  }

  for (const row of message.components || []) {
    for (const comp of row.components || []) {
      const e = comp.emoji;
      if (e?.id) pushEmoji(out, seen, { id: e.id, name: e.name, animated: e.animated });
    }
  }

  for (const att of message.attachments?.values?.() || []) {
    const name = String(att.name || "");
    const url = String(att.url || att.proxyURL || "");
    if (!/\.(gif|png|webp)$/i.test(name) && !/\.(gif|png|webp)(\?|$)/i.test(url)) continue;
    if (att.size && att.size > EMOJI_MAX_BYTES) continue;
    const id = `att_${att.id}`;
    if (seen.has(`e:${id}`)) continue;
    seen.add(`e:${id}`);
    out.push({
      kind: "emoji",
      id,
      name: safeName(name.replace(/\.[^.]+$/, ""), 32),
      animated: /\.gif/i.test(name) || /\.gif/i.test(url),
      fileUrl: url,
    });
  }

  return out;
}

async function resolveSources(interactionOrMessage, args = []) {
  const fromArgs = parseItems(args.join(" "));
  if (fromArgs.length) return fromArgs;

  const ref = interactionOrMessage.reference?.messageId
    ? interactionOrMessage
    : interactionOrMessage.message?.reference?.messageId
      ? interactionOrMessage.message
      : null;

  if (ref?.reference?.messageId) {
    const replied = await ref.channel.messages.fetch(ref.reference.messageId).catch(() => null);
    if (replied) return collectFromMessage(replied);
  }

  return [];
}

async function stealEmoji(guild, emoji, actorTag) {
  let buffer;
  if (emoji.fileUrl) {
    const got = await fetchBuffer(emoji.fileUrl);
    if (!got) throw new Error(`Could not download ${emoji.name}`);
    buffer = got.buf;
  } else {
    buffer = await downloadEmoji(emoji);
  }
  const name = uniqueEmojiName(guild, emoji.name);
  return guild.emojis.create({
    attachment: buffer,
    name,
    reason: `Emoji steal by ${actorTag}`,
  });
}

async function stealSticker(guild, sticker, actorTag) {
  if (sticker.format === FORMAT_LOTTIE) {
    throw new Error("Lottie stickers cannot be uploaded as server stickers");
  }
  const buffer = await downloadSticker(sticker);
  const name = uniqueStickerName(guild, sticker.name);
  return guild.stickers.create({
    file: buffer,
    name,
    tags: name.slice(0, 200) || "stolen",
    description: "Stolen sticker",
    reason: `Sticker steal by ${actorTag}`,
  });
}

async function runSteal(context) {
  const { guild, member, user, reply } = context;
  if (!hasMod(member, PermissionFlagsBits.ManageGuildExpressions)) {
    return reply({ embeds: [danger("Missing permissions", "Need **Manage Expressions**.")] });
  }

  const items = await resolveSources(context.source, context.args);
  if (!items.length) {
    return reply({
      embeds: [
        danger(
          "Nothing found",
          "Send custom emojis (`<a:name:123>`), IDs, CDN links, stickers, or reply to a message that has them (including reactions)."
        ),
      ],
    });
  }

  const batch = items.slice(0, MAX_STEAL);
  const created = [];
  const failed = [];

  for (const item of batch) {
    try {
      if (item.kind === "sticker") {
        created.push(await stealSticker(guild, item, user.tag));
      } else {
        created.push(await stealEmoji(guild, item, user.tag));
      }
    } catch (err) {
      failed.push(`${item.name}: ${err.message}`);
    }
  }

  if (!created.length) {
    return reply({
      embeds: [danger("Steal failed", failed.slice(0, 5).join("\n") || "Could not add that.")],
    });
  }

  const lines = created
    .map((e) => {
      if ("tags" in e) return `sticker **${e.name}**`;
      return `${e} \`:${e.name}:\``;
    })
    .join("\n");
  const extra =
    items.length > MAX_STEAL
      ? `\n\nOnly the first ${MAX_STEAL} were stolen.`
      : failed.length
        ? `\n\nFailed:\n${failed.slice(0, 5).join("\n")}`
        : "";

  return reply({
    embeds: [ok("Stolen", `${lines}${extra}`)],
  });
}

module.exports = {
  name: "emojisteal",
  aliases: ["stealemoji", "es", "stickersteal", "stealsticker"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("emojisteal")
      .setDescription("Copy custom emojis (including animated) and stickers to this server")
      .addStringOption((o) =>
        o
          .setName("emoji")
          .setDescription("Emoji/sticker tags, IDs, CDN links, or leave empty when replying")
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions),

  async executePrefix(message, args) {
    return runSteal({
      guild: message.guild,
      member: message.member,
      user: message.author,
      source: message,
      args,
      reply: (payload) => message.reply(payload),
    });
  },

  async executeSlash(interaction) {
    const emojiArg = interaction.options.getString("emoji") || "";
    return runSteal({
      guild: interaction.guild,
      member: interaction.member,
      user: interaction.user,
      source: interaction,
      args: emojiArg ? [emojiArg] : [],
      reply: (payload) => interaction.reply(payload),
    });
  },
};
