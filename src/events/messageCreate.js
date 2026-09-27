const { brand } = require("../utils/loadApi");
const { handleLeaderboardDraftMessage } = require("../systems/tsb/leaderboard/draft");
const { handleLineupDraftMessage } = require("../systems/tsb/lineup/draft");
const {
  resolveManagementKind,
  sweepIfManagementChannel,
} = require("../systems/tsb/shared/mgmtCleaner");

async function tryDraft(handler, message, label) {
  try {
    return await handler(message);
  } catch (err) {
    if (err?.code === "API_UNREACHABLE") console.warn(`${label} draft skipped:`, err.message);
    else console.error(`${label} draft error:`, err);
    return false;
  }
}

module.exports = {
  async execute(message, client) {
    if (message.author.bot || !message.guild) return;

    let draftHandled = false;
    if (await tryDraft(handleLineupDraftMessage, message, "lineup")) draftHandled = true;
    else if (await tryDraft(handleLeaderboardDraftMessage, message, "leaderboard")) draftHandled = true;

    if (!draftHandled) {
      if (message.mentions.has(client.user) && message.content.trim() === `<@${client.user.id}>`) {
        const help = client.commands.get("help");
        if (help) await help.executePrefix(message, [], client).catch(() => {});
      } else {
        const prefix = brand.prefix;
        if (message.content.startsWith(prefix)) {
          const body = message.content.slice(prefix.length).trim();
          if (!body) return;

          const parts = body.split(/\s+/);
          const name = (parts.shift() || "").toLowerCase();
          if (!name) return;

          let command = client.commands.get(name);
          if (!command?.executePrefix) {
            try {
              const { rankingCommandMatches } = require("../systems/tsb/ranking/config");
              if (await rankingCommandMatches(message.guild.id, name)) {
                command = client.commands.get("stage");
              }
            } catch {}
          }
          if (command?.executePrefix) {
            try {
              await command.executePrefix(message, parts, client);
            } catch (err) {
              const unreachable = err?.code === "API_UNREACHABLE";
              if (unreachable) console.warn(`prefix ${name}:`, err.message);
              else console.error(`prefix ${name}:`, err);
              await message
                .reply({
                  content: unreachable
                    ? "Couldn't reach the Ascendant API just now. Try again in a few seconds."
                    : "That command failed.",
                  allowedMentions: { repliedUser: false },
                })
                .catch(() => {});
            }
          }
        }
      }
    }

    try {
      const resolved = await resolveManagementKind(message, message.guild.id);
      if (resolved) {
        await sweepIfManagementChannel(message, message.guild.id, { delayMs: 900, resolved });
      }
    } catch (err) {
      console.warn("mgmt sweep failed:", err?.message || err);
    }
  },
};
