const {
    getLineupConfig,
    updateLineupConfig,
    getRegion,
    updateRegion,
    resizeSlots
} = require("./config");

const { publishRegionLineup, publishAllLineups } = require("./renderer");
const { isAdminOrOwner, memberHasAnyRole } = require("../shared/permissions");
const { hasAccessPerm } = require("../access/store");

function canManageLineup(member, guild, cfg) {
    if (!member) return false;
    if (isAdminOrOwner(member, guild)) return true;
    if (hasAccessPerm(guild.id, member.id, "LINEUPS")) return true;
    return memberHasAnyRole(member, cfg.allowedRoles || []);
}

function isManagementChannel(message, cfg) {
    if (!message.guild || !message.channel) return false;
    if (cfg.managementChannelId && message.channel.id === cfg.managementChannelId) {
        return true;
    }
    return (
        message.channel.name === "tsb-lineups"
        || message.channel.name === "ascendant-lineups"
    );
}

function resolveRegionKey(cfg, raw) {
    const input = String(raw || "").trim().toLowerCase();
    if (!input) return null;

    const normalized = input.replace(/\s+/g, "_");
    if (cfg.regions?.[normalized]) return normalized;

    const keys = cfg.enabledRegionKeys?.length
        ? cfg.enabledRegionKeys
        : Object.keys(cfg.regions || {});

    for (const key of keys) {
        const region = cfg.regions?.[key];
        if (!region) continue;
        const label = String(region.label || "").toLowerCase();
        if (key === normalized || key === input) return key;
        if (label === input || label.replace(/\s+/g, "_") === normalized) return key;
    }
    return null;
}

function buildDraftTemplate(regionKey = "miami", board = "main", count = 10) {
    const header = board === "sub" ? `${regionKey} sub` : regionKey;
    const lines = [header, `1-${count}`];
    for (let i = 1; i <= count; i++) {
        lines.push(`${i}. none`);
    }
    return lines.join("\n");
}

