const { SlashCommandBuilder } = require("discord.js");
const api = require("../utils/loadApi");
const { surface, danger } = require("../utils/embeds");
const { extractFrames, downloadToTemp } = require("../utils/frames");
const fs = require("fs");

function findVideo(interactionOrMessage) {
  const fromSlash = interactionOrMessage.options?.getAttachment?.("video");
  if (fromSlash) return { url: fromSlash.url, name: fromSlash.name };
  const attachments = interactionOrMessage.attachments
    ? [...interactionOrMessage.attachments.values()]
    : [];
  const video = attachments.find((a) =>
    String(a.contentType || a.name || "").match(/video|mp4|webm|mov/i)
  );
  if (video) return { url: video.url, name: video.name };
  return null;
}

async function runCoach({ guildId, userId, videoUrl, link }) {
  let frames = [];
  let tmp = null;
  const source = videoUrl || link;
  try {
    if (source && /\.(mp4|webm|mov)(\?|$)/i.test(source)) {
      tmp = await downloadToTemp(source);
      frames = await extractFrames(tmp, 8);
    }
  } catch (err) {
    console.warn("Frame extract failed:", err.message);
  } finally {
    if (tmp) try { fs.unlinkSync(tmp); } catch {}
  }

  return api.coach.reviewClip({
    guildId,
    discordId: userId,
    videoUrl: source || null,
    frames,
  });
}

async function respond(result) {
  if (!result.ok) {
    return { embeds: [danger("TSB AI Coach", result.message)] };
  }
  const title = result.verified ? "TSB AI Coach" : "Identity not confirmed";
  const body = result.review.length > 3900 ? `${result.review.slice(0, 3900)}…` : result.review;
  return {
    embeds: [
      surface({
        title,
        description: body,
        thumbnail: result.profile?.avatarUrl,
      }),
    ],
  };
}

module.exports = {
  name: "tsbcoach",
  aliases: ["coach", "vod"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("tsbcoach")
      .setDescription("Upload a TSB clip for AI coaching (username + avatar must match /profile)")
      .addAttachmentOption((o) => o.setName("video").setDescription("Gameplay video").setRequired(false))
      .addStringOption((o) => o.setName("url").setDescription("Medal / YouTube / Discord video link").setRequired(false)),

  async executePrefix(message, args) {
    const video = findVideo(message);
    const link = args[0] || null;
    if (!video && !link) {
      return message.reply({
        embeds: [danger("Need a clip", "Attach a video or paste a link: `'tsbcoach <url>`")],
      });
    }
    const pending = await message.reply({
      embeds: [surface({ title: "Watching clip…", description: "Checking `/profile` identity, then reviewing the vod." })],
    });
    try {
      const result = await runCoach({
        guildId: message.guild.id,
        userId: message.author.id,
        videoUrl: video?.url,
        link,
      });
      return pending.edit(await respond(result));
    } catch (err) {
      return pending.edit({ embeds: [danger("Coach failed", err.message)] });
    }
  },

  async executeSlash(interaction) {
    const video = findVideo(interaction);
    const link = interaction.options.getString("url");
    if (!video && !link) {
      return interaction.reply({
        embeds: [danger("Need a clip", "Upload a video or paste a url.")],
        ephemeral: true,
      });
    }
    await interaction.deferReply();
    try {
      const result = await runCoach({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        videoUrl: video?.url,
        link,
      });
      return interaction.editReply(await respond(result));
    } catch (err) {
      return interaction.editReply({ embeds: [danger("Coach failed", err.message)] });
    }
  },
};
