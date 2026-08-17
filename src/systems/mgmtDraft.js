const api = require("../utils/loadApi");
const { brand } = require("../utils/embeds");
const { isAdminOrOwner } = require("../utils/permissions");
const { publishLeaderboard, publishLineup } = require("./boardPublish");

function buildLeaderboardDraftTemplate(count = 10) {
  const n = Math.max(1, Math.min(50, Number(count) || 10));
  const lines = [`1-${n}`];
  for (let i = 1; i <= n; i += 1) lines.push(`${i}. none`);
  return lines.join("\n");
}

function buildLineupDraftTemplate(regionKey = "na", board = "main", count = 10) {
  const n = Math.max(1, Math.min(10, Number(count) || 10));
  const header = board === "sub" ? `${regionKey} sub` : regionKey;
  const lines = [header, `1-${n}`];
  for (let i = 1; i <= n; i += 1) lines.push(`${i}. none`);
  return lines.join("\n");
}

function buildLeaderboardTips(slotCount = 10) {
  const p = brand.prefix || "'";
  return (
    "Post drafts here like this, then type `send` to publish:\n\n" +
    "```\n" +
    buildLeaderboardDraftTemplate(slotCount) +
    "\n```\n\n" +
    `Or place one spot: \`${p}tsbtop <pos> @user\` (also \`/tsbtop\`).`
  );
}

function buildLineupTips(guildId) {
  const p = brand.prefix || "'";
  const cfg = api.lineup.getConfig(guildId);
  const regionKey = Object.keys(cfg.regions || {})[0] || "na";
  return (
    "**Lineup management**\n" +
    "Post drafts here like the leaderboard, then type `send` to publish:\n\n" +
    "```\n" +
    buildLineupDraftTemplate(regionKey, "main", 10) +
    "\n```\n" +
    `Use \`${regionKey} sub\` on the first line for **Sub Line Up**.\n` +
    "`send` · `send na` · `send all` → publish (no buttons).\n\n" +
    "Or commands:\n" +
    "```\n" +
    `${p}lineup add <region> <pos> @user\n` +
    `${p}lineup replace <region> <pos> @user\n` +
    `${p}lineup remove <region> <pos>\n` +
    `${p}lineup sub add <region> <pos> @user\n` +
    `${p}lineup publish <region|all>\n` +
    `${p}lineup list\n` +
    "```\n" +
    "Slash works too: `/lineup …`\n" +
    "Users should have a `/profile`."
  );
}

function isLeaderboardTipsMessage(msg) {
  const content = msg.content || "";
  return content.includes("Post drafts here like this") && content.includes("```");
}

function isLineupTipsMessage(msg) {
  const content = msg.content || "";
  return content.includes("**Lineup management**") && content.includes("```");
}