/**
 * Parse:
 *   miami
 *   1-10
 *   1. @user
 *   2. none
 *
 * Or:
 *   miami sub
 *   1-10
 *   ...
 */
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
    const boardToken = headerParts[headerParts.length - 1];
    let regionRaw = lines[0];

    if (boardToken === "sub" || boardToken === "sublineup" || boardToken === "subs") {
        board = "sub";
        regionRaw = headerParts.slice(0, -1).join(" ");
    } else if (
        boardToken === "main" ||
        boardToken === "line" ||
        boardToken === "lineup" ||
        boardToken === "lineups"
    ) {
        board = "main";
        regionRaw = headerParts.slice(0, -1).join(" ");
    }

    const regionKey = resolveRegionKey(cfg, regionRaw);
    if (!regionKey) return null;

    const rangeLine = lines[1].match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (!rangeLine) return null;

    const start = Number(rangeLine[1]);
    const end = Number(rangeLine[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start || end > 10) {
        return null;
    }

    const slots = [];
    for (let pos = start; pos <= end; pos++) {
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

    return { regionKey, board, start, end, slots };
}

async function applyDraftSlots(guildId, parsed) {
    const cfg = await getLineupConfig(guildId);
    const region = await getRegion(guildId, parsed.regionKey);
    if (!region) return null;

    const isSub = parsed.board === "sub";
    const configured = isSub
        ? Math.max(1, Math.min(10, cfg.subSlotsPerRegion || 10))
        : Math.max(1, Math.min(10, cfg.slotsPerRegion || 10));
    const count = Math.max(configured, parsed.end);

    let mainSlots = resizeSlots(region.slots, Math.max(1, Math.min(10, cfg.slotsPerRegion || 10)));
    let subSlots = resizeSlots(
        region.subSlots,
        Math.max(1, Math.min(10, cfg.subSlotsPerRegion || cfg.slotsPerRegion || 10))
    );

    if (isSub) {
        subSlots = resizeSlots(subSlots, count);
    } else {
        mainSlots = resizeSlots(mainSlots, count);
    }

    const incomingIds = new Set(parsed.slots.map((s) => s.discordId).filter(Boolean));
    for (const slot of mainSlots) {
        if (slot.discordId && incomingIds.has(slot.discordId)) slot.discordId = null;
    }
    for (const slot of subSlots) {
        if (slot.discordId && incomingIds.has(slot.discordId)) slot.discordId = null;
    }

    const target = isSub ? subSlots : mainSlots;
    for (const parsedSlot of parsed.slots) {
        const idx = parsedSlot.position - 1;
        if (idx < 0 || idx >= target.length) continue;
        target[idx] = {
            position: parsedSlot.position,
            discordId: parsedSlot.discordId
        };
    }

    await updateRegion(guildId, parsed.regionKey, {
        slots: mainSlots,
        subSlots
    });

    await updateLineupConfig(guildId, {
        lastDraft: {
            regionKey: parsed.regionKey,
            board: parsed.board,
            start: parsed.start,
            end: parsed.end
        }
    });

    return { mainSlots, subSlots };
}

function parseSendCommand(content) {
    const text = String(content || "").trim();
    const match = text.match(/^send(?:\s+(.+))?$/i);
    if (!match) return null;

    const rest = (match[1] || "").trim().toLowerCase();
    if (!rest) return { mode: "last" };
    if (rest === "all" || rest === "*") return { mode: "all" };

    const parts = rest.split(/\s+/).filter(Boolean);
    let board = null;
    let regionRaw = rest;
    const last = parts[parts.length - 1];
    if (last === "sub" || last === "sublineup" || last === "subs") {
        board = "sub";
        regionRaw = parts.slice(0, -1).join(" ");
    } else if (last === "main" || last === "line" || last === "lineup") {
        board = "main";
        regionRaw = parts.slice(0, -1).join(" ");
    }

    return { mode: "region", regionRaw, board };
}

async function handleLineupDraftMessage(message) {
    if (!message.guild || message.author.bot) return false;

    const cfg = await getLineupConfig(message.guild.id);
    if (!cfg.setupCompleted) return false;
    if (!isManagementChannel(message, cfg)) return false;

    if (
        (message.channel.name === "tsb-lineups" || message.channel.name === "ascendant-lineups")
        && cfg.managementChannelId !== message.channel.id
    ) {
        await updateLineupConfig(message.guild.id, {
            managementChannelId: message.channel.id
        });
    }

    if (!canManageLineup(message.member, message.guild, cfg)) {
        await message.reply({
            content: "You don't have permission to manage lineup drafts.",
            allowedMentions: { repliedUser: false }
        });
        return true;
    }

    const content = message.content.trim();
    const sendCmd = parseSendCommand(content);

    if (sendCmd) {
        let targetKey = null;
        let publishAll = false;

        if (sendCmd.mode === "all") {
            publishAll = true;
        } else if (sendCmd.mode === "region") {
            targetKey = resolveRegionKey(cfg, sendCmd.regionRaw);
            if (!targetKey) {
                await message.reply({
                    content: `Unknown region \`${sendCmd.regionRaw}\`. Try \`send miami\` or \`send all\`.`,
                    allowedMentions: { repliedUser: false }
                });
                return true;
            }
        } else {
            targetKey = cfg.lastDraft?.regionKey || null;
            if (!targetKey) {
                await message.reply({
                    content:
                        "No recent draft. Post a roster first, or type `send miami` / `send all`.",
                    allowedMentions: { repliedUser: false }
                });
                return true;
            }
        }

        const label = publishAll
            ? "**all regions**"
            : `**${cfg.regions?.[targetKey]?.label || targetKey}**`;

        await updateLineupConfig(message.guild.id, {
            pendingPublish: publishAll ? { all: true } : { regionKey: targetKey }
        });

        await message.reply({
            embeds: [{
                title: "Confirm publish",
                description:
                    `Publish lineup draft for ${label}?\n\n` +
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
                        custom_id: "tsb:lu:publish_confirm"
                    },
                    {
                        type: 2,
                        style: 4,
                        label: "Cancel",
                        custom_id: "tsb:lu:publish_cancel"
                    }
                ]
            }],
            allowedMentions: { repliedUser: false }
        });
        return true;
    }

    const parsed = parseLineupDraft(content, cfg);
    if (!parsed) return false;

    await applyDraftSlots(message.guild.id, parsed);

    const filled = parsed.slots.filter((s) => s.discordId).length;
    const region = cfg.regions?.[parsed.regionKey];
    const boardLabel = parsed.board === "sub" ? "Sub Line Up" : "Line Up";

    await message.react("✅").catch(() => {});
    await message.reply({
        content:
            `Draft updated · **${region?.label || parsed.regionKey}** ${boardLabel} ` +
            `(\`${filled}/${parsed.end - parsed.start + 1}\` filled). ` +
            `Type \`send\` then press **Confirm** to publish.`,
        allowedMentions: { repliedUser: false }
    });

    return true;
}

