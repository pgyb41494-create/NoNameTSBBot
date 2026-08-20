const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { danger, ok } = require("../utils/embeds");
const { hasMod } = require("../utils/permissions");

module.exports = {
  name: "purge",
  aliases: ["clear"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("purge")
      .setDescription("Bulk delete messages")
      .addIntegerOption((o) => o.setName("amount").setDescription("1-100").setRequired(true).setMinValue(1).setMaxValue(100))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async executePrefix(message, args) {
    if (!hasMod(message.member, PermissionFlagsBits.ManageMessages)) {
      return message.reply({ embeds: [danger("Missing permissions", "Need **Manage Messages**.")] });
    }
    const n = Math.min(100, Math.max(1, Number(args[0]) || 0));
    if (!n) return message.reply({ embeds: [danger("Usage", "`'purge 10`")] });
    try {
      await message.delete().catch(() => {});
      const deleted = await message.channel.bulkDelete(n, true);
      const reply = await message.channel.send({ embeds: [ok("Purged", `Deleted ${deleted.size} messages.`)] });
      setTimeout(() => reply.delete().catch(() => {}), 4000);
    } catch (err) {
      return message.reply({ embeds: [danger("Failed", err.message)] });
    }
  },

  async executeSlash(interaction) {
    const n = interaction.options.getInteger("amount");
    try {
      const deleted = await interaction.channel.bulkDelete(n, true);
      return interaction.reply({ embeds: [ok("Purged", `Deleted ${deleted.size} messages.`)], ephemeral: true });
    } catch (err) {
      return interaction.reply({ embeds: [danger("Failed", err.message)], ephemeral: true });
    }
  },
};
