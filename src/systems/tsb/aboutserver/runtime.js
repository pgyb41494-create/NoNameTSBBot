const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorSpacingSize,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const api = require("../../../utils/loadApi");
const { isAdminOrOwner } = require("../shared/permissions");
const { tsbEmbed, COLOR_PRIMARY } = require("../shared/embeds");
const { danger, ok } = require("../../../utils/embeds");
const {
  DEFAULT_BODY,
  DEFAULT_RECORDS,
  DEFAULT_V2,
  getConfig,
  updateConfig,
  safeText,
  safeUrl,
} = require("./store");

const ID = {
  gif: "tsb:about:gif",
  body: "tsb:about:body",
  records: "tsb:about:records",
  v2: "tsb:about:v2",
  post: "tsb:about:post",
  refresh: "tsb:about:refresh",
  vars: "tsb:about:vars",
  modalGif: "tsb:about:modal_gif",
  modalBody: "tsb:about:modal_body",
  modalRecords: "tsb:about:modal_records",
  modalV2: "tsb:about:modal_v2",
};

function interpolate(template, vars) {
  return String(template || "").replace(/\{([a-z0-9_]+)\}/gi, (_, key) => {
    const found = vars[String(key).toLowerCase()];
    return found == null ? `{${key}}` : String(found);
  });
}

async function liveStats(guild) {
  let recordCount = "N/A";
  let scorePoints = "N/A";
  let mvps = "N/A";

  try {
    const wars = typeof api.wars?.getWars === "function" ? await api.wars.getWars(guild.id) : null;
    const list = wars?.wars || (Array.isArray(wars) ? wars : []);
    if (list.length) recordCount = String(list.length);
  } catch {}

  try {
    const cfg = typeof api.score?.getConfig === "function" ? await api.score.getConfig(guild.id) : null;
    const records = cfg?.records && typeof cfg.records === "object" ? cfg.records : {};
    const rows = Object.entries(records).map(([id, rec]) => ({
      id,
      wins: Number(rec?.wins || 0),
    }));
    const totalWins = rows.reduce((sum, row) => sum + row.wins, 0);
    if (totalWins) scorePoints = String(totalWins);
    const top = rows.filter((row) => row.wins > 0).sort((a, b) => b.wins - a.wins).slice(0, 3);
    if (top.length) mvps = top.map((row) => `<@${row.id}>`).join(", ");
  } catch {}

  return { recordCount, scorePoints, mvps };
}

async function buildVars(guild, cfg = getConfig(guild.id)) {
  const live = await liveStats(guild);
  const recordCount = String(cfg.recordCount || "").trim() || live.recordCount;
  const scorePoints = String(cfg.scorePoints || "").trim() || live.scorePoints;
  const mvps = String(cfg.mvps || "").trim() || live.mvps;
  const stats = {
    record_count: recordCount,
    score_points: scorePoints,
    score: scorePoints,
    mvps,
  };
  const records = interpolate(cfg.records || DEFAULT_RECORDS, {
    server: guild.name,
    guild: guild.name,
    name: guild.name,
    ...stats,
  });
  const v2 = interpolate(cfg.v2 || DEFAULT_V2, stats);
  return {
    server: guild.name,
    guild: guild.name,
    name: guild.name,
    members: String(guild.memberCount ?? "N/A"),
    owner: guild.ownerId ? `<@${guild.ownerId}>` : "N/A",
    created: guild.createdTimestamp ? `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>` : "N/A",
    gif: cfg.gif || "",
    records,
    v2,
    ...stats,
  };
}

async function buildPayload(guild, cfg = getConfig(guild.id)) {
  const vars = await buildVars(guild, cfg);
  const body = interpolate(cfg.body || DEFAULT_BODY, vars).slice(0, 4000) || "\u200b";
  const container = new ContainerBuilder().setAccentColor(0x2b2d31);
  const gif = safeUrl(cfg.gif);

  if (gif) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems((item) => item.setURL(gif))
    );
    container.addSeparatorComponents((sep) =>
      sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
  }

  container.addTextDisplayComponents((td) => td.setContent(body));

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

async function postOrEdit(channel, guild, cfg = getConfig(guild.id)) {
  const payload = await buildPayload(guild, cfg);
  if (cfg.channelId && cfg.messageId && String(cfg.channelId) === String(channel.id)) {
    const existing = await channel.messages.fetch(cfg.messageId).catch(() => null);
    if (existing?.editable) {
      await existing.edit(payload);
      return existing;
    }
  }
  const sent = await channel.send(payload);
  updateConfig(guild.id, { channelId: channel.id, messageId: sent.id });
  return sent;
}

async function refreshPosted(guild) {
  const cfg = getConfig(guild.id);
  if (!cfg.channelId || !cfg.messageId) return null;
  const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  const existing = await channel.messages.fetch(cfg.messageId).catch(() => null);
  if (!existing?.editable) return null;
  await existing.edit(await buildPayload(guild, cfg));
  return existing;
}

function varsHelp() {
  return [
    "`{server}` `{guild}` `{name}` — server name",
    "`{members}` `{owner}` `{created}`",
    "`{records}` — the records blockquote you edited",
    "`{v2}` — the tree lines (`┌ ├ └`)",
    "`{record_count}` `{score_points}` `{mvps}` — live stats, or your overrides",
  ].join("\n");
}

