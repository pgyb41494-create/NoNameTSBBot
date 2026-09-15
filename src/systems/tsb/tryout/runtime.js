const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require("discord.js");
const api = require("../../../utils/loadApi");
const { resolveMaybe } = require("../../../utils/resolveMaybe");
const { getTryoutSettings } = require("./settings");
const { addTryoutCooldownRole } = require("../ranking/tryoutCooldown");
const { getRankingConfig } = require("../ranking/config");
const { hasAccessPerm } = require("../access/store");
const {
  tsbEmbed,
  COLOR_PRIMARY,
  COLOR_SURFACE,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_DANGER,
} = require("../shared/embeds");

const live = new Map();
const hydratedGuilds = new Set();

function genToken() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitize(raw) {
  if (!raw || typeof raw !== "object" || !raw.token || !raw.guildId) return null;
  const requiredSignups = Math.max(0, Number(raw.requiredSignups) || 0);
  let maxSignups = Math.max(0, Number(raw.maxSignups) || 0);
  if (maxSignups && requiredSignups && maxSignups < requiredSignups) {
    maxSignups = requiredSignups;
  }
  return {
    token: String(raw.token),
    guildId: String(raw.guildId),
    creatorId: String(raw.creatorId || ""),
    creatorName: String(raw.creatorName || "Unknown"),
    title: String(raw.title || "").trim().slice(0, 80),
    note: String(raw.note || "").trim().slice(0, 200),
    link: String(raw.link || "").trim(),
    channelId: String(raw.channelId || ""),
    messageId: raw.messageId ? String(raw.messageId) : null,
    ended: !!raw.ended,
    endedBy: raw.endedBy ? String(raw.endedBy) : null,
    requiredSignups,
    maxSignups,
    reminderMessage: String(raw.reminderMessage || "").trim().slice(0, 250),
    notifiedReady: !!raw.notifiedReady,
    pingRoleId: String(raw.pingRoleId || ""),
    signups: Array.isArray(raw.signups)
      ? raw.signups
          .map((s) => ({
            userId: String(s.userId || ""),
            username: String(s.username || "").trim().slice(0, 64),
          }))
          .filter((s) => s.userId && s.username)
      : [],
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function persist(session) {
  const clean = sanitize(session);
  if (!clean) return null;
  live.set(clean.token, clean);
  try {
    const saved = api.tryouts.saveSession(clean.guildId, clean);
    if (saved && typeof saved.then === "function") {
      saved.catch((err) => console.warn("[Tryout] saveSession failed:", err.message));
    }
  } catch (err) {
    console.warn("[Tryout] saveSession failed:", err.message);
  }
  return clean;
}

async function hydrateGuild(guildId) {
  const id = String(guildId || "");
  if (!id || hydratedGuilds.has(id)) return;
  try {
    let sessions = [];
    if (typeof api.tryouts?.listSessions === "function") {
      sessions = (await resolveMaybe(api.tryouts.listSessions(id))) || [];
    } else {
      const settings = await getTryoutSettings(id);
      sessions = Object.values(settings.sessions || {});
    }
    for (const raw of sessions) {
      const clean = sanitize(raw);
      if (clean) live.set(clean.token, clean);
    }
  } catch (err) {
    console.warn("[Tryout] hydrate failed:", err.message);
  }
  hydratedGuilds.add(id);
}

async function getSession(token, guildId = null) {
  const key = String(token || "");
  if (!key) return null;
  if (live.has(key)) return live.get(key);
  if (guildId) await hydrateGuild(guildId);
  return live.get(key) || null;
}

function isValidLink(link) {
  const value = String(link || "").trim();
  if (!value || value.length > 300) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidRobloxUsername(name) {
  return /^[A-Za-z0-9_]{3,20}$/.test(String(name || "").trim());
}

function canManageSession(member, guild, session) {
  if (!member || !session) return false;
  if (String(member.id) === String(session.creatorId)) return true;
  if (guild?.ownerId === member.id) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  if (hasAccessPerm(guild.id, member.id, "TRYOUTS")) return true;
  return member.permissions?.has?.(PermissionFlagsBits.ManageMessages);
}

function progressLine(session) {
  const count = session.signups.length;
  if (session.maxSignups) return `${count} / ${session.maxSignups}`;
  if (session.requiredSignups) return `${count} / ${session.requiredSignups} to unlock`;
  return `${count} signed up`;
}

function statusText(session) {
  const count = session.signups.length;
  const enough = !session.requiredSignups || count >= session.requiredSignups;
  const full = session.maxSignups && count >= session.maxSignups;
  if (session.ended) return `Closed by <@${session.endedBy || session.creatorId}>`;
  if (full) return "Full — signups closed";
  if (enough) return "Open — link unlocked";
  return `Need ${Math.max(session.requiredSignups - count, 0)} more to unlock the link`;
}

function embedColor(session) {
  const count = session.signups.length;
  const enough = !session.requiredSignups || count >= session.requiredSignups;
  const full = session.maxSignups && count >= session.maxSignups;
  if (session.ended) return COLOR_DANGER;
  if (full) return COLOR_WARN;
  if (enough) return COLOR_SUCCESS;
  return COLOR_PRIMARY;
}

function buildEmbed(session) {
  const count = session.signups.length;
  const list = session.signups.slice(0, 12).map((s, i) => {
    const who = s.userId ? `<@${s.userId}>` : s.username;
    return `**${i + 1}.** \`${s.username}\` · ${who}`;
  });
  const signupsValue = list.length
    ? `${list.join("\n")}${count > 12 ? `\n…and ${count - 12} more` : ""}`
    : "_Nobody has joined yet._";

  const enough = !session.requiredSignups || count >= session.requiredSignups;
  const linkValue = session.ended || enough
    ? `[Open private server](${session.link})`
    : `_Unlocks at **${session.requiredSignups}** signup${session.requiredSignups === 1 ? "" : "s"}_`;

  const fields = [
    { name: "Status", value: statusText(session), inline: false },
    { name: "Link", value: linkValue, inline: true },
    { name: "Host", value: `<@${session.creatorId}>`, inline: true },
    { name: "Signups", value: progressLine(session), inline: true },
  ];
  if (session.requiredSignups) {
    fields.push({ name: "Unlock at", value: `\`${session.requiredSignups}\``, inline: true });
  }
  if (session.maxSignups) {
    fields.push({ name: "Capacity", value: `\`${session.maxSignups}\``, inline: true });
  }
  if (session.pingRoleId) {
    fields.push({ name: "Ready ping", value: `<@&${session.pingRoleId}>`, inline: true });
  }
  fields.push({ name: "Players", value: signupsValue, inline: false });

  const title = session.title
    ? session.title
    : "Tryout signup";
  const description = [
    session.note || "Press **Join** with your Roblox username. The host link unlocks when the signup goal is met.",
    session.ended ? "" : "",
  ].filter(Boolean).join("\n\n");

  return tsbEmbed({
    title,
    description,
    color: embedColor(session),
    fields,
    footer: `Hosted by ${session.creatorName} · ${session.token}`,
    timestamp: session.createdAt || Date.now(),
  });
}

function buildRows(session) {
  const count = session.signups.length;
  const canOpen = session.ended || !session.requiredSignups || count >= session.requiredSignups;
  const full = !!(session.maxSignups && count >= session.maxSignups);
  const closed = !!session.ended;

  const publicRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tryout_join_${session.token}`)
      .setLabel(closed || full ? "Join" : "Join")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(closed || full),
    new ButtonBuilder()
      .setCustomId(`tryout_leave_${session.token}`)
      .setLabel("Leave")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`tryout_open_${session.token}`)
      .setLabel(canOpen ? "Get link" : "Link locked")
      .setStyle(canOpen ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(closed ? false : !canOpen)
  );

  const hostRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tryout_reminder_${session.token}`)
      .setLabel("Reminder DM")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`tryout_end_${session.token}`)
      .setLabel(closed ? "Ended" : "End tryout")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(closed)
  );

  return [publicRow, hostRow];
}

