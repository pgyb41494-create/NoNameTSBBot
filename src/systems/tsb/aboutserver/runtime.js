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
const { isAdminOrOwner } = require("../shared/permissions");
const { tsbEmbed, COLOR_PRIMARY } = require("../shared/embeds");
const { danger, ok } = require("../../../utils/embeds");
const {
  getConfig,
  updateConfig,
  safeText,
  safeUrl,
  parseColor,
} = require("./store");

const ID = {
  gif: "tsb:about:gif",
  content: "tsb:about:content",
  style: "tsb:about:style",
  post: "tsb:about:post",
  refresh: "tsb:about:refresh",
  vars: "tsb:about:vars",
  modalGif: "tsb:about:modal_gif",
  modalContent: "tsb:about:modal_content",
  modalStyle: "tsb:about:modal_style",
};

function interpolate(template, vars) {
  return String(template || "").replace(/\{([a-z0-9_]+)\}/gi, (full, key) => {
    const id = String(key).toLowerCase();
    if (id === "v2line" || id === "v2_line") return full;
    const found = vars[id];
    return found == null ? full : String(found);
  });
}

function buildVars(guild) {
  return {
    server: guild.name,
    guild: guild.name,
    name: guild.name,
    members: String(guild.memberCount ?? ""),
    owner: guild.ownerId ? `<@${guild.ownerId}>` : "",
    created: guild.createdTimestamp ? `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>` : "",
  };
}

function splitV2Line(text) {
  return String(text || "").split(/\{v2line\}|\{v2_line\}/gi);
}

function fill(text, vars, max) {
  return interpolate(text, vars).slice(0, max);
}

function addText(container, content, thumbnail) {
  const sliced = String(content || "").trim();
  if (!sliced) return false;
  const body = sliced.slice(0, 4000);
  if (thumbnail) {
    container.addSectionComponents((section) =>
      section
        .addTextDisplayComponents((td) => td.setContent(body))
        .setThumbnailAccessory((acc) => acc.setURL(thumbnail))
    );
  } else {
    container.addTextDisplayComponents((td) => td.setContent(body));
  }
  return true;
}

function addDivider(container) {
  container.addSeparatorComponents((sep) =>
    sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
}

async function buildPayload(guild, cfg = getConfig(guild.id)) {
  const vars = buildVars(guild);
  const title = fill(cfg.title || "", vars, 256).trim();
  const body = fill(cfg.body || "", vars, 3900);
  const footer = fill(cfg.footer || "", vars, 500).trim();
  const gif = safeUrl(cfg.gif);
  const thumbnail = safeUrl(cfg.thumbnail);
  const color = parseColor(cfg.color);
  const container = new ContainerBuilder().setAccentColor(color);
  let usedThumb = false;

  if (gif) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems((item) => item.setURL(gif))
    );
  }

  const chunks = splitV2Line(body);
  let wrote = false;

  if (title) {
    wrote = addText(container, `# ${title}`, thumbnail) || wrote;
    usedThumb = !!thumbnail;
  }

  chunks.forEach((chunk, index) => {
    if (index > 0) addDivider(container);
    const text = String(chunk || "").trim();
    if (!text) return;
    wrote = addText(container, text, !usedThumb && thumbnail ? thumbnail : "") || wrote;
    if (!usedThumb && thumbnail) usedThumb = true;
  });

  if (footer) {
    addDivider(container);
    wrote = addText(container, `-# ${footer}`) || wrote;
  }

  if (!wrote && !gif) {
    addText(container, "\u200b");
  }

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
    "Title, body, and footer start empty — write them yourself.",
    "",
    "`{v2line}` — Discord divider between two text blocks:",
    "```",
    "Message above",
    "{v2line}",
    "Message below",
    "```",
    "`{server}` `{members}` `{owner}` `{created}`",
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
          "Editable v2 card: GIF, title, body, footer, thumbnail, color.\n\n" +
          `> **Title:** ${cfg.title ? `\`${String(cfg.title).slice(0, 40)}\`` : "`none`"}\n` +
          `> **GIF:** ${cfg.gif ? "`set`" : "`none`"}\n` +
          `> **Footer:** ${cfg.footer ? "`set`" : "`none`"}\n` +
          `> **Posted:** ${posted}\n\n` +
          varsHelp(),
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID.gif).setLabel("GIF").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(ID.content).setLabel("Title / body / footer").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ID.style).setLabel("Color / thumbnail").setStyle(ButtonStyle.Secondary)
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
  return isAdminOrOwner(interaction.member, interaction.guild);
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
      .setRequired(field.required === true)
      .setMaxLength(field.max || 4000);
    if (field.placeholder) input.setPlaceholder(String(field.placeholder).slice(0, 100));
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
          },
        ])
      );
      return true;
    }
    if (id === ID.content) {
      await interaction.showModal(
        modal(ID.modalContent, "Title, body, footer", [
          {
            id: "title",
            label: "Title",
            style: TextInputStyle.Short,
            max: 256,
            value: cfg.title,
            placeholder: "Leave empty for no title",
          },
          {
            id: "body",
            label: "Body — use {v2line} for a divider",
            max: 3900,
            value: cfg.body,
            placeholder: "Message above\n{v2line}\nMessage below",
          },
          {
            id: "footer",
            label: "Footer",
            style: TextInputStyle.Short,
            max: 500,
            value: cfg.footer,
            placeholder: "Leave empty for no footer",
          },
        ])
      );
      return true;
    }
    if (id === ID.style) {
      await interaction.showModal(
        modal(ID.modalStyle, "Color & thumbnail", [
          {
            id: "color",
            label: "Accent color hex",
            style: TextInputStyle.Short,
            max: 7,
            value: cfg.color || "2B2D31",
          },
          {
            id: "thumbnail",
            label: "Thumbnail URL",
            style: TextInputStyle.Short,
            max: 500,
            value: cfg.thumbnail,
          },
        ])
      );
      return true;
    }
    if (id === ID.post) {
      try {
        const sent = await postOrEdit(interaction.channel, interaction.guild);
        await interaction.update(editorPayload(interaction.guild.id));
        await interaction.followUp({
          embeds: [ok("Posted", `About server is live in ${sent.channel}.`)],
          ephemeral: true,
        }).catch(() => {});
      } catch (err) {
        await interaction.reply({
          embeds: [danger("Post failed", err.message || "Could not post that message.")],
          ephemeral: true,
        }).catch(() => {});
      }
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
    } else if (id === ID.modalContent) {
      updateConfig(interaction.guild.id, {
        title: safeText(interaction.fields.getTextInputValue("title"), 256),
        body: safeText(interaction.fields.getTextInputValue("body"), 3900),
        footer: safeText(interaction.fields.getTextInputValue("footer"), 500),
      });
    } else if (id === ID.modalStyle) {
      const colorRaw = String(interaction.fields.getTextInputValue("color") || "")
        .replace(/^#/, "")
        .trim()
        .toUpperCase();
      updateConfig(interaction.guild.id, {
        color: /^[0-9A-F]{6}$/.test(colorRaw) ? colorRaw : "2B2D31",
        thumbnail: safeUrl(interaction.fields.getTextInputValue("thumbnail")),
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
