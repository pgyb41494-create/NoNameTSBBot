const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { isAdminOrOwner } = require("../utils/permissions");
const { danger, ok } = require("../utils/embeds");

function canRepublish(member, guild) {
  if (isAdminOrOwner(member, guild)) return true;
  return member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)
    || member?.permissions?.has?.(PermissionFlagsBits.Administrator);
}

async function runRepublish(guild, target) {
  const lines = [];
  const want = String(target || "all").toLowerCase();

  if (want === "all" || want === "boards" || want === "leaderboard") {
    try {
      const { getLeaderboardConfig } = require("../systems/tsb/leaderboard/config");
      const { refreshLeaderboard, upsertLeaderboard } = require("../systems/tsb/leaderboard/renderer");
      const cfg = await getLeaderboardConfig(guild.id);
      if (cfg.setupCompleted) {
        await refreshLeaderboard(guild).catch(() => upsertLeaderboard(guild));
        lines.push("• **Top boards** refreshed");
      } else if (want !== "all") {
        lines.push("• Top boards — not set up");
      }
    } catch (err) {
      lines.push(`• Top boards failed: ${err.message}`);
    }
  }

  if (want === "all" || want === "lineups" || want === "lineup") {
    try {
      const { getLineupConfig } = require("../systems/tsb/lineup/config");
      const { publishAllLineups } = require("../systems/tsb/lineup/renderer");
      const cfg = await getLineupConfig(guild.id);
      if (cfg.setupCompleted) {
        await publishAllLineups(guild, { createChannels: false });
        lines.push("• **Lineups** refreshed");
      } else if (want !== "all") {
        lines.push("• Lineups — not set up");
      }
    } catch (err) {
      lines.push(`• Lineups failed: ${err.message}`);
    }
  }

  if (want === "all" || want === "challenge" || want === "challenges") {
    try {
      const { getLeaderboardConfig } = require("../systems/tsb/leaderboard/config");
      const { challengeTicketsOf } = require("../systems/tsb/leaderboard/config");
      const { publishPanel } = require("../systems/tsb/challengeTickets/runtime");
      const cfg = await getLeaderboardConfig(guild.id);
      const tickets = challengeTicketsOf(cfg);
      if (tickets.enabled) {
        const posted = await publishPanel(guild);
        lines.push(posted?.channel
          ? `• **Challenge panel** updated in ${posted.channel}`
          : "• Challenge panel — could not post");
      } else if (want !== "all") {
        lines.push("• Challenge panel — not enabled");
      }
    } catch (err) {
      lines.push(`• Challenge panel failed: ${err.message}`);
    }
  }

  if (want === "all" || want === "tickets" || want === "ticket") {
    try {
      const { listPanels } = require("../systems/tsb/tickets/store");
      const { publishPanel } = require("../systems/tsb/tickets/runtime");
      const panels = listPanels(guild.id).filter((p) => p.sendChannelId);
      if (!panels.length && want !== "all") {
        lines.push("• Ticket panels — none posted");
      }
      for (const panel of panels) {
        const result = await publishPanel(guild, panel);
        lines.push(result.error
          ? `• Ticket \`${panel.name}\` — ${result.error}`
          : `• Ticket **${panel.title || panel.name}** ${result.updated ? "updated" : "posted"} in ${result.channel}`);
      }
    } catch (err) {
      lines.push(`• Ticket panels failed: ${err.message}`);
    }
  }

  if (want === "all" || want === "embeds" || want === "embed") {
    try {
      const { listConfigs } = require("../systems/tsb/aboutserver/store");
      const { refreshPosted } = require("../systems/tsb/aboutserver/runtime");
      const names = listConfigs(guild.id);
      let refreshed = 0;
      for (const name of names) {
        const msg = await refreshPosted(guild, name).catch(() => null);
        if (msg) refreshed += 1;
      }
      if (refreshed) lines.push(`• **Embeds** refreshed (${refreshed})`);
      else if (want !== "all") lines.push("• Embeds — none posted yet");
    } catch (err) {
      lines.push(`• Embeds failed: ${err.message}`);
    }
  }

  if (want === "all" || want === "verify") {
    try {
      const { getConfig } = require("../systems/tsb/verify/store");
      const { upsertPanel } = require("../systems/tsb/verify/runtime");
      const cfg = getConfig(guild.id);
      if (cfg?.panelChannelId) {
        const channel = await guild.channels.fetch(cfg.panelChannelId).catch(() => null);
        if (channel) {
          await upsertPanel(channel, guild);
          lines.push(`• **Verify panel** updated in ${channel}`);
        } else if (want !== "all") {
          lines.push("• Verify panel — channel missing");
        }
      } else if (want !== "all") {
        lines.push("• Verify panel — not posted");
      }
    } catch (err) {
      if (want !== "all") lines.push(`• Verify panel failed: ${err.message}`);
    }
  }

  if (!lines.length) lines.push("Nothing to republish yet. Finish setup first.");
  return lines;
}

async function republishGuildQuiet(guild) {
  try {
    return await runRepublish(guild, "all");
  } catch (err) {
    return [`• Failed: ${err.message}`];
  }
}

async function republishAllGuilds(client) {
  const results = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      const lines = await republishGuildQuiet(guild);
      results.push({ guildId: guild.id, name: guild.name, lines });
      console.log(`[republish] ${guild.name}: ${lines.join(" | ")}`);
    } catch (err) {
      console.warn(`[republish] ${guild.name} failed:`, err.message);
      results.push({ guildId: guild.id, name: guild.name, error: err.message });
    }
  }
  return results;
}

module.exports = {
  name: "republish",
  aliases: ["refreshboards", "repost"],
  runRepublish,
  republishGuildQuiet,
  republishAllGuilds,
  slash: () =>
    new SlashCommandBuilder()
      .setName("republish")
      .setDescription("1-click refresh boards, lineups, challenge panel, or ticket panels")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption((o) =>
        o
          .setName("target")
          .setDescription("What to refresh")
          .setRequired(false)
          .addChoices(
            { name: "Everything", value: "all" },
            { name: "Top boards", value: "boards" },
            { name: "Lineups", value: "lineups" },
            { name: "Challenge panel", value: "challenge" },
            { name: "Ticket panels", value: "tickets" },
            { name: "Custom embeds", value: "embeds" }
          )
      ),

  async executePrefix(message, args) {
    if (!canRepublish(message.member, message.guild)) {
      return message.reply({ embeds: [danger("Missing permissions", "Manage Server required.")] });
    }
    const target = (args[0] || "all").toLowerCase();
    const reply = await message.reply({ content: "Republishing…" });
    const lines = await runRepublish(message.guild, target);
    return reply.edit({
      content: null,
      embeds: [ok("Republished", lines.join("\n"))],
    });
  },

  async executeSlash(interaction) {
    if (!canRepublish(interaction.member, interaction.guild)) {
      return interaction.reply({
        embeds: [danger("Missing permissions", "Manage Server required.")],
        ephemeral: true,
      });
    }
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getString("target") || "all";
    const lines = await runRepublish(interaction.guild, target);
    return interaction.editReply({ embeds: [ok("Republished", lines.join("\n"))] });
  },
};
