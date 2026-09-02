const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");
const api = require("../utils/loadApi");
const { surface, danger, ok, brand } = require("../utils/embeds");
const { isOwner, isAdminOrOwner } = require("../utils/permissions");
const { REGIONS } = api.regions;
const { CHARACTERS, getCharacterLabel } = api.characters;
const { profileDividerAttachment } = require("./profileDivider");
const { resolveCountry } = require("./profileCountries");

const sessions = new Map();
const lastGuildByUser = new Map();

function maybe(value) {
  return Promise.resolve(value);
}

function rememberGuild(userId, guildId) {
  if (userId && guildId) lastGuildByUser.set(String(userId), String(guildId));
}

function resolveGuildId(interaction, session) {
  return (
    interaction.guildId ||
    session?.guildId ||
    lastGuildByUser.get(String(interaction.user?.id)) ||
    null
  );
}

async function resolveGuild(interaction, session) {
  if (interaction.guild) {
    rememberGuild(interaction.user.id, interaction.guild.id);
    return interaction.guild;
  }
  const guildId = resolveGuildId(interaction, session);
  if (!guildId) return null;
  const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
  if (guild) rememberGuild(interaction.user.id, guild.id);
  return guild;
}

function withEphemeral(interaction, payload) {
  if (interaction.inGuild?.()) return payload;
  const next = { ...payload };
  delete next.ephemeral;
  return next;
}

async function sendProfileToUser(user, guild) {
  rememberGuild(user.id, guild.id);
  const profile = await maybe(api.profiles.getProfile(guild.id, user.id));
  const payload = profile ? await payloadFor(guild, user.id) : registerPrompt(user.id);
  await user.send(payload);
  return { hasProfile: !!(profile && profile.roblox_username) };
}

function discordRelative(isoOrDate) {
  if (!isoOrDate) return "none";
  const ms = isoOrDate instanceof Date ? isoOrDate.getTime() : new Date(isoOrDate).getTime();
  if (!Number.isFinite(ms)) return "none";
  if (ms <= Date.now()) return "ready";
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function profileEmbed(profile, extras = {}) {
  const titleName =
    profile.display_name || profile.roblox_display_name || profile.roblox_username || "Player";
  const robloxUsername = profile.roblox_username || "—";
  const robloxUrl = profile.roblox_id
    ? `https://www.roblox.com/users/${profile.roblox_id}/profile`
    : null;
  const country = profile.country_flag
    ? `${profile.country_flag} ${profile.country || ""}`.trim()
    : profile.country || "—";
  const record =
    extras.wins || extras.losses
      ? `> **Record:** ${extras.wins || 0}W · ${extras.losses || 0}L`
      : "> No scored matches yet";
  const cooldownActive = extras.cooldownUntil && new Date(extras.cooldownUntil).getTime() > Date.now();
  const cooldown = cooldownActive ? discordRelative(extras.cooldownUntil) : "Ready";
  const threshold = Number(extras.autowinThreshold) || 3;
  const strikes = Number(extras.autowinStrikes) || 0;
  const autowin = extras.autowinEnabled === false ? "Off" : `${strikes}/${threshold}`;

  const embed = new EmbedBuilder()
    .setColor(brand.color || 0x2b2d31)
    .setTitle(`Profile: ${titleName}`)
    .addFields(
      {
        name: "Roblox",
        value: robloxUrl ? `[@${robloxUsername}](${robloxUrl})` : robloxUsername,
        inline: true,
      },
      { name: "Main Character", value: profile.main_character || "—", inline: true },
      { name: "Region", value: api.regions.regionLabel(profile.region), inline: true },
      { name: "Country", value: country, inline: true },
      { name: "Phase", value: extras.stage || "No phase", inline: true },
      { name: "Cooldown", value: cooldown, inline: true },
      { name: "1v1 Score", value: record, inline: false },
      { name: "Autowin", value: autowin, inline: true }
    )
    .setFooter({ text: "Profile system" })
    .setTimestamp();

  if (profile.roblox_avatar_url) {
    embed.setThumbnail(profile.roblox_avatar_url);
    embed.setAuthor({ name: titleName, iconURL: profile.roblox_avatar_url });
  }
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

function adminCreateRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`asc:profile:admin_start:${userId}`)
      .setLabel("Create profile for this user")
      .setStyle(ButtonStyle.Success)
  );
}

