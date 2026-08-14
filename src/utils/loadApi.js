const fs = require("fs");
const path = require("path");

/**
 * Obscura-style resolution:
 * 1) Vendored ./api for Discord command data (always available in this repo)
 * 2) Optional remote HTTP client when API_SERVER_URL is set (shared website API)
 * 3) Sibling NoNameBotAPI for local monorepo work
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
  if (process.env.API_SERVER_URL) {
    return require("./remoteApi");
  }

  for (const dir of candidates()) {
    const indexJs = path.join(dir, "index.js");
    if (fs.existsSync(indexJs)) return require(indexJs);
  }

  throw new Error(
    "Cannot find the API package. Expected vendored ./api inside the bot repo (Obscura-style)."
  );
}

module.exports = resolveApiModule();
