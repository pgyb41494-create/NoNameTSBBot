const {
    DEFAULT_REGIONS,
    getLineupConfig,
    setLineupConfig,
    updateLineupConfig,
    ensureRegions
} = require("./config");

const { publishAllLineups } = require("./renderer");

const COLOR = 0x2B2D31;
const sessions = new Map();

function getSession(guildId) {
    if (!sessions.has(guildId)) {
        const saved = getLineupConfig(guildId);
        sessions.set(guildId, {
            step: 0,
            fromSetup: false,
            data: {
                enabledRegionKeys: saved.enabledRegionKeys?.length
                    ? [...saved.enabledRegionKeys]
                    : ["na", "east", "west", "central", "eu", "asia"],
                slotsPerRegion: saved.slotsPerRegion || 10,
                subSlotsPerRegion: saved.subSlotsPerRegion || saved.slotsPerRegion || 10,
                separateSubChannels: !!saved.separateSubChannels,
                allowedRoles: saved.allowedRoles || [],
                managementChannelId: saved.managementChannelId || null,
                cardGifUrl: saved.cardGifUrl || "https://developers.oneway.lat/evidencias/asa_3_1.gif"
            }
        });
    }
    return sessions.get(guildId);
}

function configSummary(data, saved = null) {
    const status = saved?.setupCompleted ? "Configured" : "Not configured";
    const subChannelMode = data.separateSubChannels
        ? "Separate `#…-sub` channel"
        : "Same channel as main";
    return (
        "**Current Configuration**\n" +
        `> **Regions:** \`${(data.enabledRegionKeys || []).join(", ") || "none"}\`\n` +
        `> **Main Line Up slots:** \`${data.slotsPerRegion}\`\n` +
        `> **Sub Line Up slots:** \`${data.subSlotsPerRegion || data.slotsPerRegion}\`\n` +
        `> **Sub Line channel:** \`${subChannelMode}\`\n` +
        `> **Allowed roles:** \`${(data.allowedRoles || []).length}\`\n` +
        `> **Management:** ${data.managementChannelId ? `<#${data.managementChannelId}>` : "`not set`"}\n` +
        `> **Card GIF:** \`${(data.cardGifUrl || "").includes("asa_3_1.gif") ? "default" : "custom"}\`\n\n` +
        `**Status**\n${status}`
    );
}

function navButtons(extra = [], { disableNext = false } = {}) {
    const buttons = [
        ...extra,
        { type: 2, style: 2, label: "Back", custom_id: "tsb:lu:back" },
        {
            type: 2,
            style: 2,
            label: "Next",
            custom_id: "tsb:lu:next",
            disabled: !!disableNext
        },
        { type: 2, style: 2, label: "TSB Menu", custom_id: "tsb:lu:main_menu" }
    ];
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push({ type: 1, components: buttons.slice(i, i + 5) });
    }
    return rows;
}

function overviewPayload(guildId) {
    const saved = getLineupConfig(guildId);
    const session = getSession(guildId);
    return {
        embeds: [{
            title: "Lineup Setup",
            description:
                "Configure regional lineups (Miami, Texas, Dallas, LA, EU, Asia, and more).\n" +
                "Cards pull **region**, **stage**, and **Roblox avatar** from `/profile`.\n" +
                "Each region gets a **Line Up** and a **Sub Line Up** (slot counts set separately).\n" +
                "You can put Sub Line Up in the **same channel** or a **separate** `#…-sub` channel.\n\n" +
                configSummary(session.data, saved),
            color: COLOR
        }],
        components: [{
            type: 1,
            components: [
                { type: 2, style: 2, label: "Back", custom_id: "tsb:lu:main_menu" },
                { type: 2, style: 1, label: "Configure Module", custom_id: "tsb:lu:configure" },
                { type: 2, style: 4, label: "Reset Configuration", custom_id: "tsb:lu:reset" }
            ]
        }]
    };
}

