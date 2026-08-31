const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  SeparatorSpacingSize,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { isAdminOrOwner } = require("../shared/permissions");
const { tsbEmbed, COLOR_PRIMARY } = require("../shared/embeds");
const { danger } = require("../../../utils/embeds");
const {
  getConfig,
  updateConfig,
  safeText,
  safeUrl,
  parseColor,
  normalizeName,
  listConfigs,
  deleteConfig,
  renameConfig,
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

function parseHubId(id) {
  const match = String(id || "").match(/^tsb:embed:hub_(select|list|new|edit|rename|post|refresh|delete)(?::([a-z0-9_-]+))?$/i);
  if (!match) return null;
  return {
    action: match[1].toLowerCase(),
    name: normalizeName(match[2] || "default"),
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

function memberMatches(member, handle) {
  const wanted = String(handle || "").toLowerCase();
  return [member.user?.username, member.user?.globalName, member.displayName, member.nickname]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase() === wanted);
}

async function resolveMention(guild, handle) {
  const wanted = String(handle || "").toLowerCase();
  if (!wanted || wanted === "everyone" || wanted === "here") return `@${handle}`;

  const cachedMember = guild.members.cache.find((member) => memberMatches(member, wanted));
  if (cachedMember) return `<@${cachedMember.id}>`;

  try {
    const fetched = await guild.members.fetch({ query: handle, limit: 10 });
    const member = fetched.find((candidate) => memberMatches(candidate, wanted));
    if (member) return `<@${member.id}>`;
  } catch {}

  const role = guild.roles.cache.find((candidate) => String(candidate.name).toLowerCase() === wanted);
  return role ? `<@&${role.id}>` : `@${handle}`;
}

async function resolveTextMentions(guild, text) {
  const source = String(text || "");
  const pattern = /@([a-z0-9_.-]{2,32})/gi;
  let output = "";
  let cursor = 0;
  let match;

  while ((match = pattern.exec(source))) {
    output += source.slice(cursor, match.index);
    output += await resolveMention(guild, match[1]);
    cursor = pattern.lastIndex;
  }

  return output + source.slice(cursor);
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
  const sectionThumbnails = Array.isArray(cfg.sectionThumbnails)
    ? cfg.sectionThumbnails.map((url) => safeUrl(url))
    : [];
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
    const chunkThumbnail =
      chunk.thumbnail
      || sectionThumbnails[index]
      || (!title && index === 0 ? thumbnail : "");
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
    allowedMentions: {
      parse: ["users", "roles", "everyone"],
    },
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
    "`{v2line}` — divider between two body sections.",
    "Use the **Section thumbnails** button to add one image URL per body section, in order:",
    "```",
    "Aesir text",
    "{v2line}",
    "Vanir text",
    "```",
    "`{server}` `{members}` `{owner}` `{created}`",
    "Mentions: paste a Discord mention or type `@username` / `@role-name`; matching server members and roles are converted automatically when saved.",
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
          `> **Section thumbnails:** \`${Array.isArray(cfg.sectionThumbnails) ? cfg.sectionThumbnails.filter(Boolean).length : 0}\`\n` +
          `> **Footer:** ${cfg.footer ? "`set`" : "`none`"}\n` +
          `> **Posted:** ${posted}\n\n` +
          varsHelp(),
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(editorId("gif", key)).setLabel("GIF").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(editorId("content", key)).setLabel("Title / body / footer").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(editorId("style", key)).setLabel("Color / thumbnail").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(editorId("sections", key)).setLabel("Section thumbnails").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(editorId("post", key)).setLabel("Post / update here").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(editorId("refresh", key)).setLabel("Refresh posted").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(editorId("rename", key)).setLabel("Rename").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(editorId("vars", key)).setLabel("Variables").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(editorId("hub", key)).setLabel("Embed Hub").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function embedHubPayload(guildId, selected = "default") {
  const names = listConfigs(guildId);
  const current = normalizeName(selected);
  const options = names.slice(0, 25).map((name) => ({
    label: name,
    value: name,
    description: name === "default" ? "Main embed" : "Saved named embed",
    default: name === current,
  }));
  if (!options.some((option) => option.default)) options[0].default = true;
  const chosen = options.find((option) => option.default)?.value || "default";

  return {
    embeds: [
      tsbEmbed({
        title: "Embeds",
        color: COLOR_PRIMARY,
        description:
          "Choose an embed below, then use the buttons. You can create as many named embeds as you need.\n\n" +
          `> **Selected:** \`${chosen}\`\n` +
          `> **Saved embeds:** \`${names.length}\``,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("tsb:embed:hub_select")
          .setPlaceholder(`Selected: ${chosen}`)
          .addOptions(options)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tsb:embed:hub_list:${chosen}`).setLabel("List").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("tsb:embed:hub_new").setLabel("Create").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tsb:embed:hub_edit:${chosen}`).setLabel("Edit").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tsb:embed:hub_post:${chosen}`).setLabel("Post").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`tsb:embed:hub_refresh:${chosen}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tsb:embed:hub_rename:${chosen}`).setLabel("Rename").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tsb:embed:hub_delete:${chosen}`).setLabel("Delete").setStyle(ButtonStyle.Danger)
      ),
    ],
  };
}

async function openEmbedHub(interaction, selected = "default") {
  const payload = embedHubPayload(interaction.guild.id, selected);
  if (interaction.replied || interaction.deferred) return interaction.editReply({ ...payload, ephemeral: true });
  if ((interaction.isButton?.() || interaction.isStringSelectMenu?.()) && interaction.message) {
    return interaction.update(payload);
  }
  return interaction.reply({ ...payload, ephemeral: true });
}

async function handleEmbedHubInteraction(interaction, context) {
  if (context.action === "select") {
    return openEmbedHub(interaction, interaction.values?.[0] || "default");
  }

  if (context.action === "new") {
    return interaction.showModal(
      modal("tsb:embed:modal_new", "New embed", [
        {
          id: "name",
          label: "Embed name",
          style: TextInputStyle.Short,
          max: 32,
          required: true,
          placeholder: "welcome, rules, announcements",
        },
      ])
    );
  }

  if (context.action === "list") {
    return openEmbedHub(interaction, context.name);
  }

  const name = context.name;
  const cfg = getConfig(interaction.guild.id, name);

  if (context.action === "edit") return openEditor(interaction, name);

  if (context.action === "rename") {
    return interaction.showModal(
      modal(`tsb:embed:modal_hub_rename:${name}`, "Rename embed", [
        {
          id: "name",
          label: "New embed name",
          style: TextInputStyle.Short,
          max: 32,
          required: true,
          value: name,
        },
      ])
    );
  }

  if (context.action === "post") {
    try {
      await postOrEdit(interaction.channel, interaction.guild, cfg);
      return interaction.update(embedHubPayload(interaction.guild.id, name));
    } catch (err) {
      return interaction.reply({
        embeds: [danger("Post failed", err.message || "Could not post that embed.")],
        ephemeral: true,
      }).catch(() => {});
    }
  }

  if (context.action === "refresh") {
    await refreshPosted(interaction.guild, name);
    return interaction.update(embedHubPayload(interaction.guild.id, name));
  }

  if (context.action === "delete") {
    if (name === "default") {
      return interaction.reply({ embeds: [danger("Cannot delete default", "Choose a named embed instead.")], ephemeral: true });
    }
    if (!deleteConfig(interaction.guild.id, name)) {
      return interaction.reply({ embeds: [danger("Not found", `No embed named \`${name}\` exists.`)], ephemeral: true });
    }
    return interaction.update(embedHubPayload(interaction.guild.id, "default"));
  }

  return false;
}

function requireStaff(interaction) {
  return isAdminOrOwner(interaction.member, interaction.guild);
}

async function updateEditorView(interaction, name) {
  const payload = editorPayload(interaction.guild.id, name);
  if (interaction.message && typeof interaction.update === "function") {
    return interaction.update(payload);
  }
  return interaction.reply({ ...payload, ephemeral: true });
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
  const hubContext = parseHubId(id);
  if (hubContext) {
    if (!requireStaff(interaction)) {
      await interaction.reply({ content: "You need **Administrator** to manage embeds.", ephemeral: true });
      return true;
    }
    return handleEmbedHubInteraction(interaction, hubContext);
  }
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
            label: "Body — use {v2line} for dividers",
            max: 3900,
            value: cfg.body,
            placeholder: "Aesir text\n{v2line}\nVanir text",
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
    if (action === "sections") {
      await interaction.showModal(
        modal(editorId("modal_sections", name), "Section thumbnails", [
          {
            id: "thumbnails",
            label: "One image URL per body section",
            max: 3900,
            value: Array.isArray(cfg.sectionThumbnails) ? cfg.sectionThumbnails.join("\n") : "",
            placeholder: "https://.../aesir.png\nhttps://.../vanir.png",
          },
        ])
      );
      return true;
    }
    if (action === "hub") return openEmbedHub(interaction, name);
    if (action === "rename") {
      await interaction.showModal(
        modal(editorId("modal_rename", name), "Rename embed", [
          {
            id: "name",
            label: "New embed name",
            style: TextInputStyle.Short,
            max: 32,
            required: true,
            value: name,
          },
        ])
      );
      return true;
    }
    if (action === "post") {
      try {
        await postOrEdit(interaction.channel, interaction.guild, cfg);
        return interaction.update(editorPayload(interaction.guild.id, name));
      } catch (err) {
        await interaction.reply({
          embeds: [danger("Post failed", err.message || "Could not post that message.")],
          ephemeral: true,
        }).catch(() => {});
      }
      return true;
    }
    if (action === "refresh") {
      await refreshPosted(interaction.guild, name);
      return interaction.update(editorPayload(interaction.guild.id, name));
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
    if (action === "modal_new") {
      const name = normalizeName(interaction.fields.getTextInputValue("name"));
      return openEditor(interaction, name);
    }
    if (action === "modal_hub_rename" || action === "modal_rename") {
      const nextName = normalizeName(interaction.fields.getTextInputValue("name"));
      const renamed = renameConfig(interaction.guild.id, name, nextName);
      if (!renamed.ok) {
        return interaction.reply({ embeds: [danger("Rename failed", renamed.reason)], ephemeral: true });
      }
      return action === "modal_hub_rename"
        ? openEmbedHub(interaction, renamed.name)
        : openEditor(interaction, renamed.name);
    }
    if (action === "modal_gif") {
      updateConfig(interaction.guild.id, { gif: safeUrl(interaction.fields.getTextInputValue("gif")) }, name);
    } else if (action === "modal_content") {
      const [title, body, footer] = await Promise.all([
        resolveTextMentions(interaction.guild, interaction.fields.getTextInputValue("title")),
        resolveTextMentions(interaction.guild, interaction.fields.getTextInputValue("body")),
        resolveTextMentions(interaction.guild, interaction.fields.getTextInputValue("footer")),
      ]);
      updateConfig(interaction.guild.id, {
        title: safeText(title, 256),
        body: safeText(body, 3900),
        footer: safeText(footer, 500),
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
    } else if (action === "modal_sections") {
      const thumbnails = interaction.fields.getTextInputValue("thumbnails") || "";
      updateConfig(interaction.guild.id, {
        sectionThumbnails: thumbnails
          .split(/\r?\n/)
          .map((value) => safeUrl(value))
          .slice(0, 25),
      }, name);
    } else {
      return false;
    }
    await refreshPosted(interaction.guild, name).catch(() => null);
    return updateEditorView(interaction, name);
  }

  return false;
}

module.exports = {
  editorId,
  parseEditorId,
  parseHubId,
  interpolate,
  resolveTextMentions,
  buildVars,
  splitV2Line,
  buildPayload,
  postOrEdit,
  refreshPosted,
  editorPayload,
  embedHubPayload,
  openEmbedHub,
  openEditor,
  handleAboutInteraction,
  varsHelp,
};
