const fs = require("fs");
const path = require("path");

function remoteApiUrl() {
  return String(process.env.API_SERVER_URL || process.env.API_URL || process.env.ASCENDANT_API_URL || "")
    .trim()
    .replace(/\/$/, "");
}

/**
 * Shared clan data lives on the website API.
 * 1) Remote HTTP when API_SERVER_URL is set (Railway bot → Railway API)
 * 2) Vendored ./api only as a local fallback
 */
function candidates() {
  const botRoot = path.join(__dirname, "..", "..");
  const parent = path.join(botRoot, "..");
  return [
    path.join(botRoot, "api"),
    process.env.API_PACKAGE,
    path.join(parent, "NoNameBotAPI"),
    path.join(parent, "NoNameTSBAPI"),
    path.join(botRoot, "NoNameBotAPI"),
  ].filter(Boolean);
}

function resolveApiModule() {
  const remote = remoteApiUrl();
  if (remote) {
    process.env.API_SERVER_URL = remote;
    console.log(`[api] source of truth: remote ${remote}`);
    return require("./remoteApi");
  }

  console.warn(
    "[api] API_SERVER_URL is not set — using local JSON. Set it on the bot service so Discord and the website share one store."
  );

  for (const dir of candidates()) {
    const indexJs = path.join(dir, "index.js");
    if (fs.existsSync(indexJs)) return require(indexJs);
  }

  throw new Error(
    "Cannot find the API package. Expected vendored ./api inside the bot repo, or API_SERVER_URL."
  );
}

module.exports = resolveApiModule();
