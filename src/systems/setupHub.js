const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const api = require("../utils/loadApi");
const { surface, danger, brand } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");
const { publishLeaderboard, publishLineup } = require("./boardPublish");
const { listThemes, resolveTheme } = require("./leaderboardThemes");
const { ensureTipsMessage, handleManagementDraft, sweepIfManagementChannel } = require("./mgmtDraft");

const HUB_ID = "asc:hub";
const THEME_ID = "asc:lb:theme";

function moduleStatus(guildId) {
  const theme = resolveTheme(api.leaderboard.getConfig(guildId).theme);
  return [
    {
      label: "Top Leaderboard",
      value: "leaderboard",
      description: api.leaderboard.getConfig(guildId).setupCompleted
        ? `OK · theme: ${theme.label}`
        : "Not configured",
    },
    { label: "Ranking / Stages", value: "ranking", description: api.ranking.getConfig(guildId).setupCompleted ? "Configured" : "Not configured" },
    { label: "1v1 Score", value: "score", description: api.score.getConfig(guildId).setupCompleted ? "Configured" : "Not configured" },
    { label: "Line Up", value: "lineup", description: api.lineup.getConfig(guildId).setupCompleted ? "Configured" : "Not configured" },
    { label: "Blacklist", value: "blacklist", description: `${api.blacklist.getList("network").entries.length} on the network list` },
  ];
}

function hubPayload(guildId) {
  return {
    embeds: [
      surface({
        title: `${brand.name} server setup`,
        description:
          "Pick a module. This is the clan setup hub (`'serversetup` / `/serversetup`).\n\n" +
          "> **Leaderboard** — themes: Classic cards or Metallic v2 (server banner)\n" +
          "> **Ranking** — `'stage @user 0 Low Weak`\n" +
          "> **Score** — `/score` records W/L on cards\n" +
          "> **Line Up** — regional boards\n" +
          "> **Blacklist** — shown on the website",
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(HUB_ID)
          .setPlaceholder("Select a module")
          .addOptions(moduleStatus(guildId))
      ),
    ],
  };
}

function moduleButtons(moduleKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`asc:setup:${moduleKey}:create`).setLabel("Create channels").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`asc:setup:${moduleKey}:publish`).setLabel("Publish / refresh").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`asc:setup:back`).setLabel("Back").setStyle(ButtonStyle.Secondary)
  );
}

function leaderboardThemeRow(guildId) {
  const current = resolveTheme(api.leaderboard.getConfig(guildId).theme);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(THEME_ID)
      .setPlaceholder(`Theme: ${current.label}`)
      .addOptions(
        listThemes().map((t) => ({
          label: t.label,
          value: t.id,
          description: t.description,
          default: t.id === current.id,
        }))
      )
  );
}

async function openModule(interaction, key) {
  const guides = {
    leaderboard:
      "Creates `#ascendant-boards` + `#top-1-10`.\n" +
      "In the boards channel, paste the **draft text block**, edit slots, then type `send`.\n" +
      "Pick a **theme**, then **Publish / refresh** if needed.\n\n" +
      "**Classic cards** — separate GIF card embeds\n" +
      "**Metallic v2** — one message, generated banner, Discord separator lines",
    ranking:
      "Enables `'stage @user 0 Low Weak` (or `/stage`). Stages print on leaderboard and lineup cards.",
    score:
      "Enables `/score` 1v1 logging. Wins/losses show on website + Discord cards.",
    lineup:
      "Creates `#ascendant-lineups` + `#lineup-na`.\n" +
      "Paste the **draft text block** (region + slots), then type `send` — no buttons.",
    blacklist:
      "The network blacklist is public on the website. Only the two bot owners can add or remove people from Network in the dashboard.",
  };

  const components = [moduleButtons(key)];
  if (key === "leaderboard") components.unshift(leaderboardThemeRow(interaction.guildId));

  return interaction.update({
    embeds: [surface({ title: key[0].toUpperCase() + key.slice(1), description: guides[key] || "Module." })],
    components,
  });
}

async function findOrCreateTextChannel(guild, name, reason) {
  const existing = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText && ch.name === name
  );
  if (existing) return { channel: existing, created: false };
  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    reason,
  });
  return { channel, created: true };
}

