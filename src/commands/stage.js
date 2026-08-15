const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const api = require("../utils/loadApi");
const { danger } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");
const { parseStage, tryoutAssignCap, isStageAtMost, splitStageParts } = require("../../api/lib/stages");
const {
  applyStageRoles,
  buildStageRankingLogEmbed,
  maybeLogStage,
  maybeRefreshBoards,
} = require("../systems/tsb/ranking/applyStage");
const { getRankingConfig, canUseRanking } = require("../systems/tsb/ranking/config");

function canAssignStage(member, guild) {
  if (isAdminOrOwner(member, guild)) return true;
  if (member?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) return true;
  return canUseRanking(member, guild);
}

module.exports = {
  name: "stage",
  aliases: ["tier", "rank", "phase"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("stage")
      .setDescription("Assign stage / tier / sub-tier roles like Obscura ranking")
      .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))
      .addStringOption((o) => o.setName("stage").setDescription("e.g. 2 High Weak or 1 applicant").setRequired(true))
      .addStringOption((o) => o.setName("notes").setDescription("Optional ranking-log notes").setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async executePrefix(message, args) {
    if (!canAssignStage(message.member, message.guild)) {
      return message.reply({ embeds: [danger("Missing permissions", "Staff only.")] });
    }
    const user = message.mentions.users.first();
    const stage = args.filter((a) => !a.startsWith("<@")).join(" ");
    if (!user || !stage) {
      return message.reply({ embeds: [danger("Usage", "`'stage @user 2 High Weak`")] });
    }
    return applyStageCommand(message, message.guild, user, stage, message.author, message.member);
  },

  async executeSlash(interaction) {
    if (!canAssignStage(interaction.member, interaction.guild)) {
      return interaction.reply({ embeds: [danger("Missing permissions", "Staff only.")], ephemeral: true });
    }
    const user = interaction.options.getUser("user");
    const stage = interaction.options.getString("stage");
    const notes = interaction.options.getString("notes");
    return applyStageCommand(
      interaction,
      interaction.guild,
      user,
      stage,
      interaction.user,
      interaction.member,
      notes
    );
  },
};

async function applyStageCommand(ctx, guild, user, stageInput, actor, actorMember, notes) {
  const parts = splitStageParts(stageInput);
  if (!parts) {
    return reply(ctx, danger("Invalid stage", "Use e.g. `2 High Weak` or `1 applicant`."));
  }

  const assignerStage = api.ranking.getStage(guild.id, actor.id);
  if (assignerStage && !parts.asApplicant) {
    const cap = tryoutAssignCap(assignerStage);
    if (!isStageAtMost(parts.text, cap)) {
      return reply(
        ctx,
        danger(
          "Above tryout cap",
          `Your stage is **${assignerStage}**. Max you can assign is **${cap}** (TSBL: own phase, ceiling 2 High Strong).`
        )
      );
    }
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    return reply(ctx, danger("Not in server", "That user is not in this server."));
  }

  const tsbRanking = getRankingConfig(guild.id);
  const { assigned, failed, phaseRole } = await applyStageRoles({
    guild,
    member,
    actorTag: actor.username,
    phaseNum: parts.phaseNum,
    tier: parts.tier,
    subtier: parts.subtier,
    asApplicant: parts.asApplicant,
    tsbRanking,
  });

  api.ranking.setStage(guild.id, user.id, parts.text, actor.id);

  const resultEmbed = await buildStageRankingLogEmbed({
    guild,
    member,
    evaluator: actor,
    phaseNum: parts.phaseNum,
    tier: parts.tier,
    subtier: parts.subtier,
    asApplicant: parts.asApplicant,
    notes: notes || "-",
    tsbRanking,
    phaseRole,
    assigned,
    failed,
  });

  await maybeLogStage(guild, tsbRanking, resultEmbed);
  maybeRefreshBoards(guild, user.id);

  return reply(ctx, resultEmbed, { raw: true });
}

function reply(ctx, embed, { raw = false } = {}) {
  const payload = raw ? { embeds: [embed] } : { embeds: [embed] };
  if (typeof ctx.reply === "function") {
    if (ctx.deferred && typeof ctx.editReply === "function") return ctx.editReply(payload);
    return ctx.reply(payload);
  }
  return Promise.resolve();
}
