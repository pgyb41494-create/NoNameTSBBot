const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const api = require("../utils/loadApi");
const { danger, ok } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");
const { publishLeaderboard, publishLineup } = require("../systems/boardPublish");
const { parseStage, tryoutAssignCap, isStageAtMost } = require("../../api/lib/stages");

module.exports = {
  name: "stage",
  aliases: ["tier", "rank", "phase"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("stage")
      .setDescription("Set a player's TSB phase/stage (tryout assign)")
      .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))
      .addStringOption((o) => o.setName("stage").setDescription("e.g. 2 High Weak").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async executePrefix(message, args) {
    if (!isAdminOrOwner(message.member, message.guild)) {
      return message.reply({ embeds: [danger("Missing permissions", "Staff only.")] });
    }
    const user = message.mentions.users.first();
    const stage = args.filter((a) => !a.startsWith("<@")).join(" ");
    if (!user || !stage) {
      return message.reply({ embeds: [danger("Usage", "`'stage @user 2 High Weak`")] });
    }
    return applyStage(message, message.guild.id, user, stage, message.author.id, message.member);
  },

  async executeSlash(interaction) {
    const user = interaction.options.getUser("user");
    const stage = interaction.options.getString("stage");
    return applyStage(
      interaction,
      interaction.guildId,
      user,
      stage,
      interaction.user.id,
      interaction.member
    );
  },
};

async function applyStage(ctx, guildId, user, stageInput, moderatorId, moderatorMember) {
  const parsed = parseStage(stageInput);
  if (!parsed) {
    return reply(ctx, danger("Invalid stage", "Use e.g. `2 High Weak` or `phase 2 mid stable`."));
  }

  // Soft tryout cap: assigner cannot give above their own stage, and never above 2 High Strong if they are Phase 0/1.
  const assignerStage = api.ranking.getStage(guildId, moderatorId);
  if (assignerStage && parsed !== "Applicant") {
    const cap = tryoutAssignCap(assignerStage);
    if (!isStageAtMost(parsed, cap)) {
      return reply(
        ctx,
        danger(
          "Above tryout cap",
          `Your stage is **${assignerStage}**. Max you can assign is **${cap}** (TSBL: own phase, ceiling 2 High Strong).`
        )
      );
    }
  }

  api.ranking.setStage(guildId, user.id, parsed, moderatorId);
  const guild = ctx.guild || (await ctx.client.guilds.fetch(guildId).catch(() => null));
  if (guild) {
    await publishLeaderboard(guild).catch(() => {});
    await publishLineup(guild).catch(() => {});
  }
  return reply(
    ctx,
    ok("Stage set", `${user} → **${api.ranking.getStage(guildId, user.id)}**`)
  );
}

function reply(ctx, embed) {
  if (typeof ctx.reply === "function") {
    return ctx.reply({ embeds: [embed] });
  }
  return Promise.resolve();
}