function stepPayload(interaction) {
    const session = getSession(interaction.guild.id);
    const { step, data } = session;
    const title = `Lineup Setup · Step ${step}/5`;

    if (step === 1) {
        return {
            embeds: [{
                title,
                description:
                    "Select which region lineups to enable.\n\n" +
                    `Selected: **${(data.enabledRegionKeys || []).join(", ") || "none"}**`,
                color: COLOR
            }],
            components: [
                {
                    type: 1,
                    components: [{
                        type: 3,
                        custom_id: "tsb:lu:regions_select",
                        placeholder: "Select lineup regions",
                        min_values: 1,
                        max_values: Math.min(25, DEFAULT_REGIONS.length),
                        options: DEFAULT_REGIONS.map((r) => ({
                            label: r.label,
                            value: r.key,
                            description: `lineup-${r.key}`,
                            default: (data.enabledRegionKeys || []).includes(r.key)
                        }))
                    }]
                },
                ...navButtons()
            ]
        };
    }

    if (step === 2) {
        return {
            embeds: [{
                title,
                description:
                    "How many slots for **Main** and **Sub** Line Ups? (max 10 each)\n\n" +
                    `Main Line Up: \`${data.slotsPerRegion}\`\n` +
                    `Sub Line Up: \`${data.subSlotsPerRegion || data.slotsPerRegion}\``,
                color: COLOR
            }],
            components: navButtons([
                { type: 2, style: 1, label: "Set slot counts", custom_id: "tsb:lu:cfg_slots" }
            ])
        };
    }

    if (step === 3) {
        const mode = data.separateSubChannels
            ? "Separate channel (`#lineup-<region>-sub`)"
            : "Same channel as main Line Up";
        return {
            embeds: [{
                title,
                description:
                    "Should **Sub Line Up** get its own Discord channel?\n\n" +
                    `Current: **${mode}**\n\n` +
                    "• **Same channel** — main + sub boards post together\n" +
                    "• **Separate channel** — creates `#lineup-<region>-sub` per region",
                color: COLOR
            }],
            components: navButtons([
                {
                    type: 2,
                    style: data.separateSubChannels ? 2 : 3,
                    label: "Same channel",
                    custom_id: "tsb:lu:subch_same"
                },
                {
                    type: 2,
                    style: data.separateSubChannels ? 3 : 2,
                    label: "Separate channel",
                    custom_id: "tsb:lu:subch_separate"
                }
            ])
        };
    }

    if (step === 4) {
        return {
            embeds: [{
                title,
                description:
                    "Roles allowed to manage lineups (optional — admins always can).\n\n" +
                    `Selected: **${(data.allowedRoles || []).length}**`,
                color: COLOR
            }],
            components: [
                {
                    type: 1,
                    components: [{
                        type: 6,
                        custom_id: "tsb:lu:roles_select",
                        placeholder: "Select allowed roles",
                        min_values: 0,
                        max_values: 25
                    }]
                },
                ...navButtons([
                    { type: 2, style: 2, label: "Skip", custom_id: "tsb:lu:skip_roles" }
                ])
            ]
        };
    }

    // step 5 confirm
    const channelPlan = data.separateSubChannels
        ? "`#lineup-<region>` (main) + `#lineup-<region>-sub` (sub)"
        : "`#lineup-<region>` (main + sub together)";
    return {
        embeds: [{
            title: "Lineup Setup · Step 5/5",
            description:
                configSummary(data, { setupCompleted: false }) +
                `\n\nConfirm to create ${channelPlan} and publish **Line Up** + **Sub Line Up** cards.`,
            color: COLOR
        }],
        components: navButtons(
            [
                { type: 2, style: 3, label: "Apply", custom_id: "tsb:lu:apply" },
                { type: 2, style: 4, label: "Cancel", custom_id: "tsb:lu:cancel" }
            ],
            { disableNext: true }
        )
    };
}

function renderOverview(interaction) {
    const payload = overviewPayload(interaction.guild.id);
    if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
    if (interaction.message) return interaction.update(payload);
    return interaction.reply(payload);
}

function renderStep(interaction) {
    const payload = stepPayload(interaction);
    if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
    if (interaction.message) return interaction.update(payload);
    return interaction.reply(payload);
}

function openHub(interaction) {
    const { openHub: hubOpen } = require("../hub");
    return hubOpen(interaction);
}

function openLineupModule(interaction) {
    if (
        !interaction.member?.permissions?.has?.("Administrator") &&
        interaction.guild?.ownerId !== interaction.user?.id
    ) {
        return interaction.reply({
            content: "You need **Administrator** to configure Line Ups.",
            ephemeral: true
        });
    }

    const session = getSession(interaction.guild.id);
    session.step = 0;
    session.fromSetup = true;
    return renderOverview(interaction);
}