function parseLeaderboardDraft(content) {
  const text = String(content || "")
    .replace(/\r/g, "")
    .replace(/```/g, "")
    .trim();
  if (!text) return null;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const header = lines[0].match(/^(\d+)\s*[-–—]\s*(\d+)$/);
  if (!header) return null;

  const start = Number(header[1]);
  const end = Number(header[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start || end > 50) {
    return null;
  }

  const slots = [];
  for (let pos = start; pos <= end; pos += 1) {
    slots.push({ position: pos, discordId: null });
  }

  for (const line of lines.slice(1)) {
    const match = line.match(/^(\d+)[.)]\s*(.+)$/i);
    if (!match) continue;
    const pos = Number(match[1]);
    if (pos < start || pos > end) continue;

    const value = match[2].trim();
    const mention = value.match(/^<@!?(\d+)>$/);
    const rawId = value.match(/^(\d{17,20})$/);
    let discordId = null;
    if (mention) discordId = mention[1];
    else if (rawId) discordId = rawId[1];
    else if (/^none$/i.test(value) || value === "-" || value === "—" || value === "???") {
      discordId = null;
    } else {
      continue;
    }

    const idx = slots.findIndex((s) => s.position === pos);
    if (idx !== -1) slots[idx] = { position: pos, discordId };
  }

  return { start, end, slots };
}

function parseLineupDraft(content, cfg) {
  const text = String(content || "")
    .replace(/\r/g, "")
    .replace(/```/g, "")
    .trim();
  if (!text) return null;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const headerParts = lines[0].toLowerCase().replace(/^#/, "").split(/\s+/).filter(Boolean);
  if (!headerParts.length) return null;

  let board = "main";
  let regionRaw = headerParts[0];
  if (headerParts[1] === "sub") board = "sub";

  const regionKey =
    Object.keys(cfg.regions || {}).find((k) => k === regionRaw) ||
    Object.keys(cfg.regions || {}).find((k) => String(cfg.regions[k].label || "").toLowerCase() === regionRaw) ||
    null;
  if (!regionKey) return null;

  const rangeLine = lines[1].match(/^(\d+)\s*[-–—]\s*(\d+)$/);
  if (!rangeLine) return null;
  const start = Number(rangeLine[1]);
  const end = Number(rangeLine[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start || end > 10) {
    return null;
  }

  const slots = [];
  for (let pos = start; pos <= end; pos += 1) {
    slots.push({ position: pos, discordId: null });
  }

  for (const line of lines.slice(2)) {
    const match = line.match(/^(\d+)[.)]\s*(.+)$/i);
    if (!match) continue;
    const pos = Number(match[1]);
    if (pos < start || pos > end) continue;
    const value = match[2].trim();
    const mention = value.match(/^<@!?(\d+)>$/);
    const rawId = value.match(/^(\d{17,20})$/);
    let discordId = null;
    if (mention) discordId = mention[1];
    else if (rawId) discordId = rawId[1];
    else if (/^none$/i.test(value) || value === "-" || value === "—") discordId = null;
    else continue;

    const idx = slots.findIndex((s) => s.position === pos);
    if (idx !== -1) slots[idx] = { position: pos, discordId };
  }

  return { regionKey, board, start, end, slots };
}

function applyLeaderboardDraft(guildId, parsed) {
  api.leaderboard.ensureSlots(guildId, Math.max(parsed.end, 10));
  const cfg = api.leaderboard.getConfig(guildId);
  const slots = [...(cfg.slots || [])];
  while (slots.length < parsed.end) {
    slots.push({ position: slots.length + 1, discordId: null });
  }

  const incoming = new Set(parsed.slots.map((s) => s.discordId).filter(Boolean));
  for (const slot of slots) {
    if (slot.discordId && incoming.has(String(slot.discordId))) slot.discordId = null;
  }
  for (const s of parsed.slots) {
    slots[s.position - 1] = { position: s.position, discordId: s.discordId };
  }
  return api.leaderboard.updateConfig(guildId, { slots, setupCompleted: true });
}

function applyLineupDraft(guildId, parsed) {
  for (const s of parsed.slots) {
    api.lineup.setSlot(guildId, parsed.regionKey, parsed.board, s.position, s.discordId);
  }
}

async function ensureTipsMessage(channel, guildId, kind) {
  const content = kind === "lineup" ? buildLineupTips(guildId) : buildLeaderboardTips(10);
  const cfg = kind === "lineup" ? api.lineup.getConfig(guildId) : api.leaderboard.getConfig(guildId);

  let tips = null;
  if (cfg.tipsMessageId) {
    tips = await channel.messages.fetch(cfg.tipsMessageId).catch(() => null);
  }

  const recent = await channel.messages.fetch({ limit: 40 }).catch(() => null);
  if (!tips && recent) {
    tips =
      [...recent.values()].find((m) =>
        m.author?.bot && (kind === "lineup" ? isLineupTipsMessage(m) : isLeaderboardTipsMessage(m))
      ) || null;
  }

  const components = [];

  if (tips) {
    await tips.edit({ content, embeds: [], components }).catch(async () => {
      tips = await channel.send({ content, components });
    });
  } else {
    tips = await channel.send({ content, components });
  }

  await tips.pin().catch(() => {});

  if (kind === "lineup") api.lineup.updateConfig(guildId, { tipsMessageId: tips.id, managementChannelId: channel.id });
  else api.leaderboard.updateConfig(guildId, { tipsMessageId: tips.id, managementChannelId: channel.id });

  return tips;
}

function shouldKeepMessage(msg, tipsMessageId) {
  if (!msg) return false;
  if (tipsMessageId && msg.id === tipsMessageId) return true;
  return false;
}

/** Delete everything in the mgmt channel except the tips text block. */
async function sweepManagementChannel(channel, guildId, kind) {
  if (!channel?.isTextBased?.() || !guildId || !kind) return null;

  const tips = await ensureTipsMessage(channel, guildId, kind);
  const tipsMessageId = tips.id;

  const fetched = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!fetched?.size) return tips;

  const toDelete = [...fetched.values()].filter((msg) => !shouldKeepMessage(msg, tipsMessageId));
  if (!toDelete.length) return tips;

  const twoWeeks = 14 * 24 * 60 * 60 * 1000;
  const bulkable = toDelete.filter((m) => Date.now() - m.createdTimestamp < twoWeeks);
  const older = toDelete.filter((m) => Date.now() - m.createdTimestamp >= twoWeeks);

  if (bulkable.length >= 2) {
    await channel.bulkDelete(bulkable, true).catch(async () => {
      for (const msg of bulkable) await msg.delete().catch(() => {});
    });
  } else {
    for (const msg of bulkable) await msg.delete().catch(() => {});
  }
  for (const msg of older) await msg.delete().catch(() => {});

  return tips;
}

