const {
    setLeaderboardConfig,
    getLeaderboardConfig,
    updateLeaderboardConfig,
    ensureSlots,
    defaultChallengeTickets,
    parseChallengeRanges,
    challengeTicketsOf,
    formatChallengeRules,
} = require("./config");

const { upsertLeaderboard } = require("./renderer");
const { listThemes, resolveTheme } = require("../../leaderboardThemes");
const { pageRangesFor, normalizeTopBoardRoles, formatTopBoardRoles } = require("./boardRoles");

const TOTAL_STEPS = 9;
const COLOR = 0x2B2D31;
const sessions = new Map();

function yesNo(value) {
    const v = String(value || "").trim().toLowerCase();
    return ["yes", "y", "true", "1", "on", "required"].includes(v);
}

function defaultData() {
    return {
        managementChannelId: null,
        allowedRoles: [],
        topPerChannel: 10,
        suffix: "default",
        rankLabel: "Phase",
        requireRobloxVerification: true,
        topPlayerRoleId: null,
        topBoardRoles: [],
        editingTopRoleRange: null,
        rankRequirements: [],
        theme: "classic",
        challengeTickets: defaultChallengeTickets()
    };
}

async function getSession(guildId) {
    if (!sessions.has(guildId)) {
        const saved = await getLeaderboardConfig(guildId);
        sessions.set(guildId, {
            step: 1,
            fromSetup: false,
            data: {
                ...defaultData(),
                managementChannelId: saved.managementChannelId || null,
                allowedRoles: saved.allowedRoles || [],
                topPerChannel: saved.topPerChannel || 10,
                suffix: saved.suffix || "default",
                rankLabel: saved.rankLabel || "Phase",
                requireRobloxVerification: saved.requireRobloxVerification !== false,
                topPlayerRoleId: saved.topPlayerRoleId || null,
                topBoardRoles: normalizeTopBoardRoles(
                    saved.topBoardRoles,
                    saved.topPlayerRoleId,
                    saved.topPerChannel || saved.slotCount || 10
                ),
                editingTopRoleRange: null,
                rankRequirements: saved.rankRequirements || [],
                theme: resolveTheme(saved.theme).id,
                challengeTickets: challengeTicketsOf(saved)
            }
        });
    }
    return sessions.get(guildId);
}

function navButtons(extra = [], { disableNext = false } = {}) {
    const buttons = [
        ...extra,
        { type: 2, style: 2, label: "Back", custom_id: "tsb:lb:back" },
        {
            type: 2,
            style: 2,
            label: "Next",
            custom_id: "tsb:lb:next",
            disabled: !!disableNext
        },
        { type: 2, style: 2, label: "TSB Menu", custom_id: "tsb:lb:main_menu" }
    ];

    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push({ type: 1, components: buttons.slice(i, i + 5) });
    }
    return rows;
}

function configSummary(data) {
    return (
        "**Current Configuration**\n" +
        `> **Current channel:** ${data.managementChannelId ? `<#${data.managementChannelId}>` : "not set"}\n` +
        `> **Total top spots:** \`${data.topPerChannel}\` (channels in groups of 10)\n` +
        `> **Current suffix:** \`${data.suffix || "default"}\`\n` +
        `> **Current rank label:** \`${data.rankLabel}\`\n` +
        `> **Current verification:** \`${data.requireRobloxVerification ? "required" : "optional"}\`\n` +
        `> **Top board roles:**\n${formatTopBoardRoles(data.topBoardRoles).split("\n").map((line) => `> ${line}`).join("\n")}\n` +
        `> **Theme:** ${resolveTheme(data.theme).label}`
    );
}

function themeSelectRow(themeId) {
    const current = resolveTheme(themeId);
    return {
        type: 1,
        components: [{
            type: 3,
            custom_id: "tsb:lb:theme",
            placeholder: `Theme: ${current.label}`,
            min_values: 1,
            max_values: 1,
            options: listThemes().map((theme) => ({
                label: theme.label,
                value: theme.id,
                description: theme.description,
                default: theme.id === current.id
            }))
        }]
    };
}

