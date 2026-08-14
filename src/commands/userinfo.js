const { SlashCommandBuilder } = require("discord.js");
const { surface, danger } = require("../utils/embeds");

module.exports = {
  name: "userinfo",
  slash: () =>
    new SlashCommandBuilder()
      .setName("userinfo")
      .setDescription("Show a user")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(false)),

  async executePrefix(message, args) {
    const user = message.mentions.users.first() || (args[0] ? await message.client.users.fetch(args[0]).catch(() => null) : message.author);
    if (!user) return message.reply({ embeds: [danger("Not found", "User not found.")] });
    return message.reply({ embeds: [await build(message.guild, user)] });
  },

  async executeSlash(interaction) {
    const user = interaction.options.getUser("user") || interaction.user;
    return interaction.reply({ embeds: [await build(interaction.guild, user)] });
  },
};

async function build(guild, user) {
  const member = await guild.members.fetch(user.id).catch(() => null);
  const roles = member
    ? member.roles.cache.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position).map((r) => r.toString()).slice(0, 20)
    : [];
  return surface({
    title: user.tag,
    thumbnail: user.displayAvatarURL({ size: 256 }),
    fields: [
      { name: "ID", value: user.id, inline: true },
      { name: "Bot", value: user.bot ? "Yes" : "No", inline: true },
      { name: "Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: "Joined", value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "—", inline: true },
      { name: "Roles", value: roles.join(" ") || "None", inline: false },
    ],
  });
}
