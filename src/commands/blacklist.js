const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const api = require("../utils/loadApi");
const { surface, danger, ok } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");

module.exports = {
  name: "blacklist",
  slash: () =>
    new SlashCommandBuilder()
      .setName("blacklist")
      .setDescription("Manage the website blacklist")
      .addSubcommand((sc) =>
        sc.setName("add")
          .setDescription("Add a user")
          .addUserOption((o) => o.setName("user").setDescription("User to blacklist").setRequired(true))
          .addStringOption((o) => o.setName("reason").setDescription("Sanction reason").setRequired(true))
      )
      .addSubcommand((sc) =>
        sc
          .setName("remove")
          .setDescription("Remove a user")
          .addUserOption((o) => o.setName("user").setDescription("User to remove").setRequired(true))
      )
      .addSubcommand((sc) => sc.setName("list").setDescription("Show blacklist"))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async executePrefix(message, args) {
    if (!isAdminOrOwner(message.member, message.guild)) {
      return message.reply({ embeds: [danger("Missing permissions", "Administrator only.")] });
    }
    const [sub] = args;
    if (sub === "list" || !sub) {
      const list = api.blacklist.getList(message.guild.id);
      const lines = list.entries.map((e) => `<@${e.discordId}> — ${e.reason}`).join("\n") || "Empty";
      return message.reply({ embeds: [surface({ title: "Blacklist", description: lines })] });
    }
    const user = message.mentions.users.first();
    if (!user) return message.reply({ embeds: [danger("Usage", "`'blacklist add @user reason`")] });
    if (sub === "remove") {
      api.blacklist.removeEntry(message.guild.id, user.id);
      return message.reply({ embeds: [ok("Removed", `${user} is off the blacklist.`)] });
    }
    const profile = api.profiles.getProfile(message.guild.id, user.id);
    api.blacklist.addEntry(message.guild.id, {
      discordId: user.id,
      robloxUsername: profile?.roblox_username,
      reason: args.slice(1).filter((a) => !a.startsWith("<@")).join(" ") || "No reason provided",
      addedBy: message.author.id,
    });
    return message.reply({ embeds: [ok("Blacklisted", `${user} will show on the website.`)] });
  },

  async executeSlash(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "list") {
      const list = api.blacklist.getList(interaction.guildId);
      const lines = list.entries.map((e) => `<@${e.discordId}> — ${e.reason}`).join("\n") || "Empty";
      return interaction.reply({ embeds: [surface({ title: "Blacklist", description: lines })] });
    }
    const user = interaction.options.getUser("user");
    if (sub === "remove") {
      api.blacklist.removeEntry(interaction.guildId, user.id);
      return interaction.reply({ embeds: [ok("Removed", `${user}`)] });
    }
    const profile = api.profiles.getProfile(interaction.guildId, user.id);
    api.blacklist.addEntry(interaction.guildId, {
      discordId: user.id,
      robloxUsername: profile?.roblox_username,
      reason: interaction.options.getString("reason"),
      addedBy: interaction.user.id,
    });
    return interaction.reply({ embeds: [ok("Blacklisted", `${user}`)] });
  },
};
