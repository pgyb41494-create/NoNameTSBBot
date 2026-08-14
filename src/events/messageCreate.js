const { brand } = require("../utils/loadApi");
const {
  resolveManagementKind,
  sweepIfManagementChannel,
  handleManagementDraft,
} = require("../systems/mgmtDraft");

module.exports = {
  async execute(message, client) {
    if (message.author.bot || !message.guild) return;

    const kind = resolveManagementKind(message.channel, message.guild.id);
    let draftHandled = false;

    if (kind) {
      const result = await handleManagementDraft(message);
      draftHandled = Boolean(result?.handled);
    }

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
          if (command?.executePrefix) await command.executePrefix(message, parts, client);
        }
      }
    }

    // Obscura-style: keep only the tips text block in management channels
    if (kind) {
      await sweepIfManagementChannel(message, message.guild.id, { delayMs: 900 });
    }
  },
};
