const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const api = require("../utils/loadApi");
const { surface, danger, ok } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");

module.exports = {
  name: "trainer",
  aliases: ["trainers"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("trainer")
      .setDescription("Manage website trainers")
      .addSubcommand((sc) =>
        sc.setName("add")
          .setDescription("Add a trainer")
          .addUserOption((o) => o.setName("user").setRequired(true))
          .addStringOption((o) => o.setName("specialty").setDescription("e.g. Garou, movement").setRequired(false))
          .addStringOption((o) => o.setName("role").setDescription("Head trainer / Trainer").setRequired(false))
      )
      .addSubcommand((sc) => sc.setName("remove").setDescription("Remove").addUserOption((o) => o.setName("user").setRequired(true)))
      .addSubcommand((sc) => sc.setName("list").setDescription("List trainers"))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async executePrefix(message, args) {
    if (!isAdminOrOwner(message.member, message.guild)) {
      return message.reply({ embeds: [danger("Missing permissions", "Administrator only.")] });
    }
    const [sub] = args;
    if (sub === "list" || !sub) {
      const list = api.trainers.getList(message.guild.id);
      const lines = list.trainers.map((t) => `<@${t.discordId}> · ${t.role} · ${t.specialty}`).join("\n") || "None yet";
      return message.reply({ embeds: [surface({ title: "Trainers", description: lines })] });
    }
    const user = message.mentions.users.first();
    if (!user) return message.reply({ embeds: [danger("Usage", "`'trainer add @user specialty`")] });
    if (sub === "remove") {
      api.trainers.remove(message.guild.id, user.id);
      return message.reply({ embeds: [ok("Removed", `${user}`)] });
    }
    api.trainers.upsert(message.guild.id, {
      discordId: user.id,
      specialty: args.filter((a) => !a.startsWith("<@") && a !== "add").join(" ") || "General",
      role: "Trainer",
      addedBy: message.author.id,
    });
    return message.reply({ embeds: [ok("Trainer added", `${user} is on the website Trainers tab.`)] });
  },

  async executeSlash(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "list") {
      const list = api.trainers.getList(interaction.guildId);
      const lines = list.trainers.map((t) => `<@${t.discordId}> · ${t.role} · ${t.specialty}`).join("\n") || "None yet";
      return interaction.reply({ embeds: [surface({ title: "Trainers", description: lines })] });
    }
    const user = interaction.options.getUser("user");
    if (sub === "remove") {
      api.trainers.remove(interaction.guildId, user.id);
      return interaction.reply({ embeds: [ok("Removed", `${user}`)] });
    }
    api.trainers.upsert(interaction.guildId, {
      discordId: user.id,
      specialty: interaction.options.getString("specialty") || "General",
      role: interaction.options.getString("role") || "Trainer",
      addedBy: interaction.user.id,
    });
    return interaction.reply({ embeds: [ok("Trainer added", `${user}`)] });
  },
};
