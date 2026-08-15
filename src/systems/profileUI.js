const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const api = require("../utils/loadApi");
const { surface, danger, ok, brand } = require("../utils/embeds");
const { isOwner } = require("../utils/permissions");
const { REGIONS } = api.regions;
const { CHARACTERS } = api.characters;
const { publishLeaderboard, publishLineup } = require("./boardPublish");
const { profileDividerAttachment } = require("./profileDivider");

const sessions = new Map();

function profileEmbed(profile, extras = {}) {
  const roblox = profile.roblox_username
    ? profile.roblox_id
      ? `[@${profile.roblox_username}](https://www.roblox.com/users/${profile.roblox_id}/profile)`
      : `@${profile.roblox_username}`
    : "—";
  const embed = surface({
    title: `Profile: ${profile.roblox_display_name || profile.display_name || profile.roblox_username || "Player"}`,
    thumbnail: profile.roblox_avatar_url,
    fields: [
      { name: "Code", value: `\`${profile.profile_id || "—"}\``, inline: true },
      { name: "Roblox", value: roblox, inline: true },
      { name: "Display", value: profile.roblox_display_name || profile.display_name || "—", inline: true },
      { name: "Main", value: profile.main_character || "—", inline: true },
      { name: "Region", value: api.regions.regionLabel(profile.region), inline: true },
      { name: "Country", value: profile.country ? `${profile.country} ${profile.country_flag || ""}`.trim() : "—", inline: true },
      { name: "Stage", value: extras.stage || "Unranked", inline: true },
      { name: "Record", value: `${extras.wins || 0}W · ${extras.losses || 0}L`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
    ],
  });
  return embed;
}

function manageRow(userId, admin = false) {
  const options = [
    { label: "Change name", value: "name" },
    { label: "Change main character", value: "character" },
    { label: "Change region", value: "region" },
    { label: "Change country", value: "country" },
  ];
  if (!admin) {
    options.splice(1, 0, { label: "Change Roblox account", value: "roblox" });
    options.push({ label: "Delete profile", value: "delete" });
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`asc:profile:manage:${userId}`)
      .setPlaceholder("Manage profile")
      .addOptions(options)
  );
}

async function payloadFor(guild, userId) {
  const profile = api.profiles.getProfile(guild.id, userId);
  if (!profile) return null;
  const stage = api.ranking.getStage(guild.id, userId) || "Unranked";
  const record = api.score.getRecord(guild.id, userId);
  const divider = await profileDividerAttachment();
  return {
    embeds: [profileEmbed(profile, { stage, wins: record.wins, losses: record.losses })],
    components: [manageRow(userId)],
    files: divider ? [divider] : [],
  };
}

function createModal() {
  return new ModalBuilder()
    .setCustomId("asc:profile:create")
    .setTitle("Create profile")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("display_name").setLabel("Display name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("roblox_username").setLabel("Roblox username").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)
      )
    );
}

async function handleProfileCommand({ guild, actor, targetUser, query, member }) {
  let userId = actor.id;
  let profile = null;

  if (targetUser) {
    userId = targetUser.id;
    profile = api.profiles.getProfile(guild.id, userId);
  } else if (query) {
    const mention = query.match(/^<@!?(\d+)>$/) || query.match(/^(\d{17,19})$/);
    if (mention) {
      userId = mention[1];
      profile = api.profiles.getProfile(guild.id, userId);
    } else {
      profile = api.profiles.findByRoblox(guild.id, query);
      if (profile) userId = profile.discord_id;
    }
  } else {
    profile = api.profiles.getProfile(guild.id, actor.id);
  }

  if (!profile) {
    if (userId !== actor.id) {
      return { embeds: [danger("No profile", "That player has not created a profile.")] };
    }
    return {
      embeds: [
        surface({
          title: "Create your profile",
          description: "Link Roblox so leaderboard cards, lineups, and **TSB AI Coach** can confirm it's you.",
        }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("asc:profile:start").setLabel("Create profile").setStyle(ButtonStyle.Primary)
        ),
      ],
    };
  }

  const canManage =
    actor.id === userId ||
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    isOwner(actor.id);
  const data = await payloadFor(guild, userId);
  if (!canManage) data.components = [];
  return data;
}

