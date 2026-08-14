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
    `${p}lineup remove <region> <pos>\n` +
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
  const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  let tips = null;
  if (recent) {
    tips = [...recent.values()].find((m) =>
      m.author?.bot && (kind === "lineup" ? isLineupTipsMessage(m) : isLeaderboardTipsMessage(m))
    );
  }

  if (tips) {
    await tips.edit({ content, components: [] }).catch(async () => {
      tips = await channel.send({ content });
    });
  } else {
    tips = await channel.send({ content });
  }

  try {
    await tips.pin().catch(() => {});
  } catch {
    // ignore
  }

  if (kind === "lineup") {
    api.lineup.updateConfig(guildId, { tipsMessageId: tips.id });
  } else {
    api.leaderboard.updateConfig(guildId, { tipsMessageId: tips.id });
  }
  return tips;
}

async function handleManagementDraft(message) {
  if (!message.guild || message.author.bot) return false;
  if (!isAdminOrOwner(message.member, message.guild)) return false;

  const lb = api.leaderboard.getConfig(message.guild.id);
  const lu = api.lineup.getConfig(message.guild.id);
  const isLb = lb.managementChannelId && message.channelId === lb.managementChannelId;
  const isLu = lu.managementChannelId && message.channelId === lu.managementChannelId;
  if (!isLb && !isLu) return false;

  const content = message.content.trim();

  if (isLb) {
    if (/^send$/i.test(content)) {
      await publishLeaderboard(message.guild);
      await message.react("✅").catch(() => {});
      await message.reply({ content: "Leaderboard published.", allowedMentions: { repliedUser: false } });
      return true;
    }

    const parsed = parseLeaderboardDraft(content);
    if (parsed) {
      applyLeaderboardDraft(message.guild.id, parsed);
      const filled = parsed.slots.filter((s) => s.discordId).length;
      await message.react("✅").catch(() => {});
      await message.reply({
        content: `Draft updated (\`${filled}/${parsed.end - parsed.start + 1}\` filled). Type \`send\` to publish.`,
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    // Legacy one-liner: `1 @user`
    const one = content.match(/^(\d{1,2})\s+<@!?(\d+)>$/);
    if (one) {
      api.leaderboard.place(message.guild.id, Number(one[1]), one[2]);
      await publishLeaderboard(message.guild).catch(() => {});
      await message.react("✅").catch(() => {});
      return true;
    }
    return false;
  }

  // Lineup
  if (/^send(\s+\S+)?$/i.test(content)) {
    const arg = content.split(/\s+/)[1]?.toLowerCase() || "all";
    if (arg === "all") await publishLineup(message.guild);
    else await publishLineup(message.guild, arg);
    await message.react("✅").catch(() => {});
    await message.reply({ content: "Lineup published.", allowedMentions: { repliedUser: false } });
    return true;
  }

  const parsed = parseLineupDraft(content, lu);
  if (parsed) {
    applyLineupDraft(message.guild.id, parsed);
    const filled = parsed.slots.filter((s) => s.discordId).length;
    await message.react("✅").catch(() => {});
    await message.reply({
      content: `Draft updated for **${parsed.regionKey}** (\`${filled}\` filled). Type \`send\` to publish.`,
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  return false;
}

module.exports = {
  buildLeaderboardTips,
  buildLineupTips,
  buildLeaderboardDraftTemplate,
  buildLineupDraftTemplate,
  ensureTipsMessage,
  handleManagementDraft,
  parseLeaderboardDraft,
  parseLineupDraft,
};
