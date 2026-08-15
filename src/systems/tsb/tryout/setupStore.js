const {
    getTryoutSettings,
    patchTryoutSettings,
} = require("./settings");

const COLOR = 0x2B2D31;

function summary(guildId) {
    const s = getTryoutSettings(guildId);
    return (
        "**Current Configuration**\n" +
        `> **Channel:** ${s.channelId ? `<#${s.channelId}>` : "`not set`"}\n` +
        `> **Ping role:** ${s.pingRoleId ? `<@&${s.pingRoleId}>` : "`none`"}\n` +
        `> **Default required signups:** \`${s.defaultRequiredSignups || 0}\`\n` +
        `> **Default max signups:** \`${s.defaultMaxSignups || 0}\`\n\n` +
        `**Status**\n${s.configured ? "Configured" : "Not configured"}\n\n` +
        "Runtime: `/tryout create` · `/tryout list` · `/tryout end`\n" +
        "Join cooldown role is set in **Ranking Setup** (tryout cooldown)."
    );
}

function overviewPayload(guildId) {
    return {
        embeds: [{
            title: "Tryouts",
            description:
                "Configure where TSB tryout signup posts go, ping role, and default signup limits.\n\n" +
                summary(guildId),
            color: COLOR,
            author: { name: "Ascendant · TSB" },
        }],
        components: [
            {
                type: 1,
                components: [{
                    type: 8,
                    custom_id: "tsb:tryout:channel",
                    placeholder: "Select tryout channel",
                    channel_types: [0, 5],
                    min_values: 1,
                    max_values: 1,
                }],
            },
            {
                type: 1,
                components: [{
                    type: 6,
                    custom_id: "tsb:tryout:ping_role",
                    placeholder: "Select ping role (optional)",
                    min_values: 0,
                    max_values: 1,
                }],
            },
            {
                type: 1,
                components: [
                    { type: 2, style: 1, label: "Set defaults", custom_id: "tsb:tryout:cfg_defaults" },
                    { type: 2, style: 2, label: "Clear ping role", custom_id: "tsb:tryout:clear_ping" },
                    { type: 2, style: 2, label: "TSB Menu", custom_id: "tsb:tryout:main_menu" },
                ],
            },
        ],
    };
}

function openDefaultsModal(interaction) {
    const s = getTryoutSettings(interaction.guild.id);
    return interaction.showModal({
        title: "Tryout Defaults",
        custom_id: "tsb:tryout:modal:defaults",
        components: [
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "required_signups",
                    label: "Default required signups (0 = off)",
                    style: 1,
                    required: true,
                    max_length: 3,
                    value: String(s.defaultRequiredSignups || 0),
                }],
            },
            {
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "max_signups",
                    label: "Default max signups (0 = unlimited)",
                    style: 1,
                    required: true,
                    max_length: 3,
                    value: String(s.defaultMaxSignups || 0),
                }],
            },
        ],
    });
}

function openTryoutModule(interaction) {
    if (
        !interaction.member?.permissions?.has?.("Administrator") &&
        interaction.guild?.ownerId !== interaction.user?.id
    ) {
        return interaction.reply({
            content: "You need **Administrator** to configure Tryouts.",
            ephemeral: true,
        });
    }

    const payload = overviewPayload(interaction.guild.id);
    if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
    if (interaction.message) return interaction.update(payload);
    return interaction.reply({ ...payload, ephemeral: true });
}

function openHub(interaction) {
    const { openHub: hubOpen } = require("../hub");
    return hubOpen(interaction);
}

async function handleTryoutButton(interaction) {
    const id = interaction.customId;
    if (id === "tsb:tryout:main_menu") {
        return openHub(interaction);
    }
    if (id === "tsb:tryout:clear_ping") {
        patchTryoutSettings(interaction.guild.id, { pingRoleId: "" });
        return interaction.update(overviewPayload(interaction.guild.id));
    }
    if (id === "tsb:tryout:cfg_defaults") {
        return openDefaultsModal(interaction);
    }
    return false;
}

async function handleTryoutSelect(interaction) {
    const id = interaction.customId;
    if (id === "tsb:tryout:channel") {
        const channelId = interaction.values?.[0] || "";
        patchTryoutSettings(interaction.guild.id, { channelId });
        return interaction.update(overviewPayload(interaction.guild.id));
    }
    if (id === "tsb:tryout:ping_role") {
        const pingRoleId = interaction.values?.[0] || "";
        patchTryoutSettings(interaction.guild.id, { pingRoleId });
        return interaction.update(overviewPayload(interaction.guild.id));
    }
    return false;
}

async function handleTryoutModal(interaction) {
    const id = interaction.customId;
    if (id !== "tsb:tryout:modal:defaults") return false;

    const required = Math.max(0, parseInt(interaction.fields.getTextInputValue("required_signups"), 10) || 0);
    const max = Math.max(0, parseInt(interaction.fields.getTextInputValue("max_signups"), 10) || 0);
    patchTryoutSettings(interaction.guild.id, {
        defaultRequiredSignups: required,
        defaultMaxSignups: max,
    });

    await interaction.deferUpdate();
    return interaction.editReply(overviewPayload(interaction.guild.id));
}

module.exports = {
    openTryoutModule,
    handleTryoutButton,
    handleTryoutSelect,
    handleTryoutModal,
    getTryoutSettings,
};
