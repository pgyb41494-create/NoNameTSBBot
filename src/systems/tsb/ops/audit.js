const { EmbedBuilder } = require("discord.js");
const { publicAudit } = require("./store");
const { COLOR_SURFACE } = require("../shared/embeds");

async function postAudit(guild, { title, description, color, fields, user } = {}) {
  if (!guild) return;
  const { channelId } = publicAudit(guild.id);
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const embed = new EmbedBuilder()
    .setColor(color ?? COLOR_SURFACE)
    .setTitle(String(title || "Audit").slice(0, 256))
    .setTimestamp(new Date());
  if (description) embed.setDescription(String(description).slice(0, 4000));
  if (Array.isArray(fields) && fields.length) embed.addFields(fields.slice(0, 8));
  if (user) {
    embed.setFooter({
      text: user.username || user.tag || String(user.id),
      iconURL: user.displayAvatarURL?.({ size: 32 }) || undefined,
    });
  }
  await channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { postAudit };