function resolveManagementKind(channel, guildId) {
  if (!channel?.isTextBased?.() || !guildId) return null;
  const lb = api.leaderboard.getConfig(guildId);
  const lu = api.lineup.getConfig(guildId);

  if (
    (lb.managementChannelId && channel.id === lb.managementChannelId) ||
    channel.name === "tsb-boards" ||
    channel.name === "ascendant-boards"
  ) {
    return "leaderboard";
  }
  if (
    (lu.managementChannelId && channel.id === lu.managementChannelId) ||
    channel.name === "tsb-lineups" ||
    channel.name === "ascendant-lineups"
  ) {
    return "lineup";
  }
  return null;
}

async function sweepIfManagementChannel(messageOrChannel, guildId, { delayMs = 700 } = {}) {
  const channel = messageOrChannel.channel || messageOrChannel;
  const kind = resolveManagementKind(channel, guildId);
  if (!kind) return false;
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  await sweepManagementChannel(channel, guildId, kind);
  return true;
}

async function handleManagementDraft(message) {
  if (!message.guild || message.author.bot) return false;

  const kind = resolveManagementKind(message.channel, message.guild.id);
  if (!kind) return false;

  if (!isAdminOrOwner(message.member, message.guild)) {
    // Still mark as management activity so caller can sweep junk
    return { managed: true, handled: false };
  }

  const content = message.content.trim();
  const lu = api.lineup.getConfig(message.guild.id);

  if (kind === "leaderboard") {
    if (/^send$/i.test(content)) {
      await publishLeaderboard(message.guild);
      await message.react("✅").catch(() => {});
      return { managed: true, handled: true };
    }

    const parsed = parseLeaderboardDraft(content);
    if (parsed) {
      applyLeaderboardDraft(message.guild.id, parsed);
      await message.react("✅").catch(() => {});
      return { managed: true, handled: true };
    }

    const one = content.match(/^(\d{1,2})\s+<@!?(\d+)>$/);
    if (one) {
      api.leaderboard.place(message.guild.id, Number(one[1]), one[2]);
      await publishLeaderboard(message.guild).catch(() => {});
      await message.react("✅").catch(() => {});
      return { managed: true, handled: true };
    }

    return { managed: true, handled: false };
  }

  if (/^send(\s+\S+)?$/i.test(content)) {
    const arg = content.split(/\s+/)[1]?.toLowerCase() || "all";
    if (arg === "all") await publishLineup(message.guild);
    else await publishLineup(message.guild, arg);
    await message.react("✅").catch(() => {});
    return { managed: true, handled: true };
  }

  const parsed = parseLineupDraft(content, lu);
  if (parsed) {
    applyLineupDraft(message.guild.id, parsed);
    await message.react("✅").catch(() => {});
    return { managed: true, handled: true };
  }

  return { managed: true, handled: false };
}

module.exports = {
  buildLeaderboardTips,
  buildLineupTips,
  buildLeaderboardDraftTemplate,
  buildLineupDraftTemplate,
  ensureTipsMessage,
  handleManagementDraft,
  sweepManagementChannel,
  sweepIfManagementChannel,
  resolveManagementKind,
  parseLeaderboardDraft,
  parseLineupDraft,
};
