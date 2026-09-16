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

/**
 * Dark gothic roster banner — white serif title over black field.
 * Returns a PNG Buffer, or null if canvas is unavailable.
 */
async function generateVoidRosterBanner(titleText) {
  const canvas = loadCanvas();
  if (!canvas) return null;
  ensureFont(canvas);

  const width = 1200;
  const height = 360;
  const c = canvas.createCanvas(width, height);
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(width / 2, height / 2, 40, width / 2, height / 2, 520);
  vignette.addColorStop(0, "rgba(40,40,48,0.55)");
  vignette.addColorStop(0.55, "rgba(10,10,12,0.2)");
  vignette.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  // faint diagonal scratch lines
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let i = -height; i < width + height; i += 28) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + height, height);
    ctx.stroke();
  }
  ctx.restore();

  const title = String(titleText || "ROSTER")
    .replace(/[^\w\s\-_.']/g, "")
    .trim()
    .toUpperCase()
    .slice(0, 32) || "ROSTER";

  function fitFont(text, maxPx, minPx, maxWidth) {
    let size = maxPx;
    while (size > minPx) {
      ctx.font = `700 ${size}px LeaderboardSerif, serif`;
      if (ctx.measureText(text).width <= maxWidth) return size;
      size -= 2;
    }
    return minPx;
  }

  const size = fitFont(title, 96, 36, width - 100);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${size}px LeaderboardSerif, serif`;

  ctx.save();
  ctx.shadowColor = "rgba(255,255,255,0.35)";
  ctx.shadowBlur = 22;
  ctx.fillStyle = "#f2f2f2";
  ctx.fillText(title, width / 2, height * 0.48);
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = Math.max(1, size * 0.018);
  ctx.strokeText(title, width / 2, height * 0.48);

  // underline rule
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width * 0.28, height * 0.72);
  ctx.lineTo(width * 0.72, height * 0.72);
  ctx.stroke();

  return c.toBuffer("image/png");
}

module.exports = { generateLeaderboardBanner, generateVoidRosterBanner };
