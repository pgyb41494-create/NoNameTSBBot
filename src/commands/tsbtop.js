const { SlashCommandBuilder } = require("discord.js");
const { tsbEmbed, COLOR_SUCCESS, COLOR_DANGER } = require("../systems/tsb/shared/embeds");
const { getLeaderboardConfig, updateLeaderboardConfig, ensureSlots, extraBoardsOf, sanitizeBoardId, emptyBoardSlots } = require("../systems/tsb/leaderboard/config");
const { canManageLeaderboard } = require("../systems/tsb/leaderboard/draft");
const { refreshLeaderboard, upsertLeaderboard } = require("../systems/tsb/leaderboard/renderer");
const { resolveGuildPrefix } = require("../systems/tsb/shared/guildPrefix");

async function placeOnTopBoard(guildId, position, userId, boardId = null) {
  const api = require("../utils/loadApi");
  if (!boardId && typeof api.leaderboard.place === "function") {
    await api.leaderboard.place(guildId, position, userId);
    return getLeaderboardConfig(guildId);
  }
  const cfg = await getLeaderboardConfig(guildId);
  if (boardId) {
    const extras = extraBoardsOf(cfg);
    const key = sanitizeBoardId(boardId);
    const index = extras.findIndex((board) => board.id === key || board.suffix === key);
    if (index < 0) throw new Error(`Unknown extra board \`${boardId}\`.`);
    const board = extras[index];
    const count = Math.max(board.slotCount || 10, position);
    const slots = emptyBoardSlots(count).map((slot, i) => ({
      position: i + 1,
      discordId: board.slots[i]?.discordId || null,
    }));
    for (let i = 0; i < slots.length; i += 1) {
      if (String(slots[i]?.discordId || "") === String(userId)) slots[i] = { position: i + 1, discordId: null };
    }
    slots[position - 1] = { position, discordId: userId };
    extras[index] = { ...board, slotCount: count, slots };
    await updateLeaderboardConfig(guildId, { extraBoards: extras });
    return getLeaderboardConfig(guildId);
  }
  const count = Math.max(cfg.slots?.length || cfg.topPerChannel || 10, position);
  await ensureSlots(guildId, count);
  const next = await getLeaderboardConfig(guildId);
  const slots = [...(next.slots || [])];
  while (slots.length < position) {
    slots.push({ position: slots.length + 1, discordId: null });
  }
  for (let i = 0; i < slots.length; i += 1) {
    if (String(slots[i]?.discordId || "") === String(userId)) {
      slots[i] = { position: i + 1, discordId: null };
    }
  }
  slots[position - 1] = { position, discordId: userId };
  await updateLeaderboardConfig(guildId, { slots });
  return getLeaderboardConfig(guildId);
}

function updatedEmbed(position, user) {
  return tsbEmbed({
    title: "Board updated",
    description: `> **#${position}** → ${user}`,
    color: COLOR_SUCCESS,
  });
}

function deleteSoon(message, ms = 5000) {
  if (!message) return;
  setTimeout(() => message.delete().catch(() => {}), ms);
}

module.exports = {
  name: "tsbtop",
  aliases: ["top", "lbset"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("tsbtop")
      .setDescription("Place a player on the TSB top leaderboard")
      .addIntegerOption((o) =>
        o.setName("position").setDescription("Board position (1+)").setRequired(true).setMinValue(1).setMaxValue(50)
      )
      .addUserOption((o) => o.setName("user").setDescription("Player to place").setRequired(true))
      .addStringOption((o) =>
        o.setName("board").setDescription("Extra board id (leave blank for the main board)").setRequired(false)
      ),

  async executePrefix(message, args) {
    const cfg = await getLeaderboardConfig(message.guild.id);
    if (!cfg.setupCompleted) {
      return message.reply({
        embeds: [
          tsbEmbed({
            title: "Not set up",
            description: "> Top boards are not set up. Use `'serversetup` → **Top Leaderboard**.",
            color: COLOR_DANGER,
          }),
        ],
        allowedMentions: { repliedUser: false },
      });
    }
    if (!canManageLeaderboard(message.member, message.guild, cfg)) {
      return message.reply({
        embeds: [
          tsbEmbed({
            title: "Missing permissions",
            description: "> You are not allowed to edit the top board.",
            color: COLOR_DANGER,
          }),
        ],
        allowedMentions: { repliedUser: false },
      });
    }
    const maybeBoard = args[0] && !/^\d+$/.test(args[0]) ? args[0] : null;
    const position = parseInt(maybeBoard ? args[1] : args[0], 10);
    const mentionArg = maybeBoard ? args[2] : args[1];
    const mention = mentionArg?.match(/^<@!?(\d+)>$/);
    const userId = mention?.[1] || mentionArg;
    if (!Number.isFinite(position) || position < 1 || !userId) {
      const p = resolveGuildPrefix(message.guild.id);
      return message.reply({
        content: `Usage: \`${p}tsbtop [board] <position> @user\``,
        allowedMentions: { repliedUser: false },
      });
    }
    const user = await message.client.users.fetch(userId).catch(() => null);
    if (!user) {
      return message.reply({ content: "User not found.", allowedMentions: { repliedUser: false } });
    }
    try {
      await placeOnTopBoard(message.guild.id, position, user.id, maybeBoard);
    } catch (err) {
      return message.reply({
        content: err.message || "Could not place that player.",
        allowedMentions: { repliedUser: false },
      });
    }
    await refreshLeaderboard(message.guild).catch(() => upsertLeaderboard(message.guild));
    const reply = await message.reply({
      embeds: [updatedEmbed(position, user)],
      allowedMentions: { repliedUser: false },
    });
    deleteSoon(reply);
    return reply;
  },

  async executeSlash(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "Use this in a server.", ephemeral: true });
    }
    const cfg = await getLeaderboardConfig(interaction.guild.id);
    if (!cfg.setupCompleted) {
      return interaction.reply({
        content: "Top boards are not set up. Use `/tsbsetup` → **Top Leaderboard**.",
        ephemeral: true,
      });
    }
    if (!canManageLeaderboard(interaction.member, interaction.guild, cfg)) {
      return interaction.reply({ content: "You are not allowed to edit the top board.", ephemeral: true });
    }
    const position = interaction.options.getInteger("position", true);
    const user = interaction.options.getUser("user", true);
    const board = interaction.options.getString("board");
    try {
      await placeOnTopBoard(interaction.guild.id, position, user.id, board);
    } catch (err) {
      return interaction.reply({ content: err.message || "Could not place that player.", ephemeral: true });
    }
    await refreshLeaderboard(interaction.guild).catch(() => upsertLeaderboard(interaction.guild));
    await interaction.reply({ embeds: [updatedEmbed(position, user)] });
    const reply = await interaction.fetchReply().catch(() => null);
    deleteSoon(reply);
    return reply;
  },
};
