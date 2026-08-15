const {
    setGuildConfig,
    getGuildConfig
} = require("./config");
const { resolveGuildPrefix } = require("../shared/guildPrefix");
const { findPhaseRole, findRoleByKeyword } = require("./applyStage");

const TOTAL_STEPS = 9;
const COLOR = 0x2B2D31;

const sessions = new Map();

function yesNo(value) {
    const v = String(value || "").trim().toLowerCase();
    return ["yes", "y", "true", "1", "on"].includes(v);
}

function parseList(value) {
    if (!value || !String(value).trim()) return [];
    return String(value)
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

/** Keep empty slots when users paste `id,,id` style lists. */
function parseRoleTokenList(value, expectedLength = 0) {
    const parts = String(value || "").split(",").map((part) => part.trim());
    if (expectedLength > 0) {
        while (parts.length < expectedLength) parts.push("");
        return parts.slice(0, expectedLength);
    }
    return parts.filter((part) => part.length > 0);
}

function normalizeCommandName(value) {
    return String(value || "tier").replace(/^[-/>!.]+/, "").trim().toLowerCase() || "tier";
}

function extractRoleIdToken(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const mention = raw.match(/^<@&(\d{16,22})>$/);
    if (mention) return mention[1];
    if (/^\d{16,22}$/.test(raw)) return raw;
    return null;
}

async function ensureGuildRole(guild, name, usedIds = new Set()) {
    const roleName = String(name || "").trim().slice(0, 100);
    if (!roleName) return null;

    const existing = guild.roles.cache.find((role) => {
        if (role.managed || usedIds.has(role.id)) return false;
        return String(role.name || "").toLowerCase().trim() === roleName.toLowerCase();
    });
    if (existing) {
        usedIds.add(existing.id);
        return { role: existing, created: false };
    }

    const me = guild.members.me;
    if (!me?.permissions?.has?.("ManageRoles")) {
        throw new Error("I need **Manage Roles** to create ranking roles.");
    }

    const created = await guild.roles.create({
        name: roleName,
        reason: "TSB ranking setup — create missing role",
        mentionable: false,
        hoist: false,
    });
    usedIds.add(created.id);
    return { role: created, created: true };
}

async function resolveRoleToken(guild, token, fallbackName, usedIds) {
    const id = extractRoleIdToken(token);
    if (id) {
        const role = guild.roles.cache.get(id) || await guild.roles.fetch(id).catch(() => null);
        if (role && !role.managed) {
            usedIds.add(role.id);
            return { role, created: false };
        }
    }

    const nameToken = String(token || "").trim();
    const targetName = nameToken && !extractRoleIdToken(nameToken) ? nameToken : fallbackName;
    return ensureGuildRole(guild, targetName, usedIds);
}

function tierRoleName(data, index) {
    const label = String(data.tierLabel || "Tier").trim() || "Tier";
    return `${label} ${index}`;
}

function applicantRoleName(data) {
    const label = String(data.tierLabel || "Tier").trim() || "Tier";
    return `${label} 1 Applicant`;
}

/**
 * Resolve pasted IDs/names and create any missing ranking roles.
 */
async function syncRankingRolesFromInputs(guild, data, inputs = {}) {
    await guild.roles.fetch().catch(() => null);
    const usedIds = new Set();
    const created = [];
    const failures = [];
    const tierCount = Math.max(0, Number(data.tierCount) || 0);
    const expectedTiers = tierCount + 1;

    const tierTokens = Array.isArray(inputs.tiers)
        ? inputs.tiers
        : parseRoleTokenList(inputs.tierRaw || "", expectedTiers);
    while (tierTokens.length < expectedTiers) tierTokens.push("");

    const tierRoleIds = [];
    for (let i = 0; i < expectedTiers; i += 1) {
        try {
            const result = await resolveRoleToken(guild, tierTokens[i], tierRoleName(data, i), usedIds);
            tierRoleIds.push(result?.role?.id || "");
            if (result?.created) created.push(result.role.name);
        } catch (error) {
            tierRoleIds.push("");
            failures.push(`${tierRoleName(data, i)}: ${error.message}`);
        }
    }
    data.tierRoleIds = tierRoleIds;

    if (!data.subranksSkipped && (data.subranks || []).length) {
        const subTokens = Array.isArray(inputs.subranks)
            ? inputs.subranks
            : parseRoleTokenList(inputs.subRaw || "", data.subranks.length);
        while (subTokens.length < data.subranks.length) subTokens.push("");
        const subrankRoleIds = [];
        for (let i = 0; i < data.subranks.length; i += 1) {
            const label = data.subranks[i];
            try {
                const result = await resolveRoleToken(guild, subTokens[i], label, usedIds);
                subrankRoleIds.push(result?.role?.id || "");
                if (result?.created) created.push(result.role.name);
            } catch (error) {
                subrankRoleIds.push("");
                failures.push(`subrank ${label}: ${error.message}`);
            }
        }
        data.subrankRoleIds = subrankRoleIds;
    } else {
        data.subrankRoleIds = [];
    }

    if (!data.powerRanksSkipped && (data.powerRanks || []).length) {
        const powerTokens = Array.isArray(inputs.power)
            ? inputs.power
            : parseRoleTokenList(inputs.powerRaw || "", data.powerRanks.length);
        while (powerTokens.length < data.powerRanks.length) powerTokens.push("");
        const powerRoleIds = [];
        for (let i = 0; i < data.powerRanks.length; i += 1) {
            const label = data.powerRanks[i];
            try {
                const result = await resolveRoleToken(guild, powerTokens[i], label, usedIds);
                powerRoleIds.push(result?.role?.id || "");
                if (result?.created) created.push(result.role.name);
            } catch (error) {
                powerRoleIds.push("");
                failures.push(`power ${label}: ${error.message}`);
            }
        }
        data.powerRoleIds = powerRoleIds;
    } else {
        data.powerRoleIds = [];
    }

    if (data.applicantEnabled) {
        try {
            const result = await resolveRoleToken(
                guild,
                inputs.applicant || "",
                applicantRoleName(data),
                usedIds,
            );
            data.applicantRoleId = result?.role?.id || null;
            if (result?.created) created.push(result.role.name);
        } catch (error) {
            data.applicantRoleId = null;
            failures.push(`applicant: ${error.message}`);
        }
    } else if (inputs.applicant) {
        try {
            const result = await resolveRoleToken(guild, inputs.applicant, applicantRoleName(data), usedIds);
            data.applicantRoleId = result?.role?.id || null;
            if (result?.created) created.push(result.role.name);
        } catch {
            data.applicantRoleId = extractRoleIdToken(inputs.applicant);
        }
    }

    data.autoCreateRoles = true;
    return { created, failures };
}

/**
 * Auto-detect existing roles, then create anything still missing.
 */
async function autoDetectAndCreateRankingRoles(guild, data) {
    const detected = autoDetectRankingRoles(guild, data);
    const created = [];
    const failures = [];
    const usedIds = new Set([
        ...(data.tierRoleIds || []).filter(Boolean),
        ...(data.subrankRoleIds || []).filter(Boolean),
        ...(data.powerRoleIds || []).filter(Boolean),
        data.applicantRoleId,
    ].filter(Boolean));

    for (let i = 0; i < (data.tierRoleIds || []).length; i += 1) {
        if (data.tierRoleIds[i]) continue;
        try {
            const result = await ensureGuildRole(guild, tierRoleName(data, i), usedIds);
            data.tierRoleIds[i] = result?.role?.id || "";
            if (result?.created) created.push(result.role.name);
        } catch (error) {
            failures.push(`${tierRoleName(data, i)}: ${error.message}`);
        }
    }

    if (!data.subranksSkipped) {
        for (let i = 0; i < (data.subranks || []).length; i += 1) {
            if (data.subrankRoleIds?.[i]) continue;
            const label = data.subranks[i];
            try {
                const result = await ensureGuildRole(guild, label, usedIds);
                data.subrankRoleIds[i] = result?.role?.id || "";
                if (result?.created) created.push(result.role.name);
            } catch (error) {
                failures.push(`subrank ${label}: ${error.message}`);
            }
        }
    }

    if (!data.powerRanksSkipped) {
        for (let i = 0; i < (data.powerRanks || []).length; i += 1) {
            if (data.powerRoleIds?.[i]) continue;
            const label = data.powerRanks[i];
            try {
                const result = await ensureGuildRole(guild, label, usedIds);
                data.powerRoleIds[i] = result?.role?.id || "";
                if (result?.created) created.push(result.role.name);
            } catch (error) {
                failures.push(`power ${label}: ${error.message}`);
            }
        }
    }

    if (data.applicantEnabled && !data.applicantRoleId) {
        try {
            const result = await ensureGuildRole(guild, applicantRoleName(data), usedIds);
            data.applicantRoleId = result?.role?.id || null;
            if (result?.created) created.push(result.role.name);
        } catch (error) {
            failures.push(`applicant: ${error.message}`);
        }
    }

    data.autoCreateRoles = true;
    return {
        ...detected,
        tiers: (data.tierRoleIds || []).filter(Boolean).length,
        subranks: (data.subrankRoleIds || []).filter(Boolean).length,
        power: (data.powerRoleIds || []).filter(Boolean).length,
        applicant: Boolean(data.applicantRoleId),
        created,
        failures,
        missing: [],
    };
}

function defaultData() {
    return {
        commandName: "stage",
        tierLabel: "Stage",
        tierCount: 5,
        applicantEnabled: true,
        leaderboardIntegration: true,
        authorizedRoles: [],
        subranks: ["High", "Mid", "Low"],
        subranksSkipped: false,
        powerRanks: ["Strong", "Stable", "Weak"],
        powerRanksSkipped: false,
        tierRoleIds: [],
        subrankRoleIds: [],
        powerRoleIds: [],
        applicantRoleId: null,
        colorMode: "fixed",
        fixedColors: ["0xFFD700", "0x9B59B6", "0x4EDBFA"],
        regionRequired: false,
        tryoutCooldownDays: 0,
        tryoutCooldownRoleId: null,
        autoCreateRoles: true,
        tierEmojis: [],
        useRoleEmojis: false,
        logChannelId: null
    };
}

function getSession(guildId) {
    if (!sessions.has(guildId)) {
        const saved = getGuildConfig(guildId);
        sessions.set(guildId, {
            step: 1,
            data: {
                ...defaultData(),
                commandName: normalizeCommandName(saved.commandName || "stage"),
                tierLabel: saved.tierLabel || "Stage",
                tierCount: saved.tierCount ?? 5,
                applicantEnabled: saved.applicantEnabled !== false,
                leaderboardIntegration: saved.leaderboardIntegration !== false,
                authorizedRoles: saved.authorizedRoles || [],
                subranks: saved.subranks || saved.subtiers || ["High", "Mid", "Low"],
                powerRanks: saved.powerRanks?.length ? saved.powerRanks : ["Strong", "Stable", "Weak"],
                tierRoleIds: saved.tierRoleIds || [],
                subrankRoleIds: saved.subrankRoleIds || [],
                powerRoleIds: saved.powerRoleIds || [],
                applicantRoleId: saved.applicantRoleId || null,
                colorMode: saved.colorMode || "fixed",
                fixedColors: saved.fixedColors || ["0xFFD700", "0x9B59B6", "0x4EDBFA"],
                regionRequired: false,
                tryoutCooldownDays: saved.tryoutCooldownDays ?? 0,
                tryoutCooldownRoleId: saved.tryoutCooldownRoleId || null,
                autoCreateRoles: saved.autoCreateRoles !== false,
                tierEmojis: saved.tierEmojis || [],
                useRoleEmojis: !!saved.useRoleEmojis,
                logChannelId: saved.logChannelId || null
            }
        });
    }
    return sessions.get(guildId);
}

function navButtons(extra = []) {
    const buttons = [
        ...extra,
        { type: 2, style: 2, label: "Back", custom_id: "tsb:rank:back" },
        { type: 2, style: 2, label: "Next", custom_id: "tsb:rank:next" },
        { type: 2, style: 2, label: "TSB Menu", custom_id: "tsb:rank:main_menu" }
    ];

    // Discord max 5 buttons per row
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push({ type: 1, components: buttons.slice(i, i + 5) });
    }
    return rows;
}

