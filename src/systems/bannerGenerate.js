const fs = require("fs");
const path = require("path");

let canvasMod = null;
let fontReady = false;

function loadCanvas() {
  if (canvasMod) return canvasMod;
  try {
    canvasMod = require("@napi-rs/canvas");
  } catch {
    canvasMod = null;
  }
  return canvasMod;
}

function ensureFont(canvas) {
  if (fontReady || !canvas?.GlobalFonts) return;
  const candidates = [
    path.join(__dirname, "..", "..", "assets", "fonts", "PlayfairDisplay.ttf"),
    path.join(__dirname, "..", "..", "assets", "fonts", "PlayfairDisplay-Bold.ttf"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        canvas.GlobalFonts.registerFromPath(file, "LeaderboardSerif");
        fontReady = true;
        return;
      } catch {
        // try next
      }
    }
  }
}

/**
 * Metallic chrome-style banner: "{SERVER NAME}" over "LEADERBOARD".
 * Returns a PNG Buffer, or null if canvas is unavailable.
 */
async function generateLeaderboardBanner(serverName) {
  const canvas = loadCanvas();
  if (!canvas) return null;
  ensureFont(canvas);

  const width = 1200;
  const height = 420;
  const c = canvas.createCanvas(width, height);
  const ctx = c.getContext("2d");

  // Black field + soft haze
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  const haze = ctx.createRadialGradient(width / 2, height / 2, 20, width / 2, height / 2, 380);
  haze.addColorStop(0, "rgba(180,190,210,0.22)");
  haze.addColorStop(0.45, "rgba(120,130,150,0.08)");
  haze.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, width, height);

  const title = String(serverName || "SERVER")
    .replace(/[^\w\s\-_.']/g, "")
    .trim()
    .toUpperCase()
    .slice(0, 28) || "SERVER";
  const subtitle = "LEADERBOARD";

  function fitFont(text, maxPx, minPx, maxWidth) {
    let size = maxPx;
    while (size > minPx) {
      ctx.font = `700 ${size}px LeaderboardSerif, serif`;
      if (ctx.measureText(text).width <= maxWidth) return size;
      size -= 2;
    }
    return minPx;
  }

  function drawMetallic(text, y, size) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${size}px LeaderboardSerif, serif`;

    // Outer glow
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.85)";
    ctx.shadowBlur = 28;
    ctx.fillStyle = "#f5f7fa";
    ctx.fillText(text, width / 2, y);
    ctx.restore();

    // Soft bloom pass
    ctx.save();
    ctx.shadowColor = "rgba(220,230,255,0.55)";
    ctx.shadowBlur = 48;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText(text, width / 2, y);
    ctx.restore();

    // Bevel / chrome body
    const grad = ctx.createLinearGradient(width / 2, y - size * 0.55, width / 2, y + size * 0.55);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.28, "#d8dde6");
    grad.addColorStop(0.55, "#8b93a3");
    grad.addColorStop(0.78, "#c5ccd8");
    grad.addColorStop(1, "#6e7686");
    ctx.fillStyle = grad;
    ctx.fillText(text, width / 2, y);

    // Top highlight edge
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(1, size * 0.02);
    ctx.strokeText(text, width / 2, y - 1);
  }

  const titleSize = fitFont(title, 118, 42, width - 80);
  const subSize = fitFont(subtitle, Math.min(64, titleSize * 0.52), 28, width - 100);
  drawMetallic(title, height * 0.42, titleSize);
  drawMetallic(subtitle, height * 0.68, subSize);

  return c.toBuffer("image/png");
}

module.exports = { generateLeaderboardBanner };
