const { brand } = require("../utils/loadApi");
const { handleLeaderboardDraftMessage } = require("../systems/tsb/leaderboard/draft");
const { handleLineupDraftMessage } = require("../systems/tsb/lineup/draft");
const {
  resolveManagementKind,
  sweepIfManagementChannel,
} = require("../systems/tsb/shared/mgmtCleaner");

module.exports = {
  async execute(message, client) {
    if (message.author.bot || !message.guild) return;

    let draftHandled = false;
    if (await handleLineupDraftMessage(message)) draftHandled = true;
    else if (await handleLeaderboardDraftMessage(message)) draftHandled = true;

    if (!draftHandled) {
      if (message.mentions.has(client.user) && message.content.trim() === `<@${client.user.id}>`) {
        const help = client.commands.get("help");
        if (help) await help.executePrefix(message, [], client);
      } else {
        const prefix = brand.prefix;
        if (message.content.startsWith(prefix)) {
          const parts = message.content.slice(prefix.length).trim().split(/\s+/);
          const name = (parts.shift() || "").toLowerCase();
          const command = client.commands.get(name);
          if (command?.executePrefix) {
            try {
              await command.executePrefix(message, parts, client);
            } catch (err) {
              console.error(`prefix ${name}:`, err);
              await message.reply({ content: "That command failed." }).catch(() => {});
            }
          }
        }
      }
    }

    if (resolveManagementKind(message, message.guild.id)) {
      await sweepIfManagementChannel(message, message.guild.id, { delayMs: 900 });
    }
  },
};
