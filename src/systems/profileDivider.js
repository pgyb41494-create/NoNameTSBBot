const { AttachmentBuilder } = require("discord.js");

const DIVIDER_WIDTH = 560;
const DIVIDER_HEIGHT = 10;
const GIF_URL = "https://developers.oneway.lat/evidencias/asa_3_1.gif";

let cached = null;
let inflight = null;

async function buildProfileDivider() {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    let canvas;
    try {
      canvas = require("@napi-rs/canvas");
    } catch {
      return null;
    }

    const res = await fetch(GIF_URL).catch(() => null);
    if (!res?.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());

    const src = await canvas.loadImage(bytes).catch(() => null);
    if (!src) return null;

    const img = canvas.createCanvas(DIVIDER_WIDTH, DIVIDER_HEIGHT);
    const ctx = img.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, 0, 0, DIVIDER_WIDTH, DIVIDER_HEIGHT);
    const buffer = img.toBuffer("image/png");
    cached = buffer;
    return buffer;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

async function profileDividerAttachment() {
  const buffer = await buildProfileDivider();
  if (!buffer) return null;
  return new AttachmentBuilder(buffer, { name: "profile-divider.png" });
}

module.exports = {
  DIVIDER_WIDTH,
  buildProfileDivider,
  profileDividerAttachment,
};
