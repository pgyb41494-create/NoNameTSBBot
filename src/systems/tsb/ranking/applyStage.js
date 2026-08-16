/**
 * Shared stage / ranking role assignment used by /stage and prefix aliases.
 */

const { EmbedBuilder } = require("discord.js");
const { authorName } = require("../../../utils/loadApi");

const RANKING_LOG_COLOR = 0x5DADE2;

function pngAvatar(userOrMember, size = 256) {
    const user = userOrMember?.user || userOrMember;
    if (!user?.displayAvatarURL) return null;
    try {
        return user.displayAvatarURL({ size, extension: "png", forceStatic: true });
    } catch {
        return null;
    }
}

function isHttpUrl(value) {
    return typeof value === "string" && /^https?:\/\//i.test(value);
}

function formatRolePart(role, fallback) {
    if (role?.id && role.color) return `<@&${role.id}>`;
    if (role?.name) return `**${role.name}**`;
    return fallback;
}

function displayTierLabel(tsbRanking, invokedName) {
    const invoked = String(invokedName || "").toLowerCase();
    if (invoked === "phase") return "Phase";
    if (invoked === "tier") return "Tier";
    if (invoked === "rank") return "Rank";
    if (invoked === "stage") return "Stage";
    return String(tsbRanking?.tierLabel || "Phase").trim() || "Phase";
}

function findPhaseRole(guild, phaseNum) {
    const patterns = [
        `phase ${phaseNum}`, `phase${phaseNum}`,
        `stage ${phaseNum}`, `stage${phaseNum}`,
        `ph${phaseNum}`, `st${phaseNum}`,
        `tier ${phaseNum}`, `tier${phaseNum}`, `t${phaseNum}`,
    ].map((p) => p.toLowerCase());

    const exactMatch = guild.roles.cache.find((role) => {
        if (role.managed) return false;
        if (/(?:stage|phase|tier)\s*1\s*applicant/i.test(role.name)) return false;
        const normalized = String(role.name || "").toLowerCase().trim().replace(/\s+/g, " ");
        return patterns.includes(normalized);
    });
    if (exactMatch) return exactMatch;

    return guild.roles.cache.find((role) => {
        if (role.managed) return false;
        if (/(?:stage|phase|tier)\s*1\s*applicant/i.test(role.name)) return false;
        return new RegExp(`(?:phase|stage|tier|ph|st|t)\\s*${phaseNum}\\b`, "i").test(role.name);
    }) || null;
}

function findRoleByKeyword(guild, keyword) {
    const key = String(keyword || "").toLowerCase().trim();
    if (!key) return null;
    return guild.roles.cache.find((role) => {
        if (role.managed) return false;
        return new RegExp(`\\b${key}\\b`, "i").test(role.name);
    }) || null;
}

function resolveConfiguredRole(guild, ids, names, wanted) {
    if (!ids?.length || !names?.length) return null;
    const want = String(wanted || "").toLowerCase();
    const idx = names.findIndex((n) => String(n).toLowerCase() === want);
    if (idx < 0 || !ids[idx]) return null;
    return guild.roles.cache.get(ids[idx]) || null;
}

function findExactRole(guild, name) {
    const want = String(name || "").toLowerCase().trim();
    if (!want) return null;
    return guild.roles.cache.find((role) => {
        if (role.managed) return false;
        return String(role.name || "").toLowerCase().trim() === want;
    }) || null;
}

async function ensureNamedRole(guild, name) {
    const roleName = String(name || "").trim().slice(0, 100);
    if (!roleName) return null;
    const existing = findExactRole(guild, roleName);
    if (existing) return existing;
    const me = guild.members.me;
    if (!me?.permissions?.has?.("ManageRoles")) return null;
    try {
        return await guild.roles.create({
            name: roleName,
            reason: "TSB stage assign — create missing ranking role",
            mentionable: false,
            hoist: false,
        });
    } catch {
        return null;
    }
}