function configSummary(data, prefix = "!") {
    const cooldown = data.tryoutCooldownDays > 0
        ? `${data.tryoutCooldownDays}d`
        : "off";
    const cmd = normalizeCommandName(data.commandName || "tier");
    const pfx = String(prefix || "!").trim() || "!";

    return (
        "**Current Configuration**\n" +
        `> **Command:** \`${pfx}${cmd}\` (and \`/stage\`)\n` +
        `> **Ranks:** \`0-${data.tierCount}\`\n` +
        `> **Tier label:** \`${data.tierLabel}\`\n` +
        `> **Allowed roles:** \`${data.authorizedRoles.length}\`\n` +
        `> **Leaderboard integration:** \`${data.leaderboardIntegration ? "yes" : "no"}\`\n` +
        `> **Tryout cooldown:** \`${cooldown}\``
    );
}

function stepPayload(interaction) {
    const session = getSession(interaction.guild.id);
    const { step, data } = session;
    const title = `Ranking Setup - Step ${step}/${TOTAL_STEPS}`;
    const prefix = resolveGuildPrefix(interaction.guild.id);
    const summary = configSummary(data, prefix);

    if (step === 1) {
        return {
            embeds: [{
                title,
                description:
                    "Configure command basics, tier settings, and leaderboard integration.\n\n" +
                    summary,
                color: COLOR
            }],
            components: navButtons([
                { type: 2, style: 1, label: "Configure basic settings", custom_id: "tsb:rank:cfg_basic" }
            ])
        };
    }

    if (step === 2) {
        return {
            embeds: [{
                title,
                description:
                    "Select roles allowed to use ranking commands.\n\n" +
                    `Selected: **${data.authorizedRoles.length}**` +
                    (data.authorizedRoles.length
                        ? `\n${data.authorizedRoles.map((id) => `<@&${id}>`).join(", ")}`
                        : ""),
                color: COLOR
            }],
            components: [
                {
                    type: 1,
                    components: [{
                        type: 6,
                        custom_id: "tsb:rank:roles_select",
                        placeholder: "Select allowed roles",
                        min_values: 0,
                        max_values: 25
                    }]
                },
                ...navButtons()
            ]
        };
    }

    if (step === 3) {
        const labels = data.subranksSkipped
            ? "`skipped`"
            : (data.subranks.length ? data.subranks.map((s) => `\`${s}\``).join(", ") : "`none`");

        return {
            embeds: [{
                title,
                description: `Configure subrank labels.\n\nCurrent: ${labels}`,
                color: COLOR
            }],
            components: navButtons([
                { type: 2, style: 1, label: "Set subranks", custom_id: "tsb:rank:cfg_subranks" },
                { type: 2, style: 2, label: "Skip Subranks", custom_id: "tsb:rank:skip_subranks" }
            ])
        };
    }

    if (step === 4) {
        const labels = data.powerRanksSkipped
            ? "`skipped`"
            : (data.powerRanks.length ? data.powerRanks.map((s) => `\`${s}\``).join(", ") : "`none`");

        return {
            embeds: [{
                title,
                description: `Configure power rank labels.\n\nCurrent: ${labels}`,
                color: COLOR
            }],
            components: navButtons([
                { type: 2, style: 1, label: "Set power ranks", custom_id: "tsb:rank:cfg_power" },
                { type: 2, style: 2, label: "Skip Power Ranks", custom_id: "tsb:rank:skip_power" }
            ])
        };
    }

    if (step === 5) {
        const formatIds = (ids) => (ids || [])
            .map((id) => (id ? `<@&${id}>` : "`missing`"))
            .join(", ") || "`none`";
        return {
            embeds: [{
                title,
                description:
                    "Map Discord roles to tiers, subranks, power ranks, and applicant.\n\n" +
                    "**Set role IDs** accepts role IDs, mentions, or names. Leave a slot blank and the bot **creates** that role.\n" +
                    "**Auto-detect** matches existing roles by name, then creates anything still missing.\n\n" +
                    `**Tiers (0–${data.tierCount}):** ${formatIds(data.tierRoleIds)}\n` +
                    `**Subranks:** ${data.subranksSkipped ? "`skipped`" : formatIds(data.subrankRoleIds)}\n` +
                    `**Power:** ${data.powerRanksSkipped ? "`skipped`" : formatIds(data.powerRoleIds)}\n` +
                    `**Applicant:** ${data.applicantRoleId ? `<@&${data.applicantRoleId}>` : "`none`"}`,
                color: COLOR
            }],
            components: navButtons([
                { type: 2, style: 1, label: "Set role IDs", custom_id: "tsb:rank:cfg_roles" },
                { type: 2, style: 3, label: "Auto-detect & create", custom_id: "tsb:rank:auto_roles" }
            ])
        };
    }

    if (step === 6) {
        return {
            embeds: [{
                title,
                description:
                    "Configure embed color mode.\n\n" +
                    `Mode: \`${data.colorMode}\`\n` +
                    `Fixed colors: \`${(data.fixedColors || []).join(", ") || "none"}\``,
                color: COLOR
            }],
            components: navButtons([
                { type: 2, style: 1, label: "Set colors", custom_id: "tsb:rank:cfg_colors" }
            ])
        };
    }

    if (step === 7) {
        return {
            embeds: [{
                title,
                description:
                    "Configure tryout cooldown settings.\n\n" +
                    `Days: \`${data.tryoutCooldownDays}\`\n` +
                    `Cooldown role: ${data.tryoutCooldownRoleId ? `<@&${data.tryoutCooldownRoleId}>` : "`none`"}`,
                color: COLOR
            }],
            components: navButtons([
                { type: 2, style: 1, label: "Set tryout cooldown", custom_id: "tsb:rank:cfg_tryout" }
            ])
        };
    }

    if (step === 8) {
        return {
            embeds: [{
                title,
                description:
                    "Configure tier emojis.\n\n" +
                    `Emojis: \`${(data.tierEmojis || []).join(", ") || "none"}\`\n` +
                    `Use role emojis: \`${data.useRoleEmojis ? "yes" : "no"}\``,
                color: COLOR
            }],
            components: navButtons([
                { type: 2, style: 1, label: "Set tier emojis", custom_id: "tsb:rank:cfg_emojis" }
            ])
        };
    }

    // step 9
    const cmd = normalizeCommandName(data.commandName || "tier");
    const usage = require("./parseStageInput").stageUsageLines(prefix, cmd, data);
    return {
        embeds: [{
            title,
            description:
                "Select ranking log channel (optional), then **Next** to save.\n\n" +
                `Current log: ${data.logChannelId ? `<#${data.logChannelId}>` : "`none`"}\n\n` +
                "Region is taken from the player's `/profile` automatically.\n\n" +
                "**Command usage**\n" +
                usage.map((line) => `> ${line}`).join("\n"),
            color: COLOR
        }],
        components: [
            {
                type: 1,
                components: [{
                    type: 8,
                    custom_id: "tsb:rank:log_channel",
                    placeholder: "Select a log channel (optional)",
                    min_values: 0,
                    max_values: 1,
                    channel_types: [0, 5]
                }]
            },
            ...navButtons([
                { type: 2, style: 2, label: "No log channel", custom_id: "tsb:rank:no_log" }
            ])
        ]
    };
}

