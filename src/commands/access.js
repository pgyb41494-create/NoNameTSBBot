const { SlashCommandBuilder } = require("discord.js");
const { brand } = require("../utils/loadApi");
const {
  getUserPerms,
  setUserPerms,
  canGiveAccess,
  findPerm,
} = require("../systems/tsb/access/store");
const {
  deniedPayload,
  openAccessSession,
  detailsEmbed,
  listEmbed,
  resultEmbed,
  formatPerms,
} = require("../systems/tsb/access/panel");
const { tsbEmbed, COLOR_PRIMARY } = require("../systems/tsb/shared/embeds");

function invokedName(message) {
  const prefix = brand.prefix || "'";
  return (message.content.slice(prefix.length).trim().split(/\s+/)[0] || "access").toLowerCase();
}

function usageEmbed() {
  const p = brand.prefix || "'";
  return tsbEmbed({
    title: "Access",
    color: COLOR_PRIMARY,
    description:
      `Open the panel with \`${p}access @user\` or \`/access\`.\n\n` +
      `> \`${p}access @user PHASE LINEUPS\` — grant permissions\n` +
      `> \`${p}access remove @user\` — clear all TSB access\n` +
      `> \`${p}access view @user\` · \`${p}perms [@user]\`\n` +
      `> \`${p}access list\``,
  });
}

async function requireGiveAccess(member, guild, reply) {
  if (canGiveAccess(member, guild)) return true;
  await reply({ ...deniedPayload(), allowedMentions: { repliedUser: false } });
  return false;
}

function grantPerms(guild, target, tokens) {
  const extra = [];
  for (const token of tokens) {
    const perm = findPerm(token);
    if (perm) extra.push(perm.id);
  }
  const next = [...new Set([...getUserPerms(guild.id, target.id), ...extra])];
  setUserPerms(guild.id, target.id, next);
  return { next, extra };
}

module.exports = {
  name: "access",
  aliases: ["perms", "myperms", "giveaccess"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("access")
      .setDescription("Manage TSB staff access (phase, boards, lineups, score, tryouts)")
      .addUserOption((o) => o.setName("user").setDescription("Member to manage").setRequired(true)),

  async executePrefix(message, args) {
    const invoked = invokedName(message);
    const sub = String(args[0] || "").toLowerCase();
    const target = message.mentions.users.first();

    if (invoked === "perms" || invoked === "myperms") {
      const who = target || message.author;
      if (who.id !== message.author.id && !(await requireGiveAccess(message.member, message.guild, (p) => message.reply(p)))) {
        return;
      }
      return message.reply({
        embeds: [detailsEmbed(who, message.guild.id)],
        allowedMentions: { repliedUser: false },
      });
    }

    if (sub === "list") {
      if (!(await requireGiveAccess(message.member, message.guild, (p) => message.reply(p)))) return;
      return message.reply({
        embeds: [listEmbed(message.guild)],
        allowedMentions: { repliedUser: false },
      });
    }

    if (sub === "view") {
      const who = target || message.author;
      if (who.id !== message.author.id && !(await requireGiveAccess(message.member, message.guild, (p) => message.reply(p)))) {
        return;
      }
      return message.reply({
        embeds: [detailsEmbed(who, message.guild.id)],
        allowedMentions: { repliedUser: false },
      });
    }

    if (sub === "remove") {
      if (!(await requireGiveAccess(message.member, message.guild, (p) => message.reply(p)))) return;
      if (!target) {
        return message.reply({ embeds: [usageEmbed()], allowedMentions: { repliedUser: false } });
      }
      setUserPerms(message.guild.id, target.id, []);
      return message.reply({
        embeds: [
          resultEmbed("Access", `Cleared TSB access for <@${target.id}>.`),
        ],
        allowedMentions: { repliedUser: false },
      });
    }

    if (!target) {
      return message.reply({ embeds: [usageEmbed()], allowedMentions: { repliedUser: false } });
    }
    if (!(await requireGiveAccess(message.member, message.guild, (p) => message.reply(p)))) return;

    const permTokens = args.filter((arg) => !arg.startsWith("<@") && findPerm(arg));
    if (permTokens.length) {
      const result = grantPerms(message.guild, target, permTokens);
      return message.reply({
        embeds: [
          resultEmbed(
            "Access",
            `Updated <@${target.id}>.\n\n${formatPerms(result.next)}\n\nGranted ${formatPerms(result.extra)}.`
          ),
        ],
        allowedMentions: { repliedUser: false },
      });
    }

    const payload = openAccessSession({
      adminId: message.author.id,
      target,
      guild: message.guild,
    });
    return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
  },

  async executeSlash(interaction) {
    if (!canGiveAccess(interaction.member, interaction.guild)) {
      return interaction.reply({ ...deniedPayload(), ephemeral: true });
    }
    const target = interaction.options.getUser("user", true);
    const payload = openAccessSession({
      adminId: interaction.user.id,
      target,
      guild: interaction.guild,
    });
    return interaction.reply({ ...payload, ephemeral: true });
  },
};
