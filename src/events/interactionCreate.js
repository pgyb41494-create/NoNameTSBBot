const { handleSetupInteraction } = require("../systems/setupHub");
const { handleProfileInteraction } = require("../systems/profileUI");

module.exports = {
  async execute(interaction, client) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.executeSlash) {
        return interaction.reply({ content: "Unknown command.", ephemeral: true });
      }
      return command.executeSlash(interaction, client);
    }

    if (await handleProfileInteraction(interaction)) return;
    if (await handleSetupInteraction(interaction)) return;
  },
};
