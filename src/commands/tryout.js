const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { patchTryoutSettings, getTryoutSettings } = require("../systems/tsb/tryout/settings");
const {
  createTryout,
  closeSession,
  guildSessions,
  listPayload,
  getSession,
} = require("../systems/tsb/tryout/runtime");
const { isAdminOrOwner } = require("../utils/permissions");
const { hasAccessPerm } = require("../systems/tsb/access/store");
const { tsbEmbed, COLOR_SUCCESS } = require("../systems/tsb/shared/embeds");

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
      .setDescription("Create and manage TSB tryout signups")
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("Post a tryout signup in the configured channel")
          .addStringOption((o) =>
            o.setName("link").setDescription("Private server / join link").setRequired(true)
          )
          .addStringOption((o) =>
            o.setName("title").setDescription("Optional title shown on the post").setRequired(false).setMaxLength(80)
          )
          .addStringOption((o) =>
            o.setName("note").setDescription("Optional note under the title").setRequired(false).setMaxLength(200)
          )
          .addIntegerOption((o) =>
            o
              .setName("required")
              .setDescription("Signups needed before the link unlocks (0 = always open)")
              .setRequired(false)
              .setMinValue(0)
              .setMaxValue(50)
          )
          .addIntegerOption((o) =>
            o
              .setName("max")
              .setDescription("Maximum signups (0 = unlimited)")
              .setRequired(false)
              .setMinValue(0)
              .setMaxValue(50)
          )
          .addRoleOption((o) =>
            o.setName("ping").setDescription("Role to ping when the link unlocks").setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("List active and recently ended tryouts")
      )
      .addSubcommand((sub) =>
        sub
          .setName("end")
          .setDescription("End an active tryout")
          .addStringOption((o) =>
            o.setName("token").setDescription("Tryout token from the post footer").setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("ping")
          .setDescription("Set the default ready-ping role for new tryouts")
          .addRoleOption((o) =>
            o.setName("role").setDescription("Role to ping when ready (omit to clear)").setRequired(false)
          )
      ),

  async executePrefix(message) {
    if (!canManage(message.member, message.guild)) {
      return message.reply("You need **TRYOUTS** access, **Manage Messages**, or Administrator.");
    }
    return message.reply("Use `/tryout create` · `/tryout list` · `/tryout end` (or `'setup` → **Tryouts**).");
  },

  async executeSlash(interaction) {
    if (!canManage(interaction.member, interaction.guild)) {
      return interaction.reply({
        content: "You need **TRYOUTS** access, **Manage Messages**, or Administrator.",
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "create") {
      await interaction.deferReply({ ephemeral: true });
      return createTryout(interaction, {
        link: interaction.options.getString("link", true).trim(),
        title: interaction.options.getString("title")?.trim() || "",
        note: interaction.options.getString("note")?.trim() || "",
        requiredSignups: interaction.options.getInteger("required"),
        maxSignups: interaction.options.getInteger("max"),
        pingRoleId: interaction.options.getRole("ping")?.id || "",
      });
    }

    if (sub === "ping") {
      const role = interaction.options.getRole("role");
      await patchTryoutSettings(interaction.guild.id, { pingRoleId: role?.id || "" });
      return interaction.reply({
        embeds: [
          tsbEmbed({
            title: "Tryout ping role",
            description: role
              ? `New tryouts will ping ${role} when the link unlocks.`
              : "Default ready ping cleared.",
            color: COLOR_SUCCESS,
            footer: "Ascendant · tryouts",
          }),
        ],
        ephemeral: true,
      });
    }

    if (sub === "end") {
      await interaction.deferReply({ ephemeral: true });
      const token = interaction.options.getString("token")?.trim();
      if (token) {
        const session = await getSession(token, interaction.guild.id);
        if (!session || session.guildId !== interaction.guild.id) {
          return interaction.editReply({ content: "Tryout not found. Use `/tryout list`." });
        }
        if (session.ended) {
          return interaction.editReply({ content: "That tryout is already closed." });
        }
        await closeSession(interaction.client, token, interaction.user.id);
        return interaction.editReply({
          content: `Ended **${session.title || "tryout"}** (\`${token}\`).`,
        });
      }
      const sessions = await guildSessions(interaction.guild.id);
      const { embed, components } = listPayload(sessions);
      return interaction.editReply({
        content: sessions.some((s) => !s.ended)
          ? "Pick a tryout to end:"
          : "No active tryouts to end.",
        embeds: [embed],
        components,
      });
    }

    // list
    const settings = await getTryoutSettings(interaction.guild.id);
    const sessions = await guildSessions(interaction.guild.id);
    const { embed, components } = listPayload(sessions);
    if (!settings.configured) {
      embed.setDescription(
        `${embed.data.description || ""}\n\n_Tryout channel not set — configure in_ \`'setup\` → **Tryouts**.`.trim()
      );
    }
    return interaction.reply({
      embeds: [embed],
      components,
      ephemeral: true,
    });
  },
};
