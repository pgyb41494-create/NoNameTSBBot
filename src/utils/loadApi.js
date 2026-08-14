const fs = require("fs");
const path = require("path");

/**
 * Resolve the data/API package the same way Obscura keeps Discord + API linked:
 * 1) Vendored ./api in this bot repo (default — works alone on Railway)
 * 2) Optional remote HTTP client when EMBED_API=0 and API_SERVER_URL is set
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
  if (process.env.API_SERVER_URL && process.env.EMBED_API === "0") {
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
