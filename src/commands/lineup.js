const { SlashCommandBuilder } = require("discord.js");
const {
  handleLineupPrefix,
  handleLineupSlash,
  autocompleteLineupRegion,
} = require("../systems/tsb/lineup/commands");

module.exports = {
  name: "lineup",
  slash: () =>
    new SlashCommandBuilder()
      .setName("lineup")
      .setDescription("Manage TSB regional lineups")
      .addSubcommand((sc) => sc.setName("list").setDescription("List lineup regions and fills"))
      .addSubcommand((sc) => sc.setName("add").setDescription("Add a player to a main lineup slot")
        .addStringOption((o) => o.setName("region").setDescription("Region key").setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName("position").setDescription("Slot").setRequired(true).setMinValue(1).setMaxValue(10))
        .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true)))
      .addSubcommand((sc) => sc.setName("replace").setDescription("Replace a main lineup slot")
        .addStringOption((o) => o.setName("region").setDescription("Region key").setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName("position").setDescription("Slot").setRequired(true).setMinValue(1).setMaxValue(10))
        .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true)))
      .addSubcommand((sc) => sc.setName("remove").setDescription("Clear a main lineup slot")
        .addStringOption((o) => o.setName("region").setDescription("Region key").setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName("position").setDescription("Slot").setRequired(true).setMinValue(1).setMaxValue(10)))
      .addSubcommandGroup((g) => g.setName("sub").setDescription("Sub lineup actions")
        .addSubcommand((sc) => sc.setName("add").setDescription("Add to sub lineup")
          .addStringOption((o) => o.setName("region").setDescription("Region key").setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName("position").setDescription("Slot").setRequired(true).setMinValue(1).setMaxValue(10))
          .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true)))
        .addSubcommand((sc) => sc.setName("replace").setDescription("Replace sub lineup slot")
          .addStringOption((o) => o.setName("region").setDescription("Region key").setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName("position").setDescription("Slot").setRequired(true).setMinValue(1).setMaxValue(10))
          .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true)))
        .addSubcommand((sc) => sc.setName("remove").setDescription("Clear sub lineup slot")
          .addStringOption((o) => o.setName("region").setDescription("Region key").setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName("position").setDescription("Slot").setRequired(true).setMinValue(1).setMaxValue(10))))
      .addSubcommand((sc) => sc.setName("publish").setDescription("Republish lineup boards")
        .addStringOption((o) => o.setName("region").setDescription("Region key or all").setRequired(true).setAutocomplete(true))),

  async executePrefix(message, args) {
    return handleLineupPrefix(message, args);
  },

  async executeSlash(interaction) {
    return handleLineupSlash(interaction);
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused?.name !== "region") return interaction.respond([]);
    const sub = interaction.options.getSubcommand(false);
    const choices = autocompleteLineupRegion(interaction.guildId, focused.value, sub);
    return interaction.respond(choices);
  },
};