/**
 * @param {object} opts
 * @param {import('discord.js').Guild} opts.guild
 * @param {import('discord.js').GuildMember} opts.member
 * @param {string} opts.actorTag
 * @param {number} opts.phaseNum
 * @param {string|null} opts.tier
 * @param {string|null} opts.subtier
 * @param {boolean} [opts.asApplicant]
 * @param {object} [opts.settings]
 * @param {object|null} [opts.tsbRanking]
 * @returns {Promise<{ assigned: string[], failed: string[], phaseRole: import('discord.js').Role|null, tierRole: import('discord.js').Role|null, subtierRole: import('discord.js').Role|null }>}
 */
async function applyStageRoles({
    guild,
    member,
    actorTag,
    phaseNum,
    tier,
    subtier,
    asApplicant = false,
    settings = {},
    tsbRanking = null,
}) {
    const me = guild.members.me;
    const assigned = [];
    const failed = [];
    const reason = `Stage update by ${actorTag}`;

    const resolveApplicantRole = () => {
        if (tsbRanking?.applicantRoleId) {
            return guild.roles.cache.get(tsbRanking.applicantRoleId) || null;
        }
        return guild.roles.cache.find((role) => (
            !role.managed && /(?:stage|phase|tier)\s*1\s*applicant/i.test(role.name)
        )) || guild.roles.cache.find((role) => (
            !role.managed && /\bapplicant\b/i.test(role.name)
        )) || null;
    };

    const isApplicantRole = (role) => {
        if (!role || role.managed) return false;
        if (tsbRanking?.applicantRoleId && role.id === tsbRanking.applicantRoleId) return true;
        if (/(?:stage|phase|tier)\s*1\s*applicant/i.test(role.name)) return true;
        if (/\bapplicant\b/i.test(role.name) && !/\b(high|mid|low|strong|stable|weak)\b/i.test(role.name)) return true;
        return false;
    };

    // Explicit applicant mode: `!stage @user 1 applicant`
    // Keep existing stage / subrank / power roles — only manage the applicant role.
    if (asApplicant) {
        let applicantRole = resolveApplicantRole();
        if (!applicantRole && tsbRanking?.autoCreateRoles !== false) {
            const label = tsbRanking?.tierLabel || "Phase";
            applicantRole = await ensureNamedRole(guild, `${label} 1 Applicant`);
        }
        if (!applicantRole) {
            failed.push("applicant (no matching role)");
            return { assigned, failed, phaseRole: null, tierRole: null, subtierRole: null };
        }

        for (const [, role] of member.roles.cache.filter((role) => isApplicantRole(role) && role.id !== applicantRole.id)) {
            try {
                await member.roles.remove(role, reason);
            } catch {}
        }

        if (member.roles.cache.has(applicantRole.id)) {
            assigned.push(applicantRole.name);
        } else if (me && applicantRole.position < me.roles.highest.position) {
            try {
                await member.roles.add(applicantRole, `${reason} (applicant)`);
                assigned.push(applicantRole.name);
            } catch {
                failed.push(`${applicantRole.name} (error)`);
            }
        } else {
            failed.push(`${applicantRole.name} (above my role)`);
        }

        try {
            const { removeTryoutCooldownRole } = require("./tryoutCooldown");
            const removed = await removeTryoutCooldownRole(member, tsbRanking, "Applicant assigned");
            if (removed) {
                const role = tsbRanking?.tryoutCooldownRoleId
                    ? guild.roles.cache.get(tsbRanking.tryoutCooldownRoleId)
                    : null;
                if (role) assigned.push(`removed ${role.name}`);
            }
        } catch {}

        return { assigned, failed, phaseRole: applicantRole, tierRole: null, subtierRole: null };
    }

    const configuredIds = new Set([
        ...(tsbRanking?.tierRoleIds || []),
        ...(tsbRanking?.subrankRoleIds || []),
        ...(tsbRanking?.powerRoleIds || []),
    ].filter(Boolean));

    // Rank order (worst → best): 5 → 4 → 3 → 2 → 1 applicant → 1 → 0
    // Keep applicant through Stage 2+; remove it once they reach Stage 1 or 0.
    const stripApplicant = Number(phaseNum) <= 1;

    const toStrip = member.roles.cache.filter((role) => {
        if (role.managed) return false;
        if (isApplicantRole(role)) return stripApplicant;
        if (configuredIds.has(role.id)) return true;
        if (/(?:stage|phase|tier)\s*[0-5]/i.test(role.name)) return true;
        if (/\b(high|mid|low)\b/i.test(role.name)) return true;
        if (/\b(strong|stable|weak)\b/i.test(role.name)) return true;
        return false;
    });

    for (const [, role] of toStrip) {
        try {
            await member.roles.remove(role, reason);
        } catch {}
    }

    const phaseMap = settings.verifyPhaseRoleMap || {};
    let phaseRole = phaseMap[String(phaseNum)]
        ? guild.roles.cache.get(phaseMap[String(phaseNum)])
        : null;
    if (!phaseRole && tsbRanking?.tierRoleIds?.[phaseNum]) {
        phaseRole = guild.roles.cache.get(tsbRanking.tierRoleIds[phaseNum]) || null;
    }
    if (!phaseRole) phaseRole = findPhaseRole(guild, phaseNum);
    if (!phaseRole && tsbRanking?.autoCreateRoles !== false) {
        const label = tsbRanking?.tierLabel || "Phase";
        phaseRole = await ensureNamedRole(guild, `${label} ${phaseNum}`);
    }

    const phaseLabel = `${tsbRanking?.tierLabel || "Phase"} ${phaseNum}`;
    if (phaseRole) {
        if (me && phaseRole.position < me.roles.highest.position) {
            try {
                await member.roles.add(phaseRole, reason);
                assigned.push(phaseRole.name);
            } catch {
                failed.push(`${phaseRole.name} (error)`);
            }
        } else {
            failed.push(`${phaseLabel} (above my role)`);
        }
    } else {
        failed.push(`${phaseLabel} (no matching role)`);
    }

    let tierRole = resolveConfiguredRole(
        guild,
        tsbRanking?.subrankRoleIds,
        tsbRanking?.subranks || tsbRanking?.subtiers,
        tier
    ) || findRoleByKeyword(guild, tier);
    if (!tierRole && tier && tsbRanking?.autoCreateRoles !== false) {
        tierRole = await ensureNamedRole(guild, capitalizeWord(tier));
    }

    if (tierRole) {
        if (me && tierRole.position < me.roles.highest.position) {
            try {
                await member.roles.add(tierRole, reason);
                assigned.push(tierRole.name);
            } catch {
                failed.push(`${tier} (error)`);
            }
        } else {
            failed.push(`${tier} (above my role)`);
        }
    } else {
        failed.push(`${tier} (no matching role)`);
    }

    let subtierRole = resolveConfiguredRole(
        guild,
        tsbRanking?.powerRoleIds,
        tsbRanking?.powerRanks,
        subtier
    ) || findRoleByKeyword(guild, subtier);
    if (!subtierRole && subtier && tsbRanking?.autoCreateRoles !== false) {
        subtierRole = await ensureNamedRole(guild, capitalizeWord(subtier));
    }

    if (subtierRole) {
        if (me && subtierRole.position < me.roles.highest.position) {
            try {
                await member.roles.add(subtierRole, reason);
                assigned.push(subtierRole.name);
            } catch {
                failed.push(`${subtier} (error)`);
            }
        } else {
            failed.push(`${subtier} (above my role)`);
        }
    } else {
        failed.push(`${subtier} (no matching role)`);
    }

    try {
        const { removeTryoutCooldownRole } = require("./tryoutCooldown");
        const removed = await removeTryoutCooldownRole(member, tsbRanking, "Stage assigned");
        if (removed) {
            const role = tsbRanking?.tryoutCooldownRoleId
                ? guild.roles.cache.get(tsbRanking.tryoutCooldownRoleId)
                : null;
            if (role) assigned.push(`removed ${role.name}`);
        }
    } catch {}

    return { assigned, failed, phaseRole, tierRole, subtierRole };
}

