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

const HUB_ID = "asa:hub";

function moduleStatus(guildId) {
  return [
    { label: "Top Leaderboard", value: "leaderboard", description: api.leaderboard.getConfig(guildId).setupCompleted ? "Configured" : "Not configured" },
    { label: "Ranking / Stages", value: "ranking", description: api.ranking.getConfig(guildId).setupCompleted ? "Configured" : "Not configured" },
    { label: "1v1 Score", value: "score", description: api.score.getConfig(guildId).setupCompleted ? "Configured" : "Not configured" },
    { label: "Line Up", value: "lineup", description: api.lineup.getConfig(guildId).setupCompleted ? "Configured" : "Not configured" },
    { label: "Blacklist", value: "blacklist", description: `${api.blacklist.getList(guildId).entries.length} listed` },
    { label: "Trainers", value: "trainers", description: `${api.trainers.getList(guildId).trainers.length} listed` },
  ];
}

function hubPayload(guildId) {
  return {
    embeds: [
      surface({
        title: `${brand.name} server setup`,
        description:
          "Pick a module. This is the clan setup hub (`'serversetup` / `/serversetup`).\n\n" +
          "> **Leaderboard** — `#top-*` cards with GIF + avatar\n" +
          "> **Ranking** — `'stage @user 0 Low Weak`\n" +
          "> **Score** — `/score` records W/L on cards\n" +
          "> **Line Up** — regional boards\n" +
          "> **Blacklist / Trainers** — shown on the website",
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
    new ButtonBuilder().setCustomId(`asa:setup:${moduleKey}:create`).setLabel("Create channels").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`asa:setup:${moduleKey}:publish`).setLabel("Publish / refresh").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`asa:setup:back`).setLabel("Back").setStyle(ButtonStyle.Secondary)
  );
}

async function openModule(interaction, key) {
  const guides = {
    leaderboard:
      "Creates `#asa-boards` (draft: `1 @user`) and `#top-1-10`.\nAfter placing players, press **Publish / refresh**.",
    ranking:
      "Enables `'stage @user 0 Low Weak` (or `/stage`). Stages print on leaderboard and lineup cards.",
    score:
      "Enables `/score` 1v1 logging. Wins/losses show on website + Discord cards.",
    lineup:
      "Creates `#asa-lineups` and `#lineup-na`. Use `'lineup add na 1 @user` then publish.",
    blacklist:
      "Blacklist is managed on the website (Report + staff Dashboard). No Discord command.",
    trainers:
      "Trainers are configured on the website dashboard (staff login only).",
  };

  return interaction.update({
    embeds: [surface({ title: key[0].toUpperCase() + key.slice(1), description: guides[key] || "Module." })],
    components: [moduleButtons(key)],
  });
}

async function createChannels(interaction, key) {
  const guild = interaction.guild;
  const me = guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ embeds: [danger("Missing permission", "I need **Manage Channels**.")], ephemeral: true });
  }

  if (key === "leaderboard") {
    const mgmt = await guild.channels.create({
      name: "asa-boards",
      type: ChannelType.GuildText,
      reason: `${brand.name} leaderboard management`,
    });
    const pub = await guild.channels.create({
      name: "top-1-10",
      type: ChannelType.GuildText,
      reason: `${brand.name} public leaderboard`,
    });
    api.leaderboard.updateConfig(guild.id, {
      setupCompleted: true,
      managementChannelId: mgmt.id,
      publicChannelIds: [pub.id],
    });
    await mgmt.send({
      embeds: [
        surface({
          title: "Leaderboard draft",
          description: "Type `1 @user` through `10 @user` here to place players. Then run `'serversetup` → Publish.",
        }),
      ],
    });
    await publishLeaderboard(guild);
    return interaction.update({
      embeds: [surface({ title: "Leaderboard ready", description: `Management: ${mgmt}\nPublic: ${pub}` })],
      components: [moduleButtons(key)],
    });
  }

  if (key === "lineup") {
    const mgmt = await guild.channels.create({
      name: "asa-lineups",
      type: ChannelType.GuildText,
    });
    const na = await guild.channels.create({
      name: "lineup-na",
      type: ChannelType.GuildText,
    });
    const cfg = api.lineup.getConfig(guild.id);
    cfg.regions.na.channelId = na.id;
    api.lineup.updateConfig(guild.id, {
      setupCompleted: true,
      managementChannelId: mgmt.id,
      regions: cfg.regions,
    });
    await mgmt.send({
      embeds: [
        surface({
          title: "Lineup management",
          description: "`'lineup add na 1 @user` · `'lineup remove na 1` · `'lineup publish na`",
        }),
      ],
    });
    await publishLineup(guild, "na");
    return interaction.update({
      embeds: [surface({ title: "Lineup ready", description: `Management: ${mgmt}\nNA board: ${na}` })],
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

  if (key === "blacklist" || key === "trainers") {
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
  if (id === "asa:setup:back") {
    return interaction.update(hubPayload(interaction.guildId));
  }
  const create = id.match(/^asa:setup:(\w+):create$/);
  if (create) return createChannels(interaction, create[1]);
  const publish = id.match(/^asa:setup:(\w+):publish$/);
  if (publish) {
    if (publish[1] === "leaderboard") await publishLeaderboard(interaction.guild);
    if (publish[1] === "lineup") await publishLineup(interaction.guild);
    return interaction.update({
      embeds: [surface({ title: "Published", description: "Boards refreshed." })],
      components: [moduleButtons(publish[1])],
    });
  }
  return false;
}

async function handleDraftMessage(message) {
  if (!message.guild || message.author.bot) return false;
  const cfg = api.leaderboard.getConfig(message.guild.id);
  if (!cfg.managementChannelId || message.channelId !== cfg.managementChannelId) return false;
  const match = message.content.trim().match(/^(\d{1,2})\s+<@!?(\d+)>$/);
  if (!match) return false;
  const position = Number(match[1]);
  const userId = match[2];
  api.leaderboard.place(message.guild.id, position, userId);
  await publishLeaderboard(message.guild).catch(() => {});
  await message.react("✅").catch(() => {});
  return true;
}

module.exports = { HUB_ID, hubPayload, handleSetupInteraction, handleDraftMessage };