/** @deprecated use buildRows */
function buildRow(session) {
  return buildRows(session)[0];
}

function listPayload(sessions) {
  const sorted = [...sessions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const active = sorted.filter((s) => !s.ended);
  const ended = sorted.filter((s) => s.ended).slice(0, 8);

  const activeValue = active.length
    ? active.map((s, i) => {
      const label = s.title || "Tryout";
      return `**${i + 1}.** ${label} · <#${s.channelId}> · ${progressLine(s)} · <@${s.creatorId}>`;
    }).join("\n")
    : "_No active tryouts._";

  const fields = [{ name: "Active", value: activeValue.slice(0, 1024) }];
  if (ended.length) {
    fields.push({
      name: "Recently ended",
      value: ended.map((s, i) => {
        const label = s.title || "Tryout";
        return `**${i + 1}.** ${label} · <@${s.creatorId}> · ${s.signups.length} joined`;
      }).join("\n").slice(0, 1024),
    });
  }

  const embed = tsbEmbed({
    title: "Tryouts",
    description: active.length
      ? `${active.length} active session${active.length === 1 ? "" : "s"}. Use the menu to end one, or \`/tryout end\`.`
      : "No active tryouts. Create one with `/tryout create`.",
    color: COLOR_SURFACE,
    fields,
    footer: "Ascendant · tryouts",
    timestamp: true,
  });

  const components = [];
  if (active.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("tryout_end_selected")
        .setPlaceholder("End an active tryout")
        .addOptions(active.slice(0, 25).map((s, i) => ({
          label: `${s.title || `Tryout #${i + 1}`}`.slice(0, 100),
          description: `${progressLine(s)} · ${s.creatorName}`.slice(0, 100),
          value: s.token,
        })))
    ));
  }
  return { embed, components };
}