async function stepPayload(interaction) {
    const session = await getSession(interaction.guild.id);
    const { step, data } = session;
    const title = `Top Boards Setup · Step ${step}/${TOTAL_STEPS}`;

    if (step === 1) {
        return {
            embeds: [{
                title,
                description:
                    "Select or create the management channel.\n\n" +
                    configSummary(data),
                color: COLOR
            }],
            components: [
                {
                    type: 1,
                    components: [{
                        type: 8,
                        custom_id: "tsb:lb:mgmt_channel",
                        placeholder: "Select a management channel",
                        min_values: 0,
                        max_values: 1,
                        channel_types: [0, 5]
                    }]
                },
                ...navButtons([
                    {
                        type: 2,
                        style: 1,
                        label: "Create tsb-boards channel",
                        custom_id: "tsb:lb:create_mgmt"
                    }
                ])
            ]
        };
    }

    if (step === 2) {
        return {
            embeds: [{
                title,
                description:
                    "Select roles allowed to manage leaderboard updates.\n\n" +
                    `Selected: **${data.allowedRoles.length}**` +
                    (data.allowedRoles.length
                        ? `\n${data.allowedRoles.map((id) => `<@&${id}>`).join(", ")}`
                        : ""),
                color: COLOR
            }],
            components: [
                {
                    type: 1,
                    components: [{
                        type: 6,
                        custom_id: "tsb:lb:roles_select",
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
        const { getPageRanges, pageChannelName } = require("./renderer");
        const ranges = getPageRanges(data.topPerChannel);
        const preview = ranges
            .map((r) => `• **#${r.start}–${r.end}** → \`#${pageChannelName(r.start, r.end, data.suffix)}\``)
            .join("\n");
        const spotBtn = (n) => ({
            type: 2,
            style: Number(data.topPerChannel) === n ? 3 : 2,
            label: `Top ${n}`,
            custom_id: `tsb:lb:spots:${n}`,
        });
        return {
            embeds: [{
                title,
                description:
                    "How many top spots? Each **10** get their own channel (`top-1-10`, `top-11-20`, …).\n\n" +
                    `**Selected:** \`${data.topPerChannel}\` spots\n` +
                    `**Suffix:** \`${data.suffix || "default"}\`\n\n` +
                    `${preview || "Pick a size above."}`,
                color: COLOR
            }],
            components: [
                { type: 1, components: [spotBtn(10), spotBtn(20), spotBtn(30), spotBtn(40), spotBtn(50)] },
                ...navButtons([
                    { type: 2, style: 1, label: "Custom size + suffix", custom_id: "tsb:lb:cfg_naming" },
                    { type: 2, style: 2, label: "Suffix only", custom_id: "tsb:lb:cfg_suffix" },
                ])
            ]
        };
    }

    if (step === 4) {
        return {
            embeds: [{
                title,
                description:
                    "Set the rank label used in leaderboard embeds.\n\n" +
                    `Current: \`${data.rankLabel}\``,
                color: COLOR
            }],
            components: navButtons([
                { type: 2, style: 1, label: "Set rank label", custom_id: "tsb:lb:cfg_ranklabel" }
            ])
        };
    }

    if (step === 5) {
        return {
            embeds: [{
                title,
                description:
                    "Set whether `/profile` self-registration requires Roblox bio verification.\n\n" +
                    `Current: \`${data.requireRobloxVerification ? "required" : "optional"}\``,
                color: COLOR
            }],
            components: navButtons([
                {
                    type: 2,
                    style: 1,
                    label: "Set self-register verification",
                    custom_id: "tsb:lb:cfg_verify"
                }
            ])
        };
    }

    if (step === 6) {
        const pages = pageRangesFor(data.topPerChannel || 10);
        const roles = normalizeTopBoardRoles(data.topBoardRoles, null, data.topPerChannel || 10);
        if (!data.editingTopRoleRange && pages[0]) {
            data.editingTopRoleRange = { start: pages[0].start, end: pages[0].end };
        }
        const selected = data.editingTopRoleRange || pages[0] || { start: 1, end: 10 };
        const selectedRole = roles.find((entry) => entry.start === selected.start && entry.end === selected.end);

        return {
            embeds: [{
                title,
                description:
                    "Give a different Discord role to each board page (optional).\n\n" +
                    "Example:\n" +
                    "> **1–10** → Top 10\n" +
                    "> **11–20** → Top 20\n" +
                    "> **21–30** → Top 30\n\n" +
                    `**Configured**\n${formatTopBoardRoles(roles)}\n\n` +
                    `> **Editing:** \`#${selected.start}–#${selected.end}\`\n` +
                    `> **Role:** ${selectedRole ? `<@&${selectedRole.roleId}>` : "`none`"}`,
                color: COLOR
            }],
            components: [
                {
                    type: 1,
                    components: [{
                        type: 3,
                        custom_id: "tsb:lb:top_role_range",
                        placeholder: `Editing #${selected.start}–#${selected.end}`,
                        options: pages.map((page) => {
                            const assigned = roles.find((entry) => entry.start === page.start && entry.end === page.end);
                            return {
                                label: `#${page.start}–#${page.end}`,
                                value: `${page.start}-${page.end}`,
                                description: assigned ? "Role set" : "No role yet",
                                default: page.start === selected.start && page.end === selected.end,
                            };
                        })
                    }]
                },
                {
                    type: 1,
                    components: [{
                        type: 6,
                        custom_id: "tsb:lb:top_role",
                        placeholder: `Role for #${selected.start}–#${selected.end}`,
                        min_values: 0,
                        max_values: 1
                    }]
                },
                ...navButtons([
                    {
                        type: 2,
                        style: 2,
                        label: "Clear this range",
                        custom_id: "tsb:lb:no_top_role"
                    },
                    {
                        type: 2,
                        style: 2,
                        label: "Clear all ranges",
                        custom_id: "tsb:lb:clear_top_roles"
                    }
                ])
            ]
        };
    }

    if (step === 7) {
        const reqText = data.rankRequirements?.length
            ? data.rankRequirements.map((r) => `\`${r}\``).join(", ")
            : "**None**";

        return {
            embeds: [{
                title,
                description:
                    "Set the minimum verified rank required for leaderboard position ranges. Ranking Setup must be configured first.\n\n" +
                    `**Current Requirements**\n${reqText}`,
                color: COLOR
            }],
            components: navButtons([
                {
                    type: 2,
                    style: 1,
                    label: "Configure rank requirements",
                    custom_id: "tsb:lb:cfg_requirements"
                }
            ])
        };
    }

    if (step === 8) {
        const chal = challengeTicketsOf({ challengeTickets: data.challengeTickets });
        return {
            embeds: [{
                title,
                description:
                    "Challenge tickets open a private channel so a player can challenge **one** person ahead of them.\n\n" +
                    "**Quick flow**\n" +
                    "1. Player clicks **Challenge** on the panel\n" +
                    "2. They pick who to challenge\n" +
                    "3. Defender taps **Yes** / **No**\n" +
                    "4. Staff records format, host, winner, and score in the ticket\n\n" +
                    `> **Enabled:** \`${chal.enabled ? "yes" : "no"}\`\n` +
                    `> **Panel channel:** ${chal.channelId ? `<#${chal.channelId}>` : "not set"}\n` +
                    `> **Audit log:** ${chal.auditLogChannelId ? `<#${chal.auditLogChannelId}>` : "not set"}\n` +
                    `> **Support team:** ${chal.supportRoleIds?.length ? chal.supportRoleIds.map((id) => `<@&${id}>`).join(", ") : "board staff roles"}\n` +
                    `> **Rules:** ${formatChallengeRules(chal)}`,
                color: COLOR
            }],
            components: [
                {
                    type: 1,
                    components: [{
                        type: 8,
                        custom_id: "tsb:lb:chal_channel",
                        placeholder: "Panel channel (where Challenge button posts)",
                        min_values: 0,
                        max_values: 1,
                        channel_types: [0, 5]
                    }]
                },
                {
                    type: 1,
                    components: [{
                        type: 8,
                        custom_id: "tsb:lb:chal_audit",
                        placeholder: "Audit log channel (transcripts on close)",
                        min_values: 0,
                        max_values: 1,
                        channel_types: [0, 5]
                    }]
                },
                {
                    type: 1,
                    components: [{
                        type: 6,
                        custom_id: "tsb:lb:chal_support",
                        placeholder: "Support team roles to ping in tickets",
                        min_values: 0,
                        max_values: 25
                    }]
                },
                ...navButtons([
                    {
                        type: 2,
                        style: 1,
                        label: "Create #challenge-tickets",
                        custom_id: "tsb:lb:chal_create"
                    },
                    {
                        type: 2,
                        style: 1,
                        label: "Set challenge rules",
                        custom_id: "tsb:lb:chal_rules"
                    },
                    {
                        type: 2,
                        style: 2,
                        label: "No challenge tickets",
                        custom_id: "tsb:lb:chal_skip"
                    }
                ])
            ]
        };
    }

    // step 9 confirm
    const chal = challengeTicketsOf({ challengeTickets: data.challengeTickets });
    const theme = resolveTheme(data.theme);
    const { cardEmbed } = require("../../boardPublish");
    const { brand } = require("../../../utils/loadApi");
    const previewCard = cardEmbed({
      empty: false,
      name: "Preview Player",
      discordTag: "@player",
      position: 1,
      stage: data.rankLabel ? `${data.rankLabel} 2` : "Phase 2",
      region: "Miami",
      robloxUsername: "example",
      wins: 12,
      losses: 3,
      gifUrl: brand.defaultGif,
      avatarUrl: null,
    }, { mode: "leaderboard" });
    previewCard.setFooter({ text: "Live preview · what a board card looks like" });

    return {
        embeds: [{
            title,
            description:
                `**Management Channel:** ${data.managementChannelId ? `<#${data.managementChannelId}>` : "not set"}\n` +
                `**Allowed Roles:** ${data.allowedRoles.length}\n` +
                `**Total top spots:** ${data.topPerChannel}\n` +
                `**Suffix:** ${data.suffix}\n` +
                `**Rank Label:** ${data.rankLabel}\n` +
                `**Roblox verification:** ${data.requireRobloxVerification ? "required" : "optional"}\n` +
                `**Top board roles:**\n${formatTopBoardRoles(data.topBoardRoles)}\n` +
                `**Theme:** ${theme.label}\n` +
                `**Verified-rank requirements:** ${data.rankRequirements?.length || 0} segment(s)\n` +
                `**Challenge tickets:** ${chal.enabled ? (chal.channelId ? `<#${chal.channelId}>` : "create on confirm") : "off"} · ${formatChallengeRules(chal)}\n` +
                `**Challenge support:** ${chal.supportRoleIds?.length ? chal.supportRoleIds.map((id) => `<@&${id}>`).join(", ") : "board staff"}\n` +
                `**Challenge audit log:** ${chal.auditLogChannelId ? `<#${chal.auditLogChannelId}>` : "management channel"}\n\n` +
                "Confirm to create/update board channels and publish. After that use `/republish` anytime.",
            color: COLOR
        }, previewCard],
        components: [
            themeSelectRow(data.theme),
            ...navButtons(
                [
                    { type: 2, style: 3, label: "Confirm", custom_id: "tsb:lb:confirm" },
                    { type: 2, style: 4, label: "Cancel", custom_id: "tsb:lb:cancel" }
                ],
                { disableNext: true }
            )
        ]
    };
}

async function renderStep(interaction) {
    const payload = await stepPayload(interaction);
    if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
    if (interaction.message) return interaction.update(payload);
    return interaction.reply(payload);
}

function openHub(interaction) {
    const { openHub: hubOpen } = require("../hub");
    return hubOpen(interaction);
}

async function openLeaderboardModule(interaction) {
    if (
        !interaction.member?.permissions?.has?.("Administrator") &&
        interaction.guild?.ownerId !== interaction.user?.id
    ) {
        return interaction.reply({
            content: "You need **Administrator** to configure Top Leaderboard.",
            ephemeral: true
        });
    }

    const session = await getSession(interaction.guild.id);
    session.step = 1;
    session.fromSetup = true;
    return renderStep(interaction);
}

async function createManagementChannel(interaction) {
    const { getOrCreateNamedChannel } = require("../shared/channelReuse");
    const channel = await getOrCreateNamedChannel(interaction.guild, {
        names: ["tsb-boards", "ascendant-boards"],
        pattern: /^(?:tsb-|ascendant-)?boards$/,
        createName: "tsb-boards",
        reason: "Ascendant Top Leaderboard management channel",
    });

    const session = await getSession(interaction.guild.id);
    if (!channel) {
        return interaction.reply({ content: "Could not find or create a boards channel.", ephemeral: true });
    }
    session.data.managementChannelId = channel.id;
    return renderStep(interaction);
}

async function confirmAndPublish(interaction) {
    await interaction.deferUpdate();

    const session = await getSession(interaction.guild.id);
    const data = session.data;
    const guild = interaction.guild;

    // Ensure management channel exists
    let managementChannel = data.managementChannelId
        ? await guild.channels.fetch(data.managementChannelId).catch(() => null)
        : null;

    if (!managementChannel) {
        const { getOrCreateNamedChannel } = require("../shared/channelReuse");
        managementChannel = await getOrCreateNamedChannel(guild, {
            names: ["tsb-boards", "ascendant-boards"],
            pattern: /^(?:tsb-|ascendant-)?boards$/,
            createName: "tsb-boards",
            reason: "Ascendant Top Leaderboard management channel",
        });
        if (!managementChannel) {
            return interaction.editReply({
                content: "Could not find or create a boards management channel.",
            });
        }
        data.managementChannelId = managementChannel.id;
    }

    await ensureSlots(guild.id, data.topPerChannel);

    const currentForSlots = await getLeaderboardConfig(guild.id);
    const { editingTopRoleRange: _editingRange, ...persistData } = data;
    const topBoardRoles = normalizeTopBoardRoles(data.topBoardRoles, null, data.topPerChannel || 10);
    await setLeaderboardConfig(guild.id, {
        ...persistData,
        managementChannelId: managementChannel.id,
        topBoardRoles,
        topPlayerRoleId: null,
        slots: currentForSlots.slots
    });

    const { describeLeaderboardChannels } = require("./draft");
    const { upsertLeaderboard } = require("./renderer");
    const { sweepManagementChannel } = require("../shared/mgmtCleaner");

    const published = await upsertLeaderboard(guild);
    const chal = challengeTicketsOf({ challengeTickets: data.challengeTickets });

    await setLeaderboardConfig(guild.id, {
        ...(await getLeaderboardConfig(guild.id)),
        managementChannelId: managementChannel.id,
        leaderboardChannelId: published.channelId,
        leaderboardMessageIds: published.messageIds,
        boardPages: published.boardPages,
        challengeTickets: chal.enabled ? chal : (await getLeaderboardConfig(guild.id)).challengeTickets
    });

    const tips = await sweepManagementChannel(managementChannel, guild.id, "leaderboard");
    if (tips?.id) {
        await setLeaderboardConfig(guild.id, {
            ...(await getLeaderboardConfig(guild.id)),
            tipsMessageId: tips.id
        });
    }

    let challengeLine = "Challenge tickets: off";
    if (chal.enabled) {
        try {
            const { publishPanel } = require("../challengeTickets/runtime");
            const posted = await publishPanel(guild, chal);
            if (posted?.channel) challengeLine = `Challenge tickets: ${posted.channel}`;
        } catch (err) {
            challengeLine = `Challenge tickets failed: ${err.message}`;
        }
    }

    sessions.delete(guild.id);

    const channelList = (published.boardPages || [])
        .map((p) => `• Top ${p.start}–${p.end}: <#${p.channelId}>`)
        .join("\n");

    return interaction.editReply({
        embeds: [{
            title: "Boards ready",
            description:
                `Management: <#${managementChannel.id}>\n` +
                `${channelList || "No live boards"}\n` +
                `Channels: ${describeLeaderboardChannels(data)}\n` +
                `${challengeLine}\n\n` +
                "In the management channel, post drafts like:\n" +
                "```\n1-20\n1. @user\n2. none\n...\n```\n" +
                "Then type `send` and press **Confirm** to publish (1–10, 11–20, … each get their own channel).\n" +
                `Or use \`${require("../shared/guildPrefix").resolveGuildPrefix(guild.id)}tsbtop <pos> @user\` / \`/tsbtop\`.`,
            color: 0x57F287
        }],
        components: []
    });
}

async function handleLeaderboardButton(interaction) {
    return handleLeaderboardAction(interaction, interaction.customId);
}

async function handleLeaderboardAction(interaction, id) {
    const session = await getSession(interaction.guild.id);

    if (id === "tsb:lb:publish_confirm") {
        const { publishLiveLeaderboard } = require("./draft");
        const result = await publishLiveLeaderboard(interaction);
        const { sweepManagementChannel } = require("../shared/mgmtCleaner");
        await sweepManagementChannel(interaction.channel, interaction.guild.id, "leaderboard").catch(() => {});
        return result;
    }

    if (id === "tsb:lb:publish_cancel") {
        await interaction.update({
            embeds: [{
                title: "Publish canceled",
                description: "Leaderboard was not published.",
                color: 0xED4245
            }],
            components: []
        });
        const { sweepManagementChannel } = require("../shared/mgmtCleaner");
        await sweepManagementChannel(interaction.channel, interaction.guild.id, "leaderboard").catch(() => {});
        return;
    }

    if (id === "tsb:lb:main_menu") {
        sessions.delete(interaction.guild.id);
        return openHub(interaction);
    }

    if (id.startsWith("tsb:lb:") && !session.fromSetup && id !== "tsb:lb:main_menu") {
        return interaction.reply({
            content: "Open Top Leaderboard with `/tsbsetup` → **Top Leaderboard**.",
            ephemeral: true
        });
    }

    if (id === "tsb:lb:back") {
        if (session.step <= 1) {
            sessions.delete(interaction.guild.id);
            return openHub(interaction);
        }
        session.step -= 1;
        return renderStep(interaction);
    }

    if (id === "tsb:lb:next") {
        if (session.step >= TOTAL_STEPS) return confirmAndPublish(interaction);
        session.step += 1;
        return renderStep(interaction);
    }

    if (id === "tsb:lb:create_mgmt") return createManagementChannel(interaction);
    if (id === "tsb:lb:no_top_role") {
        const pages = pageRangesFor(session.data.topPerChannel || 10);
        const selected = session.data.editingTopRoleRange || pages[0];
        if (selected) {
            session.data.topBoardRoles = normalizeTopBoardRoles(session.data.topBoardRoles, null, session.data.topPerChannel || 10)
                .filter((entry) => !(entry.start === selected.start && entry.end === selected.end));
        }
        session.data.topPlayerRoleId = null;
        return renderStep(interaction);
    }
    if (id === "tsb:lb:clear_top_roles") {
        session.data.topBoardRoles = [];
        session.data.topPlayerRoleId = null;
        return renderStep(interaction);
    }
    if (id === "tsb:lb:cancel") {
        sessions.delete(interaction.guild.id);
        return openHub(interaction);
    }
    if (id === "tsb:lb:confirm") return confirmAndPublish(interaction);

    if (id.startsWith("tsb:lb:spots:")) {
        const n = parseInt(id.split(":")[3], 10);
        if (Number.isFinite(n)) {
            session.data.topPerChannel = Math.max(1, Math.min(50, n));
            const pages = pageRangesFor(session.data.topPerChannel);
            session.data.topBoardRoles = normalizeTopBoardRoles(session.data.topBoardRoles, null, session.data.topPerChannel)
                .filter((entry) => pages.some((page) => page.start === entry.start && page.end === entry.end));
            if (!pages.some((page) =>
                session.data.editingTopRoleRange &&
                page.start === session.data.editingTopRoleRange.start &&
                page.end === session.data.editingTopRoleRange.end
            )) {
                session.data.editingTopRoleRange = pages[0] || null;
            }
        }
        return renderStep(interaction);
    }

    if (id === "tsb:lb:cfg_suffix") {
        return interaction.showModal({
            title: "Board suffix",
            custom_id: "tsb:lb:modal:suffix",
            components: [{
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "suffix",
                    label: "Suffix (default = top-1-10)",
                    style: 1,
                    required: true,
                    value: session.data.suffix || "default",
                    max_length: 32
                }]
            }]
        });
    }

    if (id === "tsb:lb:chal_create") {
        const { getOrCreateNamedChannel } = require("../shared/channelReuse");
        const channel = await getOrCreateNamedChannel(interaction.guild, {
            names: ["challenge-tickets", "challenges"],
            pattern: /^(?:challenge-tickets|challenges)$/,
            createName: "challenge-tickets",
            reason: "Ascendant challenge tickets panel",
        });
        if (!channel) {
            return interaction.reply({ content: "Could not create a challenge tickets channel.", ephemeral: true });
        }
        session.data.challengeTickets = {
            ...challengeTicketsOf({ challengeTickets: session.data.challengeTickets }),
            enabled: true,
            channelId: channel.id,
        };
        return renderStep(interaction);
    }

    if (id === "tsb:lb:chal_skip") {
        session.data.challengeTickets = {
            ...challengeTicketsOf({ challengeTickets: session.data.challengeTickets }),
            enabled: false,
        };
        return renderStep(interaction);
    }

    if (id === "tsb:lb:chal_rules") {
        const chal = challengeTicketsOf({ challengeTickets: session.data.challengeTickets });
        const rangeText = (chal.ranges || []).map((r) => `${r.from}-${r.to}:${r.spots}`).join(", ");
        return interaction.showModal({
            title: "Challenge rules",
            custom_id: "tsb:lb:modal:chal_rules",
            components: [
                {
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: "spots_ahead",
                        label: "Spots ahead (1-15)",
                        style: 1,
                        required: true,
                        value: String(chal.spotsAhead || 3),
                        max_length: 2
                    }]
                },
                {
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: "range_rules",
                        label: "Optional ranges (e.g. 1-10:1, 11-20:2)",
                        style: 2,
                        required: false,
                        value: rangeText,
                        placeholder: "1-10:1, 11-20:2, 21-50:3",
                        max_length: 200
                    }]
                }
            ]
        });
    }

    if (id === "tsb:lb:cfg_naming") {
        return interaction.showModal({
            title: "Naming Settings",
            custom_id: "tsb:lb:modal:naming",
            components: [
                {
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: "top_count",
                        label: "Total top positions (1-50)",
                        style: 1,
                        required: true,
                        value: String(session.data.topPerChannel),
                        placeholder: "20 for 1-10 and 11-20",
                        max_length: 2
                    }]
                },
                {
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: "suffix",
                        label: "Suffix",
                        style: 1,
                        required: true,
                        value: session.data.suffix || "default",
                        max_length: 32
                    }]
                }
            ]
        });
    }

    if (id === "tsb:lb:cfg_ranklabel") {
        return interaction.showModal({
            title: "Rank Label",
            custom_id: "tsb:lb:modal:ranklabel",
            components: [{
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "rank_label",
                    label: "Rank label",
                    style: 1,
                    required: true,
                    value: session.data.rankLabel || "Phase",
                    placeholder: "Phase",
                    max_length: 32
                }]
            }]
        });
    }

    if (id === "tsb:lb:cfg_verify") {
        return interaction.showModal({
            title: "Self-Register Verification",
            custom_id: "tsb:lb:modal:verify",
            components: [{
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "force_verify",
                    label: "Force Roblox verification (yes/no)",
                    style: 1,
                    required: true,
                    value: session.data.requireRobloxVerification ? "yes" : "no",
                    max_length: 3
                }]
            }]
        });
    }

    if (id === "tsb:lb:cfg_requirements") {
        return interaction.showModal({
            title: "Rank Requirements",
            custom_id: "tsb:lb:modal:requirements",
            components: [{
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "requirements",
                    label: "Requirements (comma-separated, optional)",
                    style: 2,
                    required: false,
                    value: (session.data.rankRequirements || []).join(", "),
                    placeholder: "e.g. Phase1, Phase2"
                }]
            }]
        });
    }

    return false;
}

