const fs = require("fs");
const path = require("path");

function candidates() {
  const botRoot = path.join(__dirname, "..", "..");
  const parent = path.join(botRoot, "..");
  return [
    process.env.API_PACKAGE,
    path.join(parent, "NoNameBotAPI"),
    path.join(parent, "NoNameTSBAPI"),
    path.join(botRoot, "NoNameBotAPI"),
  ].filter(Boolean);
}

function resolveApiSrc() {
  for (const dir of candidates()) {
    const src = path.join(dir, "src", "index.js");
    if (fs.existsSync(src)) return path.join(dir, "src");
  }
  throw new Error(
    "Cannot find the API package. Clone NoNameTSBAPI next to this bot as NoNameBotAPI or NoNameTSBAPI, or set API_PACKAGE to that folder."
  );
}

module.exports = require(resolveApiSrc());
