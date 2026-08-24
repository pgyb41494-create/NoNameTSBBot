const {
    getLeaderboardConfig,
    updateLeaderboardConfig,
    ensureSlots
} = require("./config");

const { refreshLeaderboard, publishLeaderboard, upsertLeaderboard, MAX_TOP, getPageRanges, pageChannelName } = require("./renderer");
const { hasAccessPerm } = require("../access/store");

function canManageLeaderboard(member, guild, cfg) {
    if (!member) return false;
    if (guild.ownerId === member.id) return true;
    if (member.permissions?.has?.("Administrator")) return true;
    if (hasAccessPerm(guild.id, member.id, "LEADERBOARD")) return true;
    return (cfg.allowedRoles || []).some((id) => member.roles.cache.has(id));
}

function sanitizeChannelPart(value) {
    return String(value || "default")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-_]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "default";
}

function getTopChannelName(cfg) {
    const count = Math.max(1, Math.min(MAX_TOP, cfg.topPerChannel || 10));
    const end = Math.min(10, count);
    return pageChannelName(1, end, cfg.suffix || "default");
}

function describeLeaderboardChannels(cfg) {
    const ranges = getPageRanges(cfg.topPerChannel || 10);
    const suffix = sanitizeChannelPart(cfg.suffix || "default");
    return ranges
        .map((r) => `\`#top-${r.start}-${r.end}-${suffix}\``)
        .join(", ");
}

function resolveManagementChannel(guild, cfg) {
    if (cfg.managementChannelId) {
        const byId = guild.channels.cache.get(cfg.managementChannelId);
        if (byId?.isTextBased?.()) return byId;
    }

    return guild.channels.cache.find(
        (c) => c.name === "tsb-boards" && c.isTextBased?.()
    ) || null;
}

function isManagementChannel(message, cfg) {
    if (!message.guild || !message.channel) return false;
    if (cfg.managementChannelId && message.channel.id === cfg.managementChannelId) {
        return true;
    }
    return (
        message.channel.name === "tsb-boards"
        || message.channel.name === "ascendant-boards"
    );
}

async function getOrCreateTopChannel(guild, cfg) {
    // Prefer publishing all pages; return the first page channel.
    const merged = { ...(await getLeaderboardConfig(guild.id)), ...cfg };
    await updateLeaderboardConfig(guild.id, {
        topPerChannel: Math.max(1, Math.min(MAX_TOP, merged.topPerChannel || 10)),
        suffix: merged.suffix || "default"
    });
    const result = await upsertLeaderboard(guild);
    const firstId = result.boardPages?.[0]?.channelId || result.channelId;
    const channel = firstId
        ? await guild.channels.fetch(firstId).catch(() => null)
        : null;
    if (!channel) throw new Error("Could not create leaderboard channel");
    return { channel, created: !result.edited, boardPages: result.boardPages, result };
}

function buildDraftTemplate(count = 10) {
    const lines = [`1-${count}`];
    for (let i = 1; i <= count; i++) {
        lines.push(`${i}. none`);
    }
    return lines.join("\n");
}

