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
  normalizeName,
  listConfigs,
  deleteConfig,
} = require("./store");

function editorId(action, name = "default") {
  const key = normalizeName(name);
  return key === "default" ? `tsb:about:${action}` : `tsb:embed:${action}:${key}`;
}

function parseEditorId(id) {
  const parts = String(id || "").split(":");
  if (parts[0] !== "tsb" || !["about", "embed"].includes(parts[1])) return null;
  return {
    action: parts[2] || "",
    name: parts[1] === "about" ? "default" : normalizeName(parts.slice(3).join(":")),
  };
}

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
  const source = String(text || "");
  const chunks = [];
  const marker = /\{v2(?:line|_line)(?:\s*[:|]\s*(https?:\/\/[^}\s]+))?\}/gi;
  let cursor = 0;
  let pendingThumbnail = "";
  let match;

  while ((match = marker.exec(source))) {
    chunks.push({
      text: source.slice(cursor, match.index),
      thumbnail: pendingThumbnail,
    });
    pendingThumbnail = safeUrl(match[1]);
    cursor = marker.lastIndex;
  }

  chunks.push({
    text: source.slice(cursor),
    thumbnail: pendingThumbnail,
  });
  return chunks;
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

  if (gif) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems((item) => item.setURL(gif))
    );
  }

  const chunks = splitV2Line(body);
  let wrote = false;

  if (title) {
    wrote = addText(container, `# ${title}`, thumbnail) || wrote;
  }

  chunks.forEach((chunk, index) => {
    if (index > 0) addDivider(container);
    const text = String(chunk.text || "").trim();
    if (!text) return;
    const chunkThumbnail = chunk.thumbnail || (!title && index === 0 ? thumbnail : "");
    wrote = addText(container, text, chunkThumbnail) || wrote;
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
  updateConfig(guild.id, { channelId: channel.id, messageId: sent.id }, cfg.name);
  return sent;
}

async function refreshPosted(guild, name = "default") {
  const cfg = getConfig(guild.id, name);
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
    "`{v2line}` — divider; `{v2line:https://...}` — divider + thumbnail for the next block:",
    "```",
    "Aesir text",
    "{v2line:https://example.com/aesir.png}",
    "Vanir text",
    "```",
    "`{server}` `{members}` `{owner}` `{created}`",
  ].join("\n");
}

function editorPayload(guildId, name = "default") {
  const key = normalizeName(name);
  const cfg = getConfig(guildId, key);
  const posted = cfg.channelId && cfg.messageId ? `<#${cfg.channelId}>` : "`not posted yet`";
  return {
    embeds: [
      tsbEmbed({
        title: `Embed editor · ${key}`,
        color: COLOR_PRIMARY,
        description:
          "Editable v2 card: GIF, title, body, footer, thumbnail, color.\n\n" +
          `> **Name:** \`${key}\`\n` +
          `> **Title:** ${cfg.title ? `\`${String(cfg.title).slice(0, 40)}\`` : "`none`"}\n` +
          `> **GIF:** ${cfg.gif ? "`set`" : "`none`"}\n` +
          `> **Footer:** ${cfg.footer ? "`set`" : "`none`"}\n` +
          `> **Posted:** ${posted}\n\n` +
          varsHelp(),
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(editorId("gif", key)).setLabel("GIF").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(editorId("content", key)).setLabel("Title / body / footer").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(editorId("style", key)).setLabel("Color / thumbnail").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(editorId("post", key)).setLabel("Post / update here").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(editorId("refresh", key)).setLabel("Refresh posted").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(editorId("vars", key)).setLabel("Variables").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function requireStaff(interaction) {
  return isAdminOrOwner(interaction.member, interaction.guild);
}

async function openEditor(interaction, name = "default") {
  const payload = editorPayload(interaction.guild.id, name);
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
  const context = parseEditorId(id);
  if (!context) return false;
  const { action, name } = context;
  if (!requireStaff(interaction)) {
    await interaction.reply({ content: "You need **Administrator** to edit embeds.", ephemeral: true });
    return true;
  }

  const cfg = getConfig(interaction.guild.id, name);

  if (interaction.isButton?.()) {
    if (action === "gif") {
      await interaction.showModal(
        modal(editorId("modal_gif", name), "Embed GIF", [
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
    if (action === "content") {
      await interaction.showModal(
        modal(editorId("modal_content", name), "Title, body, footer", [
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
            label: "Body — use {v2line} or {v2line:URL}",
            max: 3900,
            value: cfg.body,
            placeholder: "Aesir text\n{v2line:https://...}\nVanir text",
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
    if (action === "style") {
      await interaction.showModal(
        modal(editorId("modal_style", name), "Color & thumbnail", [
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
    if (action === "post") {
      try {
        const sent = await postOrEdit(interaction.channel, interaction.guild, cfg);
        await interaction.update(editorPayload(interaction.guild.id, name));
        await interaction.followUp({
          embeds: [ok("Posted", `Embed \`${name}\` is live in ${sent.channel}.`)],
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
    if (action === "refresh") {
      const msg = await refreshPosted(interaction.guild, name);
      await interaction.reply({
        embeds: msg
          ? [ok("Refreshed", `The posted embed \`${name}\` was updated.`)]
          : [danger("Nothing posted", "Use **Post / update here** first.")],
        ephemeral: true,
      });
      return true;
    }
    if (action === "vars") {
      await interaction.reply({
        embeds: [tsbEmbed({ title: "Variables", color: COLOR_PRIMARY, description: varsHelp() })],
        ephemeral: true,
      });
      return true;
    }
  }

  if (interaction.isModalSubmit?.()) {
    if (action === "modal_gif") {
      updateConfig(interaction.guild.id, { gif: safeUrl(interaction.fields.getTextInputValue("gif")) }, name);
    } else if (action === "modal_content") {
      updateConfig(interaction.guild.id, {
        title: safeText(interaction.fields.getTextInputValue("title"), 256),
        body: safeText(interaction.fields.getTextInputValue("body"), 3900),
        footer: safeText(interaction.fields.getTextInputValue("footer"), 500),
      }, name);
    } else if (action === "modal_style") {
      const colorRaw = String(interaction.fields.getTextInputValue("color") || "")
        .replace(/^#/, "")
        .trim()
        .toUpperCase();
      updateConfig(interaction.guild.id, {
        color: /^[0-9A-F]{6}$/.test(colorRaw) ? colorRaw : "2B2D31",
        thumbnail: safeUrl(interaction.fields.getTextInputValue("thumbnail")),
      }, name);
    } else {
      return false;
    }
    await refreshPosted(interaction.guild, name).catch(() => null);
    await interaction.reply({
      embeds: [ok("Saved", `Embed \`${name}\` updated. Posted message refreshed if it exists.`)],
      ephemeral: true,
    });
    return true;
  }

  return false;
}

module.exports = {
  editorId,
  parseEditorId,
  interpolate,
  buildVars,
  splitV2Line,
  buildPayload,
  postOrEdit,
  refreshPosted,
  editorPayload,
  openEditor,
  handleAboutInteraction,
  varsHelp,
};