async function payloadFor(guild, userId) {
  const profile = await maybe(api.profiles.getProfile(guild.id, userId));
  if (!profile) return null;
  const stage = (await maybe(api.ranking.getStage(guild.id, userId))) || "Unranked";
  const record = (await maybe(api.score.getRecord(guild.id, userId))) || { wins: 0, losses: 0 };
  let cooldownUntil = null;
  let autowinStrikes = 0;
  let autowinThreshold = 3;
  let autowinEnabled = true;
  try {
    const { getScoreConfig, getPlayerState } = require("./tsb/score/config");
    const cfg = await maybe(getScoreConfig(guild.id));
    const state = await maybe(getPlayerState(guild.id, userId));
    cooldownUntil = state?.cooldownUntil || null;
    autowinStrikes = state?.autowinStrikes || 0;
    autowinThreshold = cfg?.autowinThreshold ?? 3;
    autowinEnabled = cfg?.autowinEnabled !== false;
  } catch {}
  const embed = profileEmbed(profile, {
    stage,
    wins: record.wins,
    losses: record.losses,
    cooldownUntil,
    autowinStrikes,
    autowinThreshold,
    autowinEnabled,
  });
  const files = [];
  const divider = await profileDividerAttachment();
  if (divider) {
    embed.setImage("attachment://profile-divider.png");
    files.push(divider);
  } else if (brand.defaultGif) {
    embed.setImage(brand.defaultGif);
  }
  return {
    embeds: [embed],
    components: [manageRow(userId)],
    files,
  };
}

function createModal() {
  return new ModalBuilder()
    .setCustomId("asc:profile:create")
    .setTitle("Create profile")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("display_name")
          .setLabel("Display name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("roblox_username")
          .setLabel("Roblox username")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32)
      )
    );
}

function adminCreateModal(targetId) {
  return new ModalBuilder()
    .setCustomId(`asc:profile:admin_create:${targetId}`)
    .setTitle("Create member profile")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("display_name")
          .setLabel("Display name (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(32)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("roblox_username")
          .setLabel("Roblox username or profile URL")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(200)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("region")
          .setLabel("Region value or name (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("miami, virginia, London")
          .setMaxLength(40)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("country")
          .setLabel("Country (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("United States, Brazil, US")
          .setMaxLength(40)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("character")
          .setLabel("Main character (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("The Strongest Hero, Hero Hunter, Tech Prodigy")
          .setMaxLength(40)
      )
    );
}

function resolveAdminRegion(input) {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return null;
  const found = REGIONS.find(
    (region) => region.value.toLowerCase() === value || region.label.toLowerCase() === value
  );
  return found?.value || null;
}

function resolveAdminCharacter(input) {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return null;
  const label = getCharacterLabel(value);
  return CHARACTERS.find((character) => character.toLowerCase() === label.toLowerCase()) || null;
}

async function createAdminProfile({ guild, actor, member, targetUser, displayName, robloxUsername, region, country, character }) {
  if (!isAdminOrOwner(member, guild)) {
    throw new Error("Only server administrators can create profiles for other members.");
  }
  if (!targetUser?.id) throw new Error("Choose a Discord member first.");

  const roblox = await api.roblox.resolveRobloxUser(String(robloxUsername || "").trim());
  const resolvedRegion = resolveAdminRegion(region);
  if (region && !resolvedRegion) {
    throw new Error("Unknown region. Use a region value like `miami` or `virginia`.");
  }
  const resolvedCountry = country ? resolveCountry(country) : null;
  if (country && !resolvedCountry) {
    throw new Error("Unknown country. Use a full country name or a two-letter code.");
  }
  const resolvedCharacter = character ? resolveAdminCharacter(character) : null;
  if (character && !resolvedCharacter) {
    throw new Error(`Unknown character. Choose one of: ${CHARACTERS.join(", ")}.`);
  }

  await maybe(api.profiles.saveProfile(guild.id, targetUser.id, {
    display_name: String(displayName || "").trim() || targetUser.globalName || targetUser.username || roblox.displayName,
    roblox_username: roblox.name,
    roblox_display_name: roblox.displayName,
    roblox_id: roblox.id,
    roblox_avatar_url: roblox.avatarUrl,
    region: resolvedRegion,
    country: resolvedCountry?.name || null,
    country_flag: resolvedCountry?.flag || null,
    main_character: resolvedCharacter,
    verified_at: new Date().toISOString(),
  }));
  rememberGuild(targetUser.id, guild.id);
  refreshBoards(guild, targetUser.id);
  return payloadFor(guild, targetUser.id);
}

function countryModal() {
  return new ModalBuilder()
    .setCustomId("asc:profile:country")
    .setTitle("Select country")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("country_name")
          .setLabel("Country name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g. Brazil")
          .setMaxLength(40)
      )
    );
}

function regionRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("asc:profile:region")
      .setPlaceholder("Select your primary region")
      .addOptions(REGIONS.slice(0, 25).map((r) => ({ label: r.label, value: r.value })))
  );
}

function characterRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("asc:profile:character")
      .setPlaceholder("Select your main character")
      .addOptions(CHARACTERS.map((c) => ({ label: c, value: c })))
  );
}

function registerPrompt(userId) {
  return {
    embeds: [
      surface({
        title: "Profile setup",
        description: "You are not registered yet. Would you like to create your profile now?",
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`asc:profile:yes:${userId}`)
          .setLabel("Yes, register me")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`asc:profile:no:${userId}`)
          .setLabel("No")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function verificationRequired(guildId) {
  try {
    const { getLeaderboardConfig } = require("./tsb/leaderboard/config");
    const cfg = getLeaderboardConfig(guildId);
    if (cfg && typeof cfg.then === "function") return true;
    return cfg.requireRobloxVerification !== false;
  } catch {
    return true;
  }
}

function genVerifyCode() {
  const chars = "ABCDEF0123456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return `${String(brand.name || "ASCENDANT").replace(/\s+/g, "").toUpperCase()}-${code}`;
}

function refreshBoards(guild, userId) {
  try {
    const { refreshUserBoardsBackground } = require("./tsb/shared/boardRefresh");
    refreshUserBoardsBackground(guild, userId);
  } catch {}
}

async function persistSession(guild, userId, session) {
  rememberGuild(userId, guild.id);
  await maybe(
    api.profiles.saveProfile(guild.id, userId, {
      display_name: session.displayName,
      roblox_username: session.roblox.name,
      roblox_display_name: session.roblox.displayName,
      roblox_id: session.roblox.id,
      roblox_avatar_url: session.roblox.avatarUrl,
      region: session.region || null,
      country: session.country?.name || null,
      country_flag: session.country?.flag || null,
      main_character: session.mainCharacter || null,
      verified_at: new Date().toISOString(),
    })
  );
  sessions.delete(userId);
  sessions.set(userId, { guildId: guild.id, completedAt: Date.now() });
  refreshBoards(guild, userId);
  if (!process.env.API_SERVER_URL && !process.env.API_URL) {
    try {
      const { alertProfile, checkDuplicateRoblox } = require("./tsb/ops/alerts");
      const user = await guild.client.users.fetch(userId).catch(() => ({ id: userId }));
      await alertProfile(guild, user, {
        roblox_username: session.roblox.name,
        region: session.region,
        country: session.country?.name,
      });
      await checkDuplicateRoblox(guild, userId, session.roblox.id, session.roblox.name);
    } catch {}
  }
  try {
    const { onProfileCompleted } = require("./tsb/verify/runtime");
    onProfileCompleted(guild, userId).catch(() => {});
  } catch {}
  return payloadFor(guild, userId);
}

function verifyPayload(session) {
  return {
    content: null,
    embeds: [
      surface({
        title: "Verify Roblox",
        thumbnail: session.roblox?.avatarUrl,
        description:
          `Found **${session.roblox.displayName}** (@${session.roblox.name}).\n\n` +
          `Add this exact phrase to your Roblox **About / bio**, then confirm within 10 minutes:\n\n\`${session.code}\``,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("asc:profile:verify").setLabel("I added it").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("asc:profile:verify:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setLabel("Open Roblox")
          .setStyle(ButtonStyle.Link)
          .setURL(`https://www.roblox.com/users/${session.roblox.id}/profile`)
      ),
    ],
  };
}

async function handleProfileCommand({ guild, actor, targetUser, query, member }) {
  if (guild?.id) rememberGuild(actor.id, guild.id);
  let userId = actor.id;
  let profile = null;

  if (targetUser) {
    userId = targetUser.id;
    profile = await maybe(api.profiles.getProfile(guild.id, userId));
  } else if (query) {
    const mention = query.match(/^<@!?(\d+)>$/) || query.match(/^(\d{17,19})$/);
    if (mention) {
      userId = mention[1];
      profile = await maybe(api.profiles.getProfile(guild.id, userId));
    } else {
      profile = await maybe(api.profiles.findByRoblox(guild.id, query));
      if (!profile && api.profiles.searchProfiles) {
        const matches = await maybe(api.profiles.searchProfiles(guild.id, query, 8));
        if (Array.isArray(matches) && matches.length > 1) {
          const lines = matches.slice(0, 8).map((p) => {
            const name = p.roblox_username || p.robloxUsername || "?";
            const code = p.profile_id || p.profileId || "—";
            return `• **@${name}** · code \`${code}\` · <@${p.discord_id || p.discordId}>`;
          });
          return {
            embeds: [
              danger(
                "Multiple profiles matched",
                `Several profiles match **${query}**. Pick one:\n\n${lines.join("\n")}\n\n` +
                  "Tip: use the exact Roblox username, profile code, or `/profile user:@member`."
              ),
            ],
          };
        }
        if (Array.isArray(matches) && matches.length === 1) profile = matches[0];
      }
      // Username changed on Roblox but we still have the old roblox_id linked
      if (!profile) {
        try {
          const roblox = await api.roblox.resolveRobloxUser(String(query).trim());
          if (roblox?.id) {
            profile = await maybe(api.profiles.findByRoblox(guild.id, String(roblox.id)));
          }
        } catch {
          /* ignore resolve failures */
        }
      }
      if (profile) userId = profile.discord_id || profile.discordId;
    }
  } else {
    profile = await maybe(api.profiles.getProfile(guild.id, actor.id));
  }

  if (!profile) {
    if (query && !targetUser) {
      return {
        embeds: [
          danger(
            "No profile",
            `No linked profile found for **${query}**.\n` +
              "Try Roblox username, profile URL, profile code (e.g. `ACD`), Discord ID, or `/profile user:@member`."
          ),
        ],
      };
    }
    if (userId !== actor.id) {
      const admin = isAdminOrOwner(member, guild);
      return {
        embeds: [danger("No profile", "That player has not created a profile.")],
        ...(admin ? { components: [adminCreateRow(userId)] } : {}),
      };
    }
    return registerPrompt(actor.id);
  }

  const canManage =
    actor.id === userId ||
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    isOwner(actor.id);
  const data = await payloadFor(guild, userId);
  if (!canManage) data.components = [];
  return data;
}

async function autocompleteProfileQuery(guildId, focusedValue = "") {
  if (!guildId || !api.profiles.searchProfiles) return [];
  const matches = await maybe(api.profiles.searchProfiles(guildId, focusedValue, 25));
  if (!Array.isArray(matches)) return [];
  return matches.slice(0, 25).map((p) => {
    const username = p.roblox_username || p.robloxUsername || "unknown";
    const code = p.profile_id || p.profileId || "";
    const label = code ? `@${username} (${code})` : `@${username}`;
    return {
      name: label.slice(0, 100),
      value: String(username).slice(0, 100),
    };
  });
}

function getSession(interaction) {
  return sessions.get(interaction.user.id) || null;
}

function expiredSession(interaction) {
  const payload = withEphemeral(interaction, {
    embeds: [danger("Session expired", "Use `/profile` or `'profile` again.")],
    ephemeral: true,
  });
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }
  if (interaction.isModalSubmit?.() || !interaction.message) {
    return interaction.reply(payload);
  }
  return interaction.reply(payload);
}

async function handleProfileInteraction(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("asc:profile")) return false;

  if (id.startsWith("asc:profile:yes:")) {
    const ownerId = id.slice("asc:profile:yes:".length);
    if (ownerId !== interaction.user.id) {
      return interaction.reply(withEphemeral(interaction, { content: "This is not your profile.", ephemeral: true }));
    }
    return interaction.showModal(createModal());
  }

  if (id.startsWith("asc:profile:admin_start:")) {
    const targetId = id.slice("asc:profile:admin_start:".length);
    if (!interaction.guild || !isAdminOrOwner(interaction.member, interaction.guild)) {
      return interaction.reply(withEphemeral(interaction, {
        content: "Only server administrators can create profiles for other members.",
        ephemeral: true,
      }));
    }
    return interaction.showModal(adminCreateModal(targetId));
  }

  if (id === "asc:profile:start") {
    return interaction.showModal(createModal());
  }

  if (id.startsWith("asc:profile:no:")) {
    const ownerId = id.slice("asc:profile:no:".length);
    if (ownerId !== interaction.user.id) {
      return interaction.reply(withEphemeral(interaction, { content: "This is not your profile.", ephemeral: true }));
    }
    return interaction.update({
      content: "No problem. Use `/profile` or `'profile` to register anytime.",
      embeds: [],
      components: [],
    });
  }

  if (id === "asc:profile:create" && interaction.isModalSubmit()) {
    const displayName = interaction.fields.getTextInputValue("display_name").trim();
    const robloxUsername = interaction.fields.getTextInputValue("roblox_username").trim();
    let roblox;
    try {
      roblox = await api.roblox.resolveRobloxUser(robloxUsername);
    } catch (err) {
      return interaction.reply(withEphemeral(interaction, { embeds: [danger("Roblox lookup failed", err.message)], ephemeral: true }));
    }
    const prev = sessions.get(interaction.user.id) || {};
    const guildId = resolveGuildId(interaction, prev);
    if (guildId) rememberGuild(interaction.user.id, guildId);
    sessions.set(interaction.user.id, {
      displayName,
      robloxUsername,
      roblox,
      guildId,
      step: "region",
    });
    return interaction.reply(withEphemeral(interaction, {
      ephemeral: true,
      embeds: [surface({ title: "Profile setup", description: "Select your primary region." })],
      components: [regionRow()],
    }));
  }

  if (id.startsWith("asc:profile:admin_create:") && interaction.isModalSubmit()) {
    const targetId = id.slice("asc:profile:admin_create:".length);
    if (!interaction.guild || !isAdminOrOwner(interaction.member, interaction.guild)) {
      return interaction.reply(withEphemeral(interaction, {
        content: "Only server administrators can create profiles for other members.",
        ephemeral: true,
      }));
    }
    const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
    if (!targetUser) {
      return interaction.reply(withEphemeral(interaction, {
        embeds: [danger("Member not found", "That Discord member could not be fetched.")],
        ephemeral: true,
      }));
    }
    try {
      const payload = await createAdminProfile({
        guild: interaction.guild,
        actor: interaction.user,
        member: interaction.member,
        targetUser,
        displayName: interaction.fields.getTextInputValue("display_name"),
        robloxUsername: interaction.fields.getTextInputValue("roblox_username"),
        region: interaction.fields.getTextInputValue("region"),
        country: interaction.fields.getTextInputValue("country"),
        character: interaction.fields.getTextInputValue("character"),
      });
      return interaction.reply(withEphemeral(interaction, {
        ...payload,
        content: `Profile created for ${targetUser}. No Roblox bio code was required.`,
        ephemeral: true,
      }));
    } catch (err) {
      return interaction.reply(withEphemeral(interaction, {
        embeds: [danger("Could not create profile", err.message || "Profile creation failed.")],
        ephemeral: true,
      }));
    }
  }

  if (id === "asc:profile:region" && interaction.isStringSelectMenu()) {
    const session = getSession(interaction);
    if (!session) return expiredSession(interaction);
    session.region = interaction.values[0];
    session.step = "country";
    sessions.set(interaction.user.id, session);
    return interaction.showModal(countryModal());
  }

  if (id === "asc:profile:country" && interaction.isModalSubmit()) {
    const session = getSession(interaction);
    if (!session) return expiredSession(interaction);
    const input = interaction.fields.getTextInputValue("country_name").trim();
    const resolved = resolveCountry(input);
    if (!resolved) {
      return interaction.reply(withEphemeral(interaction, {
        ephemeral: true,
        embeds: [
          danger(
            "Unknown country",
            `Could not recognize "${input}". Use the full country name, then try again.`
          ),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("asc:profile:country:retry")
              .setLabel("Try again")
              .setStyle(ButtonStyle.Primary)
          ),
        ],
      }));
    }
    session.country = resolved;
    session.step = "confirm_country";
    sessions.set(interaction.user.id, session);
    return interaction.reply(withEphemeral(interaction, {
      ephemeral: true,
      embeds: [
        surface({
          title: "Confirm country",
          description: `Confirm country: ${resolved.flag} **${resolved.name}**?`,
        }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("asc:profile:country:yes").setLabel("Yes").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("asc:profile:country:no").setLabel("No").setStyle(ButtonStyle.Secondary)
        ),
      ],
    }));
  }

  if (id === "asc:profile:country:retry" || id === "asc:profile:country:no") {
    if (!sessions.has(interaction.user.id)) {
      return interaction.reply(withEphemeral(interaction, { embeds: [danger("Session expired", "Use `/profile` again.")], ephemeral: true }));
    }
    return interaction.showModal(countryModal());
  }

  if (id === "asc:profile:country:yes") {
    const session = getSession(interaction);
    if (!session) return expiredSession(interaction);
    session.step = "character";
    sessions.set(interaction.user.id, session);
    return interaction.update({
      content: null,
      embeds: [surface({ title: "Profile setup", description: "Select your main TSB character." })],
      components: [characterRow()],
    });
  }

  if (id === "asc:profile:character" && interaction.isStringSelectMenu()) {
    const session = getSession(interaction);
    if (!session) return expiredSession(interaction);
    session.mainCharacter = interaction.values[0];
    session.step = "verify";
    session.code = genVerifyCode();
    sessions.set(interaction.user.id, session);

    const guild = await resolveGuild(interaction, session);
    if (!guild) {
      return interaction.update({
        content: "Could not find the server for this profile. Start verification from the server again.",
        embeds: [],
        components: [],
      });
    }
    if (!verificationRequired(guild.id)) {
      const payload = await persistSession(guild, interaction.user.id, session);
      return interaction.update({ ...payload, content: null });
    }
    return interaction.update(verifyPayload(session));
  }

  if (id === "asc:profile:verify") {
    const session = getSession(interaction);
    if (!session) return expiredSession(interaction);
    if (!session.code || !session.roblox?.id) {
      return interaction.update({
        content: "Session expired. Use `/profile` again.",
        embeds: [],
        components: [],
      });
    }
    const okBio = await api.roblox.checkRobloxBio(session.roblox.id, session.code);
    if (!okBio) {
      return interaction.update({
        content: null,
        embeds: [
          danger(
            "Not found",
            `The code was not found in your Roblox bio. Make sure you added:\n\`${session.code}\`\n\nThen click the button again.`
          ),
        ],
        components: verifyPayload(session).components,
      });
    }
    const guild = await resolveGuild(interaction, session);
    if (!guild) {
      return interaction.update({
        content: "Could not find the server for this profile. Start verification from the server again.",
        embeds: [],
        components: [],
      });
    }
    const payload = await persistSession(guild, interaction.user.id, session);
    return interaction.update({ ...payload, content: null });
  }

  if (id === "asc:profile:verify:cancel") {
    sessions.delete(interaction.user.id);
    return interaction.update({
      content: "Profile creation canceled.",
      embeds: [],
      components: [],
    });
  }

  if (id.startsWith("asc:profile:manage:") && interaction.isStringSelectMenu()) {
    const targetId = id.split(":")[3];
    const action = interaction.values[0];
    if (action === "region") {
      return interaction.reply(withEphemeral(interaction, {
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`asc:profile:setregion:${targetId}`)
              .setPlaceholder("Region")
              .addOptions(REGIONS.slice(0, 25).map((r) => ({ label: r.label, value: r.value })))
          ),
        ],
      }));
    }
    if (action === "character") {
      return interaction.reply(withEphemeral(interaction, {
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`asc:profile:setcharacter:${targetId}`)
              .setPlaceholder("Main character")
              .addOptions(CHARACTERS.map((c) => ({ label: c, value: c })))
          ),
        ],
      }));
    }
    if (action === "delete") {
      const guild = await resolveGuild(interaction);
      await maybe(api.profiles.deleteProfile(guild?.id || resolveGuildId(interaction), targetId));
      refreshBoards(guild, targetId);
      return interaction.update({
        embeds: [ok("Profile deleted", "You can create a new one with `/profile`.")],
        components: [],
        files: [],
      });
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

  if (id.startsWith("asc:profile:setregion:") && interaction.isStringSelectMenu()) {
    const targetId = id.split(":")[3];
    const guild = await resolveGuild(interaction);
    await maybe(api.profiles.saveProfile(guild.id, targetId, { region: interaction.values[0] }));
    refreshBoards(guild, targetId);
    const payload = await payloadFor(guild, targetId);
    return interaction.update(payload);
  }

  if (id.startsWith("asc:profile:setcharacter:") && interaction.isStringSelectMenu()) {
    const targetId = id.split(":")[3];
    const guild = await resolveGuild(interaction);
    await maybe(api.profiles.saveProfile(guild.id, targetId, { main_character: interaction.values[0] }));
    const payload = await payloadFor(guild, targetId);
    return interaction.update(payload);
  }

  if (id.startsWith("asc:profile:edit:") && interaction.isModalSubmit()) {
    const [, , , action, targetId] = id.split(":");
    const value = interaction.fields.getTextInputValue("value").trim();
    const guild = await resolveGuild(interaction);
    if (action === "roblox") {
      const roblox = await api.roblox.resolveRobloxUser(value);
      await maybe(
        api.profiles.saveProfile(guild.id, targetId, {
          roblox_username: roblox.name,
          roblox_display_name: roblox.displayName,
          roblox_id: roblox.id,
          roblox_avatar_url: roblox.avatarUrl,
        })
      );
    } else if (action === "country") {
      const resolved = resolveCountry(value);
      if (!resolved) {
        return interaction.reply(withEphemeral(interaction, {
          embeds: [danger("Unknown country", `Could not recognize "${value}". Use the full country name.`)],
          ephemeral: true,
        }));
      }
      await maybe(
        api.profiles.saveProfile(guild.id, targetId, {
          country: resolved.name,
          country_flag: resolved.flag,
        })
      );
    } else {
      await maybe(api.profiles.saveProfile(guild.id, targetId, { display_name: value }));
    }
    refreshBoards(guild, targetId);
    const payload = await payloadFor(guild, targetId);
    return interaction.reply(withEphemeral(interaction, { ...payload, ephemeral: true }));
  }

  return false;
}

module.exports = {
  handleProfileCommand,
  handleProfileInteraction,
  autocompleteProfileQuery,
  profileEmbed,
  payloadFor,
  registerPrompt,
  rememberGuild,
  sendProfileToUser,
  createAdminProfile,
};
