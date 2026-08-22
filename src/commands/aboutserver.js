const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { isAdminOrOwner } = require("../systems/tsb/shared/permissions");
const { danger, ok } = require("../utils/embeds");
const { tsbEmbed, COLOR_PRIMARY } = require("../systems/tsb/shared/embeds");
const { updateConfig, safeUrl } = require("../systems/tsb/aboutserver/store");
const {
  postOrEdit,
  refreshPosted,
  openEditor,
  editorPayload,
  varsHelp,
} = require("../systems/tsb/aboutserver/runtime");

function denied() {
  return { embeds: [danger("Missing permissions", "You need **Administrator** to use About server.")] };
}

function usage() {
  const p = "'";
  return tsbEmbed({
    title: "About server",
    color: COLOR_PRIMARY,
    description: [
      `Post a Components v2 card (GIF on top + text with variables).`,
      "",
      `\`${p}aboutserver\` — editor`,
      `\`${p}aboutserver post\` — post / update in this channel`,
      `\`${p}aboutserver refresh\` — rewrite the posted message`,
      `\`${p}aboutserver gif <url>\` — set the top GIF`,
      "",
      varsHelp(),
    ].join("\n"),
  });
}

async function run(member, guild, channel, args, reply, interaction) {
  if (!isAdminOrOwner(member, guild)) return reply({ ...denied(), ephemeral: true });
  const sub = String(args[0] || "").toLowerCase();

  if (!sub || sub === "edit" || sub === "setup") {
    if (interaction) return openEditor(interaction);
    return reply({ ...editorPayload(guild.id), allowedMentions: { repliedUser: false } });
  }

  if (sub === "help" || sub === "vars") {
    return reply({ embeds: [usage()], ephemeral: true });
  }

  if (sub === "gif") {
    const url = safeUrl(args.slice(1).join(" "));
    if (!url) return reply({ embeds: [danger("GIF", "Paste an https image/GIF URL.")], ephemeral: true });
    updateConfig(guild.id, { gif: url });
    await refreshPosted(guild).catch(() => null);
    return reply({ embeds: [ok("GIF set", "Top media updated.")], ephemeral: true });
  }

  if (sub === "refresh") {
    const msg = await refreshPosted(guild);
    if (!msg) return reply({ embeds: [danger("Nothing posted", `Use \`'aboutserver post\` first.`)], ephemeral: true });
    return reply({ embeds: [ok("Refreshed", "The posted About server message was updated.")], ephemeral: true });
  }

  if (sub === "post" || sub === "send") {
    try {
      const sent = await postOrEdit(channel, guild);
      return reply({ embeds: [ok("Posted", `About server is live in ${sent.channel}.`)], ephemeral: true });
    } catch (err) {
      return reply({
        embeds: [danger("Post failed", err.message || "Could not post that v2 message.")],
        ephemeral: true,
      });
    }
  }

  return reply({ embeds: [usage()], ephemeral: true });
}

module.exports = {
  name: "aboutserver",
  aliases: ["about", "serverabout", "warsrecords"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("aboutserver")
      .setDescription("Post or edit the About server v2 card")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand((s) => s.setName("edit").setDescription("Open the editor"))
      .addSubcommand((s) => s.setName("post").setDescription("Post or update the card in this channel"))
      .addSubcommand((s) => s.setName("refresh").setDescription("Refresh the posted card"))
      .addSubcommand((s) =>
        s
          .setName("gif")
          .setDescription("Set the top GIF / image")
          .addStringOption((o) => o.setName("url").setDescription("https image or GIF URL").setRequired(true))
      ),

  async executePrefix(message, args) {
    return run(message.member, message.guild, message.channel, args, (payload) =>
      message.reply({ ...payload, allowedMentions: { repliedUser: false } })
    );
  },

  async executeSlash(interaction) {
    const sub = interaction.options.getSubcommand();
    const args =
      sub === "gif" ? ["gif", interaction.options.getString("url")] : [sub];
    return run(interaction.member, interaction.guild, interaction.channel, args, (payload) => {
      if (interaction.replied || interaction.deferred) return interaction.followUp({ ...payload, ephemeral: true });
      return interaction.reply({ ...payload, ephemeral: true });
    }, interaction);
  },
};