function parseLeaderboardDraft(content) {
    const text = String(content || "")
        .replace(/\r/g, "")
        .replace(/```/g, "")
        .trim();
    if (!text) return null;

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return null;

    // Accept 1-10, 1–10, 1—10, 1 - 10
    const header = lines[0].match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (!header) return null;

    const start = Number(header[1]);
    const end = Number(header[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start || end > 25) {
        return null;
    }

    const slots = [];
    for (let pos = start; pos <= end; pos++) {
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
        if (idx !== -1) {
            slots[idx] = { position: pos, discordId };
        }
    }

    return { start, end, slots };
}

async function applyDraftSlots(guild, parsed) {
    const cfg = await getLeaderboardConfig(guild.id);
    const count = Math.max(
        cfg.topPerChannel || 10,
        Math.min(MAX_TOP, parsed.end)
    );
    await ensureSlots(guild.id, count);

    const fresh = await getLeaderboardConfig(guild.id);
    const slots = [...(fresh.slots || [])];

    while (slots.length < count) {
        slots.push({ position: slots.length + 1, discordId: null });
    }

    const incomingIds = new Set(
        parsed.slots.map((s) => s.discordId).filter(Boolean)
    );
    for (const slot of slots) {
        if (slot.discordId && incomingIds.has(slot.discordId)) {
            slot.discordId = null;
        }
    }

    for (const parsedSlot of parsed.slots) {
        const idx = parsedSlot.position - 1;
        if (idx < 0 || idx >= slots.length) continue;
        slots[idx] = {
            position: parsedSlot.position,
            discordId: parsedSlot.discordId
        };
    }

    updateLeaderboardConfig(guild.id, {
        slots,
        draftRange: { start: parsed.start, end: parsed.end }
    });

    return slots;
}

async function handleLeaderboardDraftMessage(message) {
    if (!message.guild || message.author.bot) return false;

    const cfg = await getLeaderboardConfig(message.guild.id);
    if (!isManagementChannel(message, cfg)) return false;

    // Keep management channel id in sync if matched by name
    if (
        (message.channel.name === "tsb-boards" || message.channel.name === "ascendant-boards")
        && cfg.managementChannelId !== message.channel.id
    ) {
        await updateLeaderboardConfig(message.guild.id, {
            managementChannelId: message.channel.id,
            setupCompleted: cfg.setupCompleted || true
        });
    }

    if (!canManageLeaderboard(message.member, message.guild, cfg)) {
        await message.reply({
            content: "You don't have permission to manage the leaderboard draft.",
            allowedMentions: { repliedUser: false }
        });
        return true;
    }

    const content = message.content.trim();

    // Always require button confirmation for publish
    if (/^send$/i.test(content)) {
        await message.reply({
            embeds: [{
                title: "Confirm publish",
                description:
                    "Publish the current draft to the live top channel?\n\n" +
                    "Click **Confirm** to publish, or **Cancel** to abort.",
                color: 0x5865F2
            }],
            components: [{
                type: 1,
                components: [
                    {
                        type: 2,
                        style: 3,
                        label: "Confirm",
                        custom_id: "tsb:lb:publish_confirm"
                    },
                    {
                        type: 2,
                        style: 4,
                        label: "Cancel",
                        custom_id: "tsb:lb:publish_cancel"
                    }
                ]
            }],
            allowedMentions: { repliedUser: false }
        });
        return true;
    }

    const parsed = parseLeaderboardDraft(content);
    if (!parsed) return false;

    await applyDraftSlots(message.guild, parsed);

    const filled = parsed.slots.filter((s) => s.discordId).length;

    await message.react("✅").catch(() => {});
    await message.reply({
        content: `Draft updated. (\`${filled}/${parsed.end - parsed.start + 1}\` filled) Type \`send\` then press **Confirm** to publish.`,
        allowedMentions: { repliedUser: false }
    });

    return true;
}

async function publishLiveLeaderboard(interaction) {
    const guild = interaction.guild;
    let cfg = await getLeaderboardConfig(guild.id);

    if (!canManageLeaderboard(interaction.member, guild, cfg)) {
        return interaction.reply({
            content: "You can't publish the leaderboard.",
            ephemeral: true
        });
    }

    await interaction.deferUpdate();

    await ensureSlots(guild.id, Math.max(1, Math.min(MAX_TOP, cfg.topPerChannel || 10)));
    cfg = await getLeaderboardConfig(guild.id);

    const result = await upsertLeaderboard(guild);
    cfg = await getLeaderboardConfig(guild.id);

    const missingProfiles = result.missingProfiles || [];
    const channelLines = (result.boardPages || [])
        .map((p) => `• Top ${p.start}–${p.end}: <#${p.channelId}>`)
        .join("\n");

    let description =
        `Live board ${result.edited ? "updated" : "posted"}:\n${channelLines || "`none`"}\n` +
        `Total spots: \`${cfg.topPerChannel || 10}\``;

    if (result.edited) {
        description += "\nExisting leaderboard messages were **edited** where possible.";
    }

    if (missingProfiles.length) {
        description +=
            `\n\n**Missing \`/profile\`:** ${missingProfiles.map((id) => `<@${id}>`).join(", ")}\n` +
            `Those spots show placeholders until they run \`/profile\`, finish setup, then you \`send\` again.`;
    }

    return interaction.editReply({
        embeds: [{
            title: result.edited ? "Leaderboard updated" : "Leaderboard published",
            description,
            color: missingProfiles.length ? 0xFEE75C : 0x57F287
        }],
        components: []
    });
}

module.exports = {
    buildDraftTemplate,
    parseLeaderboardDraft,
    applyDraftSlots,
    handleLeaderboardDraftMessage,
    publishLiveLeaderboard,
    canManageLeaderboard,
    getTopChannelName,
    describeLeaderboardChannels,
    getOrCreateTopChannel,
    resolveManagementChannel,
    isManagementChannel
};