async function refreshMessage(client, session) {
  if (!session?.channelId || !session?.messageId) return;
  const channel = await client.channels.fetch(session.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const message = await channel.messages.fetch(session.messageId).catch(() => null);
  if (!message) return;
  await message.edit({ embeds: [buildEmbed(session)], components: buildRows(session) }).catch(() => {});
}

async function notifyReady(client, session) {
  const dmText = session.reminderMessage
    || "Your tryout is ready — the signup goal was reached. Use **Get link** on the tryout message.";
  for (const signup of session.signups) {
    if (!signup.userId) continue;
    const user = await client.users.fetch(signup.userId).catch(() => null);
    if (user) {
      await user.send({
        content: `**Tryout ready**${session.title ? ` · ${session.title}` : ""}\n${dmText}\n${session.link}`,
      }).catch(() => {});
    }
  }
  const creator = await client.users.fetch(session.creatorId).catch(() => null);
  if (creator) {
    await creator.send({
      content: `**Your tryout is ready**${session.title ? ` · ${session.title}` : ""}\n${dmText}\n${session.link}`,
    }).catch(() => {});
  }
  const channel = await client.channels.fetch(session.channelId).catch(() => null);
  if (channel?.isTextBased?.() && session.pingRoleId) {
    await channel.send({
      content: `<@&${session.pingRoleId}> tryout is ready — link unlocked.`,
      allowedMentions: { roles: [session.pingRoleId] },
    }).catch(() => {});
  }
}

async function closeSession(client, token, endedBy) {
  const session = live.get(token) || await getSession(token);
  if (!session) return null;
  if (!session.ended) {
    session.ended = true;
    session.endedBy = endedBy;
    session.updatedAt = Date.now();
    persist(session);
    await refreshMessage(client, session);
  }
  return session;
}

async function guildSessions(guildId) {
  await hydrateGuild(guildId);
  return [...live.values()].filter((s) => s.guildId === String(guildId));
}

async function createTryout(interaction, options) {
  const settings = await getTryoutSettings(interaction.guild.id);
  if (!settings.channelId) {
    return interaction.editReply({
      content: "Tryouts aren’t configured yet. Use `'setup` → **Tryouts** and pick a channel.",
    });
  }
  const channel = await interaction.guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return interaction.editReply({ content: "The tryout channel is missing. Re-select it in `'setup` → **Tryouts**." });
  }

  const link = String(options.link || "").trim();
  if (!isValidLink(link)) {
    return interaction.editReply({ content: "Link must be a valid `http://` or `https://` URL." });
  }

  let requiredSignups = options.requiredSignups;
  if (requiredSignups == null) requiredSignups = settings.defaultRequiredSignups || 0;
  requiredSignups = Math.max(0, Number(requiredSignups) || 0);

  let maxSignups = options.maxSignups;
  if (maxSignups == null) maxSignups = settings.defaultMaxSignups || 0;
  maxSignups = Math.max(0, Number(maxSignups) || 0);
  if (maxSignups && requiredSignups && maxSignups < requiredSignups) {
    return interaction.editReply({
      content: `Max signups (\`${maxSignups}\`) can’t be lower than required (\`${requiredSignups}\`).`,
    });
  }

  const session = persist({
    token: genToken(),
    guildId: interaction.guild.id,
    creatorId: interaction.user.id,
    creatorName: interaction.member?.displayName || interaction.user.username,
    title: options.title || "",
    note: options.note || "",
    link,
    channelId: channel.id,
    messageId: null,
    ended: false,
    requiredSignups,
    maxSignups,
    pingRoleId: options.pingRoleId || settings.pingRoleId || "",
    signups: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const message = await channel.send({
    embeds: [buildEmbed(session)],
    components: buildRows(session),
  });
  session.messageId = message.id;
  persist(session);

  return interaction.editReply({
    content: `Tryout posted in ${channel}.`,
    embeds: [buildEmbed(session)],
  });
}

async function handleTryoutRuntime(interaction) {
  const id = interaction.customId || "";

  if (interaction.isStringSelectMenu() && id === "tryout_end_selected") {
    const token = interaction.values?.[0];
    const session = await getSession(token, interaction.guild.id);
    if (!session || session.guildId !== interaction.guild.id) {
      return interaction.reply({ content: "Tryout not found.", ephemeral: true });
    }
    if (!canManageSession(interaction.member, interaction.guild, session)) {
      return interaction.reply({ content: "You can’t end that tryout.", ephemeral: true });
    }
    await closeSession(interaction.client, token, interaction.user.id);
    const sessions = await guildSessions(interaction.guild.id);
    const { embed, components } = listPayload(sessions);
    return interaction.update({
      content: `Ended **${session.title || "tryout"}** hosted by <@${session.creatorId}>.`,
      embeds: [embed],
      components,
    });
  }

  if (interaction.isButton() && id.startsWith("tryout_join_")) {
    const token = id.slice("tryout_join_".length);
    const session = await getSession(token, interaction.guild?.id);
    if (!session || session.ended) {
      return interaction.reply({ content: "This tryout is closed or missing.", ephemeral: true });
    }
    if (session.maxSignups && session.signups.length >= session.maxSignups
      && !session.signups.some((s) => s.userId === interaction.user.id)) {
      return interaction.reply({ content: "This tryout is full.", ephemeral: true });
    }
    const existing = session.signups.find((s) => s.userId === interaction.user.id);
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(`tryout_join_modal_${token}`)
        .setTitle(existing ? "Update Roblox username" : "Join tryout")
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("tryout_username")
            .setLabel("Roblox username")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(20)
            .setPlaceholder("Exact Roblox username")
            .setValue(existing?.username || "")
        ))
    );
  }

  if (interaction.isButton() && id.startsWith("tryout_leave_")) {
    const token = id.slice("tryout_leave_".length);
    const session = await getSession(token, interaction.guild?.id);
    if (!session) return interaction.reply({ content: "Tryout no longer exists.", ephemeral: true });
    if (session.ended) return interaction.reply({ content: "This tryout is already closed.", ephemeral: true });
    const before = session.signups.length;
    session.signups = session.signups.filter((s) => s.userId !== interaction.user.id);
    if (session.signups.length === before) {
      return interaction.reply({ content: "You’re not on this tryout.", ephemeral: true });
    }
    session.updatedAt = Date.now();
    persist(session);
    await refreshMessage(interaction.client, session);
    return interaction.reply({ content: "You left the tryout.", ephemeral: true });
  }

  if (interaction.isButton() && id.startsWith("tryout_open_")) {
    const session = await getSession(id.slice("tryout_open_".length), interaction.guild?.id);
    if (!session) return interaction.reply({ content: "Tryout no longer exists.", ephemeral: true });
    const unlocked = session.ended
      || !session.requiredSignups
      || session.signups.length >= session.requiredSignups;
    if (!unlocked) {
      return interaction.reply({
        content: `Link unlocks at **${session.requiredSignups}** signup${session.requiredSignups === 1 ? "" : "s"} (${session.signups.length}/${session.requiredSignups}).`,
        ephemeral: true,
      });
    }
    return interaction.reply({
      content: `**Tryout link**\n${session.link}`,
      ephemeral: true,
    });
  }

  if (interaction.isButton() && id.startsWith("tryout_end_")) {
    const token = id.slice("tryout_end_".length);
    const session = await getSession(token, interaction.guild?.id);
    if (!session) return interaction.reply({ content: "Tryout no longer exists.", ephemeral: true });
    if (!canManageSession(interaction.member, interaction.guild, session)) {
      return interaction.reply({ content: "Only the host, TRYOUTS staff, or an admin can end this.", ephemeral: true });
    }
    await closeSession(interaction.client, token, interaction.user.id);
    return interaction.update({ embeds: [buildEmbed(session)], components: buildRows(session) });
  }

  if (interaction.isButton() && id.startsWith("tryout_reminder_")) {
    const token = id.slice("tryout_reminder_".length);
    const session = await getSession(token, interaction.guild?.id);
    if (!session) return interaction.reply({ content: "Tryout no longer exists.", ephemeral: true });
    if (!canManageSession(interaction.member, interaction.guild, session)) {
      return interaction.reply({ content: "Only the host or staff can edit the reminder.", ephemeral: true });
    }
    const input = new TextInputBuilder()
      .setCustomId("tryout_reminder_text")
      .setLabel("Reminder DM (sent when unlocked)")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(250)
      .setPlaceholder("Optional message players get when the link unlocks");
    if (session.reminderMessage) input.setValue(session.reminderMessage);
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(`tryout_reminder_modal_${token}`)
        .setTitle("Reminder DM")
        .addComponents(new ActionRowBuilder().addComponents(input))
    );
  }

  if (interaction.isModalSubmit() && id.startsWith("tryout_reminder_modal_")) {
    const session = await getSession(id.slice("tryout_reminder_modal_".length), interaction.guild?.id);
    if (!session) return interaction.reply({ content: "Tryout no longer exists.", ephemeral: true });
    if (!canManageSession(interaction.member, interaction.guild, session)) {
      return interaction.reply({ content: "Only the host or staff can edit the reminder.", ephemeral: true });
    }
    session.reminderMessage = interaction.fields.getTextInputValue("tryout_reminder_text").trim();
    session.updatedAt = Date.now();
    persist(session);
    await refreshMessage(interaction.client, session);
    return interaction.reply({
      content: session.reminderMessage ? "Reminder DM updated." : "Reminder DM cleared (default text will be used).",
      ephemeral: true,
    });
  }

  if (interaction.isModalSubmit() && id.startsWith("tryout_join_modal_")) {
    const token = id.slice("tryout_join_modal_".length);
    const session = await getSession(token, interaction.guild?.id);
    if (!session || session.ended) {
      return interaction.reply({ content: "This tryout is closed.", ephemeral: true });
    }
    const username = interaction.fields.getTextInputValue("tryout_username").trim();
    if (!isValidRobloxUsername(username)) {
      return interaction.reply({
        content: "Roblox usernames are 3–20 characters: letters, numbers, underscore only.",
        ephemeral: true,
      });
    }

    const existing = session.signups.find((s) => s.userId === interaction.user.id);
    if (!existing && session.maxSignups && session.signups.length >= session.maxSignups) {
      return interaction.reply({ content: "This tryout is full.", ephemeral: true });
    }

    const taken = session.signups.find(
      (s) => s.userId !== interaction.user.id && s.username.toLowerCase() === username.toLowerCase()
    );
    if (taken) {
      return interaction.reply({
        content: `Someone already signed up as \`${username}\`.`,
        ephemeral: true,
      });
    }

    let joinedFresh = false;
    if (existing) {
      existing.username = username;
    } else {
      session.signups.push({ userId: interaction.user.id, username });
      joinedFresh = true;
      try {
        const rankingCfg = await getRankingConfig(interaction.guild.id);
        const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (member && rankingCfg) {
          await addTryoutCooldownRole(member, rankingCfg, "Joined tryout");
        }
      } catch {}
    }

    session.updatedAt = Date.now();
    persist(session);
    await refreshMessage(interaction.client, session);

    if (session.requiredSignups && !session.notifiedReady && session.signups.length >= session.requiredSignups) {
      session.notifiedReady = true;
      persist(session);
      await notifyReady(interaction.client, session);
    }

    return interaction.reply({
      content: joinedFresh
        ? `You’re in as \`${username}\`.`
        : `Updated your username to \`${username}\`.`,
      ephemeral: true,
    });
  }

  return false;
}

async function restoreFromStore(guildId) {
  hydratedGuilds.delete(String(guildId || ""));
  await hydrateGuild(guildId);
}

module.exports = {
  handleTryoutRuntime,
  createTryout,
  closeSession,
  guildSessions,
  listPayload,
  persist,
  restoreFromStore,
  getSession,
  buildEmbed,
  buildRows,
  buildRow,
  isValidLink,
};
