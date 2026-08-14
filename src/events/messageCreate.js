const { brand } = require("../utils/loadApi");
const { handleDraftMessage } = require("../systems/setupHub");

module.exports = {
  async execute(message, client) {
    if (message.author.bot || !message.guild) return;

    if (await handleDraftMessage(message)) return;

    if (message.mentions.has(client.user) && message.content.trim() === `<@${client.user.id}>`) {
      const help = client.commands.get("help");
      if (help) return help.executePrefix(message, [], client);
    }

    const prefix = brand.prefix;
    if (!message.content.startsWith(prefix)) return;

    const parts = message.content.slice(prefix.length).trim().split(/\s+/);
    const name = (parts.shift() || "").toLowerCase();
    const command = client.commands.get(name);
    if (!command?.executePrefix) return;
    return command.executePrefix(message, parts, client);
  },
};
