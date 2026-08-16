const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const api = require("../utils/loadApi");
const { danger } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");
const { tryoutAssignCap, isStageAtMost, splitStageParts } = require("../../api/lib/stages");
const {
  applyStageRoles,
  buildStageRankingLogEmbed,
  maybeLogStage,
  maybeRefreshBoards,
} = require("../systems/tsb/ranking/applyStage");
const { getSafeGuildConfig, canUseRanking, isSetupCompleted } = require("../systems/tsb/ranking/config");
const { brand } = require("../utils/loadApi");
const { tsbEmbed, COLOR_DANGER } = require("../systems/tsb/shared/embeds");

function rankingNotReadyPayload() {
  return {
    embeds: [
      tsbEmbed({
        color: COLOR_DANGER,
        description:
          "Ranking is not set up yet. An admin must run `'serversetup` → **Ranking Setup** first.",
      }),
    ],
  };
}

function canAssignStage(member, guild) {
  if (isAdminOrOwner(member, guild)) return true;
  if (member?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) return true;
  return canUseRanking(member, guild);
}

function invokedFromPrefix(message) {
  const prefix = brand.prefix || "'";
  const name = message.content.slice(prefix.length).trim().split(/\s+/)[0] || "phase";
  return name.toLowerCase();
}

function slashCommand(name) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription("Assign phase / stage / sub-tier roles")
    .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))
    .addStringOption((o) => o.setName("stage").setDescription("e.g. 2 High Weak or 1 applicant").setRequired(true))
    .addStringOption((o) => o.setName("notes").setDescription("Optional ranking-log notes").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
}

module.exports = {
  name: "stage",
  aliases: ["tier", "rank", "phase"],
  slash: () => [slashCommand("stage"), slashCommand("phase")],

  async executePrefix(message, args) {
    if (!isSetupCompleted(message.guild.id)) {
      return message.reply({ ...rankingNotReadyPayload(), allowedMentions: { repliedUser: false } });
    }
    if (!canAssignStage(message.member, message.guild)) {
      return message.reply({ embeds: [danger("Missing permissions", "Staff only.")] });
    }
    const user = message.mentions.users.first();
    const stage = args.filter((a) => !a.startsWith("<@")).join(" ");
    if (!user || !stage) {
      return message.reply({ embeds: [danger("Usage", "`'phase @user 2 High Weak`")] });
    }
    return applyStageCommand(
      message,
      message.guild,
      user,
      stage,
      message.author,
      message.member,
      null,
      invokedFromPrefix(message)
    );
  },

  async executeSlash(interaction) {
    if (!isSetupCompleted(interaction.guild.id)) {
      return interaction.reply({ ...rankingNotReadyPayload(), ephemeral: true });
    }
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
      notes,
      interaction.commandName
    );
  },
};

async function applyStageCommand(ctx, guild, user, stageInput, actor, actorMember, notes, invokedName) {
  const parts = splitStageParts(stageInput);
  if (!parts) {
    return reply(ctx, danger("Invalid stage", "Use e.g. `2 High Weak` or `1 applicant`."));
  }

  const assignerStage = await Promise.resolve(api.ranking.getStage(guild.id, actor.id));
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

  const tsbRanking = getSafeGuildConfig(guild.id);
  if (!tsbRanking) {
    return reply(
      ctx,
      tsbEmbed({
        color: COLOR_DANGER,
        description:
          "Ranking is not set up yet. An admin must run `'serversetup` → **Ranking Setup** first.",
      })
    );
  }
  const { assigned, failed, phaseRole, tierRole, subtierRole } = await applyStageRoles({
    guild,
    member,
    actorTag: actor.username,
    phaseNum: parts.phaseNum,
    tier: parts.tier,
    subtier: parts.subtier,
    asApplicant: parts.asApplicant,
    tsbRanking,
  });

  await Promise.resolve(api.ranking.setStage(guild.id, user.id, parts.text, actor.id));

  const resultEmbed = await buildStageRankingLogEmbed({
    guild,
    member,
    evaluator: actor,
    phaseNum: parts.phaseNum,
    tier: parts.tier,
    subtier: parts.subtier,
    asApplicant: parts.asApplicant,
    notes: notes || "—",
    tsbRanking,
    phaseRole,
    tierRole,
    subtierRole,
    assigned,
    failed,
    invokedName,
  });

  await maybeLogStage(guild, tsbRanking, resultEmbed);
  maybeRefreshBoards(guild, user.id);

  return reply(ctx, resultEmbed);
}

function reply(ctx, embed) {
  const payload = { embeds: [embed] };
  if (typeof ctx.reply === "function") {
    if (ctx.deferred && typeof ctx.editReply === "function") return ctx.editReply(payload);
    return ctx.reply(payload);
  }
  return Promise.resolve();
}
