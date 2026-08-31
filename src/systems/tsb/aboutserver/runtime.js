const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
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
  hasConfig,
  createConfig,
  updateConfig,
  safeText,
  safeUrl,
  parseColor,
  normalizeName,
  listConfigs,
  deleteConfig,
  renameConfig,
  duplicateConfig,
} = require("./store");

function editorId(action, name) {
  const key = normalizeName(name);
  return `tsb:embed:${action}:${key}`;
}

function parseEditorId(id) {
  const parts = String(id || "").split(":");
  if (parts[0] !== "tsb" || parts[1] !== "embed") return null;
  const action = parts[2] || "";
  if (action === "section_select") {
    return {
      action,
      index: -1,
      name: normalizeName(parts.slice(3).join(":")),
    };
  }
  if (action === "channel") {
    return {
      action,
      view: parts[3] === "hub" ? "hub" : "editor",
      name: normalizeName(parts.slice(4).join(":")),
    };
  }
  if (action.startsWith("section_")) {
    return {
      action,
      index: Number.isInteger(Number(parts[3])) ? Number(parts[3]) : -1,
      name: normalizeName(parts.slice(4).join(":")),
    };
  }
  return {
    action,
    name: normalizeName(parts.slice(3).join(":")),
  };
}

function parseHubId(id) {
  const match = String(id || "").match(/^tsb:embed:hub_(select|list|new|edit|duplicate|rename|post|refresh|delete|confirm_delete|cancel_delete)(?::([a-z0-9_-]+))?$/i);
  if (!match) return null;
  return {
    action: match[1].toLowerCase(),
    name: normalizeName(match[2] || ""),
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

function normalizeSection(section) {
  if (!section || typeof section !== "object") return null;
  const text = String(section.text || "").trim().slice(0, 4000);
  if (!text) return null;
  return {
    id: String(section.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 48),
    text,
    thumbnail: safeUrl(section.thumbnail),
  };
}

function sectionsFromConfig(cfg) {
  if (Array.isArray(cfg.sections) && cfg.sections.length) {
    return cfg.sections.map(normalizeSection).filter(Boolean).slice(0, 25);
  }
  const legacyThumbnails = Array.isArray(cfg.sectionThumbnails) ? cfg.sectionThumbnails : [];
  return splitV2Line(cfg.body)
    .map((chunk, index) => normalizeSection({
      text: chunk.text,
      thumbnail: chunk.thumbnail || legacyThumbnails[index],
    }))
    .filter(Boolean)
    .slice(0, 25);
}

function bodyFromSections(sections) {
  return sections.map((section) => section.text).join("\n{v2line}\n").slice(0, 3900);
}

function sectionId(action, name, index = -1) {
  return `tsb:embed:${action}:${index}:${normalizeName(name)}`;
}

function sectionValidation(sections) {
  if (sections.length > 25) return "An embed can have at most 25 sections.";
  const total = sections.reduce((sum, section) => sum + section.text.length, 0);
  if (total > 5900) return "The sections are too long together. Keep the total text under 5,900 characters.";
  return "";
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
  const sections = sectionsFromConfig(cfg);
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

  const chunks = sections.length
    ? sections.map((section) => ({ text: fill(section.text, vars, 4000), thumbnail: safeUrl(section.thumbnail) }))
    : splitV2Line(fill(cfg.body || "", vars, 3900));
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

async function refreshPosted(guild, name = "") {
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
    "Every embed starts empty — name it, then build it with buttons.",
    "",
    "Use **Sections** to add, edit, remove, and reorder body sections.",
    "Existing `{v2line}` content is still read when an older embed is opened.",
    "`{server}` `{members}` `{owner}` `{created}`",
    "Mentions: paste a Discord mention or type `@username` / `@role-name`; matching server members and roles are converted automatically when saved.",
  ].join("\n");
}

function previewEmbed(guild, cfg) {
  const vars = buildVars(guild);
  const sections = sectionsFromConfig(cfg);
  const description = sections.map((section) => fill(section.text, vars, 4000)).join("\n\n") || "\u200b";
  const preview = tsbEmbed({
    title: fill(cfg.title, vars, 256).trim() || "Untitled embed",
    description: description.slice(0, 4096),
    footer: fill(cfg.footer, vars, 500).trim(),
    color: parseColor(cfg.color),
    thumbnail: safeUrl(cfg.thumbnail),
    image: safeUrl(cfg.gif),
  });
  return preview;
}

function editorPayload(guildId, name, guild = { id: guildId, name: "this server", memberCount: 0 }, notice = "") {
  const key = normalizeName(name);
  if (!key) return embedHubPayload(guildId);
  const cfg = getConfig(guildId, key);
  const sections = sectionsFromConfig(cfg);
  const posted = cfg.channelId && cfg.messageId ? `<#${cfg.channelId}>` : "`not posted`";
  return {
    embeds: [
      tsbEmbed({
        title: `Embed editor · ${key}`,
        color: COLOR_PRIMARY,
        description:
          "Changes save automatically and the preview updates after every action.\n\n" +
          `> **Name:** \`${key}\`\n` +
          `> **Title:** ${cfg.title ? `\`${String(cfg.title).slice(0, 40)}\`` : "`none`"}\n` +
          `> **Sections:** \`${sections.length}\`\n` +
          `> **GIF:** ${cfg.gif ? "`set`" : "`none`"}\n` +
          `> **Footer:** ${cfg.footer ? "`set`" : "`none`"}\n` +
          `> **Posted:** ${posted}\n` +
          `> **Last saved:** ${cfg.updatedAt ? `<t:${Math.floor(cfg.updatedAt / 1000)}:R>` : "`not saved yet`"}\n\n` +
          (notice ? `> **Status:** ${notice}\n\n` : "") +
          varsHelp(),
      }),
      previewEmbed(guild, cfg),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(editorId("content", key)).setLabel("Title / body / footer").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(editorId("sections", key)).setLabel("Sections").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(editorId("style", key)).setLabel("Color / thumbnail").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(editorId("gif", key)).setLabel("GIF").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(editorId("post", key)).setLabel("Post / update").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(editorId("refresh", key)).setLabel("Refresh posted").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(editorId("rename", key)).setLabel("Rename").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(editorId("vars", key)).setLabel("Variables").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(editorId("hub", key)).setLabel("Embed Hub").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function embedHubPayload(guildId, selected = "", notice = "") {
  const names = listConfigs(guildId);
  const current = normalizeName(selected);
  if (!names.length) {
    return {
      embeds: [
        tsbEmbed({
          title: "Embeds",
          color: COLOR_PRIMARY,
          description: "No embeds yet.\n\nClick **Create** to name your first embed. Nothing is created until you choose a name.",
        }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("tsb:embed:hub_new").setLabel("Create your first embed").setStyle(ButtonStyle.Primary)
        ),
      ],
    };
  }
  const options = names.slice(0, 25).map((name) => ({
    label: name,
    value: name,
    description: "Saved named embed",
    default: name === current,
  }));
  if (!options.some((option) => option.default)) options[0].default = true;
  const chosen = options.find((option) => option.default)?.value || names[0];

  return {
    embeds: [
      tsbEmbed({
        title: "Embeds",
        color: COLOR_PRIMARY,
        description:
          "Choose an embed below, then use the buttons. You can create as many named embeds as you need.\n\n" +
          `> **Selected:** \`${chosen}\`\n` +
          `> **Saved embeds:** \`${names.length}\`` +
          (notice ? `\n> **Status:** ${notice}` : ""),
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
        new ButtonBuilder().setCustomId(`tsb:embed:hub_duplicate:${chosen}`).setLabel("Duplicate").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tsb:embed:hub_edit:${chosen}`).setLabel("Edit").setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tsb:embed:hub_post:${chosen}`).setLabel("Post / update").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`tsb:embed:hub_refresh:${chosen}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tsb:embed:hub_rename:${chosen}`).setLabel("Rename").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tsb:embed:hub_delete:${chosen}`).setLabel("Delete").setStyle(ButtonStyle.Danger)
      ),
    ],
  };
}

function channelPickerPayload(guildId, name, view = "editor") {
  return {
    embeds: [
      tsbEmbed({
        title: "Choose a channel",
        color: COLOR_PRIMARY,
        description: `Select where \`${name}\` should be posted. If a matching message already exists there, it will be updated.`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`tsb:embed:channel:${view}:${name}`)
          .setPlaceholder("Select a text channel")
          .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(view === "hub" ? `tsb:embed:hub_edit:${name}` : editorId("hub", name))
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function deleteConfirmPayload(guildId, name) {
  return {
    embeds: [
      tsbEmbed({
        title: "Delete embed?",
        color: COLOR_PRIMARY,
        description: `This permanently removes \`${name}\` from the bot. Any message already posted in Discord will not be deleted.`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tsb:embed:hub_confirm_delete:${name}`).setLabel("Delete permanently").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`tsb:embed:hub_cancel_delete:${name}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

async function openEmbedHub(interaction, selected = "") {
  const payload = embedHubPayload(interaction.guild.id, selected);
  if (interaction.replied || interaction.deferred) return interaction.editReply({ ...payload, ephemeral: true });
  if ((interaction.isButton?.() || interaction.isStringSelectMenu?.()) && interaction.message) {
    return interaction.update(payload);
  }
  return interaction.reply({ ...payload, ephemeral: true });
}

async function handleEmbedHubInteraction(interaction, context) {
  if (context.action === "select") {
    return openEmbedHub(interaction, interaction.values?.[0] || "");
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
  if (!name || !hasConfig(interaction.guild.id, name)) {
    return openEmbedHub(interaction);
  }
  const cfg = getConfig(interaction.guild.id, name);

  if (context.action === "edit") return openEditor(interaction, name);

  if (context.action === "duplicate") {
    return interaction.showModal(
      modal(`tsb:embed:modal_duplicate:${name}`, "Duplicate embed", [
        {
          id: "name",
          label: "New embed name",
          style: TextInputStyle.Short,
          max: 32,
          required: true,
          placeholder: "welcome-copy",
        },
      ])
    );
  }

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
    return interaction.update(channelPickerPayload(interaction.guild.id, name, "hub"));
  }

  if (context.action === "refresh") {
    const refreshed = await refreshPosted(interaction.guild, name);
    return interaction.update(embedHubPayload(
      interaction.guild.id,
      name,
      refreshed ? "Posted message refreshed." : "No posted message was found. Use Post / update to choose a channel."
    ));
  }

  if (context.action === "delete") {
    return interaction.update(deleteConfirmPayload(interaction.guild.id, name));
  }

  if (context.action === "confirm_delete") {
    if (!deleteConfig(interaction.guild.id, name)) {
      return interaction.reply({ embeds: [danger("Not found", `No embed named \`${name}\` exists.`)], ephemeral: true });
    }
    return interaction.update(embedHubPayload(interaction.guild.id));
  }

  if (context.action === "cancel_delete") {
    return openEmbedHub(interaction, name);
  }

  return false;
}

function sectionsPayload(guildId, name, selected = 0) {
  const key = normalizeName(name);
  const cfg = getConfig(guildId, key);
  const sections = sectionsFromConfig(cfg);
  const current = Number.isInteger(selected) && selected >= 0 && selected < sections.length ? selected : 0;
  const selectedSection = sections[current];
  const payload = {
    embeds: [
      tsbEmbed({
        title: `Sections · ${key}`,
        color: COLOR_PRIMARY,
        description: sections.length
          ? `Select a section to edit or reorder it.\n\n> **Selected:** ${current + 1} of ${sections.length}\n> ${String(selectedSection.text).slice(0, 300)}`
          : "This embed has no body sections yet.\n\nClick **Add section** to create the first one.",
      }),
    ],
    components: [],
  };

  if (sections.length) {
    payload.components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`tsb:embed:section_select:${key}`)
          .setPlaceholder("Choose a section")
          .addOptions(sections.map((section, index) => ({
            label: `Section ${index + 1}`,
            value: String(index),
            description: String(section.text).replace(/\s+/g, " ").slice(0, 100),
            default: index === current,
          })))
      )
    );
  }

  payload.components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(sectionId("section_add", key)).setLabel("Add section").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(sectionId("section_edit", key, current)).setLabel("Edit").setStyle(ButtonStyle.Secondary).setDisabled(!sections.length),
      new ButtonBuilder().setCustomId(sectionId("section_delete", key, current)).setLabel("Delete").setStyle(ButtonStyle.Danger).setDisabled(!sections.length),
      new ButtonBuilder().setCustomId(sectionId("section_up", key, current)).setLabel("Move up").setStyle(ButtonStyle.Secondary).setDisabled(current <= 0),
      new ButtonBuilder().setCustomId(sectionId("section_down", key, current)).setLabel("Move down").setStyle(ButtonStyle.Secondary).setDisabled(current < 0 || current >= sections.length - 1)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(editorId("content", key)).setLabel("Edit title/body/footer").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(editorId("back", key)).setLabel("Back to editor").setStyle(ButtonStyle.Secondary)
    )
  );
  return payload;
}

function requireStaff(interaction) {
  return isAdminOrOwner(interaction.member, interaction.guild);
}

async function updateEditorView(interaction, name) {
  const payload = editorPayload(interaction.guild.id, name, interaction.guild);
  if (interaction.message && typeof interaction.update === "function") {
    return interaction.update(payload);
  }
  return interaction.reply({ ...payload, ephemeral: true });
}

async function openEditor(interaction, name = "") {
  const key = normalizeName(name);
  if (!key || !hasConfig(interaction.guild.id, key)) return openEmbedHub(interaction);
  const payload = editorPayload(interaction.guild.id, key, interaction.guild);
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

  if (action === "channel" && interaction.isChannelSelectMenu?.()) {
    const channelId = interaction.values?.[0];
    const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.isTextBased?.()) {
      await interaction.reply({ embeds: [danger("Invalid channel", "Choose a text or announcement channel.")], ephemeral: true });
      return true;
    }
    try {
      await postOrEdit(channel, interaction.guild, cfg);
      return interaction.update(
        context.view === "hub"
          ? embedHubPayload(interaction.guild.id, name, "Embed posted or updated.")
          : editorPayload(interaction.guild.id, name, interaction.guild, "Embed posted or updated.")
      );
    } catch (err) {
      await interaction.reply({
        embeds: [danger("Post failed", err.message || "Could not post that embed.")],
        ephemeral: true,
      }).catch(() => {});
      return true;
    }
  }

  if (action === "section_select" && interaction.isStringSelectMenu?.()) {
    return interaction.update(sectionsPayload(interaction.guild.id, name, Number(interaction.values?.[0])));
  }

  if (interaction.isButton?.()) {
    if (action === "sections") return interaction.update(sectionsPayload(interaction.guild.id, name));
    if (action === "back") return openEditor(interaction, name);
    if (action === "section_add") {
      await interaction.showModal(
        modal(sectionId("section_add", name), "Add section", [
          {
            id: "text",
            label: "Section text",
            max: 4000,
            required: true,
            placeholder: "Write the content for this section.",
          },
          {
            id: "thumbnail",
            label: "Thumbnail URL (optional)",
            style: TextInputStyle.Short,
            max: 500,
            placeholder: "https://example.com/image.png",
          },
        ])
      );
      return true;
    }
    if (["section_edit", "section_delete", "section_up", "section_down"].includes(action)) {
      const sections = sectionsFromConfig(cfg);
      const index = context.index;
      if (index < 0 || index >= sections.length) return interaction.update(sectionsPayload(interaction.guild.id, name));
      if (action === "section_edit") {
        await interaction.showModal(
          modal(sectionId("section_edit", name, index), `Edit section ${index + 1}`, [
            {
              id: "text",
              label: "Section text",
              max: 4000,
              required: true,
              value: sections[index].text,
            },
            {
              id: "thumbnail",
              label: "Thumbnail URL (optional)",
              style: TextInputStyle.Short,
              max: 500,
              value: sections[index].thumbnail,
            },
          ])
        );
        return true;
      }
      if (action === "section_delete") {
        sections.splice(index, 1);
      } else {
        const nextIndex = action === "section_up" ? index - 1 : index + 1;
        if (nextIndex < 0 || nextIndex >= sections.length) return interaction.update(sectionsPayload(interaction.guild.id, name, index));
        [sections[index], sections[nextIndex]] = [sections[nextIndex], sections[index]];
      }
      const problem = sectionValidation(sections);
      if (problem) {
        await interaction.reply({ embeds: [danger("Sections are too long", problem)], ephemeral: true });
        return true;
      }
      updateConfig(interaction.guild.id, {
        sections,
        body: "",
        sectionThumbnails: [],
      }, name);
      await refreshPosted(interaction.guild, name).catch(() => null);
      return interaction.update(sectionsPayload(interaction.guild.id, name, Math.min(index, sections.length - 1)));
    }

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
            label: "Body — use {v2line} for section breaks",
            max: 3900,
            value: bodyFromSections(sectionsFromConfig(cfg)),
            placeholder: "Write body text, or use the Sections button for visual editing.",
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
      return interaction.update(channelPickerPayload(interaction.guild.id, name, "editor"));
    }
    if (action === "refresh") {
      const refreshed = await refreshPosted(interaction.guild, name);
      return interaction.update(editorPayload(
        interaction.guild.id,
        name,
        interaction.guild,
        refreshed ? "Posted message refreshed." : "No posted message was found. Use Post / update to choose a channel."
      ));
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
      const created = createConfig(interaction.guild.id, name);
      if (!created.ok) {
        return interaction.reply({ embeds: [danger("Could not create embed", created.reason)], ephemeral: true });
      }
      return openEditor(interaction, name);
    }
    if (action === "modal_duplicate") {
      const nextName = normalizeName(interaction.fields.getTextInputValue("name"));
      const duplicated = duplicateConfig(interaction.guild.id, name, nextName);
      if (!duplicated.ok) {
        return interaction.reply({ embeds: [danger("Could not duplicate embed", duplicated.reason)], ephemeral: true });
      }
      return openEditor(interaction, duplicated.config.name);
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
      const rawGif = interaction.fields.getTextInputValue("gif");
      if (String(rawGif || "").trim() && !safeUrl(rawGif)) {
        return interaction.reply({ embeds: [danger("Invalid media URL", "Use a complete `https://` image or GIF URL.")], ephemeral: true });
      }
      updateConfig(interaction.guild.id, { gif: safeUrl(rawGif) }, name);
    } else if (action === "modal_content") {
      const [title, body, footer] = await Promise.all([
        resolveTextMentions(interaction.guild, interaction.fields.getTextInputValue("title")),
        resolveTextMentions(interaction.guild, interaction.fields.getTextInputValue("body")),
        resolveTextMentions(interaction.guild, interaction.fields.getTextInputValue("footer")),
      ]);
      const sections = sectionsFromConfig({ body });
      const sectionProblem = sectionValidation(sections);
      if (sectionProblem) {
        return interaction.reply({ embeds: [danger("Body is too long", sectionProblem)], ephemeral: true });
      }
      updateConfig(interaction.guild.id, {
        title: safeText(title, 256),
        body: safeText(body, 3900),
        footer: safeText(footer, 500),
        sections,
        sectionThumbnails: [],
      }, name);
    } else if (action === "modal_style") {
      const colorRaw = String(interaction.fields.getTextInputValue("color") || "")
        .replace(/^#/, "")
        .trim()
        .toUpperCase();
      const rawThumbnail = interaction.fields.getTextInputValue("thumbnail");
      if (String(rawThumbnail || "").trim() && !safeUrl(rawThumbnail)) {
        return interaction.reply({ embeds: [danger("Invalid thumbnail URL", "Use a complete `https://` image URL.")], ephemeral: true });
      }
      updateConfig(interaction.guild.id, {
        color: /^[0-9A-F]{6}$/.test(colorRaw) ? colorRaw : "2B2D31",
        thumbnail: safeUrl(rawThumbnail),
      }, name);
    } else if (action === "section_add" || action === "section_edit") {
      const text = await resolveTextMentions(interaction.guild, interaction.fields.getTextInputValue("text"));
      const rawThumbnail = interaction.fields.getTextInputValue("thumbnail");
      if (String(rawThumbnail || "").trim() && !safeUrl(rawThumbnail)) {
        return interaction.reply({ embeds: [danger("Invalid thumbnail URL", "Use a complete `https://` image URL.")], ephemeral: true });
      }
      const sections = sectionsFromConfig(cfg);
      const section = normalizeSection({
        text,
        thumbnail: rawThumbnail,
      });
      if (!section) {
        return interaction.reply({ embeds: [danger("Section is empty", "Add some text before saving this section.")], ephemeral: true });
      }
      if (action === "section_add") sections.push(section);
      else sections[context.index] = section;
      const sectionProblem = sectionValidation(sections);
      if (sectionProblem) {
        return interaction.reply({ embeds: [danger("Could not save section", sectionProblem)], ephemeral: true });
      }
      updateConfig(interaction.guild.id, {
        sections,
        body: "",
        sectionThumbnails: [],
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
  sectionsFromConfig,
  sectionsPayload,
  channelPickerPayload,
  postOrEdit,
  refreshPosted,
  editorPayload,
  embedHubPayload,
  openEmbedHub,
  openEditor,
  handleAboutInteraction,
  varsHelp,
};
