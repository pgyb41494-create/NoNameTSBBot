const { EmbedBuilder } = require("discord.js");
const { brand, authorName } = require("./loadApi");

function surface(options = {}) {
  const embed = new EmbedBuilder().setColor(options.color ?? brand.color);
  if (options.title) embed.setTitle(options.title);
  if (options.description) embed.setDescription(options.description);
  if (options.footer) embed.setFooter({ text: options.footer });
  else embed.setFooter({ text: authorName() });
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.image) embed.setImage(options.image);
  if (options.author !== false) {
    embed.setAuthor({ name: options.authorName || authorName() });
  }
  if (options.fields) embed.addFields(options.fields);
  if (options.timestamp !== false) embed.setTimestamp(new Date());
  return embed;
}

function danger(title, description) {
  return surface({ title, description, color: brand.danger });
}

function ok(title, description) {
  return surface({ title, description, color: brand.success });
}

module.exports = { surface, danger, ok, brand };
