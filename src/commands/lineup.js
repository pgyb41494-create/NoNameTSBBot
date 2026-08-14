const { SlashCommandBuilder } = require("discord.js");
const api = require("../utils/loadApi");
const { surface, danger, ok } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");
const { publishLineup } = require("../systems/boardPublish");

module.exports = {
  name: "lineup",
  slash: () =>
    new SlashCommandBuilder()
      .setName("lineup")
      .setDescription("Manage regional lineups")
      .addSubcommand((sc) =>
        sc.setName("add")
          .setDescription("Add a player")
          .addStringOption((o) => o.setName("region").setDescription("na / eu / asia / west / east").setRequired(true))
          .addIntegerOption((o) => o.setName("position").setDescription("1-10").setRequired(true).setMinValue(1).setMaxValue(10))
          .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc.setName("remove")
          .setDescription("Clear a slot")
          .addStringOption((o) => o.setName("region").setDescription("na / eu / asia / west / east").setRequired(true))
          .addIntegerOption((o) => o.setName("position").setDescription("1-10").setRequired(true).setMinValue(1).setMaxValue(10))
      )
      .addSubcommand((sc) =>
        sc.setName("publish")
          .setDescription("Refresh lineup boards")
          .addStringOption((o) => o.setName("region").setDescription("Region or all").setRequired(false))
      )
      .addSubcommand((sc) => sc.setName("list").setDescription("List regions")),

  async executePrefix(message, args) {
    if (!isAdminOrOwner(message.member, message.guild)) {
      return message.reply({ embeds: [danger("Missing permissions", "Administrator only.")] });
    }
    const [sub, region, pos, userRaw] = args;
    if (!sub || sub === "list") {
      const cfg = api.lineup.getConfig(message.guild.id);
      const lines = Object.values(cfg.regions).map((r) => `**${r.label}** (\`${r.key}\`) · ${r.slots.filter((s) => s.discordId).length}/10`);
      return message.reply({ embeds: [surface({ title: "Lineups", description: lines.join("\n") || "None" })] });
    }
    if (sub === "publish") {
      await publishLineup(message.guild, region || null);
      return message.reply({ embeds: [ok("Published", "Lineup boards refreshed.")] });
    }
    if (sub === "add") {
      const user = message.mentions.users.first();
      if (!region || !pos || !user) return message.reply({ embeds: [danger("Usage", "`'lineup add na 1 @user`")] });
      api.lineup.setSlot(message.guild.id, region, "main", Number(pos), user.id);
      await publishLineup(message.guild, region).catch(() => {});
      return message.reply({ embeds: [ok("Lineup updated", `#${pos} ${user} on **${region}**`)] });
    }
    if (sub === "remove") {
      api.lineup.setSlot(message.guild.id, region, "main", Number(pos), null);
      await publishLineup(message.guild, region).catch(() => {});
      return message.reply({ embeds: [ok("Slot cleared", `#${pos} on **${region}**`)] });
    }
    return message.reply({ embeds: [danger("Usage", "`'lineup add|remove|publish|list`")] });
  },

  async executeSlash(interaction) {
    if (!isAdminOrOwner(interaction.member, interaction.guild)) {
      return interaction.reply({ embeds: [danger("Missing permissions", "Administrator only.")], ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === "list") {
      const cfg = api.lineup.getConfig(interaction.guildId);
      const lines = Object.values(cfg.regions).map((r) => `**${r.label}** (\`${r.key}\`) · ${r.slots.filter((s) => s.discordId).length}/10`);
      return interaction.reply({ embeds: [surface({ title: "Lineups", description: lines.join("\n") })] });
    }
    if (sub === "publish") {
      await publishLineup(interaction.guild, interaction.options.getString("region"));
      return interaction.reply({ embeds: [ok("Published", "Lineup boards refreshed.")] });
    }
    const region = interaction.options.getString("region");
    const position = interaction.options.getInteger("position");
    if (sub === "add") {
      const user = interaction.options.getUser("user");
      api.lineup.setSlot(interaction.guildId, region, "main", position, user.id);
      await publishLineup(interaction.guild, region).catch(() => {});
      return interaction.reply({ embeds: [ok("Lineup updated", `#${position} ${user}`)] });
    }
    api.lineup.setSlot(interaction.guildId, region, "main", position, null);
    await publishLineup(interaction.guild, region).catch(() => {});
    return interaction.reply({ embeds: [ok("Slot cleared", `#${position}`)] });
  },
};
