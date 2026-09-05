const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { isAdminOrOwner } = require("../systems/tsb/shared/permissions");
const { danger, ok } = require("../utils/embeds");
const { tsbEmbed, COLOR_PRIMARY } = require("../systems/tsb/shared/embeds");
const {
  updateConfig,
  getConfig,
  safeUrl,
  normalizeName,
  hasConfig,
  listConfigs,
  deleteConfig,
} = require("../systems/tsb/aboutserver/store");
const {
  postOrEdit,
  refreshPosted,
  openEmbedHub,
  embedHubPayload,
  varsHelp,
} = require("../systems/tsb/aboutserver/runtime");

function denied() {
  return { embeds: [danger("Missing permissions", "You need **Administrator** to use embeds.")] };
}

function usage() {
  const p = "'";
  const site = String(process.env.WEBSITE_URL || process.env.FRONTEND_URL || "https://no-name-tsb-website.vercel.app").replace(
    /\/$/,
    ""
  );
  return tsbEmbed({
    title: "Embeds",
    color: COLOR_PRIMARY,
    description: [
      `Create and edit embeds on the **website dashboard** (Discohook-style UI + live preview).`,
      "",
      `Open **Dashboard → Embeds**: ${site}/dashboard`,
      `Use \`${p}embed\` here to list, post, refresh, or delete.`,
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
    description: names.length ? names.map((name) => `• \`${name}\``).join("\n") : "No embeds have been created yet.",
  });
}

async function run(member, guild, channel, args, reply, interaction) {
  if (!isAdminOrOwner(member, guild)) return reply({ ...denied(), ephemeral: true });
  const sub = String(args[0] || "").toLowerCase();
  const name = normalizeName(args[1] || "");

  if (!sub) {
    if (interaction) return openEmbedHub(interaction);
    return reply({ ...embedHubPayload(guild.id), allowedMentions: { repliedUser: false } });
  }

  if (sub === "edit" || sub === "setup") {
    const site = String(process.env.WEBSITE_URL || process.env.FRONTEND_URL || "https://no-name-tsb-website.vercel.app").replace(
      /\/$/,
      ""
    );
    return reply({
      embeds: [
        tsbEmbed({
          title: "Edit embeds on the website",
          color: COLOR_PRIMARY,
          description: [
            "The Discohook-style builder lives on the dashboard.",
            "",
            `Open **Dashboard → Embeds**: ${site}/dashboard`,
            name ? `Then select or create \`${name}\`.` : "Create a new embed there, then use `'embed` here to post it.",
          ].join("\n"),
        }),
      ],
      ephemeral: true,
    });
  }

  if (sub === "help" || sub === "vars") {
    return reply({ embeds: [usage()], ephemeral: true });
  }

  if (sub === "list") {
    return reply({ embeds: [listPayload(guild.id)], ephemeral: true });
  }

  if (sub === "delete" || sub === "remove") {
    if (!name) return reply({ embeds: [danger("Missing embed name", "Choose the embed you want to delete.")], ephemeral: true });
    if (!deleteConfig(guild.id, name)) {
      return reply({ embeds: [danger("Not found", `No embed named \`${name}\` exists.`)], ephemeral: true });
    }
    return reply({ embeds: [ok("Deleted", `Embed \`${name}\` was deleted.`)], ephemeral: true });
  }

  if (sub === "gif") {
    const url = safeUrl(args[2]);
    if (!name || !url) return reply({ embeds: [danger("GIF", "Use `embed gif <name> <https image/GIF URL>`.")], ephemeral: true });
    if (!hasConfig(guild.id, name)) return reply({ embeds: [danger("Not found", `No embed named \`${name}\` exists.`)], ephemeral: true });
    updateConfig(guild.id, { gif: url }, name);
    await refreshPosted(guild, name).catch(() => null);
    return reply({ embeds: [ok("GIF set", `Top media for \`${name}\` updated.`)], ephemeral: true });
  }

  if (sub === "refresh") {
    if (!name) return reply({ embeds: [danger("Missing embed name", "Choose the embed you want to refresh.")], ephemeral: true });
    const msg = await refreshPosted(guild, name);
    if (!msg) return reply({ embeds: [danger("Nothing posted", `Use \`'embed post ${name}\` first.`)], ephemeral: true });
    return reply({ embeds: [ok("Refreshed", `Embed \`${name}\` was updated.`)], ephemeral: true });
  }

  if (sub === "post" || sub === "send") {
    if (!name) return reply({ embeds: [danger("Missing embed name", "Choose the embed you want to post.")], ephemeral: true });
    if (!hasConfig(guild.id, name)) return reply({ embeds: [danger("Not found", `No embed named \`${name}\` exists.`)], ephemeral: true });
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
      .setDescription("Post and refresh server embeds (edit on the website)")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async executePrefix(message, args) {
    return run(message.member, message.guild, message.channel, args, (payload) =>
      message.reply({ ...payload, allowedMentions: { repliedUser: false } })
    );
  },

  async executeSlash(interaction) {
    return run(interaction.member, interaction.guild, interaction.channel, [], (payload) => {
      if (interaction.replied || interaction.deferred) return interaction.followUp({ ...payload, ephemeral: true });
      return interaction.reply({ ...payload, ephemeral: true });
    }, interaction);
  },
};
