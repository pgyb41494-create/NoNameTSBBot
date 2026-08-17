const { PermissionFlagsBits } = require("discord.js");

const {
    getScoreConfig,
    getPlayerState,
    setPlayerState,
    pushMatch
} = require("./config");

const {
    getLeaderboardConfig,
    updateLeaderboardConfig
} = require("../leaderboard/config");

const { refreshLeaderboard } = require("../leaderboard/renderer");

const {
    getProfileByDiscordId,
    resolveRobloxUser
} = require("../shared/profileAdapter");
const { hasAccessPerm } = require("../access/store");

function canUseScore(member, guild, cfg) {
    if (!member) return false;
    if (guild.ownerId === member.id) return true;
    if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
    if (hasAccessPerm(guild.id, member.id, "SCORE")) return true;
    const allowed = cfg.allowedRoleIds || [];
    // Empty allowed list = locked (admins/owner only) — configure roles in -setup
    if (!allowed.length) return false;
    return allowed.some((id) => member.roles.cache.has(id));
}

function isOnCooldown(playerState) {
    if (!playerState?.cooldownUntil) return false;
    const until = new Date(playerState.cooldownUntil).getTime();
    return Number.isFinite(until) && until > Date.now();
}

function parseScore(raw) {
    const text = String(raw || "").trim();
    const match = text.match(/^(\d+)\s*[-–—:]\s*(\d+)$/);
    if (!match) return null;
    return {
        left: Number(match[1]),
        right: Number(match[2]),
        display: `${match[1]}-${match[2]}`
    };
}