async function handleLeaderboardSelect(interaction) {
    const session = await getSession(interaction.guild.id);

    if (interaction.customId === "tsb:lb:mgmt_channel") {
        session.data.managementChannelId = interaction.values[0] || null;
        return renderStep(interaction);
    }

    if (interaction.customId === "tsb:lb:roles_select") {
        session.data.allowedRoles = interaction.values;
        return renderStep(interaction);
    }

    if (interaction.customId === "tsb:lb:top_role_range") {
        const raw = String(interaction.values[0] || "");
        const match = raw.match(/^(\d+)-(\d+)$/);
        if (match) {
            session.data.editingTopRoleRange = {
                start: Number(match[1]),
                end: Number(match[2]),
            };
        }
        return renderStep(interaction);
    }

    if (interaction.customId === "tsb:lb:top_role") {
        const pages = pageRangesFor(session.data.topPerChannel || 10);
        const selected = session.data.editingTopRoleRange || pages[0] || { start: 1, end: 10 };
        const roleId = interaction.values[0] || null;
        const next = normalizeTopBoardRoles(session.data.topBoardRoles, null, session.data.topPerChannel || 10)
            .filter((entry) => !(entry.start === selected.start && entry.end === selected.end));
        if (roleId) {
            next.push({ start: selected.start, end: selected.end, roleId });
        }
        next.sort((a, b) => a.start - b.start);
        session.data.topBoardRoles = next;
        session.data.topPlayerRoleId = null;
        return renderStep(interaction);
    }

    if (interaction.customId === "tsb:lb:chal_channel") {
        const channelId = interaction.values[0] || "";
        session.data.challengeTickets = {
            ...challengeTicketsOf({ challengeTickets: session.data.challengeTickets }),
            enabled: !!channelId,
            channelId,
        };
        return renderStep(interaction);
    }

    if (interaction.customId === "tsb:lb:chal_audit") {
        const channelId = interaction.values[0] || "";
        session.data.challengeTickets = {
            ...challengeTicketsOf({ challengeTickets: session.data.challengeTickets }),
            auditLogChannelId: channelId,
        };
        return renderStep(interaction);
    }

    if (interaction.customId === "tsb:lb:chal_support") {
        session.data.challengeTickets = {
            ...challengeTicketsOf({ challengeTickets: session.data.challengeTickets }),
            supportRoleIds: interaction.values || [],
        };
        return renderStep(interaction);
    }

    if (interaction.customId === "tsb:lb:theme") {
        session.data.theme = resolveTheme(interaction.values[0]).id;
        return renderStep(interaction);
    }

    if (
        interaction.customId === "tsb:hub" ||
        interaction.customId === "tsb:hub"
    ) {
        const selected = interaction.values[0];
        if (selected === "leaderboard_setup") return openLeaderboardModule(interaction);
        if (selected === "ranking_setup") {
            const { openRankingModule } = require("../ranking/setupStore");
            return openRankingModule(interaction);
        }
        if (selected === "lineup_setup") {
            const { openLineupModule } = require("../lineup/setupStore");
            return openLineupModule(interaction);
        }
    }

    return false;
}

