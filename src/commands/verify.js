const { SlashCommandBuilder } = require("discord.js");
const { danger } = require("../utils/embeds");
const { panelPayload, canPostPanel, startVerification } = require("../systems/tsb/verify/runtime");

module.exports = {
  name: "verify",
  aliases: ["verification"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Start TSB verification, or post the panel if you are staff"),

  async executePrefix(message) {
    if (canPostPanel(message.member, message.guild)) {
      return message.reply(panelPayload());
    }
    return message.reply({
      embeds: [danger("Use the button", "Click **Start verification** on the panel, or ask staff to post `/verify`.")],
      allowedMentions: { repliedUser: false },
    });
  },

  async executeSlash(interaction) {
    if (canPostPanel(interaction.member, interaction.guild)) {
      await interaction.channel.send(panelPayload());
      return interaction.reply({ content: "Verification panel posted.", ephemeral: true });
    }
    return startVerification(interaction);
  },
};
