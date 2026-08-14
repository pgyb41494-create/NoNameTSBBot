const { SlashCommandBuilder } = require("discord.js");
const { surface } = require("../utils/embeds");

module.exports = {
  name: "serverinfo",
  slash: () => new SlashCommandBuilder().setName("serverinfo").setDescription("Show this server"),

  async executePrefix(message) {
    return message.reply({ embeds: [build(message.guild)] });
  },
  async executeSlash(interaction) {
    return interaction.reply({ embeds: [build(interaction.guild)] });
  },
};

function build(guild) {
  const text = guild.channels.cache.filter((c) => c.type === 0).size;
  const voice = guild.channels.cache.filter((c) => c.type === 2).size;
  return surface({
    title: guild.name,
    thumbnail: guild.iconURL({ size: 256 }),
    fields: [
      { name: "Owner", value: `<@${guild.ownerId}>`, inline: true },
      { name: "Members", value: String(guild.memberCount), inline: true },
      { name: "Roles", value: String(guild.roles.cache.size), inline: true },
      { name: "Text", value: String(text), inline: true },
      { name: "Voice", value: String(voice), inline: true },
      { name: "Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
      { name: "ID", value: guild.id, inline: false },
    ],
  });
}
