const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { isAdminOrOwner } = require("../systems/tsb/shared/permissions");
const { danger, ok } = require("../utils/embeds");
const { tsbEmbed, COLOR_PRIMARY } = require("../systems/tsb/shared/embeds");
const {
  updateConfig,
  getConfig,
  safeUrl,
  normalizeName,
  listConfigs,
  deleteConfig,
} = require("../systems/tsb/aboutserver/store");
const {
  postOrEdit,
  refreshPosted,
  openEditor,
  editorPayload,
  varsHelp,
} = require("../systems/tsb/aboutserver/runtime");

function denied() {
  return { embeds: [danger("Missing permissions", "You need **Administrator** to use embeds.")] };
}

function usage() {
  const p = "'";
  return tsbEmbed({
    title: "Embeds",
    color: COLOR_PRIMARY,
    description: [
      `Create and post multiple editable v2 cards (GIF, title, body, footer).`,
      "",
      `\`${p}embed edit [name]\` — open an editor (default: default)`,
      `\`${p}embed post [name]\` — post / update that embed here`,
      `\`${p}embed refresh [name]\` — rewrite the posted message`,
      `\`${p}embed gif <url>\` — set the default embed GIF`,
      `\`${p}embed list\` — list saved embeds`,
      `\`${p}embed delete <name>\` — delete a named embed`,
      "",
      varsHelp(),
    ].join("\n"),
  });
}

function listPayload(guildId) {
  const names = listConfigs(guildId);
  return tsbEmbed({
    title: "Saved embeds",
    color: COLOR_PRIMARY,
    description: names.map((name) => `• \`${name}\``).join("\n"),
  });
}

async function run(member, guild, channel, args, reply, interaction) {
  if (!isAdminOrOwner(member, guild)) return reply({ ...denied(), ephemeral: true });
  const sub = String(args[0] || "").toLowerCase();
  const name = normalizeName(args[1] || "default");

  if (!sub || sub === "edit" || sub === "setup") {
    if (interaction) return openEditor(interaction, name);
    return reply({ ...editorPayload(guild.id, name), allowedMentions: { repliedUser: false } });
  }

  if (sub === "help" || sub === "vars") {
    return reply({ embeds: [usage()], ephemeral: true });
  }

  if (sub === "list") {
    return reply({ embeds: [listPayload(guild.id)], ephemeral: true });
  }

  if (sub === "delete" || sub === "remove") {
    if (name === "default") {
      return reply({ embeds: [danger("Cannot delete default", "Use a named embed instead.")], ephemeral: true });
    }
    if (!deleteConfig(guild.id, name)) {
      return reply({ embeds: [danger("Not found", `No embed named \`${name}\` exists.`)], ephemeral: true });
    }
    return reply({ embeds: [ok("Deleted", `Embed \`${name}\` was deleted.`)], ephemeral: true });
  }

  if (sub === "gif") {
    const namedUrl = safeUrl(args[2]);
    const targetName = namedUrl ? name : "default";
    const url = namedUrl || safeUrl(args.slice(1).join(" "));
    if (!url) return reply({ embeds: [danger("GIF", "Paste an https image/GIF URL.")], ephemeral: true });
    updateConfig(guild.id, { gif: url }, targetName);
    await refreshPosted(guild, targetName).catch(() => null);
    return reply({ embeds: [ok("GIF set", `Top media for \`${targetName}\` updated.`)], ephemeral: true });
  }

  if (sub === "refresh") {
    const msg = await refreshPosted(guild, name);
    if (!msg) return reply({ embeds: [danger("Nothing posted", `Use \`'embed post ${name}\` first.`)], ephemeral: true });
    return reply({ embeds: [ok("Refreshed", `Embed \`${name}\` was updated.`)], ephemeral: true });
  }

  if (sub === "post" || sub === "send") {
    try {
      const sent = await postOrEdit(channel, guild, getConfig(guild.id, name));
      return reply({ embeds: [ok("Posted", `Embed \`${name}\` is live in ${sent.channel}.`)], ephemeral: true });
    } catch (err) {
      return reply({
        embeds: [danger("Post failed", err.message || "Could not post that embed.")],
        ephemeral: true,
      });
    }
  }

  return reply({ embeds: [usage()], ephemeral: true });
}

module.exports = {
  name: "embed",
  aliases: ["aboutserver", "about", "serverabout", "warsrecords"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("embed")
      .setDescription("Create and post editable server embeds")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand((s) =>
        s
          .setName("edit")
          .setDescription("Open an embed editor")
          .addStringOption((o) => o.setName("name").setDescription("Embed name").setRequired(false))
      )
      .addSubcommand((s) =>
        s
          .setName("post")
          .setDescription("Post or update an embed in this channel")
          .addStringOption((o) => o.setName("name").setDescription("Embed name").setRequired(false))
      )
      .addSubcommand((s) =>
        s
          .setName("refresh")
          .setDescription("Refresh a posted embed")
          .addStringOption((o) => o.setName("name").setDescription("Embed name").setRequired(false))
      )
      .addSubcommand((s) =>
        s
          .setName("gif")
          .setDescription("Set the top GIF / image")
          .addStringOption((o) => o.setName("url").setDescription("https image or GIF URL").setRequired(true))
          .addStringOption((o) => o.setName("name").setDescription("Embed name").setRequired(false))
      )
      .addSubcommand((s) => s.setName("list").setDescription("List saved embeds"))
      .addSubcommand((s) =>
        s
          .setName("delete")
          .setDescription("Delete a named embed")
          .addStringOption((o) => o.setName("name").setDescription("Embed name").setRequired(true))
      ),

  async executePrefix(message, args) {
    return run(message.member, message.guild, message.channel, args, (payload) =>
      message.reply({ ...payload, allowedMentions: { repliedUser: false } })
    );
  },

  async executeSlash(interaction) {
    const sub = interaction.options.getSubcommand();
    const selectedName = interaction.options.getString("name") || "default";
    const args = sub === "gif"
      ? ["gif", selectedName, interaction.options.getString("url")]
      : [sub, selectedName];
    return run(interaction.member, interaction.guild, interaction.channel, args, (payload) => {
      if (interaction.replied || interaction.deferred) return interaction.followUp({ ...payload, ephemeral: true });
      return interaction.reply({ ...payload, ephemeral: true });
    }, interaction);
  },
};
