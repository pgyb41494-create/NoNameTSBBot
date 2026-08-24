const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { homePayload, canSetup } = require("../systems/tsb/tickets/runtime");

function denied() {
  return { content: "You need **Manage Server** to set up tickets.", ephemeral: true };
}

module.exports = {
  name: "ticketsetup",
  aliases: ["ticketsetup", "tickets"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("ticketsetup")
      .setDescription("Create and publish ticket panels (channel, staff, buttons or menu)")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async executePrefix(message) {
    if (!canSetup(message.member)) {
      return message.reply({ content: "You need **Manage Server** to set up tickets." });
    }
    return message.reply(homePayload(message.guild.id));
  },

  async executeSlash(interaction) {
    if (!canSetup(interaction.member)) {
      return interaction.reply(denied());
    }
    return interaction.reply({ ...homePayload(interaction.guild.id), ephemeral: true });
  },
};
