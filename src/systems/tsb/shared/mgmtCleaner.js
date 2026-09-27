const {
    getLeaderboardConfig,
    updateLeaderboardConfig
} = require("../leaderboard/config");

const {
    getLineupConfig,
    updateLineupConfig
} = require("../lineup/config");

const { resolveGuildPrefix } = require("./guildPrefix");

function buildLineupTipsFromConfig(guildId, cfg) {
    const p = resolveGuildPrefix(guildId);
    const { buildDraftTemplate } = require("../lineup/draft");
    const sampleRegion = (cfg?.enabledRegionKeys || [])[0] || "miami";
    const slots = Math.max(1, Math.min(10, cfg?.slotsPerRegion || 10));
    return (
        "**Lineup management**\n" +
        "Post drafts here like the leaderboard, then type `send` to publish:\n\n" +
        "```\n" +
        buildDraftTemplate(sampleRegion, "main", slots) +
        "\n```\n" +
        `Use \`${sampleRegion} sub\` on the first line for **Sub Line Up**.\n` +
        `\`send\` · \`send ${sampleRegion}\` · \`send all\` → Confirm to publish.\n\n` +
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
        `1-click refresh: \`${p}republish lineups\` / \`/republish\`\n` +
        "Users must have a `/profile`."
    );
}

async function buildLineupTips(guildId) {
    const cfg = guildId ? await getLineupConfig(guildId).catch(() => null) : null;
    return buildLineupTipsFromConfig(guildId, cfg);
}

function buildLeaderboardTips(slotCount = 10, guildId = null) {
    const { buildDraftTemplate } = require("../leaderboard/draft");
    const p = resolveGuildPrefix(guildId);
    return (
        "Post drafts here like this, then type `send` to publish:\n\n" +
        "```\n" +
        buildDraftTemplate(slotCount) +
        "\n```\n\n" +
        "Type `draft` to dump the **current** board (1–10, 11–20, …) ready to copy/edit.\n" +
        `Or place one spot: \`${p}tsbtop <pos> @user\` (also \`/tsbtop\`). Extra boards: first line \`board sa\` in the draft, or \`${p}tsbtop sa <pos> @user\`.\n` +
        `1-click refresh anytime: \`${p}republish\` / \`/republish\`.`
    );
}

function isLineupTipsMessage(msg) {
    const content = msg.content || "";
    return content.includes("**Lineup management**") && content.includes("```");
}

function isLeaderboardTipsMessage(msg) {
    const content = msg.content || "";
    return content.includes("Post drafts here like this") && content.includes("```");
}

function hasPendingConfirm(msg, prefix) {
    if (!msg.components?.length) return false;
    return msg.components.some((row) =>
        (row.components || []).some((c) =>
            c.customId === `${prefix}:publish_confirm` || c.customId === `${prefix}:publish_cancel`
        )
    );
}

const BOARD_NAMES = new Set(["tsb-boards", "ascendant-boards"]);
const LINEUP_NAMES = new Set(["tsb-lineups", "ascendant-lineups"]);

/**
 * Resolves whether a channel is a leaderboard/lineup management channel.
 * Name matches short-circuit so ordinary chat never waits on the API.
 */
async function resolveManagementKind(messageOrChannel, guildId) {
    const channel = messageOrChannel.channel || messageOrChannel;
    if (!channel?.isTextBased?.() || !guildId) return null;

    if (BOARD_NAMES.has(channel.name)) {
        const lb = await getLeaderboardConfig(guildId).catch(() => ({}));
        return { kind: "leaderboard", tipsMessageId: lb.tipsMessageId || null, cfg: lb };
    }
    if (LINEUP_NAMES.has(channel.name)) {
        const lu = await getLineupConfig(guildId).catch(() => ({}));
        return { kind: "lineup", tipsMessageId: lu.tipsMessageId || null, cfg: lu };
    }

    const [lb, lu] = await Promise.all([
        getLeaderboardConfig(guildId).catch(() => null),
        getLineupConfig(guildId).catch(() => null),
    ]);
    if (lb?.managementChannelId && channel.id === lb.managementChannelId) {
        return { kind: "leaderboard", tipsMessageId: lb.tipsMessageId || null, cfg: lb };
    }
    if (lu?.managementChannelId && channel.id === lu.managementChannelId) {
        return { kind: "lineup", tipsMessageId: lu.tipsMessageId || null, cfg: lu };
    }
    return null;
}

function shouldKeepMessage(msg, tipsMessageId, kind) {
    if (tipsMessageId && msg.id === tipsMessageId) return true;
    if (kind === "leaderboard" && hasPendingConfirm(msg, "tsb:lb")) return true;
    if (kind === "lineup" && hasPendingConfirm(msg, "tsb:lu")) return true;
    return false;
}

function oldestMatching(messages, test) {
    return [...(messages?.values?.() || [])]
        .filter((msg) => test(msg))
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0] || null;
}

async function ensureTipsMessage(channel, guildId, kind) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const isLineup = kind === "lineup";
    const cfg = isLineup
        ? await getLineupConfig(guildId).catch(() => ({}))
        : await getLeaderboardConfig(guildId).catch(() => ({}));

    let tips = null;
    if (cfg.tipsMessageId) {
        tips = await channel.messages.fetch(cfg.tipsMessageId).catch(() => null);
    }
    if (!tips && recent?.size) {
        tips = oldestMatching(recent, (m) =>
            m.author?.bot && (isLineup ? isLineupTipsMessage(m) : isLeaderboardTipsMessage(m))
        );
    }

    const content = isLineup
        ? buildLineupTipsFromConfig(guildId, cfg)
        : buildLeaderboardTips(cfg.topPerChannel || 10, guildId);

    if (!tips) {
        tips = await channel.send({ content, components: [] });
    } else if (tips.content !== content) {
        await tips.edit({ content, embeds: [], components: [] }).catch(async () => {
            tips = await channel.send({ content, components: [] });
        });
    }

    if (cfg.tipsMessageId !== tips.id || cfg.managementChannelId !== channel.id) {
        const patch = { tipsMessageId: tips.id, managementChannelId: channel.id };
        const save = isLineup ? updateLineupConfig(guildId, patch) : updateLeaderboardConfig(guildId, patch);
        await Promise.resolve(save).catch((err) => console.warn("tips id save failed:", err?.message || err));
    }
    if (!tips.pinned) await tips.pin().catch(() => {});
    return tips;
}

/**
 * Delete every message in a management channel except the tips (and pending confirms).
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
            for (const msg of bulkable) await msg.delete().catch(() => {});
        });
    } else {
        for (const msg of bulkable) await msg.delete().catch(() => {});
    }
    for (const msg of older) await msg.delete().catch(() => {});

    return tips;
}

async function sweepIfManagementChannel(messageOrChannel, guildId, { delayMs = 900, resolved = null } = {}) {
    const channel = messageOrChannel.channel || messageOrChannel;
    const match = resolved || await resolveManagementKind(channel, guildId);
    if (!match) return false;

    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    await sweepManagementChannel(channel, guildId, match.kind);
    return true;
}

module.exports = {
    buildLineupTips,
    buildLeaderboardTips,
    resolveManagementKind,
    ensureTipsMessage,
    sweepManagementChannel,
    sweepIfManagementChannel,
    isLineupTipsMessage,
    isLeaderboardTipsMessage
};
