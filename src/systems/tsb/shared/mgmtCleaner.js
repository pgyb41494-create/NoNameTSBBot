const {
    getLeaderboardConfig,
    updateLeaderboardConfig
} = require("../leaderboard/config");

const {
    getLineupConfig,
    updateLineupConfig
} = require("../lineup/config");

const { resolveGuildPrefix } = require("./guildPrefix");

function buildLineupTips(guildId) {
    const p = resolveGuildPrefix(guildId);
    const { buildDraftTemplate } = require("../lineup/draft");
    const cfg = getLineupConfig(guildId);
    const sampleRegion = (cfg.enabledRegionKeys || [])[0] || "miami";
    const slots = Math.max(1, Math.min(10, cfg.slotsPerRegion || 10));
    return (
        "**Lineup management**\n" +
        "Post drafts here like the leaderboard, then type `send` to publish:\n\n" +
        "```\n" +
        buildDraftTemplate(sampleRegion, "main", slots) +
        "\n```\n" +
        "Use `miami sub` on the first line for **Sub Line Up**.\n" +
        "`send` · `send miami` · `send all` → Confirm to publish.\n\n" +
        "Or use commands:\n" +
        "```\n" +
        `${p}lineup add <region> <pos> @user\n` +
        `${p}lineup remove <region> <pos>\n` +
        `${p}lineup replace <region> <pos> @user\n` +
        `${p}lineup sub add <region> <pos> @user\n` +
        `${p}lineup publish <region|all>\n` +
        `${p}lineup list\n` +
        "```\n" +
        "Slash works too: `/lineup …`\n" +
        "Users must have a `/profile`."
    );
}

function buildLeaderboardTips(slotCount = 10, guildId = null) {
    const { buildDraftTemplate } = require("../leaderboard/draft");
    const p = guildId ? resolveGuildPrefix(guildId) : "!";
    return (
        "Post drafts here like this, then type `send` to publish:\n\n" +
        "```\n" +
        buildDraftTemplate(slotCount) +
        "\n```\n\n" +
        `Or place one spot: \`${p}tsbtop <pos> @user\` (also \`/tsbtop\`).`
    );
}

/** @deprecated Use buildLineupTips(guildId) — fallback uses `!` */
const LINEUP_TIPS = buildLineupTips(null);

function isLineupTipsMessage(msg) {
    const content = msg.content || "";
    return content.includes("**Lineup management**") && content.includes("lineup add");
}

function isLeaderboardTipsMessage(msg) {
    const content = msg.content || "";
    return content.includes("Post drafts here like this") && content.includes("```");
}

function hasPendingLeaderboardConfirm(msg) {
    if (!msg.components?.length) return false;
    return msg.components.some((row) =>
        (row.components || []).some((c) =>
            c.customId === "tsb:lb:publish_confirm" || c.customId === "tsb:lb:publish_cancel"
        )
    );
}

function hasPendingLineupConfirm(msg) {
    if (!msg.components?.length) return false;
    return msg.components.some((row) =>
        (row.components || []).some((c) =>
            c.customId === "tsb:lu:publish_confirm" || c.customId === "tsb:lu:publish_cancel"
        )
    );
}

function resolveManagementKind(messageOrChannel, guildId) {
    const channel = messageOrChannel.channel || messageOrChannel;
    if (!channel?.isTextBased?.() || !guildId) return null;

    const lb = getLeaderboardConfig(guildId);
    if (
        (lb.managementChannelId && channel.id === lb.managementChannelId) ||
        channel.name === "tsb-boards" ||
        channel.name === "ascendant-boards"
    ) {
        return { kind: "leaderboard", tipsMessageId: lb.tipsMessageId || null, cfg: lb };
    }

    const lu = getLineupConfig(guildId);
    if (
        (lu.managementChannelId && channel.id === lu.managementChannelId) ||
        channel.name === "tsb-lineups" ||
        channel.name === "ascendant-lineups"
    ) {
        return { kind: "lineup", tipsMessageId: lu.tipsMessageId || null, cfg: lu };
    }

    return null;
}

