const fs = require("fs");
const path = require("path");

function tryRequire(id) {
  try {
    return require.resolve(id);
  } catch {
    return null;
  }
}

function candidates() {
  const botRoot = path.join(__dirname, "..", "..");
  const parent = path.join(botRoot, "..");
  return [
    process.env.API_PACKAGE,
    path.join(botRoot, "node_modules", "NoNameBotAPI"),
    path.join(parent, "NoNameBotAPI"),
    path.join(parent, "NoNameTSBAPI"),
    path.join(botRoot, "NoNameBotAPI"),
    path.join(botRoot, "api"),
  ].filter(Boolean);
}

function resolveApiModule() {
  const npmEntry = tryRequire("NoNameBotAPI");
  if (npmEntry) return require("NoNameBotAPI");

  for (const dir of candidates()) {
    const indexJs = path.join(dir, "src", "index.js");
    const rootJs = path.join(dir, "index.js");
    if (fs.existsSync(indexJs)) return require(indexJs);
    if (fs.existsSync(rootJs)) return require(rootJs);
  }

  throw new Error(
    "Cannot find the API package. On Railway, add dependency github:pgyb41494-create/NoNameTSBAPI or set API_PACKAGE to that folder."
  );
}

module.exports = resolveApiModule();