function capitalizeWord(value) {
    const s = String(value || "").trim();
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Meteorite-style ranking log embed.
 * Author: `{robloxUsername} | Ranking Log`
 */
async function buildStageRankingLogEmbed({
    guild,
    member,
    evaluator,
    phaseNum,
    tier,
    subtier,
    asApplicant = false,
    regionLabel = null,
    notes = "-",
    tsbRanking = null,
    settings = {},
    phaseRole = null,
    tierRole = null,
    subtierRole = null,
    assigned = [],
    failed = [],
    invokedName = null,
}) {
    let profile = null;
    try {
        const { getProfileByDiscordId, REGIONS } = require("../shared/profileAdapter");
        profile = await Promise.resolve(getProfileByDiscordId(guild.id, member.id)).catch(() => null);
        if (!profile) profile = await Promise.resolve(getProfileByDiscordId(null, member.id)).catch(() => null);

        if (!regionLabel && profile?.region) {
            regionLabel = REGIONS.find((r) => r.value === profile.region)?.label || profile.region;
        }
        if ((!profile?.roblox_avatar_url || !isHttpUrl(profile.roblox_avatar_url)) && (profile?.roblox_id || profile?.roblox_username)) {
            const { resolveRobloxUser } = require("../shared/profileAdapter");
            const live = await resolveRobloxUser(profile.roblox_id || profile.roblox_username).catch(() => null);
            if (live?.avatarUrl) profile = { ...profile, roblox_avatar_url: live.avatarUrl };
        }
    } catch {}

    const robloxName =
        profile?.roblox_username
        || profile?.display_name
        || member.displayName
        || member.user?.username
        || "Unknown";
    const avatarUrl =
        (isHttpUrl(profile?.roblox_avatar_url) ? profile.roblox_avatar_url : null)
        || pngAvatar(member, 256);

    if (!phaseRole && !asApplicant) {
        const phaseMap = settings.verifyPhaseRoleMap || {};
        phaseRole = phaseMap[String(phaseNum)]
            ? guild.roles.cache.get(phaseMap[String(phaseNum)])
            : null;
        if (!phaseRole && tsbRanking?.tierRoleIds?.[phaseNum]) {
            phaseRole = guild.roles.cache.get(tsbRanking.tierRoleIds[phaseNum]) || null;
        }
        if (!phaseRole) phaseRole = findPhaseRole(guild, phaseNum);
    }

    const label = displayTierLabel(tsbRanking, invokedName);
    const rankParts = asApplicant
        ? [formatRolePart(phaseRole, "Applicant")]
        : [
            `**${label} ${phaseNum}**`,
            formatRolePart(tierRole, capitalizeWord(tier)),
            formatRolePart(subtierRole, capitalizeWord(subtier)),
        ].filter(Boolean);
    const rankResult = rankParts.join(" ");

    let notesValue = notes && String(notes).trim() && notes !== "-" ? String(notes).trim() : "—";
    if (failed?.length) {
        notesValue = notesValue === "—"
            ? `Could not assign: ${failed.join(", ")}`
            : `${notesValue}\nCould not assign: ${failed.join(", ")}`;
    }

    const evaluatorUser = evaluator?.user || evaluator;
    const footerIcon = pngAvatar(evaluatorUser, 64);

    const embed = new EmbedBuilder()
        .setColor(failed?.length && !assigned?.length ? 0xED4245 : RANKING_LOG_COLOR)
        .setAuthor({
            name: `${robloxName} | Ranking Log`,
            ...(avatarUrl ? { iconURL: avatarUrl } : {}),
        })
        .addFields(
            { name: "Target", value: `${member}`, inline: true },
            { name: "Rank result", value: rankResult.slice(0, 1024), inline: true },
            { name: "Region", value: regionLabel || "—", inline: true },
            { name: "Notes", value: notesValue.slice(0, 1024), inline: false },
        )
        .setFooter({
            text: `Evaluated by ${evaluatorUser?.username || evaluatorUser?.tag || "Unknown"} · ${authorName()}`,
            ...(footerIcon ? { iconURL: footerIcon } : {}),
        })
        .setTimestamp();

    if (avatarUrl) embed.setThumbnail(avatarUrl);

    return embed;
}

async function maybeLogStage(guild, tsbRanking, embed) {
    const channelId = tsbRanking?.logChannelId;
    if (!channelId || !embed) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    await channel.send({ embeds: [embed] }).catch(() => {});
}

async function maybeRefreshBoards(guild, userId) {
    try {
        const { refreshUserBoardsBackground } = require("../shared/boardRefresh");
        refreshUserBoardsBackground(guild, userId);
    } catch {}
}

module.exports = {
    applyStageRoles,
    buildStageRankingLogEmbed,
    maybeLogStage,
    maybeRefreshBoards,
    findPhaseRole,
    findRoleByKeyword,
};