function renderStep(interaction) {
    const payload = stepPayload(interaction);
    if (interaction.replied || interaction.deferred) {
        return interaction.editReply(payload);
    }
    if (interaction.isMessageComponent?.() || interaction.message) {
        return interaction.update(payload);
    }
    return interaction.reply(payload);
}

function openHub(interaction) {
    const { openHub: hubOpen } = require("../hub");
    return hubOpen(interaction);
}

function openRankingMain(interaction) {
    return openHub(interaction);
}

function openRankingModule(interaction) {
    if (
        !interaction.member?.permissions?.has?.("Administrator") &&
        interaction.guild?.ownerId !== interaction.user?.id
    ) {
        return interaction.reply({
            content: "You need **Administrator** to configure Ranking Setup.",
            ephemeral: true
        });
    }

    const session = getSession(interaction.guild.id);
    session.step = 1;
    session.fromSetup = true;
    return renderStep(interaction);
}

function showModal(interaction, modal) {
    return interaction.showModal(modal);
}

function openBasicModal(interaction) {
    const data = getSession(interaction.guild.id).data;
    return showModal(interaction, {
        title: "Ranking Setup",
        custom_id: "tsb:rank:modal:basic",
        components: [
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "command_name",
                    label: "Command name (no prefix)",
                    style: 1,
                    required: true,
                    value: normalizeCommandName(data.commandName),
                    placeholder: "tier",
                    max_length: 32
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "tier_label",
                    label: "Tier label",
                    style: 1,
                    required: true,
                    value: data.tierLabel,
                    max_length: 32
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "tier_count",
                    label: "Tier count",
                    style: 1,
                    required: true,
                    value: String(data.tierCount),
                    max_length: 2
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "applicant_enabled",
                    label: "Applicant enabled (yes/no)",
                    style: 1,
                    required: true,
                    value: data.applicantEnabled ? "yes" : "no",
                    max_length: 3
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "leaderboard",
                    label: "Integrate with top leaderboard (yes/no)",
                    style: 1,
                    required: true,
                    value: data.leaderboardIntegration ? "yes" : "no",
                    max_length: 3
                }]
            }
        ]
    });
}

