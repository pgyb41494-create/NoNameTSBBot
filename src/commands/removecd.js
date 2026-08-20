const { SlashCommandBuilder } = require("discord.js");
const { getScoreConfig, getPlayerState, setPlayerState } = require("../systems/tsb/score/config");
const { canUseScore } = require("../systems/tsb/score/system");
const { danger, ok } = require("../utils/embeds");

function snowflake(value) {
  const id = String(value || "").replace(/[<@!>]/g, "").trim();
  return /^\d{17,20}$/.test(id) ? id : "";
}

async function resolveTargetUser(guild, source, args) {
  if (source.options) return source.options.getUser("user");
  const mention = source.mentions?.users?.first();
  if (mention) return mention;
  const id = snowflake(args[0]);
  if (id) return guild.client.users.fetch(id).catch(() => null);
  return null;
}

async function clearCooldown(guild, actor, target) {
  const cfg = await Promise.resolve(getScoreConfig(guild.id));
  const before = await Promise.resolve(getPlayerState(guild.id, target.id));
  const hadCooldown =
    before?.cooldownUntil && new Date(before.cooldownUntil).getTime() > Date.now();

  await Promise.resolve(setPlayerState(guild.id, target.id, { cooldownUntil: null }));

  try {
    const { refreshUserBoardsBackground } = require("../systems/tsb/shared/boardRefresh");
    refreshUserBoardsBackground(guild, target.id);
  } catch {}

  return { hadCooldown, actor };
}

module.exports = {
  name: "removecd",
  aliases: ["uncd", "clearcd", "removecooldown", "clearcooldown"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("removecd")
      .setDescription("Remove a player's 1v1 cooldown (staff)")
      .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true)),

  async executePrefix(message, args) {
    const cfg = await Promise.resolve(getScoreConfig(message.guild.id));
    if (!canUseScore(message.member, message.guild, cfg)) {
      return message.reply({
        embeds: [danger("Missing permissions", "You need **SCORE** access or an allowed score role.")],
      });
    }
    const user = await resolveTargetUser(message.guild, message, args);
    if (!user) {
      return message.reply({ embeds: [danger("Usage", "`'removecd @user` or `'uncd <userId>`")] });
    }
    const { hadCooldown } = await clearCooldown(message.guild, message.author, user);
    return message.reply({
      embeds: [
        ok(
          "Cooldown removed",
          hadCooldown
            ? `<@${user.id}> is **ready** to challenge again.`
            : `<@${user.id}> had no active cooldown — cleared anyway.`
        ),
      ],
    });
  },

  async executeSlash(interaction) {
    const cfg = await Promise.resolve(getScoreConfig(interaction.guild.id));
    if (!canUseScore(interaction.member, interaction.guild, cfg)) {
      return interaction.reply({
        embeds: [danger("Missing permissions", "You need **SCORE** access or an allowed score role.")],
        ephemeral: true,
      });
    }
    const user = interaction.options.getUser("user");
    const { hadCooldown } = await clearCooldown(interaction.guild, interaction.user, user);
    return interaction.reply({
      embeds: [
        ok(
          "Cooldown removed",
          hadCooldown
            ? `<@${user.id}> is **ready** to challenge again.`
            : `<@${user.id}> had no active cooldown — cleared anyway.`
        ),
      ],
    });
  },
};