function shouldKeepMessage(msg, tipsMessageId, kind) {
    if (tipsMessageId && msg.id === tipsMessageId) return true;
    if (kind === "leaderboard" && hasPendingLeaderboardConfirm(msg)) return true;
    if (kind === "lineup" && hasPendingLineupConfirm(msg)) return true;
    return false;
}

function oldestMatching(messages, test) {
    return [...(messages?.values?.() || [])]
        .filter((msg) => test(msg))
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0] || null;
}

async function ensureTipsMessage(channel, guildId, kind) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    let tips = null;

    if (kind === "lineup") {
        const cfg = getLineupConfig(guildId);
        if (cfg.tipsMessageId) {
            tips = await channel.messages.fetch(cfg.tipsMessageId).catch(() => null);
        }
        if (!tips && recent?.size) tips = oldestMatching(recent, isLineupTipsMessage);
        const content = buildLineupTips(guildId);
        if (!tips) {
            tips = await channel.send({ content, components: [] });
        } else {
            await tips.edit({ content, components: [] }).catch(async () => {
                tips = await channel.send({ content, components: [] });
            });
        }
        updateLineupConfig(guildId, { tipsMessageId: tips.id });
        await tips.pin().catch(() => {});
        return tips;
    }

    const cfg = getLeaderboardConfig(guildId);
    if (cfg.tipsMessageId) {
        tips = await channel.messages.fetch(cfg.tipsMessageId).catch(() => null);
    }
    if (!tips && recent?.size) tips = oldestMatching(recent, isLeaderboardTipsMessage);
    const content = buildLeaderboardTips(cfg.topPerChannel || 10, guildId);
    if (!tips) {
        tips = await channel.send({ content });
    } else {
        await tips.edit({ content }).catch(async () => {
            tips = await channel.send({ content });
        });
    }
    updateLeaderboardConfig(guildId, { tipsMessageId: tips.id });
    await tips.pin().catch(() => {});
    return tips;
}

/**
 * Delete every message in a management channel except the tips (and pending LB confirm).
 */
async function sweepManagementChannel(channel, guildId, kind) {
    if (!channel?.isTextBased?.() || !guildId || !kind) return null;

    const tips = await ensureTipsMessage(channel, guildId, kind);
    const tipsMessageId = tips.id;

    const fetched = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!fetched?.size) return tips;

    const toDelete = [...fetched.values()].filter(
        (msg) => !shouldKeepMessage(msg, tipsMessageId, kind)
    );

    if (!toDelete.length) return tips;

    const twoWeeks = 14 * 24 * 60 * 60 * 1000;
    const bulkable = toDelete.filter((m) => Date.now() - m.createdTimestamp < twoWeeks);
    const older = toDelete.filter((m) => Date.now() - m.createdTimestamp >= twoWeeks);

    if (bulkable.length >= 2) {
        await channel.bulkDelete(bulkable, true).catch(async () => {
            for (const msg of bulkable) {
                await msg.delete().catch(() => {});
            }
        });
    } else {
        for (const msg of bulkable) {
            await msg.delete().catch(() => {});
        }
    }

    for (const msg of older) {
        await msg.delete().catch(() => {});
    }

    return tips;
}

async function sweepIfManagementChannel(messageOrChannel, guildId, { delayMs = 900 } = {}) {
    const channel = messageOrChannel.channel || messageOrChannel;
    const resolved = resolveManagementKind(channel, guildId);
    if (!resolved) return false;

    if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
    }

    await sweepManagementChannel(channel, guildId, resolved.kind);
    return true;
}

module.exports = {
    LINEUP_TIPS,
    buildLineupTips,
    buildLeaderboardTips,
    resolveManagementKind,
    ensureTipsMessage,
    sweepManagementChannel,
    sweepIfManagementChannel,
    isLineupTipsMessage,
    isLeaderboardTipsMessage
};