function openSubranksModal(interaction) {
    const data = getSession(interaction.guild.id).data;
    const [r1, r2, r3] = data.subranks;
    return showModal(interaction, {
        title: "Subranks",
        custom_id: "tsb:rank:modal:subranks",
        components: [
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "rank_1",
                    label: "Rank 1",
                    style: 1,
                    required: true,
                    value: r1 || "High",
                    max_length: 32
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "rank_2",
                    label: "Rank 2",
                    style: 1,
                    required: false,
                    value: r2 || "Mid",
                    max_length: 32
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "rank_3",
                    label: "Rank 3",
                    style: 1,
                    required: false,
                    value: r3 || "Low",
                    max_length: 32
                }]
            }
        ]
    });
}

function openPowerModal(interaction) {
    const data = getSession(interaction.guild.id).data;
    const [r1, r2, r3] = data.powerRanks;
    return showModal(interaction, {
        title: "Power Ranks",
        custom_id: "tsb:rank:modal:power",
        components: [
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "power_1",
                    label: "Power 1",
                    style: 1,
                    required: true,
                    value: r1 || "Strong",
                    max_length: 32
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "power_2",
                    label: "Power 2",
                    style: 1,
                    required: false,
                    value: r2 || "Stable",
                    max_length: 32
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "power_3",
                    label: "Power 3",
                    style: 1,
                    required: false,
                    value: r3 || "Weak",
                    max_length: 32
                }]
            }
        ]
    });
}