async function applySetup(interaction) {
    await interaction.deferUpdate();
    const session = getSession(interaction.guild.id);
    const data = session.data;
    const guild = interaction.guild;

    let managementChannel = data.managementChannelId
        ? await guild.channels.fetch(data.managementChannelId).catch(() => null)
        : null;

    if (!managementChannel) {
        const { getOrCreateNamedChannel } = require("../shared/channelReuse");
        managementChannel = await getOrCreateNamedChannel(guild, {
            names: ["tsb-lineups", "ascendant-lineups"],
            pattern: /^(?:tsb-|ascendant-)?lineups$/,
            createName: "tsb-lineups",
            reason: "Ascendant Lineup management",
        });
        if (!managementChannel) {
            return interaction.editReply({
                content: "Could not find or create a lineups management channel.",
            });
        }
    }

    ensureRegions(
        guild.id,
        data.enabledRegionKeys,
        data.slotsPerRegion,
        data.subSlotsPerRegion || data.slotsPerRegion
    );

    setLineupConfig(guild.id, {
        ...getLineupConfig(guild.id),
        managementChannelId: managementChannel.id,
        allowedRoles: data.allowedRoles || [],
        slotsPerRegion: data.slotsPerRegion,
        subSlotsPerRegion: data.subSlotsPerRegion || data.slotsPerRegion,
        separateSubChannels: !!data.separateSubChannels,
        enabledRegionKeys: data.enabledRegionKeys,
        cardGifUrl: data.cardGifUrl
    });

    // Re-ensure after set
    ensureRegions(
        guild.id,
        data.enabledRegionKeys,
        data.slotsPerRegion,
        data.subSlotsPerRegion || data.slotsPerRegion
    );

    const published = await publishAllLineups(guild);
    const channels = published
        .map((p) => {
            const main = `<#${p.channel.id}>`;
            const sub = p.subChannel ? `<#${p.subChannel.id}>` : null;
            return sub && sub !== main ? `${main} / ${sub}` : main;
        })
        .join(", ");

    const { buildLineupTips, sweepManagementChannel } = require("../shared/mgmtCleaner");
    const { lineupBotComponents } = require("./botUI");
    const { resolveGuildPrefix } = require("../shared/guildPrefix");

    const tips = await managementChannel.send({
        content: buildLineupTips(guild.id),
        components: lineupBotComponents()
    });

    updateLineupConfig(guild.id, { tipsMessageId: tips.id });
    await tips.pin().catch(() => {});
    await sweepManagementChannel(managementChannel, guild.id, "lineup");

    sessions.delete(guild.id);

    const p = resolveGuildPrefix(guild.id);
    return interaction.editReply({
        embeds: [{
            title: "Line Up Setup Complete",
            description:
                `Management: <#${managementChannel.id}>\n` +
                `Live boards: ${channels || "none"}\n\n` +
                "Post a draft in the management channel like the leaderboard:\n" +
                "```\nmiami\n1-10\n1. @user\n2. none\n```\n" +
                "Then type `send` and press **Confirm** to publish. Or use " +
                `\`${p}lineup add <region> <pos> @user\` / \`/lineup\`.`,
            color: 0x57F287
        }],
        components: []
    });
}

async function handleLineupButton(interaction) {
    return handleLineupAction(interaction, interaction.customId);
}