async function handleLeaderboardModal(interaction) {
    const session = await getSession(interaction.guild.id);
    const data = session.data;
    const id = interaction.customId;

    if (id === "tsb:lb:modal:naming") {
        const count = parseInt(interaction.fields.getTextInputValue("top_count"), 10);
        data.topPerChannel = Math.max(1, Math.min(50, Number.isFinite(count) ? count : 10));
        data.suffix = interaction.fields.getTextInputValue("suffix").trim() || "default";
    } else if (id === "tsb:lb:modal:suffix") {
        data.suffix = interaction.fields.getTextInputValue("suffix").trim() || "default";
    } else if (id === "tsb:lb:modal:ranklabel") {
        data.rankLabel = interaction.fields.getTextInputValue("rank_label").trim() || "Phase";
    } else if (id === "tsb:lb:modal:verify") {
        data.requireRobloxVerification = yesNo(interaction.fields.getTextInputValue("force_verify"));
    } else if (id === "tsb:lb:modal:requirements") {
        const raw = interaction.fields.getTextInputValue("requirements") || "";
        data.rankRequirements = raw
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
    } else if (id === "tsb:lb:modal:chal_rules") {
        const spots = parseInt(interaction.fields.getTextInputValue("spots_ahead"), 10);
        const ranges = parseChallengeRanges(interaction.fields.getTextInputValue("range_rules") || "");
        data.challengeTickets = {
            ...challengeTicketsOf({ challengeTickets: data.challengeTickets }),
            spotsAhead: Math.max(1, Math.min(15, Number.isFinite(spots) ? spots : 3)),
            ranges,
        };
    } else {
        return false;
    }

    await interaction.deferUpdate();
    return renderStep(interaction);
}

module.exports = {
    openLeaderboardModule,
    openHub,
    handleLeaderboardButton,
    handleLeaderboardSelect,
    handleLeaderboardModal,
    TOTAL_STEPS
};