function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLabeledTierRole(guild, tierNum, tierLabel, usedIds) {
    const found = findPhaseRole(guild, tierNum);
    if (found && !usedIds.has(found.id)) return found;

    const label = String(tierLabel || "Tier").toLowerCase().trim();
    if (!label) return null;

    const exact = [
        `${label} ${tierNum}`,
        `${label}${tierNum}`,
        `${label}-${tierNum}`,
    ];
    const fuzzy = new RegExp(`\\b${escapeRegex(label)}\\s*[-:]?\\s*${tierNum}\\b`, "i");

    return guild.roles.cache.find((role) => {
        if (role.managed || usedIds.has(role.id)) return false;
        if (/(?:stage|phase|tier)\s*1\s*applicant/i.test(role.name)) return false;
        const normalized = String(role.name || "").toLowerCase().trim().replace(/\s+/g, " ");
        return exact.includes(normalized) || fuzzy.test(role.name);
    }) || null;
}

function findKeywordRole(guild, keyword, usedIds) {
    const key = String(keyword || "").toLowerCase().trim();
    if (!key) return null;

    const exact = guild.roles.cache.find((role) => {
        if (role.managed || usedIds.has(role.id)) return false;
        return String(role.name || "").toLowerCase().trim() === key;
    });
    if (exact) return exact;

    const found = findRoleByKeyword(guild, key);
    if (found && !usedIds.has(found.id)) return found;
    return null;
}

function findApplicantRole(guild, usedIds) {
    const preferred = guild.roles.cache.find((role) => {
        if (role.managed || usedIds.has(role.id)) return false;
        return /(?:stage|phase|tier)\s*1\s*applicant/i.test(role.name);
    });
    if (preferred) return preferred;

    return guild.roles.cache.find((role) => {
        if (role.managed || usedIds.has(role.id)) return false;
        return /\bapplicant\b/i.test(role.name);
    }) || null;
}

/**
 * Scan guild roles and fill ranking role ID arrays from configured labels.
 * @returns {{ tiers: number, subranks: number, power: number, applicant: boolean, missing: string[] }}
 */