function relativeTime(iso) {
    if (!iso) return "never";
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "never";
    const diff = Math.max(0, Date.now() - then);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Discord relative timestamp: <t:unix:R> */
function discordRelative(isoOrDate) {
    if (!isoOrDate) return "never";
    const ms = isoOrDate instanceof Date ? isoOrDate.getTime() : new Date(isoOrDate).getTime();
    if (!Number.isFinite(ms)) return "never";
    return `<t:${Math.floor(ms / 1000)}:R>`;
}

/** Cooldown end time from 1v1 Score Config day values */
function cooldownUntilFromDays(days) {
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

function boardPosition(guildId, userId) {
    const cfg = getLeaderboardConfig(guildId);
    const slots = cfg.slots || [];
    const idx = slots.findIndex((s) => s?.discordId && String(s.discordId) === String(userId));
    return idx >= 0 ? idx + 1 : null;
}

async function loadDisplay(guild, userId) {
    const member = await guild.members.fetch(userId).catch(() => null);
    let profile = await getProfileByDiscordId(guild.id, userId).catch(() => null);
    if (!profile) profile = await getProfileByDiscordId(null, userId).catch(() => null);

    let avatarUrl = profile?.roblox_avatar_url || null;
    if (!avatarUrl && (profile?.roblox_id || profile?.roblox_username)) {
        try {
            const resolved = await resolveRobloxUser(profile.roblox_id || profile.roblox_username);
            avatarUrl = resolved?.avatarUrl || null;
        } catch {
            // ignore
        }
    }

    if (!avatarUrl) {
        avatarUrl = member?.user?.displayAvatarURL({ size: 128 }) || null;
    }

    const name =
        profile?.roblox_display_name ||
        profile?.display_name ||
        profile?.roblox_username ||
        member?.displayName ||
        "Unknown";

    return {
        discordId: String(userId),
        mention: `<@${userId}>`,
        name,
        avatarUrl,
        position: boardPosition(guild.id, userId),
        profile
    };
}

function detectAutowin(score, notes) {
    const noteText = String(notes || "").toLowerCase();
    if (/\bauto\b/.test(noteText) || noteText.includes("autowin") || noteText.includes("auto win")) {
        return true;
    }
    if (score && (score.left === 0 || score.right === 0) && Math.max(score.left, score.right) >= 10) {
        if (noteText.includes("w") && noteText.includes("auto")) return true;
    }
    return false;
}

function formatRank(position) {
    if (!position) return "`#?`";
    return `\`#${position}\``;
}

function formatPlayerChip(player) {
    return `${formatRank(player.position)} ${player.mention}`;
}

function formatReferees(raw) {
    const text = String(raw || "").trim();
    if (!text || /^none$/i.test(text)) return "None";
    return text;
}

async function bumpLeaderboard(guild, winnerId, loserId) {
    const cfg = getLeaderboardConfig(guild.id);
    if (!cfg.setupCompleted || !(cfg.slots || []).length) {
        return { bumped: false, reason: "lb_not_setup" };
    }

    const winnerPos = boardPosition(guild.id, winnerId);
    const loserPos = boardPosition(guild.id, loserId);

    if (!loserPos) {
        return { bumped: false, reason: "loser_off_board", winnerPos, loserPos };
    }

    // Defense: already equal/better rank keeps the board
    if (winnerPos && winnerPos <= loserPos) {
        return { bumped: false, reason: "defense", winnerPos, loserPos };
    }

    const ids = (cfg.slots || []).map((s) => (s?.discordId ? String(s.discordId) : null));
    const wIdx = winnerPos ? winnerPos - 1 : -1;
    const lIdx = loserPos - 1;
    const winnerStr = String(winnerId);
    let droppedId = null;

    if (wIdx >= 0) {
        ids.splice(wIdx, 1);
        ids.splice(lIdx, 0, winnerStr);
    } else {
        ids.splice(lIdx, 0, winnerStr);
        droppedId = ids.pop() || null;
        if (droppedId === winnerStr) droppedId = null;
    }

    const slots = ids.map((discordId, i) => ({
        position: i + 1,
        discordId
    }));

    updateLeaderboardConfig(guild.id, { slots });
    await refreshLeaderboard(guild).catch((err) => {
        console.warn("[Score] leaderboard refresh failed:", err.message);
    });

    await syncTopPlayerRole(guild, slots[0]?.discordId).catch(() => {});

    return {
        bumped: true,
        swapped: true,
        winnerPos: loserPos,
        previousWinnerPos: winnerPos,
        loserFrom: loserPos,
        challengedFor: loserPos,
        droppedId
    };
}

/** @deprecated Use bumpLeaderboard — kept for callers expecting swap naming. */
async function swapLeaderboardSlots(guild, winnerId, loserId) {
    const result = await bumpLeaderboard(guild, winnerId, loserId);
    return {
        ...result,
        swapped: !!result.bumped
    };
}

async function syncTopPlayerRole(guild, topDiscordId) {
    const cfg = getLeaderboardConfig(guild.id);
    const roleId = cfg.topPlayerRoleId;
    if (!roleId || !topDiscordId) return;

    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) return;

    const topId = String(topDiscordId);
    for (const member of guild.members.cache.values()) {
        if (member.roles.cache.has(roleId) && member.id !== topId) {
            await member.roles.remove(role).catch(() => {});
        }
    }

    const topMember = await guild.members.fetch(topId).catch(() => null);
    if (topMember && !topMember.roles.cache.has(roleId)) {
        await topMember.roles.add(role).catch(() => {});
    }
}

/**
 * Meteorite-style plain message with Discord # headers (big text).
 *
 * # PVP FOR TOP `#1` LATAM
 * # `#1` @a vs `#2` @b
 * # Score: 10-9 to @b
 *
 * - *Referees*: @ref
 * - *Cooldowns*:
 *
 * @a: <t:…:R>, @b: <t:…:R>
 *
 * - *Autowin Strike*: N/A
 * - *Notes*: …
 * ||@role||
 */
function buildMatchMessage({
    region,
    p1,
    p2,
    winner,
    scoreDisplay,
    referees,
    notes,
    autowinLabel,
    cd1,
    cd2,
    crossRegionLines,
    pvpRoleId,
    leaderboardLine
}) {
    const ranks = [p1.position, p2.position].filter(Boolean);
    const topRank = ranks.length ? Math.min(...ranks) : null;
    const regionLabel = (region || "").trim().toUpperCase();

    const title = topRank
        ? `# PVP FOR TOP ${formatRank(topRank)}${regionLabel ? ` ${regionLabel}` : ""}`
        : `# PVP MATCH${regionLabel ? ` ${regionLabel}` : ""}`;

    const lines = [
        title,
        `# ${formatPlayerChip(p1)} vs ${formatPlayerChip(p2)}`,
        `# Score: ${scoreDisplay} to ${winner.mention}`,
        "",
        `- *Referees*: ${formatReferees(referees)}`,
        `- *Cooldowns*:`,
        "",
        `${p1.mention}: ${cd1}, ${p2.mention}: ${cd2}`,
        "",
        `- *Autowin Strike*: ${autowinLabel || "N/A"}`,
        `- *Notes*: ${notes && notes !== "None" ? notes : "None"}`,
        `- *Leaderboard*: ${leaderboardLine || "no change"}`
    ];

    if (crossRegionLines?.length) {
        lines.push("", ...crossRegionLines);
    }

    if (pvpRoleId) {
        lines.push(`||<@&${pvpRoleId}>||`);
    }

    return lines.join("\n");
}

function formatLeaderboardBump(bump, winner, loser) {
    if (!bump) return "leaderboard not linked";
    if (bump.bumped) {
        const from = bump.previousWinnerPos ? `#${bump.previousWinnerPos}` : "off-board";
        let text = `${winner.mention} took \`#${bump.winnerPos}\` (from ${from})`;
        if (bump.droppedId) {
            text += ` · <@${bump.droppedId}> dropped off`;
        }
        return text;
    }
    if (bump.reason === "defense") {
        return `${winner.mention} defended \`#${bump.winnerPos}\``;
    }
    if (bump.reason === "loser_off_board") {
        return "no change (opponent not on leaderboard)";
    }
    if (bump.reason === "lb_not_setup") {
        return "no change (leaderboard not set up)";
    }
    return "no change";
}

async function applyMatchResult({
    guild,
    recorderId,
    participant1Id,
    participant2Id,
    winnerId,
    scoreRaw,
    matchType = "1v1",
    region = null,
    notes = null,
    referees = null,
    crossregion = false,
    region1 = null,
    region1Score = null,
    region1WinnerId = null,
    region2 = null,
    region2Score = null,
    region2WinnerId = null,
}) {
    const cfg = getScoreConfig(guild.id);
    if (!cfg.setupCompleted) {
        return { error: "1v1 Score is not set up yet. Use `/tsbsetup` → **1v1 Score Setup**." };
    }

    if (String(participant1Id) === String(participant2Id)) {
        return { error: "Participants must be two different users." };
    }
    if (String(winnerId) !== String(participant1Id) && String(winnerId) !== String(participant2Id)) {
        return { error: "Winner must be one of the two participants." };
    }

    const score = parseScore(scoreRaw);
    if (!score) {
        return { error: "Score must look like `10-0` or `5-3`." };
    }

    const state1 = getPlayerState(guild.id, participant1Id);
    const state2 = getPlayerState(guild.id, participant2Id);
    const blocked = [];
    if (isOnCooldown(state1)) {
        blocked.push(`<@${participant1Id}> until ${discordRelative(state1.cooldownUntil)}`);
    }
    if (isOnCooldown(state2)) {
        blocked.push(`<@${participant2Id}> until ${discordRelative(state2.cooldownUntil)}`);
    }
    if (blocked.length) {
        return { error: `Cooldown active — cannot record this match yet:\n• ${blocked.join("\n• ")}` };
    }

    const p1 = await loadDisplay(guild, participant1Id);
    const p2 = await loadDisplay(guild, participant2Id);
    const winner = String(winnerId) === p1.discordId ? p1 : p2;
    const loser = String(winnerId) === p1.discordId ? p2 : p1;

    const prevLoser = getPlayerState(guild.id, loser.discordId);
    const prevWinner = getPlayerState(guild.id, winner.discordId);

    const isAutowin = detectAutowin(score, notes);
    let autowinLabel = "N/A";
    let loserStrikes = prevLoser.autowinStrikes || 0;

    if (cfg.autowinEnabled) {
        if (isAutowin) {
            loserStrikes = (prevLoser.autowinStrikes || 0) + 1;
            autowinLabel = `${loserStrikes}/${cfg.autowinThreshold}`;
            if (loserStrikes >= cfg.autowinThreshold) {
                autowinLabel += " (threshold reached)";
            }
        } else {
            autowinLabel = "N/A";
        }
    }

    const now = new Date().toISOString();
    const winnerCdUntil = cooldownUntilFromDays(cfg.winnerCooldownDays);
    const loserCdUntil = cooldownUntilFromDays(cfg.loserCooldownDays);
    const winnerCdText = winnerCdUntil ? discordRelative(winnerCdUntil) : "none";
    const loserCdText = loserCdUntil ? discordRelative(loserCdUntil) : "none";
    const cd1 = winner.discordId === p1.discordId ? winnerCdText : loserCdText;
    const cd2 = winner.discordId === p2.discordId ? winnerCdText : loserCdText;

    setPlayerState(guild.id, winner.discordId, {
        lastMatchAt: now,
        lastResult: "win",
        cooldownUntil: winnerCdUntil ? winnerCdUntil.toISOString() : null,
        autowinStrikes: cfg.autowinSuccessBehavior === "reset" && !isAutowin
            ? 0
            : (prevWinner.autowinStrikes || 0)
    });

    setPlayerState(guild.id, loser.discordId, {
        lastMatchAt: now,
        lastResult: isAutowin ? "autoloss" : "loss",
        cooldownUntil: loserCdUntil ? loserCdUntil.toISOString() : null,
        autowinStrikes: cfg.autowinEnabled && isAutowin
            ? loserStrikes
            : (cfg.autowinSuccessBehavior === "reset" ? 0 : (prevLoser.autowinStrikes || 0))
    });

    const swap = await bumpLeaderboard(guild, winner.discordId, loser.discordId);
    try {
      const api = require("../../../utils/loadApi");
      if (api.challenges?.clearInvolving) {
        await Promise.resolve(api.challenges.clearInvolving(guild.id, winner.discordId));
        await Promise.resolve(api.challenges.clearInvolving(guild.id, loser.discordId));
      }
    } catch {}
    const leaderboardLine = formatLeaderboardBump(swap, winner, loser);

    const region1Winner = region1WinnerId ? `<@${region1WinnerId}>` : null;
    const region2Winner = region2WinnerId ? `<@${region2WinnerId}>` : null;
    const crossRegionLines = [];
    if (crossregion || region1 || region2) {
        if (region1 || region1Score || region1Winner) {
            crossRegionLines.push(
                `- *Region 1*: ${region1 || "—"} · ${region1Score || "—"} · ${region1Winner || "—"}`
            );
        }
        if (region2 || region2Score || region2Winner) {
            crossRegionLines.push(
                `- *Region 2*: ${region2 || "—"} · ${region2Score || "—"} · ${region2Winner || "—"}`
            );
        }
    }

    const body = buildMatchMessage({
        region,
        p1: { ...p1 },
        p2: { ...p2 },
        winner: { ...winner },
        scoreDisplay: score.display,
        referees: referees || "None",
        notes: notes || "None",
        autowinLabel,
        cd1,
        cd2,
        crossRegionLines,
        pvpRoleId: cfg.pvpUpdatesRoleId || null,
        leaderboardLine
    });

    pushMatch(guild.id, {
        at: now,
        matchType,
        participant1: p1.discordId,
        participant2: p2.discordId,
        winner: winner.discordId,
        score: score.display,
        region: region || null,
        notes: notes || null,
        autowin: isAutowin,
        swapped: !!swap.bumped,
        bumped: !!swap.bumped,
        bumpTo: swap.bumped ? swap.winnerPos : null,
        recordedBy: recorderId || null
    });

    try {
        const api = require("../../../utils/loadApi");
        api.score.recordMatch(guild.id, {
            winnerId: winner.discordId,
            loserId: loser.discordId,
            score: score.display,
            region: region || null,
            matchType,
            notes: notes || null,
        });
    } catch {}

    const refIds = [...String(referees || "").matchAll(/<@!?(\d+)>/g)].map((m) => m[1]);
    return {
        body,
        allowedMentions: {
            roles: cfg.pvpUpdatesRoleId ? [cfg.pvpUpdatesRoleId] : [],
            users: [p1.discordId, p2.discordId, ...refIds]
        },
        p1,
        p2,
        winner,
        loser,
        swap,
        score
    };
}

async function recordScore(interaction) {
    const guild = interaction.guild;
    const cfg = getScoreConfig(guild.id);

    if (!canUseScore(interaction.member, guild, cfg)) {
        const needsRoles = !(cfg.allowedRoleIds || []).length;
        return interaction.reply({
            content: needsRoles
                ? "No score staff roles are configured yet. An admin must finish `/tsbsetup` → **1v1 Score Setup** (allowed roles)."
                : "You are not allowed to use `/score`.",
            ephemeral: true
        });
    }

    const result = await applyMatchResult({
        guild,
        recorderId: interaction.user.id,
        participant1Id: interaction.options.getUser("participant_1", true).id,
        participant2Id: interaction.options.getUser("participant_2", true).id,
        winnerId: interaction.options.getUser("winner", true).id,
        scoreRaw: interaction.options.getString("score", true),
        matchType: interaction.options.getString("match_type", true),
        region: interaction.options.getString("region"),
        notes: interaction.options.getString("notes"),
        referees: interaction.options.getString("referees"),
        crossregion: interaction.options.getBoolean("crossregion") || false,
        region1: interaction.options.getString("region_1"),
        region1Score: interaction.options.getString("region_1_score"),
        region1WinnerId: interaction.options.getUser("region_1_winner")?.id || null,
        region2: interaction.options.getString("region_2"),
        region2Score: interaction.options.getString("region_2_score"),
        region2WinnerId: interaction.options.getUser("region_2_winner")?.id || null,
    });

    if (result.error) {
        return interaction.reply({ content: result.error, ephemeral: true });
    }

    return interaction.reply({
        content: result.body,
        embeds: [],
        allowedMentions: result.allowedMentions
    });
}

module.exports = {
    recordScore,
    applyMatchResult,
    canUseScore,
    parseScore,
    boardPosition,
    bumpLeaderboard,
    swapLeaderboardSlots,
    detectAutowin,
    relativeTime,
    discordRelative,
    buildMatchMessage,
    formatLeaderboardBump
};