function editorPayload(guildId) {
  const cfg = getConfig(guildId);
  const posted = cfg.channelId && cfg.messageId ? `<#${cfg.channelId}>` : "`not posted yet`";
  return {
    embeds: [
      tsbEmbed({
        title: "About server",
        color: COLOR_PRIMARY,
        description:
          "Components v2 post: GIF on top, then your text with variables.\n\n" +
          `> **GIF:** ${cfg.gif ? "`set`" : "`none`"}\n` +
          `> **Posted:** ${posted}\n\n` +
          varsHelp(),
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID.gif).setLabel("GIF").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(ID.body).setLabel("Body").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ID.records).setLabel("Records").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ID.v2).setLabel("V2 lines").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID.post).setLabel("Post / update here").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(ID.refresh).setLabel("Refresh posted").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ID.vars).setLabel("Variables").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function requireStaff(interaction) {
  if (isAdminOrOwner(interaction.member, interaction.guild)) return true;
  return false;
}

async function openEditor(interaction) {
  const payload = editorPayload(interaction.guild.id);
  if (interaction.replied || interaction.deferred) return interaction.editReply({ ...payload, ephemeral: true });
  if (interaction.isButton?.() && interaction.message) return interaction.update(payload);
  return interaction.reply({ ...payload, ephemeral: true });
}

function modal(customId, title, fields) {
  const builder = new ModalBuilder().setCustomId(customId).setTitle(title);
  for (const field of fields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setStyle(field.style || TextInputStyle.Paragraph)
      .setRequired(field.required !== false)
      .setMaxLength(field.max || 4000);
    const value = String(field.value || "").slice(0, field.max || 4000);
    if (value) input.setValue(value);
    builder.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return builder;
}

async function handleAboutInteraction(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("tsb:about:")) return false;
  if (!requireStaff(interaction)) {
    await interaction.reply({ content: "You need **Administrator** to edit About server.", ephemeral: true });
    return true;
  }

  const cfg = getConfig(interaction.guild.id);

  if (interaction.isButton?.()) {
    if (id === ID.gif) {
      await interaction.showModal(
        modal(ID.modalGif, "About GIF", [
          {
            id: "gif",
            label: "GIF / image URL",
            style: TextInputStyle.Short,
            max: 500,
            value: cfg.gif,
            required: false,
          },
        ])
      );
      return true;
    }
    if (id === ID.body) {
      await interaction.showModal(
        modal(ID.modalBody, "About body", [
          { id: "body", label: "Message (use {records} and {v2})", max: 4000, value: cfg.body || DEFAULT_BODY },
        ])
      );
      return true;
    }
    if (id === ID.records) {
      await interaction.showModal(
        modal(ID.modalRecords, "Records block", [
          { id: "records", label: "{records} text", max: 2000, value: cfg.records || DEFAULT_RECORDS },
        ])
      );
      return true;
    }
    if (id === ID.v2) {
      await interaction.showModal(
        modal(ID.modalV2, "V2 lines + stats", [
          { id: "v2", label: "{v2} tree (┌ ├ └)", max: 500, value: cfg.v2 || DEFAULT_V2 },
          {
            id: "record_count",
            label: "Records value (blank = auto)",
            style: TextInputStyle.Short,
            max: 80,
            value: cfg.recordCount,
            required: false,
          },
          {
            id: "score_points",
            label: "Total Score Points (blank = auto)",
            style: TextInputStyle.Short,
            max: 80,
            value: cfg.scorePoints,
            required: false,
          },
          {
            id: "mvps",
            label: "MVPS (blank = auto)",
            style: TextInputStyle.Short,
            max: 200,
            value: cfg.mvps,
            required: false,
          },
        ])
      );
      return true;
    }
    if (id === ID.post) {
      const sent = await postOrEdit(interaction.channel, interaction.guild);
      await interaction.update(editorPayload(interaction.guild.id));
      await interaction.followUp({
        embeds: [ok("Posted", `About server is live in ${sent.channel}.`)],
        ephemeral: true,
      }).catch(() => {});
      return true;
    }
    if (id === ID.refresh) {
      const msg = await refreshPosted(interaction.guild);
      await interaction.reply({
        embeds: msg
          ? [ok("Refreshed", "The posted About server message was updated.")]
          : [danger("Nothing posted", "Use **Post / update here** first.")],
        ephemeral: true,
      });
      return true;
    }
    if (id === ID.vars) {
      await interaction.reply({
        embeds: [tsbEmbed({ title: "Variables", color: COLOR_PRIMARY, description: varsHelp() })],
        ephemeral: true,
      });
      return true;
    }
  }

  if (interaction.isModalSubmit?.()) {
    if (id === ID.modalGif) {
      updateConfig(interaction.guild.id, { gif: safeUrl(interaction.fields.getTextInputValue("gif")) });
    } else if (id === ID.modalBody) {
      updateConfig(interaction.guild.id, { body: safeText(interaction.fields.getTextInputValue("body"), 4000) });
    } else if (id === ID.modalRecords) {
      updateConfig(interaction.guild.id, { records: safeText(interaction.fields.getTextInputValue("records"), 2000) });
    } else if (id === ID.modalV2) {
      updateConfig(interaction.guild.id, {
        v2: safeText(interaction.fields.getTextInputValue("v2"), 500) || DEFAULT_V2,
        recordCount: safeText(interaction.fields.getTextInputValue("record_count"), 80),
        scorePoints: safeText(interaction.fields.getTextInputValue("score_points"), 80),
        mvps: safeText(interaction.fields.getTextInputValue("mvps"), 200),
      });
    } else {
      return false;
    }
    await refreshPosted(interaction.guild).catch(() => null);
    await interaction.reply({
      embeds: [ok("Saved", "About server updated. Posted message refreshed if it exists.")],
      ephemeral: true,
    });
    return true;
  }

  return false;
}

module.exports = {
  ID,
  interpolate,
  buildVars,
  buildPayload,
  postOrEdit,
  refreshPosted,
  editorPayload,
  openEditor,
  handleAboutInteraction,
  varsHelp,
};
