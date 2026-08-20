const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const api = require("../utils/loadApi");
const { danger, surface } = require("../utils/embeds");
const { canUseScore } = require("../systems/tsb/score/system");
const { getScoreConfig } = require("../systems/tsb/score/config");
const { checkDuplicateRoblox } = require("../systems/tsb/ops/alerts");

async function loadDuplicateGroups(guildId) {
  if (typeof api.profiles.listDuplicateRobloxGroups === "function") {
    return Promise.resolve(api.profiles.listDuplicateRobloxGroups(guildId));
  }
  return [];
}

function formatGroup(group) {
  const roblox = group[0];
  const name = roblox?.roblox_username || roblox?.robloxUsername || "?";
  const id = roblox?.roblox_id || roblox?.robloxId || "?";
  const lines = group.map((p) => `<@${p.discord_id || p.discordId}> · code \`${p.profile_id || "—"}\``);
  return `**@${name}** (\`${id}\`)\n${lines.join("\n")}`;
}

async function buildDupesEmbed(guild) {
  const groups = await loadDuplicateGroups(guild.id);
  if (!groups.length) {
    return surface({
      title: "Duplicate Roblox scan",
      description: "No duplicate Roblox links found in this server's profiles.",
    });
  }
  const body = groups.slice(0, 8).map(formatGroup).join("\n\n");
  const extra = groups.length > 8 ? `\n\n_+${groups.length - 8} more group(s)_` : "";
  return surface({
    title: `Duplicate Roblox · ${groups.length} group(s)`,
    description: body + extra,
  });
}

module.exports = {
  name: "dupes",
  aliases: ["duplicateroblox", "robloxdupes"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("dupes")
      .setDescription("List profiles sharing the same Roblox account (staff)")
      .addUserOption((o) =>
        o.setName("user").setDescription("Also check this user's Roblox link").setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async executePrefix(message, args) {
    const cfg = await Promise.resolve(getScoreConfig(message.guild.id));
    if (!canUseScore(message.member, message.guild, cfg)) {
      return message.reply({ embeds: [danger("Missing permissions", "You need **SCORE** access or an allowed score role.")] });
    }
    const target = message.mentions.users.first();
    if (target) {
      const profile = await Promise.resolve(api.profiles.getProfile(message.guild.id, target.id));
      if (profile?.roblox_id) {
        await checkDuplicateRoblox(message.guild, target.id, profile.roblox_id, profile.roblox_username);
      }
    }
    return message.reply({ embeds: [await buildDupesEmbed(message.guild)] });
  },

  async executeSlash(interaction) {
    const cfg = await Promise.resolve(getScoreConfig(interaction.guild.id));
    if (!canUseScore(interaction.member, interaction.guild, cfg)) {
      return interaction.reply({
        embeds: [danger("Missing permissions", "You need **SCORE** access or an allowed score role.")],
        ephemeral: true,
      });
    }
    const target = interaction.options.getUser("user");
    if (target) {
      const profile = await Promise.resolve(api.profiles.getProfile(interaction.guild.id, target.id));
      if (profile?.roblox_id) {
        await checkDuplicateRoblox(interaction.guild, target.id, profile.roblox_id, profile.roblox_username);
      }
    }
    return interaction.reply({ embeds: [await buildDupesEmbed(interaction.guild)] });
  },
};