async function createChannels(interaction, key) {
  const guild = interaction.guild;
  const me = guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ embeds: [danger("Missing permission", "I need **Manage Channels**.")], ephemeral: true });
  }

  if (key === "leaderboard") {
    const { channel: mgmt, created: mgmtNew } = await findOrCreateTextChannel(
      guild,
      "ascendant-boards",
      `${brand.name} leaderboard management`
    );
    const { channel: pub, created: pubNew } = await findOrCreateTextChannel(
      guild,
      "top-1-10",
      `${brand.name} public leaderboard`
    );
    api.leaderboard.updateConfig(guild.id, {
      setupCompleted: true,
      managementChannelId: mgmt.id,
      publicChannelIds: [pub.id],
    });
    await ensureTipsMessage(mgmt, guild.id, "leaderboard");
    await publishLeaderboard(guild);
    const note =
      !mgmtNew && !pubNew
        ? "Reused existing channels (no duplicates)."
        : "Created missing channels; existing ones were reused.";
    return interaction.update({
      embeds: [
        surface({
          title: "Leaderboard ready",
          description: `Management: ${mgmt}\nPublic: ${pub}\n\n${note}\nPaste the draft text block in ${mgmt}, then type \`send\`.`,
        }),
      ],
      components: [leaderboardThemeRow(guild.id), moduleButtons(key)],
    });
  }

  if (key === "lineup") {
    const { channel: mgmt, created: mgmtNew } = await findOrCreateTextChannel(
      guild,
      "ascendant-lineups",
      `${brand.name} lineup management`
    );
    const { channel: na, created: naNew } = await findOrCreateTextChannel(
      guild,
      "lineup-na",
      `${brand.name} NA lineup`
    );
    const cfg = api.lineup.getConfig(guild.id);
    cfg.regions.na.channelId = na.id;
    api.lineup.updateConfig(guild.id, {
      setupCompleted: true,
      managementChannelId: mgmt.id,
      regions: cfg.regions,
    });
    await ensureTipsMessage(mgmt, guild.id, "lineup");
    await publishLineup(guild, "na");
    const note =
      !mgmtNew && !naNew
        ? "Reused existing channels (no duplicates)."
        : "Created missing channels; existing ones were reused.";
    return interaction.update({
      embeds: [
        surface({
          title: "Lineup ready",
          description: `Management: ${mgmt}\nNA board: ${na}\n\n${note}\nPaste the draft text block in ${mgmt}, then type \`send\`.`,
        }),
      ],
      components: [moduleButtons(key)],
    });
  }

  if (key === "ranking") {
    api.ranking.updateConfig(guild.id, { setupCompleted: true });
    return interaction.update({
      embeds: [surface({ title: "Ranking enabled", description: "Use `'stage @user 0 Low Weak`." })],
      components: [moduleButtons(key)],
    });
  }

  if (key === "score") {
    api.score.updateConfig(guild.id, { setupCompleted: true, logChannelId: interaction.channelId });
    return interaction.update({
      embeds: [surface({ title: "Score enabled", description: "Use `/score` to log 1v1s." })],
      components: [moduleButtons(key)],
    });
  }

  if (key === "blacklist") {
    return interaction.update({
      embeds: [
        surface({
          title: "Website lists",
          description: "No Discord channels or commands needed. Use the website dashboard.",
        }),
      ],
      components: [moduleButtons(key)],
    });
  }
}

async function handleSetupInteraction(interaction) {
  const id = interaction.customId || "";
  if (id === HUB_ID) {
    if (!isAdminOrOwner(interaction.member, interaction.guild)) {
      return interaction.reply({ content: "Administrator only.", ephemeral: true });
    }
    return openModule(interaction, interaction.values[0]);
  }
  if (id === THEME_ID) {
    if (!isAdminOrOwner(interaction.member, interaction.guild)) {
      return interaction.reply({ content: "Administrator only.", ephemeral: true });
    }
    const theme = resolveTheme(interaction.values[0]);
    api.leaderboard.updateConfig(interaction.guildId, { theme: theme.id });
    await publishLeaderboard(interaction.guild).catch(() => {});
    return interaction.update({
      embeds: [
        surface({
          title: "Leaderboard",
          description:
            `Theme set to **${theme.label}**.\n\n` +
            "Creates `#ascendant-boards` (draft: `1 @user`) and `#top-1-10`.\n" +
            "Pick a **theme**, place players, then **Publish / refresh**.\n\n" +
            "**Classic cards** — separate GIF card embeds\n" +
            "**Metallic v2** — one message, generated banner, Discord separator lines",
        }),
      ],
      components: [leaderboardThemeRow(interaction.guildId), moduleButtons("leaderboard")],
    });
  }
  if (id === "asc:setup:back") {
    return interaction.update(hubPayload(interaction.guildId));
  }
  const create = id.match(/^asc:setup:(\w+):create$/);
  if (create) return createChannels(interaction, create[1]);
  const publish = id.match(/^asc:setup:(\w+):publish$/);
  if (publish) {
    if (publish[1] === "leaderboard") {
      await publishLeaderboard(interaction.guild);
      const cfg = api.leaderboard.getConfig(interaction.guildId);
      const ch = cfg.managementChannelId
        ? await interaction.guild.channels.fetch(cfg.managementChannelId).catch(() => null)
        : null;
      if (ch) await ensureTipsMessage(ch, interaction.guildId, "leaderboard");
      const { sweepManagementChannel } = require("./mgmtDraft");
      if (ch) await sweepManagementChannel(ch, interaction.guildId, "leaderboard");
    }
    if (publish[1] === "lineup") {
      await publishLineup(interaction.guild);
      const cfg = api.lineup.getConfig(interaction.guildId);
      const ch = cfg.managementChannelId
        ? await interaction.guild.channels.fetch(cfg.managementChannelId).catch(() => null)
        : null;
      if (ch) {
        await ensureTipsMessage(ch, interaction.guildId, "lineup");
        const { sweepManagementChannel } = require("./mgmtDraft");
        await sweepManagementChannel(ch, interaction.guildId, "lineup");
      }
    }
    const components =
      publish[1] === "leaderboard"
        ? [leaderboardThemeRow(interaction.guildId), moduleButtons("leaderboard")]
        : [moduleButtons(publish[1])];
    return interaction.update({
      embeds: [surface({ title: "Published", description: "Boards refreshed." })],
      components,
    });
  }
  return false;
}

async function handleDraftMessage(message) {
  const result = await handleManagementDraft(message);
  if (!result) return false;
  await sweepIfManagementChannel(message, message.guild.id, { delayMs: 900 });
  return Boolean(result.handled);
}

const { hubPayload: tsbHubPayload } = require("./tsb/hub");

module.exports = {
  HUB_ID: "tsb:hub",
  hubPayload: tsbHubPayload,
  handleSetupInteraction,
  handleDraftMessage,
};
