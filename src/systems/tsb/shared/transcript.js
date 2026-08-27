const { AttachmentBuilder, EmbedBuilder } = require("discord.js");

function formatStamp(date) {
  try {
    return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return "unknown time";
  }
}

function authorLabel(message) {
  const user = message.author;
  if (!user) return "Unknown";
  const tag = user.tag || user.username || "Unknown";
  const bot = user.bot ? " [BOT]" : "";
  return `${tag}${bot} (${user.id})`;
}

function describeMessage(message) {
  const bits = [];
  if (message.content?.trim()) bits.push(message.content.trim());

  if (message.attachments?.size) {
    for (const file of message.attachments.values()) {
      bits.push(`[attachment] ${file.name || "file"} · ${file.url}`);
    }
  }

  if (message.stickers?.size) {
    for (const sticker of message.stickers.values()) {
      bits.push(`[sticker] ${sticker.name}`);
    }
  }

  if (message.embeds?.length) {
    message.embeds.forEach((embed, index) => {
      const parts = [];
      if (embed.title) parts.push(`title: ${embed.title}`);
      if (embed.description) parts.push(embed.description.slice(0, 400));
      if (embed.url) parts.push(`url: ${embed.url}`);
      if (embed.image?.url) parts.push(`image: ${embed.image.url}`);
      if (embed.thumbnail?.url) parts.push(`thumb: ${embed.thumbnail.url}`);
      bits.push(`[embed ${index + 1}] ${parts.join(" | ") || "(empty embed)"}`);
    });
  }

  if (message.components?.length) {
    const labels = [];
    for (const row of message.components) {
      for (const c of row.components || []) {
        if (c.label) labels.push(c.label);
        else if (c.placeholder) labels.push(c.placeholder);
      }
    }
    if (labels.length) bits.push(`[components] ${labels.join(", ")}`);
  }

  return bits.join("\n  ") || "(no content)";
}

async function fetchChannelHistory(channel, { pages = 10 } = {}) {
  const collected = [];
  let before;
  for (let i = 0; i < pages; i += 1) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    const list = [...batch.values()];
    collected.push(...list);
    before = list[list.length - 1].id;
    if (batch.size < 100) break;
  }
  collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return collected;
}

function buildTranscriptText(channel, messages, meta = {}) {
  const guild = channel.guild;
  const opener = meta.openerId ? `Opener: ${meta.openerId}` : null;
  const closedBy = meta.closedById ? `Closed by: ${meta.closedById}` : null;
  const header = [
    "══════════════════════════════════════",
    ` Ascendant ticket transcript`,
    "══════════════════════════════════════",
    `Server: ${guild?.name || "unknown"} (${guild?.id || "?"})`,
    `Channel: #${channel.name} (${channel.id})`,
    meta.panelName ? `Panel: ${meta.panelName}` : null,
    opener,
    closedBy,
    `Generated: ${formatStamp(new Date())}`,
    `Messages: ${messages.length}`,
    "──────────────────────────────────────",
    "",
  ].filter((line) => line != null).join("\n");

  const body = messages.length
    ? messages.map((message) => {
      const reply = message.reference?.messageId
        ? `\n  ↳ reply to ${message.reference.messageId}`
        : "";
      return `[${formatStamp(message.createdAt)}] ${authorLabel(message)}${reply}\n  ${describeMessage(message)}`;
    }).join("\n\n")
    : "(no messages)";

  return `${header}\n${body}\n`;
}

function participantLines(messages) {
  const map = new Map();
  for (const message of messages) {
    const user = message.author;
    if (!user) continue;
    const key = user.id;
    const prev = map.get(key) || { tag: user.tag || user.username || key, count: 0, bot: user.bot };
    prev.count += 1;
    map.set(key, prev);
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .map((p) => `${p.tag}${p.bot ? " [BOT]" : ""} · ${p.count} msg${p.count === 1 ? "" : "s"}`);
}

function durationLabel(startMs) {
  const minutes = Math.floor(Math.max(0, Date.now() - startMs) / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  return `${Math.max(1, minutes)}m`;
}

async function buildTicketTranscript(channel, meta = {}) {
  const messages = await fetchChannelHistory(channel);
  const transcript = buildTranscriptText(channel, messages, meta);
  const participants = participantLines(messages);
  const safeName = String(channel.name || "ticket").replace(/[^a-z0-9-_]/gi, "-").slice(0, 40);
  const file = new AttachmentBuilder(Buffer.from(transcript, "utf8"), {
    name: `transcript-${safeName}-${Date.now().toString(36)}.txt`,
  });
  return {
    count: messages.length,
    participants,
    transcript,
    file,
    duration: durationLabel(channel.createdTimestamp),
  };
}

function transcriptAuditEmbed({
  title = "Ticket closed",
  color = 0xed4245,
  channel,
  closedBy,
  openerId,
  panelName,
  history,
  extraFields = [],
} = {}) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(
      [
        channel ? `${channel} was closed.` : "Ticket closed.",
        "Full chat log is attached below.",
      ].join("\n")
    )
    .addFields(
      [
        closedBy ? { name: "Closed by", value: `${closedBy}`, inline: true } : null,
        openerId ? { name: "Opened by", value: `<@${openerId}>`, inline: true } : null,
        panelName ? { name: "Panel", value: `\`${panelName}\``, inline: true } : null,
        history?.duration ? { name: "Duration", value: history.duration, inline: true } : null,
        { name: "Messages", value: String(history?.count || 0), inline: true },
        {
          name: "Participants",
          value: (history?.participants?.join("\n") || "—").slice(0, 1024),
          inline: false,
        },
        ...extraFields,
      ].filter(Boolean).slice(0, 25)
    )
    .setFooter({ text: "Ascendant · ticket transcript" })
    .setTimestamp();
}

module.exports = {
  buildTicketTranscript,
  transcriptAuditEmbed,
  durationLabel,
  fetchChannelHistory,
  buildTranscriptText,
};
