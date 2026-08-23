const {
    getLineupConfig,
    setRegionSlot
} = require("./config");

const {
    publishRegionLineup,
    publishAllLineups,
    loadPlayerCard,
    buildLineupListDescription,
} = require("./renderer");

const { hasAccessPerm } = require("../access/store");

function canManage(member, guild, cfg) {
    if (!member) return false;
    if (guild.ownerId === member.id) return true;
    if (member.permissions?.has?.("Administrator")) return true;
    if (hasAccessPerm(guild.id, member.id, "LINEUPS")) return true;
    return (cfg.allowedRoles || []).some((id) => member.roles.cache.has(id));
}

function lineupBotComponents() {
    return [
        {
            type: 1,
            components: [
                { type: 2, style: 3, label: "Add", custom_id: "tsb:lubot:add" },
                { type: 2, style: 1, label: "Replace", custom_id: "tsb:lubot:replace" },
                { type: 2, style: 4, label: "Remove", custom_id: "tsb:lubot:remove" },
                { type: 2, style: 2, label: "Publish All", custom_id: "tsb:lubot:publish" },
                { type: 2, style: 2, label: "List", custom_id: "tsb:lubot:list" }
            ]
        },
        {
            type: 1,
            components: [
                { type: 2, style: 3, label: "Sub Add", custom_id: "tsb:lubot:sub_add" },
                { type: 2, style: 1, label: "Sub Replace", custom_id: "tsb:lubot:sub_replace" },
                { type: 2, style: 4, label: "Sub Remove", custom_id: "tsb:lubot:sub_remove" }
            ]
        }
    ];
}

function parseUserId(raw) {
    const text = String(raw || "").trim();
    const mention = text.match(/^<@!?(\d+)>$/);
    if (mention) return mention[1];
    if (/^\d{17,20}$/.test(text)) return text;
    return null;
}

function actionModal(customId, title, { needUser = true } = {}) {
    const rows = [
        {
            type: 1,
            components: [{
                type: 4,
                custom_id: "region",
                label: "Region key (na, east, sp…)",
                style: 1,
                required: true,
                max_length: 20,
                placeholder: "na"
            }]
        },
        {
            type: 1,
            components: [{
                type: 4,
                custom_id: "position",
                label: "Position number",
                style: 1,
                required: true,
                max_length: 2,
                placeholder: "1"
            }]
        }
    ];

    if (needUser) {
        rows.push({
            type: 1,
            components: [{
                type: 4,
                custom_id: "user",
                label: "User @mention or Discord ID",
                style: 1,
                required: true,
                max_length: 40,
                placeholder: "@user or 123456789012345678"
            }]
        });
    }

    return {
        title: title.slice(0, 45),
        custom_id: customId,
        components: rows
    };
}

async function handleLineupBotButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith("tsb:lubot:")) return false;

    const cfg = await getLineupConfig(interaction.guild.id);
    if (!cfg.setupCompleted) {
        return interaction.reply({
            content: "Line Up is not set up yet. Use `/tsbsetup` → **Line Up Management**.",
            ephemeral: true
        });
    }

    if (!canManage(interaction.member, interaction.guild, cfg)) {
        return interaction.reply({
            content: "You can't manage lineups.",
            ephemeral: true
        });
    }

    if (id === "tsb:lubot:publish") {
        await interaction.deferReply({ ephemeral: true });
        await publishAllLineups(interaction.guild);
        return interaction.editReply("Published all region lineups (main + sub).");
    }

    if (id === "tsb:lubot:list") {
        return interaction.reply({
            embeds: [{
                title: "Line Ups",
                description: buildLineupListDescription(cfg),
                color: 0x2B2D31
            }],
            ephemeral: true
        });
    }

    const map = {
        'tsb:lubot:add': ['tsb:lubot:modal:add', 'Add to Line Up', true],
        'tsb:lubot:replace': ['tsb:lubot:modal:replace', 'Replace on Line Up', true],
        'tsb:lubot:remove': ['tsb:lubot:modal:remove', 'Remove from Line Up', false],
        'tsb:lubot:sub_add': ['tsb:lubot:modal:sub_add', 'Add to Sub Line Up', true],
        'tsb:lubot:sub_replace': ['tsb:lubot:modal:sub_replace', 'Replace on Sub Line Up', true],
        'tsb:lubot:sub_remove': ['tsb:lubot:modal:sub_remove', 'Remove from Sub Line Up', false],
    };

    const spec = map[id];
    if (!spec) return false;

    return interaction.showModal(actionModal(spec[0], spec[1], { needUser: spec[2] }));
}

async function handleLineupBotModal(interaction) {
    const id = interaction.customId;
    if (!id.startsWith("tsb:lubot:modal:")) return false;

    const cfg = await getLineupConfig(interaction.guild.id);
    if (!canManage(interaction.member, interaction.guild, cfg)) {
        return interaction.reply({
            content: "You can't manage lineups.",
            ephemeral: true
        });
    }

    const board = id.includes(":modal:sub_") || id.includes("modal:sub_") ? "sub" : "main";
    const isRemove = id.endsWith("_remove");
    const regionKey = String(interaction.fields.getTextInputValue("region") || "")
        .trim()
        .toLowerCase();
    const pos = parseInt(interaction.fields.getTextInputValue("position"), 10);

    if (!cfg.regions?.[regionKey]) {
        return interaction.reply({
            content: `Unknown region \`${regionKey}\`. Available: ${(cfg.enabledRegionKeys || []).join(", ")}`,
            ephemeral: true
        });
    }

    const slots = board === "sub"
        ? cfg.regions[regionKey].subSlots
        : cfg.regions[regionKey].slots;
    const max = slots?.length || 0;
    if (!pos || pos < 1 || pos > max) {
        return interaction.reply({
            content: `Position must be 1–${max}.`,
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });

    if (isRemove) {
        await setRegionSlot(interaction.guild.id, regionKey, pos, null, board);
        await publishRegionLineup(interaction.guild, regionKey);
        return interaction.editReply(`Cleared **${regionKey} ${board} #${pos}**.`);
    }

    const userId = parseUserId(interaction.fields.getTextInputValue("user"));
    if (!userId) {
        return interaction.editReply("Provide a valid @mention or Discord ID.");
    }

    const player = await loadPlayerCard(interaction.guild, userId);
    if (!player.hasProfile) {
        return interaction.editReply(`<@${userId}> needs a \`/profile\` first.`);
    }

    const existing = slots[pos - 1]?.discordId || null;
    if (!isRemove && id.includes("_add") && existing) {
        return interaction.editReply(
            `That slot is already filled by <@${existing}>. Use **Replace** instead.`
        );
    }

    await setRegionSlot(interaction.guild.id, regionKey, pos, userId, board);
    await publishRegionLineup(interaction.guild, regionKey);

    return interaction.editReply(
        `Set **${regionKey} ${board} #${pos}** → <@${userId}> (**${player.name}** · ${player.region} · ${player.rank}).`
    );
}

module.exports = {
    lineupBotComponents,
    handleLineupBotButton,
    handleLineupBotModal
};