function autoDetectRankingRoles(guild, data) {
    const usedIds = new Set();
    const missing = [];
    const tierCount = Math.max(0, Number(data.tierCount) || 0);

    const tierRoleIds = [];
    for (let i = 0; i <= tierCount; i += 1) {
        const role = findLabeledTierRole(guild, i, data.tierLabel, usedIds);
        if (role) {
            usedIds.add(role.id);
            tierRoleIds.push(role.id);
        } else {
            tierRoleIds.push("");
            missing.push(`${data.tierLabel || "Tier"} ${i}`);
        }
    }
    data.tierRoleIds = tierRoleIds;

    if (!data.subranksSkipped && (data.subranks || []).length) {
        const subrankRoleIds = [];
        for (const label of data.subranks) {
            const role = findKeywordRole(guild, label, usedIds);
            if (role) {
                usedIds.add(role.id);
                subrankRoleIds.push(role.id);
            } else {
                subrankRoleIds.push("");
                missing.push(`subrank ${label}`);
            }
        }
        data.subrankRoleIds = subrankRoleIds;
    } else {
        data.subrankRoleIds = [];
    }

    if (!data.powerRanksSkipped && (data.powerRanks || []).length) {
        const powerRoleIds = [];
        for (const label of data.powerRanks) {
            const role = findKeywordRole(guild, label, usedIds);
            if (role) {
                usedIds.add(role.id);
                powerRoleIds.push(role.id);
            } else {
                powerRoleIds.push("");
                missing.push(`power ${label}`);
            }
        }
        data.powerRoleIds = powerRoleIds;
    } else {
        data.powerRoleIds = [];
    }

    const applicant = findApplicantRole(guild, usedIds);
    data.applicantRoleId = applicant?.id || null;
    if (!applicant && data.applicantEnabled) missing.push("applicant");

    return {
        tiers: tierRoleIds.filter(Boolean).length,
        subranks: (data.subrankRoleIds || []).filter(Boolean).length,
        power: (data.powerRoleIds || []).filter(Boolean).length,
        applicant: Boolean(applicant),
        missing,
    };
}

function openRolesModal(interaction) {
    const data = getSession(interaction.guild.id).data;
    const tierValue = (data.tierRoleIds || []).filter(Boolean).join(",");
    const subValue = (data.subrankRoleIds || []).filter(Boolean).join(",");
    const powerValue = (data.powerRoleIds || []).filter(Boolean).join(",");

    return showModal(interaction, {
        title: "Role IDs",
        custom_id: "tsb:rank:modal:roles",
        components: [
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "tier_role_ids",
                    label: `Tier IDs/names (0-${data.tierCount})`,
                    style: 2,
                    required: false,
                    ...(tierValue
                        ? { value: tierValue.slice(0, 4000) }
                        : { placeholder: "IDs, mentions, or names — blank slots are created", value: ",".repeat(data.tierCount) })
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "subrank_role_ids",
                    label: `Subrank IDs/names (${data.subranksSkipped ? 0 : data.subranks.length})`,
                    style: 2,
                    required: false,
                    ...(subValue
                        ? { value: subValue.slice(0, 4000) }
                        : { placeholder: "blank = create from subrank labels" })
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "power_role_ids",
                    label: `Power IDs/names (${data.powerRanksSkipped ? 0 : data.powerRanks.length})`,
                    style: 2,
                    required: false,
                    ...(powerValue
                        ? { value: powerValue.slice(0, 4000) }
                        : { placeholder: "blank = create from power labels" })
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "applicant_role_id",
                    label: "Applicant role ID/name (optional)",
                    style: 1,
                    required: false,
                    ...(data.applicantRoleId
                        ? { value: String(data.applicantRoleId) }
                        : { placeholder: "blank creates applicant role if enabled" })
                }]
            }
        ]
    });
}

function openColorsModal(interaction) {
    const data = getSession(interaction.guild.id).data;
    return showModal(interaction, {
        title: "Color Mode",
        custom_id: "tsb:rank:modal:colors",
        components: [
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "color_mode",
                    label: "Color mode (fixed/use_role_color)",
                    style: 1,
                    required: true,
                    value: data.colorMode || "fixed",
                    placeholder: "fixed"
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "fixed_colors",
                    label: "Fixed colors (comma-separated ints/hex)",
                    style: 2,
                    required: false,
                    value: (data.fixedColors || []).join(",") || "0xFFD700,0x9B59B6,0x4EDBFA",
                    placeholder: "0xFFD700,0x9B59B6,0x4EDBFA"
                }]
            }
        ]
    });
}

function openTryoutModal(interaction) {
    const data = getSession(interaction.guild.id).data;
    return showModal(interaction, {
        title: "Tryout Cooldown",
        custom_id: "tsb:rank:modal:tryout",
        components: [
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "cooldown_days",
                    label: "Cooldown days (0 to disable)",
                    style: 1,
                    required: true,
                    value: String(data.tryoutCooldownDays ?? 0)
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "cooldown_role",
                    label: "Cooldown role ID (optional)",
                    style: 1,
                    required: false,
                    value: data.tryoutCooldownRoleId || "",
                    placeholder: "123456789012345678"
                }]
            }
        ]
    });
}

function openEmojisModal(interaction) {
    const data = getSession(interaction.guild.id).data;
    const commas = Array(Math.max(data.tierCount + 1, 1)).fill("").join(",");
    return showModal(interaction, {
        title: "Tier Emojis",
        custom_id: "tsb:rank:modal:emojis",
        components: [
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "tier_emojis",
                    label: `Tier emojis (0-${data.tierCount})`,
                    style: 2,
                    required: false,
                    value: data.tierEmojis.length ? data.tierEmojis.join(",") : commas
                }]
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "use_role_emojis",
                    label: "Use role emojis (yes/no)",
                    style: 1,
                    required: true,
                    value: data.useRoleEmojis ? "yes" : "no"
                }]
            }
        ]
    });
}