async function handleProfileInteraction(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("asc:profile")) return false;

  if (id === "asc:profile:start") {
    return interaction.showModal(createModal());
  }

  if (id === "asc:profile:create" && interaction.isModalSubmit()) {
    const displayName = interaction.fields.getTextInputValue("display_name").trim();
    const robloxUsername = interaction.fields.getTextInputValue("roblox_username").trim();
    let roblox;
    try {
      roblox = await api.roblox.resolveRobloxUser(robloxUsername);
    } catch (err) {
      return interaction.reply({ embeds: [danger("Roblox lookup failed", err.message)], ephemeral: true });
    }
    const code = `${brand.name}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    sessions.set(interaction.user.id, {
      displayName,
      roblox,
      code,
      guildId: interaction.guildId,
    });
    return interaction.reply({
      ephemeral: true,
      embeds: [
        surface({
          title: "Verify Roblox",
          thumbnail: roblox.avatarUrl,
          description:
            `Found **${roblox.displayName}** (@${roblox.name}).\n\n` +
            `Put this code in your Roblox **About / bio**, then press Verify:\n\n\`${code}\``,
        }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("asc:profile:verify").setLabel("Verify bio").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setLabel("Open Roblox").setStyle(ButtonStyle.Link).setURL(`https://www.roblox.com/users/${roblox.id}/profile`)
        ),
      ],
    });
  }

  if (id === "asc:profile:verify") {
    const session = sessions.get(interaction.user.id);
    if (!session) {
      return interaction.reply({ embeds: [danger("Session expired", "Run `/profile` again.")], ephemeral: true });
    }
    const okBio = await api.roblox.checkRobloxBio(session.roblox.id, session.code);
    if (!okBio) {
      return interaction.reply({
        embeds: [danger("Not found", `I don't see \`${session.code}\` in that Roblox bio yet.`)],
        ephemeral: true,
      });
    }
    api.profiles.saveProfile(session.guildId, interaction.user.id, {
      display_name: session.displayName,
      roblox_username: session.roblox.name,
      roblox_display_name: session.roblox.displayName,
      roblox_id: session.roblox.id,
      roblox_avatar_url: session.roblox.avatarUrl,
      verified_at: new Date().toISOString(),
    });
    sessions.delete(interaction.user.id);
    const payload = await payloadFor(interaction.guild, interaction.user.id);
    return interaction.update({ ...payload, content: null });
  }

  if (id.startsWith("asc:profile:manage:") && interaction.isStringSelectMenu()) {
    const targetId = id.split(":")[3];
    const action = interaction.values[0];
    if (action === "region") {
      return interaction.reply({
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`asc:profile:region:${targetId}`)
              .setPlaceholder("Region")
              .addOptions(REGIONS.slice(0, 25).map((r) => ({ label: r.label, value: r.value })))
          ),
        ],
      });
    }
    if (action === "character") {
      return interaction.reply({
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`asc:profile:character:${targetId}`)
              .setPlaceholder("Main character")
              .addOptions(CHARACTERS.map((c) => ({ label: c, value: c })))
          ),
        ],
      });
    }
    if (action === "delete") {
      api.profiles.deleteProfile(interaction.guildId, targetId);
      return interaction.update({ embeds: [ok("Profile deleted", "You can create a new one with `/profile`.")], components: [] });
    }
    const modal = new ModalBuilder()
      .setCustomId(`asc:profile:edit:${action}:${targetId}`)
      .setTitle("Edit profile")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("value")
            .setLabel(action === "roblox" ? "New Roblox username" : action === "country" ? "Country" : "Display name")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
    return interaction.showModal(modal);
  }

  if (id.startsWith("asc:profile:region:") && interaction.isStringSelectMenu()) {
    const targetId = id.split(":")[3];
    api.profiles.saveProfile(interaction.guildId, targetId, { region: interaction.values[0] });
    await publishLeaderboard(interaction.guild).catch(() => {});
    await publishLineup(interaction.guild).catch(() => {});
    const payload = await payloadFor(interaction.guild, targetId);
    return interaction.update(payload);
  }

  if (id.startsWith("asc:profile:character:") && interaction.isStringSelectMenu()) {
    const targetId = id.split(":")[3];
    api.profiles.saveProfile(interaction.guildId, targetId, { main_character: interaction.values[0] });
    const payload = await payloadFor(interaction.guild, targetId);
    return interaction.update(payload);
  }

  if (id.startsWith("asc:profile:edit:") && interaction.isModalSubmit()) {
    const [, , , action, targetId] = id.split(":");
    const value = interaction.fields.getTextInputValue("value").trim();
    if (action === "roblox") {
      const roblox = await api.roblox.resolveRobloxUser(value);
      api.profiles.saveProfile(interaction.guildId, targetId, {
        roblox_username: roblox.name,
        roblox_display_name: roblox.displayName,
        roblox_id: roblox.id,
        roblox_avatar_url: roblox.avatarUrl,
      });
    } else if (action === "country") {
      api.profiles.saveProfile(interaction.guildId, targetId, { country: value });
    } else {
      api.profiles.saveProfile(interaction.guildId, targetId, { display_name: value });
    }
    await publishLeaderboard(interaction.guild).catch(() => {});
    const payload = await payloadFor(interaction.guild, targetId);
    return interaction.reply({ ...payload, ephemeral: true });
  }

  return false;
}

module.exports = { handleProfileCommand, handleProfileInteraction, profileEmbed };
