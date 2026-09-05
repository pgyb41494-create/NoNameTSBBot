const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { danger } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");
const { startAdminProfileWizard } = require("../systems/profileUI");

function usage() {
  return "Use `/profile-create` with a Discord member and their Roblox username.";
}

module.exports = {
  name: "profilecreate",
  aliases: ["createprofile"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("profile-create")
      .setDescription("Admin: create a member profile (same setup flow, no bio verification)")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("Discord member who needs the profile")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("roblox")
          .setDescription("Roblox username or profile URL")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("display_name")
          .setDescription("Profile display name (optional)")
          .setRequired(false)
      ),

  async executePrefix(message, args) {
    if (!isAdminOrOwner(message.member, message.guild)) {
      return message.reply({
        embeds: [danger("Missing permissions", "Only server administrators can create profiles for other members.")],
        allowedMentions: { repliedUser: false },
      });
    }
    const targetUser = message.mentions.users.first();
    const robloxUsername = args.filter((arg) => !/^<@!?\d+>$/.test(arg))[0];
    if (!targetUser || !robloxUsername) {
      return message.reply({ content: usage(), allowedMentions: { repliedUser: false } });
    }
    try {
      const payload = await startAdminProfileWizard({
        guild: message.guild,
        actor: message.author,
        member: message.member,
        targetUser,
        robloxUsername,
        displayName: "",
      });
      return message.reply({
        ...payload,
        allowedMentions: { repliedUser: false },
      });
    } catch (err) {
      return message.reply({
        embeds: [danger("Could not create profile", err.message || "Profile creation failed.")],
        allowedMentions: { repliedUser: false },
      });
    }
  },

  async executeSlash(interaction) {
    if (!isAdminOrOwner(interaction.member, interaction.guild)) {
      return interaction.reply({
        embeds: [danger("Missing permissions", "Only server administrators can create profiles for other members.")],
        ephemeral: true,
      });
    }
    const targetUser = interaction.options.getUser("user", true);
    try {
      const payload = await startAdminProfileWizard({
        guild: interaction.guild,
        actor: interaction.user,
        member: interaction.member,
        targetUser,
        robloxUsername: interaction.options.getString("roblox", true),
        displayName: interaction.options.getString("display_name") || "",
      });
      return interaction.reply({
        ...payload,
        ephemeral: true,
      });
    } catch (err) {
      return interaction.reply({
        embeds: [danger("Could not create profile", err.message || "Profile creation failed.")],
        ephemeral: true,
      });
    }
  },
};
