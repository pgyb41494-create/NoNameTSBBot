const { EmbedBuilder } = require("discord.js");
const { brand, authorName } = require("../../../utils/loadApi");

const COLOR_PRIMARY = brand.accent || 0x5865f2;
const COLOR_SURFACE = brand.color || 0x2b2d31;
const COLOR_SUCCESS = brand.success || 0x57f287;
const COLOR_WARN = brand.warn || 0xfee75c;
const COLOR_DANGER = brand.danger || 0xed4245;

function tsbEmbed(options = {}) {
  const embed = new EmbedBuilder().setColor(options.color ?? COLOR_SURFACE);
  if (options.title) embed.setTitle(options.title);
  if (options.description) embed.setDescription(options.description);
  if (options.footer) embed.setFooter({ text: options.footer });
  if (options.author !== false) {
    embed.setAuthor({ name: options.authorName || authorName() });
  }
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.image) embed.setImage(options.image);
  if (Array.isArray(options.fields) && options.fields.length) embed.addFields(options.fields);
  return embed;
}

function tsbFooter(text) {
  return `${authorName()}${text ? ` · ${text}` : ""}`;
}

function fieldLine(label, value) {
  return `> **${label}:** ${value}`;
}

module.exports = {
  TSB_AUTHOR: authorName(),
  COLOR_PRIMARY,
  COLOR_SURFACE,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_DANGER,
  tsbEmbed,
  tsbFooter,
  fieldLine,
};
