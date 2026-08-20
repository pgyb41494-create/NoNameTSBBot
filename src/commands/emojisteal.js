const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { danger, ok } = require("../utils/embeds");
const { hasMod } = require("../utils/permissions");

const CUSTOM_EMOJI = /<(a)?:(\w+):(\d+)>/g;
const EMOJI_CDN = /cdn\.discordapp\.com\/emojis\/(\d+)\.(?:png|gif|webp)/i;
const MAX_STEAL = 5;

function parseCustomEmojis(text) {
  const out = [];
  const seen = new Set();
  const raw = String(text || "");

  for (const match of raw.matchAll(CUSTOM_EMOJI)) {
    const id = match[3];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ animated: Boolean(match[1]), name: match[2], id });
  }

  for (const match of raw.matchAll(EMOJI_CDN)) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      animated: /\.gif/i.test(match[0]),
      name: `emoji_${id.slice(-6)}`,
      id,
    });
  }

  for (const token of raw.split(/\s+/)) {
    const id = token.replace(/[<>:]/g, "").trim();
    if (!/^\d{17,20}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ animated: null, name: `emoji_${id.slice(-6)}`, id });
  }

  return out;
}

function emojiUrl(emoji) {
  if (emoji.animated === true) {
    return `https://cdn.discordapp.com/emojis/${emoji.id}.gif?quality=lossless`;
  }
  if (emoji.animated === false) {
    return `https://cdn.discordapp.com/emojis/${emoji.id}.png?quality=lossless`;
  }
  return `https://cdn.discordapp.com/emojis/${emoji.id}.png?quality=lossless`;
}

async function downloadEmoji(emoji) {
  let res = await fetch(emojiUrl(emoji));
  if (!res.ok && emoji.animated == null) {
    res = await fetch(`https://cdn.discordapp.com/emojis/${emoji.id}.gif?quality=lossless`);
    if (res.ok) emoji.animated = true;
  }
  if (!res.ok) throw new Error(`Could not download ${emoji.name}`);
  if (emoji.animated == null) emoji.animated = false;
  return Buffer.from(await res.arrayBuffer());
}

function safeName(name) {
  const cleaned = String(name || "stolen_emoji")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return cleaned || "stolen_emoji";
}

function uniqueName(guild, base) {
  let name = safeName(base);
  if (!guild.emojis.cache.some((e) => e.name === name)) return name;
  const suffix = Date.now().toString(36).slice(-4);
  return `${name.slice(0, Math.max(1, 32 - suffix.length - 1))}_${suffix}`;
}

async function collectEmojisFromMessage(message) {
  const chunks = [message.content];
  for (const embed of message.embeds || []) {
    chunks.push(embed.title, embed.description, embed.footer?.text, embed.author?.name);
    for (const field of embed.fields || []) {
      chunks.push(field.name, field.value);
    }
  }
  for (const sticker of message.stickers?.cache?.values?.() || []) {
    if (sticker.url) chunks.push(sticker.url);
  }
  return parseCustomEmojis(chunks.filter(Boolean).join(" "));
}

async function resolveEmojiSources(interactionOrMessage, args = []) {
  const emojis = parseCustomEmojis(args.join(" "));
  if (emojis.length) return emojis;

  const ref = interactionOrMessage.reference?.messageId
    ? interactionOrMessage
    : interactionOrMessage.message?.reference?.messageId
      ? interactionOrMessage.message
      : null;

  if (ref?.reference?.messageId) {
    const replied = await ref.channel.messages.fetch(ref.reference.messageId).catch(() => null);
    if (replied) return collectEmojisFromMessage(replied);
  }

  return [];
}

async function stealOne(guild, emoji, actorTag) {
  const buffer = await downloadEmoji(emoji);
  const name = uniqueName(guild, emoji.name);
  return guild.emojis.create({
    attachment: buffer,
    name,
    reason: `Emoji steal by ${actorTag}`,
  });
}

async function runSteal(context) {
  const { guild, member, user, reply } = context;
  if (!hasMod(member, PermissionFlagsBits.ManageGuildExpressions)) {
    return reply({ embeds: [danger("Missing permissions", "Need **Manage Expressions**.")] });
  }

  const emojis = await resolveEmojiSources(context.source, context.args);
  if (!emojis.length) {
    return reply({
      embeds: [
        danger(
          "No emoji found",
          "Send a custom emoji (`<:name:123>`), paste the emoji ID, paste a CDN link, or reply to a message that contains one."
        ),
      ],
    });
  }

  const batch = emojis.slice(0, MAX_STEAL);
  const created = [];
  const failed = [];

  for (const emoji of batch) {
    try {
      const item = await stealOne(guild, emoji, user.tag);
      created.push(item);
    } catch (err) {
      failed.push(`${emoji.name}: ${err.message}`);
    }
  }

  if (!created.length) {
    return reply({
      embeds: [danger("Steal failed", failed.slice(0, 3).join("\n") || "Could not add that emoji.")],
    });
  }

  const lines = created.map((e) => `${e} \`:${e.name}:\``).join("\n");
  const extra =
    emojis.length > MAX_STEAL
      ? `\n\nOnly the first ${MAX_STEAL} emojis were stolen.`
      : failed.length
        ? `\n\nFailed:\n${failed.slice(0, 3).join("\n")}`
        : "";

  return reply({
    embeds: [ok("Emoji stolen", `${lines}${extra}`)],
  });
}

module.exports = {
  name: "emojisteal",
  aliases: ["stealemoji", "es"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("emojisteal")
      .setDescription("Add a custom emoji from another server to this one")
      .addStringOption((o) =>
        o.setName("emoji").setDescription("Emoji tag, ID, CDN link, or leave empty when replying").setRequired(false)
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