async function collectMissingProfiles(guild, regionKeys) {
    const { loadPlayerCard } = require("./renderer");
    const missing = [];
    for (const key of regionKeys) {
        const region = await getRegion(guild.id, key);
        if (!region) continue;
        const ids = [
            ...(region.slots || []).map((s) => s.discordId),
            ...(region.subSlots || []).map((s) => s.discordId)
        ].filter(Boolean);
        for (const id of [...new Set(ids)]) {
            const player = await loadPlayerCard(guild, id);
            if (!player?.hasProfile) missing.push(id);
        }
    }
    return [...new Set(missing)];
}

async function publishLiveLineup(interaction) {
    const guild = interaction.guild;
    let cfg = await getLineupConfig(guild.id);

    if (!canManageLineup(interaction.member, guild, cfg)) {
        return interaction.reply({
            content: "You can't publish lineups.",
            ephemeral: true
        });
    }

    await interaction.deferUpdate();

    const pending = cfg.pendingPublish || {};
    let description = "";
    let regionKeys = [];

    if (pending.all) {
        await publishAllLineups(guild);
        cfg = await getLineupConfig(guild.id);
        regionKeys = cfg.enabledRegionKeys || [];
        const lines = regionKeys.map((key) => {
            const region = cfg.regions?.[key];
            const label = region?.label || key;
            const ch = region?.channelId ? `<#${region.channelId}>` : "`none`";
            return `• ${label}: ${ch}`;
        });
        description = `Published **all** lineups:\n${lines.join("\n") || "`none`"}`;
    } else {
        const regionKey = pending.regionKey || cfg.lastDraft?.regionKey;
        if (!regionKey || !cfg.regions?.[regionKey]) {
            return interaction.editReply({
                embeds: [{
                    title: "Publish failed",
                    description: "No region selected. Draft a roster, then type `send`.",
                    color: 0xED4245
                }],
                components: []
            });
        }

        const result = await publishRegionLineup(guild, regionKey);
        cfg = await getLineupConfig(guild.id);
        regionKeys = [regionKey];
        const label = cfg.regions[regionKey]?.label || regionKey;
        const mainId = result.channel?.id || cfg.regions[regionKey]?.channelId;
        const subId = result.subChannel?.id || cfg.regions[regionKey]?.subChannelId;
        description =
            `Published **${label}**:\n` +
            `• Line Up: ${mainId ? `<#${mainId}>` : "`none`"}` +
            (subId && subId !== mainId ? `\n• Sub: <#${subId}>` : "");
    }

    const missingProfiles = await collectMissingProfiles(guild, regionKeys);

    if (missingProfiles.length) {
        description +=
            `\n\n**Missing \`/profile\`:** ${missingProfiles.map((id) => `<@${id}>`).join(", ")}\n` +
            `Those spots show placeholders until they run \`/profile\`, then you \`send\` again.`;
    }

    await updateLineupConfig(guild.id, { pendingPublish: null });

    return interaction.editReply({
        embeds: [{
            title: "Lineup published",
            description,
            color: missingProfiles.length ? 0xFEE75C : 0x57F287
        }],
        components: []
    });
}

module.exports = {
    buildDraftTemplate,
    parseLineupDraft,
    applyDraftSlots,
    handleLineupDraftMessage,
    publishLiveLineup,
    canManageLineup,
    isManagementChannel,
    resolveRegionKey
};
