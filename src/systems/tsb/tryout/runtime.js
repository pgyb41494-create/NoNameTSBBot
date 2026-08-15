const {
  EmbedBuilder,
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
const { getTryoutSettings } = require("./settings");
const { addTryoutCooldownRole } = require("../ranking/tryoutCooldown");
const { getRankingConfig } = require("../ranking/config");

const live = new Map();

function genToken() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function sanitize(raw) {
  if (!raw || typeof raw !== "object" || !raw.token || !raw.guildId) return null;
  return {
    token: String(raw.token),
    guildId: String(raw.guildId),
    creatorId: String(raw.creatorId || ""),
    creatorName: String(raw.creatorName || "Unknown"),
    link: String(raw.link || ""),
    channelId: String(raw.channelId || ""),
    messageId: raw.messageId ? String(raw.messageId) : null,
    ended: !!raw.ended,
    endedBy: raw.endedBy ? String(raw.endedBy) : null,
    requiredSignups: Number(raw.requiredSignups) || 0,
    maxSignups: Number(raw.maxSignups) || 0,
    reminderMessage: String(raw.reminderMessage || ""),
    notifiedReady: !!raw.notifiedReady,
    pingRoleId: String(raw.pingRoleId || ""),
    signups: Array.isArray(raw.signups)
      ? raw.signups.map((s) => ({ userId: String(s.userId || ""), username: String(s.username || "") })).filter((s) => s.username)
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
    api.tryouts.saveSession(clean.guildId, clean);
  } catch {}
  return clean;
}

function buildEmbed(session) {
  const count = session.signups.length;
  const list = session.signups.slice(0, 8).map((s, i) => `**${i + 1}.** ${s.username}${s.userId ? ` (<@${s.userId}>)` : ""}`);
  const signupsValue = list.length
    ? `${list.join("\n")}${session.signups.length > 8 ? `\n…and ${session.signups.length - 8} more` : ""}`
    : "*No signups yet.*";
  const enough = !session.requiredSignups || count >= session.requiredSignups;
  const maxReached = session.maxSignups && count >= session.maxSignups;
  const status = session.ended
    ? `Closed by <@${session.endedBy || session.creatorId}>`
    : maxReached
      ? "Full — no more signups"
      : enough
        ? "Open — link unlocked"
        : `Waiting for ${Math.max(session.requiredSignups - count, 0)} more signup(s) to unlock the link`;
  const fields = [
    {
      name: "TSB Link",
      value: session.ended || enough ? `[Join tryout](${session.link})` : `*Unlocks after ${session.requiredSignups} signup(s)*`,
      inline: true,
    },
    { name: "Hosted by", value: `<@${session.creatorId}>`, inline: true },
    { name: "Status", value: status, inline: true },
  ];
  if (session.requiredSignups) fields.push({ name: "Required signups", value: `${session.requiredSignups}`, inline: true });
  if (session.maxSignups) fields.push({ name: "Max signups", value: `${session.maxSignups}`, inline: true });
  if (session.pingRoleId) fields.push({ name: "Ready ping", value: `<@&${session.pingRoleId}>`, inline: true });
  fields.push({ name: session.maxSignups ? `Signups (${count}/${session.maxSignups})` : `Signups (${count})`, value: signupsValue });

  return new EmbedBuilder()
    .setColor(session.ended ? 0x8b0000 : maxReached ? 0xfee75c : 0x5865f2)
    .setTitle("⚔️ TSB Tryout")
    .setDescription("**The Strongest Battlegrounds** — click **Join Tryout** with your Roblox username.")
    .addFields(fields)
    .setFooter({ text: `TSB tryout by ${session.creatorName} · ${session.token}` })
    .setTimestamp(session.createdAt || Date.now());
}

function buildRow(session) {
  const canOpen = session.ended || !session.requiredSignups || session.signups.length >= session.requiredSignups;
  const maxReached = session.maxSignups && session.signups.length >= session.maxSignups;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tryout_open_${session.token}`).setLabel("Open Link").setStyle(ButtonStyle.Secondary).setDisabled(!canOpen),
    new ButtonBuilder().setCustomId(`tryout_join_${session.token}`).setLabel("Join Tryout").setStyle(ButtonStyle.Primary).setDisabled(session.ended || maxReached),
    new ButtonBuilder().setCustomId(`tryout_reminder_${session.token}`).setLabel("Edit Reminder").setStyle(ButtonStyle.Secondary).setDisabled(session.ended),
    new ButtonBuilder().setCustomId(`tryout_end_${session.token}`).setLabel("End Tryout").setStyle(ButtonStyle.Danger).setDisabled(session.ended)
  );
}

function listPayload(sessions) {
  const sorted = [...sessions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const active = sorted.filter((s) => !s.ended);
  const ended = sorted.filter((s) => s.ended);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("⚔️ TSB Tryout Sessions").setTimestamp();
  if (active.length) {
    embed.addFields({
      name: "Active tryouts",
      value: active.map((s, i) => `**${i + 1}.** \`${s.token}\` <#${s.channelId}> — ${s.signups.length}${s.maxSignups ? `/${s.maxSignups}` : ""}`).join("\n"),
    });
  } else {
    embed.addFields({ name: "Active tryouts", value: "*No active tryouts.*" });
  }
  if (ended.length) {
    embed.addFields({
      name: "Ended tryouts",
      value: ended.slice(0, 10).map((s, i) => `**${i + 1}.** <#${s.channelId}> by <@${s.creatorId}> — closed`).join("\n"),
    });
  }
  const components = [];
  if (active.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("tryout_end_selected")
        .setPlaceholder("Select a tryout to end")
        .addOptions(active.slice(0, 25).map((s, i) => ({
          label: `#${i + 1} ${s.creatorName}`.slice(0, 100),
          description: `Signups ${s.signups.length}`.slice(0, 100),
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
  await message.edit({ embeds: [buildEmbed(session)], components: [buildRow(session)] }).catch(() => {});
}

async function notifyReady(client, session) {
  const dmText = session.reminderMessage || "Your TSB tryout is ready! The required signups have been reached.";
  for (const signup of session.signups) {
    if (!signup.userId) continue;
    const user = await client.users.fetch(signup.userId).catch(() => null);
    if (user) await user.send({ content: `⚔️ **TSB Tryout Ready**\n${dmText}\n\nLink: ${session.link}` }).catch(() => {});
  }
  const creator = await client.users.fetch(session.creatorId).catch(() => null);
  if (creator) await creator.send({ content: `⚔️ **Your TSB tryout is ready**\n${dmText}\n\nLink: ${session.link}` }).catch(() => {});
  const channel = await client.channels.fetch(session.channelId).catch(() => null);
  if (channel?.isTextBased?.() && session.pingRoleId) {
    await channel.send({ content: `<@&${session.pingRoleId}> TSB tryout is ready!`, allowedMentions: { roles: [session.pingRoleId] } }).catch(() => {});
  }
}

async function closeSession(client, token, endedBy) {
  const session = live.get(token);
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

function guildSessions(guildId) {
  return [...live.values()].filter((s) => s.guildId === guildId);
}

async function createTryout(interaction, options) {
  const settings = getTryoutSettings(interaction.guild.id);
  if (!settings.channelId) {
    return interaction.editReply({ content: "No tryout channel is configured. Use `'serversetup` → **Tryouts**." });
  }
  const channel = await interaction.guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return interaction.editReply({ content: "The configured tryout channel is not available." });
  }
  const session = persist({
    token: genToken(),
    guildId: interaction.guild.id,
    creatorId: interaction.user.id,
    creatorName: interaction.user.tag,
    link: options.link,
    channelId: channel.id,
    messageId: null,
    ended: false,
    requiredSignups: options.requiredSignups ?? settings.defaultRequiredSignups ?? 0,
    maxSignups: options.maxSignups ?? settings.defaultMaxSignups ?? 0,
    pingRoleId: options.pingRoleId || settings.pingRoleId || "",
    signups: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const message = await channel.send({ embeds: [buildEmbed(session)], components: [buildRow(session)] });
  session.messageId = message.id;
  persist(session);
  const capText = session.maxSignups ? ` · max ${session.maxSignups}` : "";
  const reqText = session.requiredSignups ? ` · unlocks at ${session.requiredSignups} signup(s)` : "";
  return interaction.editReply({ content: `TSB tryout created in <#${channel.id}>${reqText}${capText}.` });
}

async function handleTryoutRuntime(interaction) {
  const id = interaction.customId || "";

  if (interaction.isStringSelectMenu() && id === "tryout_end_selected") {
    const token = interaction.values?.[0];
    const session = live.get(token);
    if (!session || session.guildId !== interaction.guild.id) {
      return interaction.reply({ content: "Tryout not found.", ephemeral: true });
    }
    await closeSession(interaction.client, token, interaction.user.id);
    return interaction.update({ content: `Ended tryout by <@${session.creatorId}>.`, embeds: [buildEmbed(session)], components: [] });
  }

  if (interaction.isButton() && id.startsWith("tryout_join_")) {
    const token = id.slice("tryout_join_".length);
    const session = live.get(token);
    if (!session || session.ended) {
      return interaction.reply({ content: "This tryout is closed or missing.", ephemeral: true });
    }
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(`tryout_join_modal_${token}`)
        .setTitle("Join Tryout")
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("tryout_username").setLabel("Your TSB Roblox username").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(64)
        ))
    );
  }

  if (interaction.isButton() && id.startsWith("tryout_open_")) {
    const session = live.get(id.slice("tryout_open_".length));
    if (!session) return interaction.reply({ content: "Tryout no longer exists.", ephemeral: true });
    if (session.ended || !session.requiredSignups || session.signups.length >= session.requiredSignups) {
      return interaction.reply({ content: `Tryout link: ${session.link}`, ephemeral: true });
    }
    return interaction.reply({ content: `Link unlocks after ${session.requiredSignups} signups.`, ephemeral: true });
  }

  if (interaction.isButton() && id.startsWith("tryout_end_")) {
    const token = id.slice("tryout_end_".length);
    const session = live.get(token);
    if (!session) return interaction.reply({ content: "Tryout no longer exists.", ephemeral: true });
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    if (interaction.user.id !== session.creatorId && !isAdmin) {
      return interaction.reply({ content: "Only the creator or an admin can end this tryout.", ephemeral: true });
    }
    await closeSession(interaction.client, token, interaction.user.id);
    return interaction.update({ embeds: [buildEmbed(session)], components: [buildRow(session)] });
  }

  if (interaction.isButton() && id.startsWith("tryout_reminder_")) {
    const token = id.slice("tryout_reminder_".length);
    const session = live.get(token);
    if (!session) return interaction.reply({ content: "Tryout no longer exists.", ephemeral: true });
    const input = new TextInputBuilder().setCustomId("tryout_reminder_text").setLabel("Reminder DM text").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(250);
    if (session.reminderMessage) input.setValue(session.reminderMessage);
    return interaction.showModal(
      new ModalBuilder().setCustomId(`tryout_reminder_modal_${token}`).setTitle("Edit Reminder DM")
        .addComponents(new ActionRowBuilder().addComponents(input))
    );
  }

  if (interaction.isModalSubmit() && id.startsWith("tryout_reminder_modal_")) {
    const session = live.get(id.slice("tryout_reminder_modal_".length));
    if (!session) return interaction.reply({ content: "Tryout no longer exists.", ephemeral: true });
    session.reminderMessage = interaction.fields.getTextInputValue("tryout_reminder_text").trim();
    persist(session);
    await refreshMessage(interaction.client, session);
    return interaction.reply({ content: "Reminder DM text updated.", ephemeral: true });
  }

  if (interaction.isModalSubmit() && id.startsWith("tryout_join_modal_")) {
    const token = id.slice("tryout_join_modal_".length);
    const session = live.get(token);
    if (!session || session.ended) return interaction.reply({ content: "This tryout is closed.", ephemeral: true });
    const username = interaction.fields.getTextInputValue("tryout_username").trim();
    if (!username) return interaction.reply({ content: "Enter your Roblox username.", ephemeral: true });
    const existing = session.signups.find((s) => s.userId === interaction.user.id);
    if (!existing && session.maxSignups && session.signups.length >= session.maxSignups) {
      return interaction.reply({ content: "This tryout is full.", ephemeral: true });
    }
    if (existing) existing.username = username;
    else {
      session.signups.push({ userId: interaction.user.id, username });
      try {
        const rankingCfg = getRankingConfig(interaction.guild.id);
        if (rankingCfg) {
          const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
          if (member) await addTryoutCooldownRole(member, rankingCfg, "Joined TSB tryout");
        }
      } catch {}
    }
    persist(session);
    await refreshMessage(interaction.client, session);
    if (session.requiredSignups && !session.notifiedReady && session.signups.length >= session.requiredSignups) {
      session.notifiedReady = true;
      persist(session);
      await notifyReady(interaction.client, session);
    }
    return interaction.reply({ content: "You have joined the TSB tryout.", ephemeral: true });
  }

  return false;
}

function restoreFromStore(guildId) {
  try {
    for (const session of api.tryouts.listSessions(guildId) || []) {
      const clean = sanitize(session);
      if (clean) live.set(clean.token, clean);
    }
  } catch {}
}

module.exports = {
  handleTryoutRuntime,
  createTryout,
  closeSession,
  guildSessions,
  listPayload,
  persist,
  restoreFromStore,
};
