const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder
} = require("discord.js");

const {
    getScoreConfig,
    setScoreConfig,
    resetScoreConfig,
    defaultConfig
} = require("./config");

const TOTAL_STEPS = 5;
const COLOR = 0x2B2D31;
const sessions = new Map();

function yesNo(value) {
    const v = String(value || "").trim().toLowerCase();
    return ["yes", "y", "true", "1", "on", "enabled"].includes(v);
}

function parseBehavior(value) {
    const v = String(value || "").trim().toLowerCase();
    if (v.startsWith("keep")) return "keep";
    return "reset";
}

function getSession(guildId) {
    if (!sessions.has(guildId)) {
        const saved = getScoreConfig(guildId);
        sessions.set(guildId, {
            step: 0,
            fromSetup: false,
            data: {
                winnerCooldownDays: saved.winnerCooldownDays ?? 4,
                loserCooldownDays: saved.loserCooldownDays ?? 7,
                autowinEnabled: saved.autowinEnabled !== false,
                autowinThreshold: saved.autowinThreshold ?? 3,
                autowinSuccessBehavior: saved.autowinSuccessBehavior || "reset",
                pvpUpdatesRoleId: saved.pvpUpdatesRoleId || null,
                allowedRoleIds: saved.allowedRoleIds || []
            }
        });
    }
    return sessions.get(guildId);
}

function configSummary(data, saved = null) {
    const status = saved?.setupCompleted ? "Configured" : "Not configured";
    return (
        "**Current Configuration**\n" +
        `> **Winner CD:** \`${Number(data.winnerCooldownDays)} day(s)\`\n` +
        `> **Loser CD:** \`${Number(data.loserCooldownDays)} day(s)\`\n` +
        `> **Autowin strikes:** \`${data.autowinEnabled ? "enabled" : "disabled"}\`\n` +
        `> **Autowin threshold:** \`${data.autowinThreshold}\`\n` +
        `> **Success behavior:** \`${data.autowinSuccessBehavior === "keep" ? "keep" : "reset to 0"}\`\n` +
        `> **Notification role:** ${data.pvpUpdatesRoleId ? `<@&${data.pvpUpdatesRoleId}>` : "`None`"}\n` +
        `> **Score allowlist roles:** \`${(data.allowedRoleIds || []).length}\`\n\n` +
        `**Status**\n${status}`
    );
}

function navButtons(extra = [], { disableNext = false } = {}) {
    const buttons = [
        ...extra,
        { type: 2, style: 2, label: "Back", custom_id: "tsb:score:back" },
        {
            type: 2,
            style: 2,
            label: "Next",
            custom_id: "tsb:score:next",
            disabled: !!disableNext
        },
        { type: 2, style: 2, label: "TSB Menu", custom_id: "tsb:score:main_menu" }
    ];

    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push({ type: 1, components: buttons.slice(i, i + 5) });
    }
    return rows;
}

function overviewPayload(guildId) {
    const saved = getScoreConfig(guildId);
    const session = getSession(guildId);
    return {
        embeds: [{
            title: "1v1 Score Setup",
            description:
                "Configure 1v1 Score Config to edit its settings.\n\n" +
                configSummary(session.data, saved),
            color: COLOR
        }],
        components: [{
            type: 1,
            components: [
                { type: 2, style: 2, label: "Back", custom_id: "tsb:score:main_menu" },
                { type: 2, style: 1, label: "Configure Module", custom_id: "tsb:score:configure" },
                { type: 2, style: 4, label: "Reset Configuration", custom_id: "tsb:score:reset" }
            ]
        }]
    };
}

