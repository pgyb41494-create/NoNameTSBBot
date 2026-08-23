const {
    getLineupConfig,
    setRegionSlot,
} = require('./config');

const {
    publishRegionLineup,
    publishAllLineups,
    loadPlayerCard,
    buildLineupListDescription,
} = require('./renderer');

const { isAdminOrOwner, memberHasAnyRole } = require('../shared/permissions');
const { resolveGuildPrefix } = require('../shared/guildPrefix');
const { hasAccessPerm } = require('../access/store');

function canManage(member, guild, cfg) {
    if (isAdminOrOwner(member, guild)) return true;
    if (hasAccessPerm(guild.id, member.id, 'LINEUPS')) return true;
    return memberHasAnyRole(member, cfg.allowedRoles || []);
}

function normalizeRegion(raw) {
    return String(raw || '').trim().toLowerCase();
}

function usageText(guildId = null) {
    const p = resolveGuildPrefix(guildId);
    return (
        'Usage:\n' +
        `\`${p}lineup list\` · \`/lineup list\`\n` +
        `\`${p}lineup add <region> <pos> @user\`\n` +
        `\`${p}lineup replace <region> <pos> @user\`\n` +
        `\`${p}lineup remove <region> <pos>\`\n` +
        `\`${p}lineup sub add <region> <pos> @user\`\n` +
        `\`${p}lineup sub replace <region> <pos> @user\`\n` +
        `\`${p}lineup sub remove <region> <pos>\`\n` +
        `\`${p}lineup publish <region|all>\``
    );
}

async function placePlayer(ctx, cfg, board, action, regionKey, pos, user) {
    const isSlash = Boolean(ctx.options);
    const send = async (contentOrPayload) => {
        if (typeof contentOrPayload === 'string') {
            if (isSlash) return ctx.reply({ content: contentOrPayload, ephemeral: true });
            return ctx.reply(contentOrPayload);
        }
        if (isSlash) return ctx.reply({ ...contentOrPayload, ephemeral: true });
        return ctx.reply(contentOrPayload);
    };
    if (!regionKey || !pos || (action !== 'remove' && !user)) {
        const verb = action === 'remove' ? 'remove' : action;
        const isSlash = Boolean(ctx.options);
        const p = resolveGuildPrefix(ctx.guild?.id);
        const suffix = `${verb} <region> <pos>${action === 'remove' ? '' : ' @user'}`;
        const msg = isSlash
            ? (board === 'sub'
                ? `Usage: \`/lineup sub ${suffix}\``
                : `Usage: \`/lineup ${suffix}\``)
            : (board === 'sub'
                ? `Usage: \`${p}lineup sub ${suffix}\``
                : `Usage: \`${p}lineup ${suffix}\``);
        return send(msg);
    }

    if (!cfg.regions?.[regionKey]) {
        return send(
            `Unknown region \`${regionKey}\`. Available: ${(cfg.enabledRegionKeys || []).join(', ')}`
        );
    }

    const region = cfg.regions[regionKey];
    const slots = board === 'sub' ? region.subSlots : region.slots;
    const max = slots?.length || 0;
    if (pos < 1 || pos > max) {
        return send(`Position must be 1–${max}.`);
    }

    const label = board === 'sub' ? 'sub' : 'main';
    const guild = ctx.guild;

    if (action === 'remove') {
        await setRegionSlot(guild.id, regionKey, pos, null, board);
        await publishRegionLineup(guild, regionKey);
        return send(`Cleared **${regionKey} ${label} #${pos}**.`);
    }

    const existing = slots[pos - 1]?.discordId || null;
    if (action === 'add' && existing) {
        return send(
            `**${regionKey} ${label} #${pos}** is already filled by <@${existing}>. Use **replace** instead.`
        );
    }

    const player = await loadPlayerCard(guild, user.id);
    if (!player.hasProfile) {
        return send(`<@${user.id}> needs a \`/profile\` before they can be placed on a lineup.`);
    }

    await setRegionSlot(guild.id, regionKey, pos, user.id, board);
    await publishRegionLineup(guild, regionKey);

    return send(
        `Set **${regionKey} ${label} #${pos}** → <@${user.id}> (**${player.name}** · ${player.host} · ${player.rank}).`
    );
}

