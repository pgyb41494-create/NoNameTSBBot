const { SlashCommandBuilder, ChannelType } = require("discord.js");
const { danger } = require("../utils/embeds");
const { canPostPanel, startVerification, upsertPanel } = require("../systems/tsb/verify/runtime");

async function postPanel(channel, guild) {
  try {
    await upsertPanel(channel, guild);
    return `Verification panel posted in ${channel}.`;
  } catch (err) {
    return `Couldn't post in ${channel}: ${err.message || "check my permissions there"}.`;
  }
}

module.exports = {
  name: "verify",
  aliases: ["verification"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Start verification, or post the panel if you are staff")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Staff: channel to post the panel in (default: here)")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      ),

  async executePrefix(message) {
    if (canPostPanel(message.member, message.guild)) {
      const target = message.mentions.channels.first() || message.channel;
      const content = await postPanel(target, message.guild);
      return message.reply({ content, allowedMentions: { repliedUser: false } }).catch(() => {});
    }
    return message.reply({
      embeds: [danger("Use the button", "Press **Verify** on the verification panel.")],
      allowedMentions: { repliedUser: false },
    });
  },

  async executeSlash(interaction) {
    if (canPostPanel(interaction.member, interaction.guild)) {
      await interaction.deferReply({ ephemeral: true });
      const target = interaction.options.getChannel("channel") || interaction.channel;
      return interaction.editReply({ content: await postPanel(target, interaction.guild) });
    }
    return startVerification(interaction);
  },
};