async function handleLineupAction(interaction, id) {
    const session = getSession(interaction.guild.id);

    if (id === "tsb:lu:publish_confirm") {
        const { publishLiveLineup } = require("./draft");
        const result = await publishLiveLineup(interaction);
        const { sweepManagementChannel } = require("../shared/mgmtCleaner");
        await sweepManagementChannel(interaction.channel, interaction.guild.id, "lineup").catch(() => {});
        return result;
    }

    if (id === "tsb:lu:publish_cancel") {
        updateLineupConfig(interaction.guild.id, { pendingPublish: null });
        await interaction.update({
            embeds: [{
                title: "Publish canceled",
                description: "Lineup was not published.",
                color: 0xED4245
            }],
            components: []
        });
        const { sweepManagementChannel } = require("../shared/mgmtCleaner");
        await sweepManagementChannel(interaction.channel, interaction.guild.id, "lineup").catch(() => {});
        return;
    }

    if (id === "tsb:lu:main_menu") {
        sessions.delete(interaction.guild.id);
        return openHub(interaction);
    }

    if (id.startsWith("tsb:lu:") && !session.fromSetup && id !== "tsb:lu:main_menu") {
        return interaction.reply({
            content: "Open Line Up with `/tsbsetup` → **Line Up Management**.",
            ephemeral: true
        });
    }

    if (id === "tsb:lu:configure") {
        session.step = 1;
        return renderStep(interaction);
    }

    if (id === "tsb:lu:reset") {
        updateLineupConfig(interaction.guild.id, {
            setupCompleted: false,
            regions: {},
            enabledRegionKeys: ["na", "east", "west", "central", "eu", "asia"],
            slotsPerRegion: 10,
            subSlotsPerRegion: 10,
            separateSubChannels: false,
            allowedRoles: [],
            managementChannelId: null
        });
        sessions.delete(interaction.guild.id);
        const fresh = getSession(interaction.guild.id);
        fresh.fromSetup = true;
        return renderOverview(interaction);
    }

    if (id === "tsb:lu:back") {
        if (session.step <= 1) {
            session.step = 0;
            return renderOverview(interaction);
        }
        session.step -= 1;
        return renderStep(interaction);
    }

    if (id === "tsb:lu:next") {
        if (session.step < 5) session.step += 1;
        return renderStep(interaction);
    }

    if (id === "tsb:lu:subch_same") {
        session.data.separateSubChannels = false;
        return renderStep(interaction);
    }

    if (id === "tsb:lu:subch_separate") {
        session.data.separateSubChannels = true;
        return renderStep(interaction);
    }

    if (id === "tsb:lu:skip_roles") {
        session.step = 5;
        return renderStep(interaction);
    }

    if (id === "tsb:lu:cfg_slots") {
        return interaction.showModal({
            title: "Lineup Slot Counts",
            custom_id: "tsb:lu:modal:slots",
            components: [
                {
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: "slot_count",
                        label: "Main Line Up slots (1-10)",
                        style: 1,
                        required: true,
                        value: String(session.data.slotsPerRegion || 10),
                        max_length: 2
                    }]
                },
                {
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: "sub_slot_count",
                        label: "Sub Line Up slots (1-10)",
                        style: 1,
                        required: true,
                        value: String(
                            session.data.subSlotsPerRegion ||
                            session.data.slotsPerRegion ||
                            10
                        ),
                        max_length: 2
                    }]
                }
            ]
        });
    }

    if (id === "tsb:lu:apply") return applySetup(interaction);

    if (id === "tsb:lu:cancel") {
        sessions.delete(interaction.guild.id);
        return interaction.update({
            embeds: [{
                title: "Setup canceled",
                description: "Line Up configuration was not saved.",
                color: 0xED4245
            }],
            components: []
        });
    }

    return false;
}

async function handleLineupSelect(interaction) {
    const id = interaction.customId;
    const session = getSession(interaction.guild.id);

    if (id === "tsb:hub" || id === "tsb:hub") {
        if (interaction.values[0] === "lineup_setup") {
            return openLineupModule(interaction);
        }
        return false;
    }

    if (!session.fromSetup) {
        return interaction.reply({
            content: "Open Line Up with `/tsbsetup` → **Line Up Management**.",
            ephemeral: true
        });
    }

    if (id === "tsb:lu:regions_select") {
        session.data.enabledRegionKeys = interaction.values || [];
        return renderStep(interaction);
    }

    if (id === "tsb:lu:roles_select") {
        session.data.allowedRoles = interaction.values || [];
        return renderStep(interaction);
    }

    return false;
}

async function handleLineupModal(interaction) {
    const session = getSession(interaction.guild.id);
    if (!session.fromSetup) {
        return interaction.reply({
            content: "Open Line Up with `/tsbsetup` → **Line Up Management**.",
            ephemeral: true
        });
    }

    if (interaction.customId === "tsb:lu:modal:slots") {
        const n = parseInt(interaction.fields.getTextInputValue("slot_count"), 10);
        const sub = parseInt(interaction.fields.getTextInputValue("sub_slot_count"), 10);
        if (!Number.isFinite(n) || n < 1 || n > 10) {
            return interaction.reply({
                content: "Main slot count must be 1–10.",
                ephemeral: true
            });
        }
        if (!Number.isFinite(sub) || sub < 1 || sub > 10) {
            return interaction.reply({
                content: "Sub slot count must be 1–10.",
                ephemeral: true
            });
        }
        session.data.slotsPerRegion = n;
        session.data.subSlotsPerRegion = sub;
        await interaction.deferUpdate();
        return renderStep(interaction);
    }

    return false;
}

module.exports = {
    openLineupModule,
    handleLineupButton,
    handleLineupSelect,
    handleLineupModal,
    getSession
};