function stepPayload(interaction) {
    const session = getSession(interaction.guild.id);
    const { step, data } = session;
    const title = `1v1 Score · Step ${step}/${TOTAL_STEPS}`;
    const summary =
        "**Current Configuration**\n" +
        `> **Winner cooldown:** \`${Number(data.winnerCooldownDays)} day(s)\`\n` +
        `> **Loser cooldown:** \`${Number(data.loserCooldownDays)} day(s)\`\n` +
        `> **Autowin strikes:** \`${data.autowinEnabled ? "enabled" : "disabled"}\`\n` +
        `> **Autowin threshold:** \`${data.autowinThreshold}\`\n` +
        `> **Successful match behavior:** \`${data.autowinSuccessBehavior === "keep" ? "keep" : "reset to 0"}\`\n` +
        `> **PVP updates role:** ${data.pvpUpdatesRoleId ? `<@&${data.pvpUpdatesRoleId}>` : "`none`"}\n` +
        `> **Allowed roles:** \`${(data.allowedRoleIds || []).length}\``;

    if (step === 1) {
        return {
            embeds: [{
                title,
                description: `Configure score cooldown settings.\n\n${summary}`,
                color: COLOR
            }],
            components: navButtons([
                {
                    type: 2,
                    style: 1,
                    label: "Configure Score Settings",
                    custom_id: "tsb:score:cfg_cooldowns"
                }
            ])
        };
    }

    if (step === 2) {
        return {
            embeds: [{
                title,
                description: `Configure autowin strike enforcement.\n\n${summary}`,
                color: COLOR
            }],
            components: navButtons([
                {
                    type: 2,
                    style: 1,
                    label: "Configure Autowin Strikes",
                    custom_id: "tsb:score:cfg_autowin"
                }
            ])
        };
    }

    if (step === 3) {
        return {
            embeds: [{
                title,
                description:
                    "Select a PVP updates role to mention when a score is recorded (optional).",
                color: COLOR
            }],
            components: [
                {
                    type: 1,
                    components: [{
                        type: 6,
                        custom_id: "tsb:score:pvp_role",
                        placeholder: "Select PVP updates role",
                        min_values: 0,
                        max_values: 1
                    }]
                },
                ...navButtons([
                    {
                        type: 2,
                        style: 2,
                        label: "No PVP updates role",
                        custom_id: "tsb:score:no_pvp_role"
                    }
                ])
            ]
        };
    }

    if (step === 4) {
        return {
            embeds: [{
                title,
                description:
                    "Select roles allowed to use `/score`.\n\n" +
                    "If none are set, only **Administrators** / the owner can record scores.\n\n" +
                    `Selected: **${(data.allowedRoleIds || []).length}**` +
                    (data.allowedRoleIds?.length
                        ? `\n${data.allowedRoleIds.map((id) => `<@&${id}>`).join(", ")}`
                        : "\n`admins only`"),
                color: COLOR
            }],
            components: [
                {
                    type: 1,
                    components: [{
                        type: 6,
                        custom_id: "tsb:score:allowed_roles",
                        placeholder: "Select allowed roles",
                        min_values: 0,
                        max_values: 25
                    }]
                },
                ...navButtons([
                    { type: 2, style: 2, label: "Admins only", custom_id: "tsb:score:skip_roles" }
                ])
            ]
        };
    }

    // step 5
    return {
        embeds: [{
            title: `1v1 Score · Step ${TOTAL_STEPS}/${TOTAL_STEPS}`,
            description: summary,
            color: COLOR
        }],
        components: navButtons(
            [
                { type: 2, style: 3, label: "Apply", custom_id: "tsb:score:apply" },
                { type: 2, style: 4, label: "Cancel", custom_id: "tsb:score:cancel" }
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

function openScoreModule(interaction) {
    if (
        !interaction.member?.permissions?.has?.("Administrator") &&
        interaction.guild?.ownerId !== interaction.user?.id
    ) {
        return interaction.reply({
            content: "You need **Administrator** to configure 1v1 Score.",
            ephemeral: true
        });
    }

    const session = getSession(interaction.guild.id);
    session.step = 0;
    session.fromSetup = true;
    return renderOverview(interaction);
}

async function applyConfig(interaction) {
    await interaction.deferUpdate();
    const session = getSession(interaction.guild.id);
    const data = session.data;

    setScoreConfig(interaction.guild.id, {
        winnerCooldownDays: Number(data.winnerCooldownDays) || 4,
        loserCooldownDays: Number(data.loserCooldownDays) || 7,
        autowinEnabled: !!data.autowinEnabled,
        autowinThreshold: Math.max(1, Number(data.autowinThreshold) || 3),
        autowinSuccessBehavior: data.autowinSuccessBehavior === "keep" ? "keep" : "reset",
        pvpUpdatesRoleId: data.pvpUpdatesRoleId || null,
        allowedRoleIds: data.allowedRoleIds || []
    });

    sessions.delete(interaction.guild.id);

    return interaction.editReply({
        embeds: [{
            title: "1v1 Score configured",
            description:
                "Score config saved.\n\n" +
                "Use `/score` to record 1v1 results. Wins against a higher (or on-board) spot **auto-bump** the top leaderboard.",
            color: 0x57F287
        }],
        components: []
    });
}

async function handleScoreButton(interaction) {
    const id = interaction.customId;
    const session = getSession(interaction.guild.id);

    if (id === "tsb:score:main_menu") {
        sessions.delete(interaction.guild.id);
        return openHub(interaction);
    }

    if (id.startsWith("tsb:score:") && !session.fromSetup && id !== "tsb:score:main_menu") {
        return interaction.reply({
            content: "Open 1v1 Score with `/serversetup` → **1v1 Score Setup**.",
            ephemeral: true
        });
    }

    if (id === "tsb:score:configure") {
        session.step = 1;
        return renderStep(interaction);
    }

    if (id === "tsb:score:reset") {
        resetScoreConfig(interaction.guild.id);
        sessions.delete(interaction.guild.id);
        const fresh = getSession(interaction.guild.id);
        fresh.fromSetup = true;
        fresh.step = 0;
        Object.assign(fresh.data, {
            winnerCooldownDays: 4,
            loserCooldownDays: 7,
            autowinEnabled: true,
            autowinThreshold: 3,
            autowinSuccessBehavior: "reset",
            pvpUpdatesRoleId: null,
            allowedRoleIds: []
        });
        return renderOverview(interaction);
    }

    if (id === "tsb:score:back") {
        if (session.step <= 1) {
            session.step = 0;
            return renderOverview(interaction);
        }
        session.step -= 1;
        return renderStep(interaction);
    }

    if (id === "tsb:score:next") {
        if (session.step < TOTAL_STEPS) session.step += 1;
        return renderStep(interaction);
    }

    if (id === "tsb:score:skip_roles") {
        session.step = 5;
        return renderStep(interaction);
    }

    if (id === "tsb:score:no_pvp_role") {
        session.data.pvpUpdatesRoleId = null;
        session.step = 4;
        return renderStep(interaction);
    }

    if (id === "tsb:score:cfg_cooldowns") {
        const modal = new ModalBuilder()
            .setCustomId("tsb:score:modal:cooldowns")
            .setTitle("1v1 Score Configuration");

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("winner_cd")
                    .setLabel("Winner cooldown (days)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(String(session.data.winnerCooldownDays ?? 4))
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("loser_cd")
                    .setLabel("Loser cooldown (days)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(String(session.data.loserCooldownDays ?? 7))
            )
        );

        return interaction.showModal(modal);
    }

    if (id === "tsb:score:cfg_autowin") {
        const modal = new ModalBuilder()
            .setCustomId("tsb:score:modal:autowin")
            .setTitle("Autowin Strike Settings");

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("enabled")
                    .setLabel("Autowin strikes enabled (yes/no)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(session.data.autowinEnabled ? "yes" : "no")
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("threshold")
                    .setLabel("Strike threshold")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(String(session.data.autowinThreshold ?? 3))
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("behavior")
                    .setLabel("Successful match behavior")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(session.data.autowinSuccessBehavior === "keep" ? "keep" : "reset")
            )
        );

        return interaction.showModal(modal);
    }

    if (id === "tsb:score:apply") return applyConfig(interaction);

    if (id === "tsb:score:cancel") {
        sessions.delete(interaction.guild.id);
        return interaction.update({
            embeds: [{
                title: "Setup canceled",
                description: "1v1 Score configuration was not saved.",
                color: 0xED4245
            }],
            components: []
        });
    }

    return false;
}

async function handleScoreSelect(interaction) {
    const id = interaction.customId;
    const session = getSession(interaction.guild.id);

    if (id === "tsb:hub" || id === "tsb:hub") {
        if (interaction.values[0] === "score_setup") {
            return openScoreModule(interaction);
        }
        return false;
    }

    if (!session.fromSetup) {
        return interaction.reply({
            content: "Open 1v1 Score with `/serversetup` → **1v1 Score Setup**.",
            ephemeral: true
        });
    }

    if (id === "tsb:score:pvp_role") {
        session.data.pvpUpdatesRoleId = interaction.values[0] || null;
        session.step = 4;
        return renderStep(interaction);
    }

    if (id === "tsb:score:allowed_roles") {
        session.data.allowedRoleIds = interaction.values || [];
        return renderStep(interaction);
    }

    return false;
}

async function handleScoreModal(interaction) {
    const id = interaction.customId;
    const session = getSession(interaction.guild.id);

    if (!session.fromSetup) {
        return interaction.reply({
            content: "Open 1v1 Score with `/serversetup` → **1v1 Score Setup**.",
            ephemeral: true
        });
    }

    if (id === "tsb:score:modal:cooldowns") {
        const winner = Number(interaction.fields.getTextInputValue("winner_cd"));
        const loser = Number(interaction.fields.getTextInputValue("loser_cd"));
        if (!Number.isFinite(winner) || winner < 0 || !Number.isFinite(loser) || loser < 0) {
            return interaction.reply({
                content: "Cooldown days must be valid non-negative numbers.",
                ephemeral: true
            });
        }
        session.data.winnerCooldownDays = winner;
        session.data.loserCooldownDays = loser;
        await interaction.deferUpdate();
        return renderStep(interaction);
    }

    if (id === "tsb:score:modal:autowin") {
        const enabled = yesNo(interaction.fields.getTextInputValue("enabled"));
        const threshold = Number(interaction.fields.getTextInputValue("threshold"));
        const behavior = parseBehavior(interaction.fields.getTextInputValue("behavior"));

        if (!Number.isFinite(threshold) || threshold < 1) {
            return interaction.reply({
                content: "Strike threshold must be a number >= 1.",
                ephemeral: true
            });
        }

        session.data.autowinEnabled = enabled;
        session.data.autowinThreshold = Math.floor(threshold);
        session.data.autowinSuccessBehavior = behavior;
        await interaction.deferUpdate();
        return renderStep(interaction);
    }

    return false;
}

module.exports = {
    openScoreModule,
    handleScoreButton,
    handleScoreSelect,
    handleScoreModal,
    getSession,
    defaultConfig,
    TOTAL_STEPS
};