async function finishAndSave(interaction) {
    const session = getSession(interaction.guild.id);
    const data = session.data;

    const phases = [];
    for (let i = 0; i <= data.tierCount; i++) {
        phases.push(`${data.tierLabel}${i}`);
    }

    setGuildConfig(interaction.guild.id, {
        ...data,
        commandName: normalizeCommandName(data.commandName),
        regionRequired: false,
        phases,
        tiers: phases,
        subtiers: data.subranksSkipped ? [] : data.subranks,
        autoCreateRoles: true,
        setupCompleted: true
    });

    sessions.delete(interaction.guild.id);

    const prefix = resolveGuildPrefix(interaction.guild.id);
    const cmd = normalizeCommandName(data.commandName || "tier");
    const { stageUsageLines } = require("./parseStageInput");
    const usage = stageUsageLines(prefix, cmd, { ...data, regionRequired: false });

    // Refresh existing boards only — ranking must never create leaderboard/lineup channels.
    setImmediate(() => {
        try {
            const { refreshLeaderboard } = require("../leaderboard/renderer");
            refreshLeaderboard(interaction.guild).catch(() => {});
        } catch {}
        try {
            const { publishAllLineups } = require("../lineup/renderer");
            publishAllLineups(interaction.guild, { createChannels: false }).catch(() => {});
        } catch {}
    });

    return interaction.update({
        embeds: [{
            title: "Ranking configured",
            description:
                "Ranking system saved. This only creates **roles**, not channels.\n\n" +
                configSummary(data, prefix) +
                "\n\n**Command usage**\n" +
                usage.map((line) => `> ${line}`).join("\n"),
            color: 0x57F287
        }],
        components: []
    });
}

async function handleRankingButton(interaction) {
    const id = interaction.customId;
    const session = getSession(interaction.guild.id);

    if (id === "tsb:rank:main_menu" || id === "setup_back" || id === "server_setup_back") {
        sessions.delete(interaction.guild.id);
        return openHub(interaction);
    }

    // Ranking wizard buttons only work after entering via -setup → Ranking Setup
    if (id.startsWith("tsb:rank:") && !session.fromSetup) {
        return interaction.reply({
            content: "Open Ranking Setup with `/serversetup` → **Ranking Setup**.",
            ephemeral: true
        });
    }

    if (id === "tsb:rank:back") {
        if (session.step <= 1) {
            sessions.delete(interaction.guild.id);
            return openHub(interaction);
        }
        session.step -= 1;
        return renderStep(interaction);
    }

    if (id === "tsb:rank:next") {
        if (session.step >= TOTAL_STEPS) {
            return finishAndSave(interaction);
        }
        session.step += 1;
        return renderStep(interaction);
    }

    if (id === "tsb:rank:cfg_basic") return openBasicModal(interaction);
    if (id === "tsb:rank:cfg_subranks") return openSubranksModal(interaction);
    if (id === "tsb:rank:skip_subranks") {
        session.data.subranksSkipped = true;
        session.data.subranks = [];
        return renderStep(interaction);
    }
    if (id === "tsb:rank:cfg_power") return openPowerModal(interaction);
    if (id === "tsb:rank:skip_power") {
        session.data.powerRanksSkipped = true;
        session.data.powerRanks = [];
        return renderStep(interaction);
    }
    if (id === "tsb:rank:cfg_roles") return openRolesModal(interaction);
    if (id === "tsb:rank:auto_roles") {
        await interaction.deferUpdate().catch(() => null);
        await interaction.guild.roles.fetch().catch(() => null);
        const result = await autoDetectAndCreateRankingRoles(interaction.guild, session.data);
        const payload = stepPayload(interaction);
        const createdNote = result.created?.length
            ? ` Created: ${result.created.slice(0, 10).join(", ")}${result.created.length > 10 ? "…" : ""}.`
            : "";
        const failNote = result.failures?.length
            ? ` Issues: ${result.failures.slice(0, 4).join("; ")}${result.failures.length > 4 ? "…" : ""}.`
            : "";
        const note = `\n\n_Auto-detect & create: ${result.tiers} tiers · ${result.subranks} subranks · ${result.power} power · applicant ${result.applicant ? "yes" : "no"}.${createdNote}${failNote}_`;
        if (payload.embeds?.[0]) {
            payload.embeds[0].description = `${payload.embeds[0].description || ""}${note}`;
        }
        return interaction.editReply(payload);
    }
    if (id === "tsb:rank:cfg_colors") return openColorsModal(interaction);
    if (id === "tsb:rank:cfg_tryout") return openTryoutModal(interaction);
    if (id === "tsb:rank:cfg_emojis") return openEmojisModal(interaction);
    if (id === "tsb:rank:no_log") {
        session.data.logChannelId = null;
        return renderStep(interaction);
    }

    return false;
}

async function handleRankingSelect(interaction) {
    const session = getSession(interaction.guild.id);

    if (interaction.customId === "tsb:rank:roles_select") {
        session.data.authorizedRoles = interaction.values;
        return renderStep(interaction);
    }

    if (interaction.customId === "tsb:rank:log_channel") {
        session.data.logChannelId = interaction.values[0] || null;
        return renderStep(interaction);
    }

    if (
        interaction.customId === "tsb:hub" ||
        interaction.customId === "tsb:hub"
    ) {
        const selected = interaction.values[0];
        if (selected === "ranking_setup") return openRankingModule(interaction);
        if (selected === "leaderboard_setup") {
            const { openLeaderboardModule } = require("../leaderboard/setupStore");
            return openLeaderboardModule(interaction);
        }
        if (selected === "score_setup") {
            const { openScoreModule } = require("../score/setupStore");
            return openScoreModule(interaction);
        }
        if (selected === "lineup_setup") {
            const { openLineupModule } = require("../lineup/setupStore");
            return openLineupModule(interaction);
        }
    }

    return false;
}

