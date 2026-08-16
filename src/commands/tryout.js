const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { patchTryoutSettings } = require("../systems/tsb/tryout/settings");
const {
  createTryout,
  closeSession,
  guildSessions,
  listPayload,
} = require("../systems/tsb/tryout/runtime");
const { isAdminOrOwner } = require("../utils/permissions");
const { hasAccessPerm } = require("../systems/tsb/access/store");

function canManage(member, guild) {
  if (isAdminOrOwner(member, guild || member?.guild)) return true;
  if (member && guild && hasAccessPerm(guild.id, member.id, "TRYOUTS")) return true;
  return member?.permissions?.has?.(PermissionFlagsBits.ManageMessages)
    || member?.permissions?.has?.(PermissionFlagsBits.Administrator);
}

module.exports = {
  name: "tryout",
  slash: () =>
    new SlashCommandBuilder()
      .setName("tryout")
      .setDescription("TSB tryout signups — create and manage sessions")
      .addSubcommand((sub) =>
        sub.setName("create").setDescription("Post a TSB tryout signup message")
          .addStringOption((o) => o.setName("link").setDescription("Roblox private server or join link").setRequired(true))
          .addIntegerOption((o) => o.setName("required_signups").setDescription("Signups needed before the link unlocks").setRequired(false).setMinValue(0))
          .addIntegerOption((o) => o.setName("max_signups").setDescription("Maximum players allowed to join").setRequired(false).setMinValue(1))
          .addRoleOption((o) => o.setName("ping_role").setDescription("Role to ping when signups are met").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub.setName("ping-role").setDescription("Set the default ping role for new tryouts")
          .addRoleOption((o) => o.setName("role").setDescription("Role to ping when ready (omit to clear)").setRequired(false))
      )
      .addSubcommand((sub) => sub.setName("list").setDescription("List active and ended tryouts"))
      .addSubcommand((sub) =>
        sub.setName("end").setDescription("End an active tryout")
          .addStringOption((o) => o.setName("token").setDescription("Tryout token").setRequired(false))
      ),

  async executePrefix(message, args) {
    if (!canManage(message.member, message.guild)) {
      return message.reply("You need **TRYOUTS** access, **Manage Messages**, or Administrator.");
    }
    return message.reply("Use `/tryout create|list|end` (or `'serversetup` → **Tryouts**).");
  },

  async executeSlash(interaction) {
    if (!canManage(interaction.member, interaction.guild)) {
      return interaction.reply({ content: "You need **TRYOUTS** access, **Manage Messages**, or Administrator.", ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === "create") {
      await interaction.deferReply({ ephemeral: true });
      return createTryout(interaction, {
        link: interaction.options.getString("link", true).trim(),
        requiredSignups: interaction.options.getInteger("required_signups"),
        maxSignups: interaction.options.getInteger("max_signups"),
        pingRoleId: interaction.options.getRole("ping_role")?.id || "",
      });
    }
    if (sub === "ping-role") {
      const role = interaction.options.getRole("role");
      patchTryoutSettings(interaction.guild.id, { pingRoleId: role?.id || "" });
      return interaction.reply({
        content: role ? `Default tryout ping role set to ${role}.` : "Default tryout ping role cleared.",
        ephemeral: true,
      });
    }
    if (sub === "end") {
      await interaction.deferReply({ ephemeral: true });
      const token = interaction.options.getString("token");
      if (token) {
        const session = guildSessions(interaction.guild.id).find((s) => s.token === token);
        if (!session) return interaction.editReply({ content: "Tryout not found. Use `/tryout list`." });
        if (session.ended) return interaction.editReply({ content: "That tryout is already closed." });
        await closeSession(interaction.client, token, interaction.user.id);
        return interaction.editReply({ content: `Ended TSB tryout \`${token}\`.` });
      }
      const { embed, components } = listPayload(guildSessions(interaction.guild.id));
      return interaction.editReply({
        content: "Select a tryout to end, or run `/tryout end token:<token>`.",
        embeds: [embed],
        components,
      });
    }
    const { embed, components } = listPayload(guildSessions(interaction.guild.id));
    return interaction.reply({ embeds: [embed], components, ephemeral: true });
  },
};
