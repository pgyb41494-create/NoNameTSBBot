const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

function ffmpegPath() {
  try {
    return require("ffmpeg-static");
  } catch {
    return null;
  }
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-400) || `ffmpeg exited ${code}`));
    });
  });
}

async function extractFrames(inputPath, count = 8) {
  const bin = ffmpegPath();
  if (!bin || !fs.existsSync(inputPath)) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asa-coach-"));
  const out = path.join(dir, "frame-%02d.jpg");
  try {
    await run(bin, [
      "-y",
      "-i",
      inputPath,
      "-vf",
      `fps=1/${Math.max(1, Math.floor(8 / count))},scale=640:-1`,
      "-frames:v",
      String(count),
      out,
    ]);
  } catch {
    try {
      await run(bin, ["-y", "-i", inputPath, "-vf", "fps=0.5,scale=640:-1", "-frames:v", String(count), out]);
    } catch {
      return [];
    }
  }
  const frames = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jpg"))
    .slice(0, count)
    .map((file) => ({
      mime: "image/jpeg",
      b64: fs.readFileSync(path.join(dir, file)).toString("base64"),
    }));
  fs.rmSync(dir, { recursive: true, force: true });
  return frames;
}

async function downloadToTemp(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download clip (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `asa-clip-${Date.now()}.mp4`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

module.exports = { extractFrames, downloadToTemp, ffmpegPath };
