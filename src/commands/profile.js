const { SlashCommandBuilder } = require("discord.js");
const { handleProfileCommand, autocompleteProfileQuery } = require("../systems/profileUI");

module.exports = {
  name: "profile",
  slash: () =>
    new SlashCommandBuilder()
      .setName("profile")
      .setDescription("View or create your TSB profile")
      .addUserOption((o) => o.setName("user").setDescription("Discord user").setRequired(false))
      .addStringOption((o) =>
        o
          .setName("query")
          .setDescription("Roblox username, URL, profile code, or Discord ID")
          .setRequired(false)
          .setAutocomplete(true)
      ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused?.name !== "query") {
      return interaction.respond([]);
    }
    const choices = await autocompleteProfileQuery(interaction.guildId, focused.value);
    return interaction.respond(choices);
  },

  async executePrefix(message, args) {
    const payload = await handleProfileCommand({
      guild: message.guild,
      actor: message.author,
      member: message.member,
      targetUser: message.mentions.users.first() || null,
      query: args.filter((a) => !/^<@!?\d+>$/.test(a)).join(" "),
    });
    return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
  },

  async executeSlash(interaction) {
    const payload = await handleProfileCommand({
      guild: interaction.guild,
      actor: interaction.user,
      member: interaction.member,
      targetUser: interaction.options.getUser("user"),
      query: interaction.options.getString("query") || "",
    });
    return interaction.reply({ ...payload, ephemeral: false });
  },
};
