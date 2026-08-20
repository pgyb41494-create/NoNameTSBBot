const { EmbedBuilder } = require("discord.js");
const { publicStaffAlerts } = require("./store");
const { COLOR_SURFACE, COLOR_WARN, COLOR_SUCCESS, COLOR_DANGER } = require("../shared/embeds");

function recordNetworkActivity(guildId, event, payload = {}) {
  const base = String(process.env.API_SERVER_URL || process.env.API_URL || "").replace(/\/$/, "");
  if (!base || !guildId || !event) return;
  const token = process.env.API_TOKEN || process.env.BOT_API_TOKEN || "";
  fetch(`${base}/api/bot/activity`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-bot-token": token } : {}),
    },
    body: JSON.stringify({ guildId: String(guildId), event: String(event), payload }),
  }).catch(() => {});
}

async function postStaffAlert(guild, eventKey, { title, description, color, fields, user } = {}) {
  if (!guild || !eventKey) return false;
  const cfg = publicStaffAlerts(guild.id);
  if (cfg.events[eventKey] === false) return false;
  const channelId = cfg.channelId || cfg.fallbackChannelId;
  if (!channelId) return false;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  const embed = new EmbedBuilder()
    .setColor(color ?? COLOR_SURFACE)
    .setTitle(String(title || "Staff alert").slice(0, 256))
    .setTimestamp(new Date());
  if (description) embed.setDescription(String(description).slice(0, 4000));
  if (Array.isArray(fields) && fields.length) embed.addFields(fields.slice(0, 8));
  if (user) {
    embed.setFooter({
      text: user.username || user.tag || String(user.id),
      iconURL: user.displayAvatarURL?.({ size: 32 }) || undefined,
    });
  }

  await channel.send({ embeds: [embed] }).catch(() => {});
  return true;
}

async function alertProfile(guild, user, profile) {
  if (!guild || !user) return;
  const roblox = profile?.roblox_username || profile?.robloxUsername || "—";
  const region = profile?.region || "—";
  recordNetworkActivity(guild.id, "profile", {
    discordId: user.id,
    roblox_username: profile?.roblox_username || profile?.robloxUsername,
    region: profile?.region,
    country: profile?.country,
  });
  await postStaffAlert(guild, "profile", {
    title: "Profile registered",
    color: COLOR_SUCCESS,
    description: `<@${user.id}> linked **${roblox}**`,
    fields: [
      { name: "Region", value: String(region), inline: true },
      { name: "Country", value: String(profile?.country || "—"), inline: true },
    ],
    user,
  });
}

async function alertPhase(guild, targetUser, stage, actor) {
  recordNetworkActivity(guild.id, "phase", {
    targetId: targetUser?.id,
    stage,
    actorId: actor?.id || null,
  });
  await postStaffAlert(guild, "phase", {
    title: "Rank updated",
    color: COLOR_SURFACE,
    description: `<@${targetUser.id}> → **${stage}**`,
    fields: actor ? [{ name: "By", value: `<@${actor.id}>`, inline: true }] : [],
    user: targetUser,
  });
}

async function alertScore(guild, { winner, loser, scoreDisplay, region, recorder }) {
  recordNetworkActivity(guild.id, "score", {
    winnerId: winner?.id,
    loserId: loser?.id,
    score: scoreDisplay,
    region,
    recorderId: recorder?.id || null,
  });
  await postStaffAlert(guild, "score", {
    title: "Match recorded",
    color: COLOR_SUCCESS,
    description: `<@${winner.id}> beat <@${loser.id}> **${scoreDisplay}**`,
    fields: [
      { name: "Region", value: region || "—", inline: true },
      { name: "By", value: recorder ? `<@${recorder.id}>` : "—", inline: true },
    ],
    user: winner,
  });
}

async function alertChallenge(guild, challenger, target) {
  recordNetworkActivity(guild.id, "challenge", {
    fromId: challenger?.id,
    targetId: target?.id,
  });
  await postStaffAlert(guild, "challenge", {
    title: "Challenge opened",
    color: COLOR_WARN,
    description: `<@${challenger.id}> → <@${target.id}>`,
    user: challenger,
  });
}

async function alertDuplicateRoblox(guild, primaryDiscordId, robloxId, robloxUsername, others) {
  const lines = (others || [])
    .slice(0, 6)
    .map((p) => `<@${p.discord_id || p.discordId}> · @${p.roblox_username || p.robloxUsername || "?"}`)
    .join("\n");
  recordNetworkActivity(guild.id, "duplicateRoblox", {
    primaryDiscordId,
    robloxId,
    robloxUsername,
    others,
  });
  await postStaffAlert(guild, "duplicateRoblox", {
    title: "Duplicate Roblox account",
    color: COLOR_DANGER,
    description:
      `<@${primaryDiscordId}> linked **@${robloxUsername || "?"}** (\`${robloxId}\`), ` +
      "but that Roblox ID is already on:",
    fields: [{ name: "Other profiles", value: lines || "—" }],
  });
}

async function checkDuplicateRoblox(guild, discordId, robloxId, robloxUsername) {
  if (!guild || !robloxId) return [];
  const api = require("../../../utils/loadApi");
  let dupes = [];
  if (typeof api.profiles.findDuplicateRoblox === "function") {
    dupes = await Promise.resolve(api.profiles.findDuplicateRoblox(guild.id, robloxId, discordId));
  }
  if (dupes.length) {
    await alertDuplicateRoblox(guild, discordId, robloxId, robloxUsername, dupes);
  }
  return dupes;
}

async function postStaffAlertFromPayload(guild, eventKey, payload = {}) {
  if (!guild) return false;
  if (eventKey === "profile") {
    const user = payload.discordId
      ? await guild.client.users.fetch(String(payload.discordId)).catch(() => ({ id: payload.discordId }))
      : null;
    return alertProfile(guild, user, payload);
  }
  if (eventKey === "phase") {
    const user = payload.targetId
      ? await guild.client.users.fetch(String(payload.targetId)).catch(() => ({ id: payload.targetId }))
      : null;
    return alertPhase(guild, user, payload.stage, payload.actorId ? { id: payload.actorId } : null);
  }
  if (eventKey === "score") {
    const winner = payload.winnerId ? { id: payload.winnerId } : null;
    const loser = payload.loserId ? { id: payload.loserId } : null;
    if (winner && loser) return alertScore(guild, { winner, loser, scoreDisplay: payload.score, region: payload.region, recorder: payload.recorderId ? { id: payload.recorderId } : null });
  }
  if (eventKey === "challenge") {
    return alertChallenge(guild, { id: payload.fromId }, { id: payload.targetId });
  }
  if (eventKey === "duplicateRoblox") {
    return alertDuplicateRoblox(
      guild,
      payload.primaryDiscordId,
      payload.robloxId,
      payload.robloxUsername,
      payload.others || []
    );
  }
  return postStaffAlert(guild, eventKey, payload);
}

module.exports = {
  postStaffAlert,
  postStaffAlertFromPayload,
  alertProfile,
  alertPhase,
  alertScore,
  alertChallenge,
  alertDuplicateRoblox,
  checkDuplicateRoblox,
};
