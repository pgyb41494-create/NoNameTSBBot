const { SlashCommandBuilder } = require("discord.js");
const { getScoreConfig, getPlayerState } = require("../systems/tsb/score/config");
const { surface, danger } = require("../utils/embeds");

function discordRelative(isoOrDate) {
  if (!isoOrDate) return "none";
  const ms = isoOrDate instanceof Date ? isoOrDate.getTime() : new Date(isoOrDate).getTime();
  if (!Number.isFinite(ms)) return "none";
  if (ms <= Date.now()) return "ready";
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function lastResultLabel(value) {
  if (value === "win") return "Win";
  if (value === "loss") return "Loss";
  if (value === "autoloss") return "Autowin loss";
  return "—";
}

async function lookup(guild, user) {
  const cfg = await Promise.resolve(getScoreConfig(guild.id));
  const state = await Promise.resolve(getPlayerState(guild.id, user.id));
  const until = state?.cooldownUntil || null;
  const active = until && new Date(until).getTime() > Date.now();
  const threshold = Number(cfg.autowinThreshold) || 3;
  const strikes = Number(state?.autowinStrikes) || 0;
  const autowinOn = cfg.autowinEnabled !== false;

  return surface({
    title: `Cooldown · ${user.username}`,
    thumbnail: user.displayAvatarURL({ size: 128 }),
    fields: [
      { name: "Cooldown", value: active ? discordRelative(until) : "Ready", inline: true },
      {
        name: "Autowin strikes",
        value: autowinOn ? `${strikes}/${threshold}` : "Off",
        inline: true,
      },
      { name: "Last result", value: lastResultLabel(state?.lastResult), inline: true },
    ],
  });
}

async function resolveUser(guild, source, args) {
  if (source.options) return source.options.getUser("user") || source.user;
  const mention = source.mentions?.users?.first();
  if (mention) return mention;
  const id = String(args[0] || "").replace(/[<@!>]/g, "");
  if (/^\d{17,20}$/.test(id)) {
    return guild.client.users.fetch(id).catch(() => null);
  }
  return source.author;
}

module.exports = {
  name: "cd",
  aliases: ["cooldown", "autowin"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("cd")
      .setDescription("Show 1v1 cooldown and autowin strikes")
      .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(false)),

  async executePrefix(message, args) {
    const user = await resolveUser(message.guild, message, args);
    if (!user) return message.reply({ embeds: [danger("Not found", "User not found.")] });
    return message.reply({ embeds: [await lookup(message.guild, user)] });
  },

  async executeSlash(interaction) {
    const user = interaction.options.getUser("user") || interaction.user;
    return interaction.reply({ embeds: [await lookup(interaction.guild, user)] });
  },
};