async function handleLineupPrefix(message, args) {
    const cfg = await getLineupConfig(message.guild.id);

    if (!cfg.setupCompleted) {
        return message.reply('Line Up is not set up yet. Use `/tsbsetup` → **Line Up Management**.');
    }

    if (!canManage(message.member, message.guild, cfg)) {
        return message.reply('You can\'t manage lineups.');
    }

    let board = 'main';
    let rest = [...args];
    if ((rest[0] || '').toLowerCase() === 'sub') {
        board = 'sub';
        rest.shift();
    }

    const sub = (rest[0] || 'list').toLowerCase();

    if (board === 'sub' && !['add', 'replace', 'remove'].includes(sub)) {
        const p = resolveGuildPrefix(message.guild.id);
        return message.reply(
            'Usage:\n' +
            `\`${p}lineup sub add <region> <pos> @user\`\n` +
            `\`${p}lineup sub replace <region> <pos> @user\`\n` +
            `\`${p}lineup sub remove <region> <pos>\``
        );
    }

    if (sub === 'list') {
        return message.reply({
            embeds: [{
                title: 'Line Ups',
                description: buildLineupListDescription(cfg),
                color: 0x2B2D31,
                author: { name: 'Ascendant · TSB' },
            }],
        });
    }

    if (sub === 'publish') {
        const target = normalizeRegion(rest[1] || 'all');
        await message.channel.sendTyping().catch(() => {});

        if (target === 'all') {
            await publishAllLineups(message.guild);
            return message.reply('Published all region lineups (main + sub).');
        }

        if (!cfg.regions?.[target]) {
            return message.reply(
                `Unknown region \`${target}\`. Available: ${(cfg.enabledRegionKeys || []).join(', ')}`
            );
        }

        const { channel } = await publishRegionLineup(message.guild, target);
        return message.reply(`Published **${target}** (main + sub) in <#${channel.id}>.`);
    }

    if (sub === 'add' || sub === 'replace' || sub === 'remove') {
        const regionKey = normalizeRegion(rest[1]);
        const pos = parseInt(rest[2], 10);
        const user = message.mentions.users.first();
        return placePlayer(message, cfg, board, sub, regionKey, pos, user);
    }

    return message.reply(usageText(message.guild.id));
}

async function handleLineupSlash(interaction) {
    const cfg = await getLineupConfig(interaction.guild.id);

    if (!cfg.setupCompleted) {
        return interaction.reply({
            content: 'Line Up is not set up yet. Use `/tsbsetup` → **Line Up Management**.',
            ephemeral: true,
        });
    }

    if (!canManage(interaction.member, interaction.guild, cfg)) {
        return interaction.reply({ content: 'You can\'t manage lineups.', ephemeral: true });
    }

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    let board = 'main';
    let action = sub;
    if (group === 'sub') {
        board = 'sub';
        action = sub;
    }

    if (sub === 'list') {
        return interaction.reply({
            embeds: [{
                title: 'Line Ups',
                description: buildLineupListDescription(cfg),
                color: 0x2B2D31,
                author: { name: 'Ascendant · TSB' },
            }],
            ephemeral: true,
        });
    }

    if (sub === 'publish') {
        await interaction.deferReply({ ephemeral: true });
        const target = normalizeRegion(interaction.options.getString('region') || 'all');
        if (target === 'all') {
            await publishAllLineups(interaction.guild);
            return interaction.editReply('Published all region lineups (main + sub).');
        }
        if (!cfg.regions?.[target]) {
            return interaction.editReply(`Unknown region \`${target}\`.`);
        }
        const { channel } = await publishRegionLineup(interaction.guild, target);
        return interaction.editReply(`Published **${target}** in <#${channel.id}>.`);
    }

    const regionKey = normalizeRegion(interaction.options.getString('region', true));
    const pos = interaction.options.getInteger('position', true);
    const user = interaction.options.getUser('user');

    return placePlayer(
        interaction,
        cfg,
        board,
        action,
        regionKey,
        pos,
        user
    );
}

/**
 * Discord slash autocomplete for lineup `region` options.
 * @returns {{ name: string, value: string }[]}
 */
async function autocompleteLineupRegion(guildId, focusedValue = '', subcommand = null) {
    const cfg = await getLineupConfig(guildId);
    const q = String(focusedValue || '').toLowerCase().trim();
    const choices = [];

    if (subcommand === 'publish') {
        if (!q || 'all'.startsWith(q) || 'all'.includes(q)) {
            choices.push({ name: 'all (every region)', value: 'all' });
        }
    }

    for (const key of cfg.enabledRegionKeys || []) {
        const region = cfg.regions?.[key];
        const label = region?.label || key;
        const hay = `${key} ${label}`.toLowerCase();
        if (q && !hay.includes(q) && !key.toLowerCase().startsWith(q)) continue;
        choices.push({
            name: `${label} (${key})`.slice(0, 100),
            value: key,
        });
        if (choices.length >= 25) break;
    }

    return choices.slice(0, 25);
}

module.exports = {
    canManage,
    handleLineupPrefix,
    handleLineupSlash,
    autocompleteLineupRegion,
    usageText,
};