async function handleRankingModal(interaction) {
    const session = getSession(interaction.guild.id);
    const data = session.data;
    const id = interaction.customId;

    if (id === "tsb:rank:modal:basic") {
        data.commandName = normalizeCommandName(interaction.fields.getTextInputValue("command_name"));
        data.tierLabel = interaction.fields.getTextInputValue("tier_label");
        data.tierCount = Math.max(1, Math.min(20, parseInt(interaction.fields.getTextInputValue("tier_count"), 10) || 5));
        data.applicantEnabled = yesNo(interaction.fields.getTextInputValue("applicant_enabled"));
        data.leaderboardIntegration = yesNo(interaction.fields.getTextInputValue("leaderboard"));
    } else if (id === "tsb:rank:modal:subranks") {
        data.subranksSkipped = false;
        data.subranks = [
            interaction.fields.getTextInputValue("rank_1"),
            interaction.fields.getTextInputValue("rank_2"),
            interaction.fields.getTextInputValue("rank_3")
        ].map((v) => v.trim()).filter(Boolean);
    } else if (id === "tsb:rank:modal:power") {
        data.powerRanksSkipped = false;
        data.powerRanks = [
            interaction.fields.getTextInputValue("power_1"),
            interaction.fields.getTextInputValue("power_2"),
            interaction.fields.getTextInputValue("power_3")
        ].map((v) => v.trim()).filter(Boolean);
    } else if (id === "tsb:rank:modal:roles") {
        await interaction.deferUpdate().catch(() => null);
        const result = await syncRankingRolesFromInputs(interaction.guild, data, {
            tierRaw: interaction.fields.getTextInputValue("tier_role_ids"),
            subRaw: interaction.fields.getTextInputValue("subrank_role_ids"),
            powerRaw: interaction.fields.getTextInputValue("power_role_ids"),
            applicant: interaction.fields.getTextInputValue("applicant_role_id"),
        });
        const payload = stepPayload(interaction);
        const createdNote = result.created.length
            ? `\n\n_Created ${result.created.length} role(s): ${result.created.slice(0, 10).join(", ")}${result.created.length > 10 ? "…" : ""}_`
            : "\n\n_Roles mapped — no new roles needed._";
        const failNote = result.failures.length
            ? `\n_Issues: ${result.failures.slice(0, 4).join("; ")}${result.failures.length > 4 ? "…" : ""}_`
            : "";
        if (payload.embeds?.[0]) {
            payload.embeds[0].description = `${payload.embeds[0].description || ""}${createdNote}${failNote}`;
        }
        return interaction.editReply(payload);
    } else if (id === "tsb:rank:modal:colors") {
        data.colorMode = interaction.fields.getTextInputValue("color_mode").trim().toLowerCase() || "fixed";
        const colors = parseList(interaction.fields.getTextInputValue("fixed_colors"));
        if (colors.length) data.fixedColors = colors;
    } else if (id === "tsb:rank:modal:tryout") {
        data.tryoutCooldownDays = Math.max(0, parseInt(interaction.fields.getTextInputValue("cooldown_days"), 10) || 0);
        const roleId = interaction.fields.getTextInputValue("cooldown_role").trim();
        data.tryoutCooldownRoleId = roleId || null;
    } else if (id === "tsb:rank:modal:emojis") {
        const emojis = parseList(interaction.fields.getTextInputValue("tier_emojis"));
        data.tierEmojis = emojis;
        data.useRoleEmojis = yesNo(interaction.fields.getTextInputValue("use_role_emojis"));
    } else if (id === "tsb:rank:modal:autocreate") {
        // Legacy modal — auto-create is now part of Set role IDs / Auto-detect.
        data.autoCreateRoles = true;
    } else {
        return false;
    }

    await interaction.deferUpdate();
    return renderStep(interaction);
}

// Legacy export names used by interactionCreate
function openManualStep1(interaction) {
    return openBasicModal(interaction);
}

function manualNext(interaction) {
    const session = getSession(interaction.guild.id);
    if (session.step >= TOTAL_STEPS) return finishAndSave(interaction);
    session.step += 1;
    return renderStep(interaction);
}

function manualBack(interaction) {
    const session = getSession(interaction.guild.id);
    session.step = Math.max(1, session.step - 1);
    return renderStep(interaction);
}

function reset(interaction) {
    sessions.delete(interaction.guild.id);
    return openRankingModule(interaction);
}

async function autoSetup(interaction) {
    const session = getSession(interaction.guild.id);
    session.data = defaultData();
    session.step = 1;
    await finishAndSave(interaction);
}

function handleSelect(interaction) {
    return handleRankingSelect(interaction);
}

async function saveStep1(interaction) {
    return handleRankingModal(interaction);
}

function finishSetup(interaction) {
    return finishAndSave(interaction);
}

module.exports = {
    openRankingMain,
    openRankingModule,
    openManualStep1,
    manualNext,
    manualBack,
    reset,
    autoSetup,
    handleSelect,
    saveStep1,
    finishSetup,
    handleRankingButton,
    handleRankingSelect,
    handleRankingModal,
    TOTAL_STEPS
};
