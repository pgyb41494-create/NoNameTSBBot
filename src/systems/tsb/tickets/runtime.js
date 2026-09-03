const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const {
  COLOR,
  emptyPanel,
  getPanel,
  savePanel,
  listPanels,
  staffIds,
  slug,
} = require("./store");
const { buildTicketTranscript, transcriptAuditEmbed } = require("../shared/transcript");
const { parseEmoji, resolveEmojiStorage, formatEmojiLabel, parseEmojiInput } = require("../shared/parseEmoji");
const { applyTicketVars, ticketVarHint, ticketVariablesHelpEmbed } = require("../shared/ticketVars");

const LAST_STEP = 8;
const STYLES = {
  blue: ButtonStyle.Primary,
  gray: ButtonStyle.Secondary,
  green: ButtonStyle.Success,
  red: ButtonStyle.Danger,
};

function canSetup(member) {
  return Boolean(
    member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)
    || member?.permissions?.has?.(PermissionFlagsBits.Administrator)
  );
}

function applyVars(text, ctx = {}) {
  return applyTicketVars(text, ctx);
}
function parseColor(value) {
  const hex = String(value || "").trim().replace(/^#/, "").replace(/^0x/i, "");
  const num = Number.parseInt(hex, 16);
  return Number.isNaN(num) ? COLOR : num;
}

function colorHex(value) {
  return `#${Number(value || COLOR).toString(16).padStart(6, "0").toUpperCase()}`;
}

function staffMentions(panel) {
  const ids = staffIds(panel);
  return ids.length ? ids.map((id) => `<@&${id}>`).join(" ") : "not set";
}

function itemsOf(panel) {
  return Array.isArray(panel.items) ? panel.items : [];
}

function panelEmbed(panel, ctx = {}) {
  const embed = new EmbedBuilder()
    .setColor(panel.color || COLOR)
    .setTitle(applyVars(panel.title || "Tickets", ctx).slice(0, 256))
    .setDescription(applyVars(panel.body || " ", ctx).slice(0, 4096));
  if (panel.thumbnail) embed.setThumbnail(panel.thumbnail);
  if (panel.image) embed.setImage(panel.image);
  if (panel.footer) embed.setFooter({ text: applyVars(panel.footer, ctx).slice(0, 2048) });
  if (panel.fields?.length) {
    embed.addFields(
      panel.fields.slice(0, 25).map((field) => ({
        name: applyVars(field.name, ctx).slice(0, 256),
        value: applyVars(field.value, ctx).slice(0, 1024),
        inline: Boolean(field.inline),
      }))
    );
  }
  return embed;
}

function ticketInsideEmbed(panel, ctx = {}) {
  return new EmbedBuilder()
    .setColor(panel.color || COLOR)
    .setTitle(applyVars(panel.ticketTitle || "Ticket", ctx).slice(0, 256))
    .setDescription(
      applyVars(panel.ticketBody || "Hey {user}, staff will be with you shortly.\n> Reason: {reason}", ctx).slice(0, 4096)
    )
    .setTimestamp();
}

function panelComponents(panel, ctx = {}) {
  const rows = [];
  const items = itemsOf(panel);
  if (panel.componentMode === "buttons" && items.length) {
    for (let start = 0; start < Math.min(items.length, 25); start += 5) {
      const row = new ActionRowBuilder();
      items.slice(start, start + 5).forEach((item, offset) => {
        const btn = new ButtonBuilder()
          .setCustomId(`tsb:tix:open:${panel.name}:${start + offset}`)
          .setLabel(applyVars(item.label, ctx).slice(0, 80))
          .setStyle(STYLES[item.style] || ButtonStyle.Primary);
        const emoji = parseEmoji(item.emoji, ctx.guild);
        if (emoji) btn.setEmoji(emoji);
        row.addComponents(btn);
      });
      rows.push(row);
    }
  }
  if (panel.componentMode === "dropdown" && items.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`tsb:tix:dd:${panel.name}`)
      .setPlaceholder(applyVars(panel.dropdownPlaceholder || "Choose a reason", ctx).slice(0, 150))
      .addOptions(
        items.slice(0, 25).map((option, index) => {
          const opt = {
            label: applyVars(option.label, ctx).slice(0, 100),
            value: String(index),
            description: applyVars(option.description || "Open a ticket", ctx).slice(0, 100),
          };
          const emoji = parseEmoji(option.emoji, ctx.guild);
          if (emoji) opt.emoji = emoji;
          return opt;
        })
      );
    rows.push(new ActionRowBuilder().addComponents(menu));
  }
  return rows;
}

function summary(panel) {
  const mode = panel.componentMode === "dropdown"
    ? "dropdown"
    : panel.componentMode === "buttons"
      ? "buttons"
      : "not chosen";
  return [
    `> **ID:** \`${panel.name}\``,
    `> **Panel channel:** ${panel.sendChannelId ? `<#${panel.sendChannelId}>` : "not set"}`,
    `> **Ticket category:** ${panel.categoryId ? `<#${panel.categoryId}>` : "not set"}`,
    `> **Log channel:** ${panel.auditLogChannelId ? `<#${panel.auditLogChannelId}>` : "skipped"}`,
    `> **Staff:** ${staffMentions(panel)}`,
    `> **Color:** \`${colorHex(panel.color)}\``,
    `> **Type:** ${mode} · **Options:** ${itemsOf(panel).length}`,
  ].join("\n");
}

function homePayload(guildId) {
  const panels = listPanels(guildId);
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("Ticket setup")
    .setDescription(
      panels.length
        ? "Pick a panel to configure, or create a new one."
        : "No panels yet. Create one, then walk through the steps."
    );
  if (panels.length) {
    embed.addFields(
      panels.slice(0, 25).map((panel) => ({
        name: panel.title || panel.name,
        value: [
          `> ID: \`${panel.name}\``,
          `> Channel: ${panel.sendChannelId ? `<#${panel.sendChannelId}>` : "—"}`,
          `> Category: ${panel.categoryId ? `<#${panel.categoryId}>` : "—"}`,
        ].join("\n"),
      }))
    );
  }
  const rows = [];
  if (panels.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("tsb:tix:pick")
          .setPlaceholder("Edit a panel")
          .addOptions(
            panels.slice(0, 25).map((panel) => ({
              label: (panel.title || panel.name).slice(0, 100),
              value: panel.name,
              description: `ID: ${panel.name}`.slice(0, 100),
            }))
          )
      )
    );
  }
  const homeButtons = [
    new ButtonBuilder().setCustomId("tsb:tix:create").setLabel("Create panel").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("tsb:tix:import").setLabel("Import message").setStyle(ButtonStyle.Secondary),
  ];
  if (panels.some((p) => p.sendChannelId)) {
    homeButtons.push(
      new ButtonBuilder().setCustomId("tsb:tix:republish_all").setLabel("Republish all").setStyle(ButtonStyle.Primary)
    );
  }
  rows.push(new ActionRowBuilder().addComponents(homeButtons));
  if (panels.some((p) => p.sendChannelId)) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("tsb:tix:republish_one")
          .setPlaceholder("1-click republish one panel")
          .addOptions(
            panels
              .filter((p) => p.sendChannelId)
              .slice(0, 25)
              .map((panel) => ({
                label: `Republish: ${(panel.title || panel.name)}`.slice(0, 100),
                value: panel.name,
                description: panel.sendChannelId ? `→ #channel` : "not posted",
              }))
          )
      )
    );
  }
  return { embeds: [embed], components: rows };
}

function wizardNav(panel, step) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tsb:tix:back:${panel.name}:${step}`).setLabel("Back").setStyle(ButtonStyle.Secondary)
  );
  if (step < LAST_STEP) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`tsb:tix:next:${panel.name}:${step}`).setLabel("Next").setStyle(ButtonStyle.Primary)
    );
  } else {
    row.addComponents(
      new ButtonBuilder().setCustomId(`tsb:tix:post:${panel.name}`).setLabel("Publish panel").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tsb:tix:preview:${panel.name}`).setLabel("Live preview").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tsb:tix:vars:${panel.name}`).setLabel("Variables").setStyle(ButtonStyle.Secondary)
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId("tsb:tix:home").setLabel("All panels").setStyle(ButtonStyle.Secondary)
  );
  return row;
}

function wizardPayload(panel, step, guild = null) {
  const titles = {
    1: ["Step 1 of 8 · Panel channel", "Where the ticket panel is posted."],
    2: ["Step 2 of 8 · Ticket category", "New tickets are created under this category."],
    3: ["Step 3 of 8 · Log channel", "Optional. Open/close transcripts go here. You can skip."],
    4: ["Step 4 of 8 · Staff roles", "These roles can see and close tickets."],
    5: ["Step 5 of 8 · Panel message", "Panel embed shown in the channel. Press **Variables** for placeholders."],
    6: ["Step 6 of 8 · Ticket greeting", "Posted inside each new ticket. Press **Variables** for the full list."],
    7: ["Step 7 of 8 · Buttons or menu", "Pick a type, then add options. Emoji: ID, :name:, or unicode."],
    8: ["Step 8 of 8 · Publish", "Review and post (or update) the panel."],
  };
  const [title, hint] = titles[step] || titles[1];
  const embed = new EmbedBuilder()
    .setColor(panel.color || COLOR)
    .setTitle(title)
    .setDescription(`${hint}\n\n${summary(panel)}`);

  const rows = [];
  if (step === 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`tsb:tix:send:${panel.name}`)
        .setPlaceholder("Channel for the panel")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    ));
  }
  if (step === 2) {
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`tsb:tix:cat:${panel.name}`)
        .setPlaceholder("Category for new tickets")
        .addChannelTypes(ChannelType.GuildCategory)
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tsb:tix:makecat:${panel.name}`).setLabel("Create Tickets category").setStyle(ButtonStyle.Primary)
    ));
  }
  if (step === 3) {
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`tsb:tix:audit:${panel.name}`)
        .setPlaceholder("Log channel (optional)")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tsb:tix:skipaudit:${panel.name}`).setLabel("Skip logs").setStyle(ButtonStyle.Secondary)
    ));
  }
  if (step === 4) {
    rows.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`tsb:tix:staff:${panel.name}`)
        .setPlaceholder("Staff roles")
        .setMinValues(0)
        .setMaxValues(25)
    ));
  }
  if (step === 5) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tsb:tix:edit:${panel.name}`).setLabel("Edit text").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`tsb:tix:color:${panel.name}`).setLabel("Color").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tsb:tix:vars:${panel.name}`).setLabel("Variables").setStyle(ButtonStyle.Secondary)
    ));
  }
  if (step === 6) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tsb:tix:tickettxt:${panel.name}`).setLabel("Edit greeting").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`tsb:tix:vars:${panel.name}`).setLabel("Variables").setStyle(ButtonStyle.Secondary)
    ));
  }
  if (step === 7) {
    if (!panel.componentMode) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tsb:tix:mode:dd:${panel.name}`).setLabel("Dropdown menu").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tsb:tix:mode:btn:${panel.name}`).setLabel("Buttons").setStyle(ButtonStyle.Success)
      ));
    } else {
      const ops = [
        new ButtonBuilder().setCustomId(`tsb:tix:additem:${panel.name}`).setLabel("Add option").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tsb:tix:clearitems:${panel.name}`).setLabel("Clear options").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`tsb:tix:modereset:${panel.name}`).setLabel("Change type").setStyle(ButtonStyle.Secondary),
      ];
      if (panel.componentMode === "dropdown") {
        ops.unshift(
          new ButtonBuilder().setCustomId(`tsb:tix:editmenu:${panel.name}`).setLabel("Menu text").setStyle(ButtonStyle.Secondary)
        );
      }
      rows.push(new ActionRowBuilder().addComponents(ops.slice(0, 5)));
      const items = itemsOf(panel);
      if (items.length) {
        rows.push(new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`tsb:tix:rm:${panel.name}`)
            .setPlaceholder("Remove an option")
            .addOptions(items.slice(0, 25).map((item, index) => ({
              label: `Remove: ${item.label}`.slice(0, 100),
              value: String(index),
            })))
        ));
      }
    }
  }

  rows.push(wizardNav(panel, step));

  const embeds = [embed];
  if (step === 5 || step === 8) embeds.push(panelEmbed(panel));
  if (step === 6 || step === 8) embeds.push(ticketInsideEmbed(panel));
  if (step === 7) {
    const items = itemsOf(panel);
    embeds.push(
      new EmbedBuilder()
        .setColor(panel.color || COLOR)
        .setTitle(panel.componentMode === "dropdown" ? "Dropdown" : panel.componentMode === "buttons" ? "Buttons" : "Choose a type")
        .setDescription(
          items.length
            ? items.map((item, i) => {
              const emojiLabel = item.emoji ? `${formatEmojiLabel(item.emoji, guild)} ` : "";
              return `> ${i + 1}. ${emojiLabel}**${item.label}**${item.description ? ` — ${item.description}` : ""}`;
            }).join("\n")
            : "> No options yet. Add Support, Appeals, or anything you need."
        )
    );
  }
  return { embeds, components: rows };
}

function field(id, label, style, value, max, required = false) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(String(label).slice(0, 45))
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(Math.min(max, style === TextInputStyle.Short ? 400 : 4000));
  if (value) input.setValue(String(value).slice(0, Math.min(max, 4000)));
  return input;
}

function createModal() {
  return new ModalBuilder()
    .setCustomId("tsb:tix:modal:create")
    .setTitle("Create ticket panel")
    .addComponents(new ActionRowBuilder().addComponents(field("name", "Panel name (id)", TextInputStyle.Short, "support", 32, true)));
}

function editModal(panel) {
  return new ModalBuilder()
    .setCustomId(`tsb:tix:modal:edit:${panel.name}`)
    .setTitle("Panel message")
    .addComponents(
      new ActionRowBuilder().addComponents(field("title", "Title", TextInputStyle.Short, panel.title, 256)),
      new ActionRowBuilder().addComponents(field("body", "Body", TextInputStyle.Paragraph, panel.body, 4000)),
      new ActionRowBuilder().addComponents(field("footer", "Footer", TextInputStyle.Short, panel.footer, 256)),
      new ActionRowBuilder().addComponents(field("image", "Image URL", TextInputStyle.Short, panel.image, 400)),
      new ActionRowBuilder().addComponents(field("thumbnail", "Thumbnail URL", TextInputStyle.Short, panel.thumbnail, 400))
    );
}

function ticketModal(panel) {
  const bodyInput = field(
    "ticket_body",
    "Body inside the ticket",
    TextInputStyle.Paragraph,
    panel.ticketBody,
    4000
  );
  bodyInput.setPlaceholder("Hey {user} — {reason} · vars: {staff} {paneltitle} {date}");
  return new ModalBuilder()
    .setCustomId(`tsb:tix:modal:ticket:${panel.name}`)
    .setTitle("Ticket greeting")
    .addComponents(
      new ActionRowBuilder().addComponents(field("ticket_title", "Title inside the ticket", TextInputStyle.Short, panel.ticketTitle, 256)),
      new ActionRowBuilder().addComponents(bodyInput)
    );
}

function colorModal(panel) {
  return new ModalBuilder()
    .setCustomId(`tsb:tix:modal:color:${panel.name}`)
    .setTitle("Panel color")
    .addComponents(new ActionRowBuilder().addComponents(field("color", "HEX (#5865F2)", TextInputStyle.Short, colorHex(panel.color), 10, true)));
}

function itemModal(name) {
  const emojiInput = field("emoji", "Emoji (ID, :name:, unicode)", TextInputStyle.Short, "", 80);
  emojiInput.setPlaceholder("e.g. 1423781348568727705 or :support:");
  return new ModalBuilder()
    .setCustomId(`tsb:tix:modal:item:${name}`)
    .setTitle("Add option")
    .addComponents(
      new ActionRowBuilder().addComponents(field("label", "Label", TextInputStyle.Short, "", 80, true)),
      new ActionRowBuilder().addComponents(field("description", "Description (dropdown)", TextInputStyle.Short, "Open a ticket", 100)),
      new ActionRowBuilder().addComponents(emojiInput),
      new ActionRowBuilder().addComponents(field("style", "Button color: blue gray green red", TextInputStyle.Short, "blue", 12))
    );
}

function importModal() {
  return new ModalBuilder()
    .setCustomId("tsb:tix:modal:import")
    .setTitle("Import panel")
    .addComponents(new ActionRowBuilder().addComponents(field("link", "Message link", TextInputStyle.Paragraph, "", 200, true)));
}

function menuModal(panel) {
  return new ModalBuilder()
    .setCustomId(`tsb:tix:modal:menu:${panel.name}`)
    .setTitle("Dropdown text")
    .addComponents(new ActionRowBuilder().addComponents(field("placeholder", "Placeholder", TextInputStyle.Short, panel.dropdownPlaceholder, 150)));
}

async function sendAudit(guild, panel, options) {
  if (!panel?.auditLogChannelId) return;
  const channel = await guild.channels.fetch(panel.auditLogChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const payload = {
    embeds: options.embeds?.length
      ? options.embeds
      : [
        new EmbedBuilder()
          .setColor(options.color || COLOR)
          .setTitle(options.title || "Tickets")
          .setDescription((options.description || "").slice(0, 4096))
          .addFields((options.fields || []).slice(0, 25))
          .setTimestamp(),
      ],
  };
  if (options.files?.length) payload.files = options.files;
  await channel.send(payload).catch(() => {});
}

async function ensureCategory(guild, panel) {
  if (panel.categoryId) {
    const existing = await guild.channels.fetch(panel.categoryId).catch(() => null);
    if (existing?.type === ChannelType.GuildCategory) return existing;
  }
  const found = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && /^tickets$/i.test(ch.name)
  );
  if (found) return found;
  return guild.channels.create({
    name: "Tickets",
    type: ChannelType.GuildCategory,
    reason: "Ticket category",
  });
}

async function openTicket(interaction, panel, item) {
  const reason = typeof item === "string" ? item : item?.label || "";
  let categoryId = panel.categoryId;
  if (!categoryId) {
    const category = await ensureCategory(interaction.guild, panel);
    categoryId = category?.id;
    if (categoryId && categoryId !== panel.categoryId) {
      panel.categoryId = categoryId;
      savePanel(interaction.guildId, panel);
    }
  }
  if (!categoryId) {
    return interaction.reply({ content: "This panel has no ticket category. Run `/ticketsetup`.", ephemeral: true });
  }

  const existing = interaction.guild.channels.cache.find(
    (channel) => channel.topic === `ticket:${panel.name}:${interaction.user.id}`
  );
  if (existing) {
    return interaction.reply({ content: `You already have a ticket: ${existing}`, ephemeral: true });
  }

  const overwrites = [
    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
      ],
    },
    {
      id: interaction.client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
  ];
  for (const roleId of staffIds(panel)) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    });
  }

  const name = `ticket-${interaction.user.username}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 90);
  const channel = await interaction.guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: categoryId,
    topic: `ticket:${panel.name}:${interaction.user.id}`,
    permissionOverwrites: overwrites,
  });

  const ctx = {
    user: interaction.user,
    member: interaction.member,
    guild: interaction.guild,
    channel,
    reason: reason || "",
    staff: staffMentions(panel),
    panelName: panel.name,
    panelTitle: panel.title || panel.name,
    openedAt: new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
    now: new Date(),
  };

  await channel.send({
    content: applyVars(`{user}${staffIds(panel).length ? " | {staff}" : ""}`, ctx),
    embeds: [ticketInsideEmbed(panel, ctx)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tsb:tix:claim:${panel.name}`).setLabel("Claim").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tsb:tix:close:${panel.name}`).setLabel("Close ticket").setStyle(ButtonStyle.Danger)
      ),
    ],
  });

  await interaction.reply({ content: `Ticket opened: ${channel}`, ephemeral: true });
  await sendAudit(interaction.guild, panel, {
    title: "Ticket opened",
    color: 0x57f287,
    description: `Opened in ${channel}.`,
    fields: [
      { name: "User", value: `${interaction.user} \`${interaction.user.id}\``, inline: true },
      { name: "Panel", value: `\`${panel.name}\``, inline: true },
      { name: "Reason", value: reason || "button", inline: true },
    ],
  });
}

async function publishPanel(guild, panel) {
  if (!panel.sendChannelId) return { error: "Pick the panel channel in step 1." };
  const channel = await guild.channels.fetch(panel.sendChannelId).catch(() => null);
  if (!channel?.isTextBased()) return { error: "Panel channel is invalid." };
  if (guild?.emojis?.fetch) {
    for (const item of itemsOf(panel)) {
      const parsed = parseEmojiInput(item.emoji);
      if (parsed?.id) await guild.emojis.fetch(parsed.id).catch(() => null);
    }
  }
  const ctx = { guild, panelName: panel.name, panelTitle: panel.title || panel.name };
  const payload = { embeds: [panelEmbed(panel, ctx)], components: panelComponents(panel, ctx) };
  if (panel.messageId) {
    const existing = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return { channel, updated: true };
    }
  }
  const sent = await channel.send(payload);
  panel.messageId = sent.id;
  savePanel(guild.id, panel);
  return { channel, updated: false };
}

function parseMessageLink(input, fallbackChannelId) {
  const text = String(input || "").trim();
  const match = text.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (match) return { channelId: match[2], messageId: match[3] };
  const idOnly = text.match(/^(\d{17,20})$/);
  if (idOnly && fallbackChannelId) return { channelId: fallbackChannelId, messageId: idOnly[1] };
  return null;
}

async function importFromLink(interaction, raw) {
  const parsed = parseMessageLink(raw, interaction.channel.id);
  if (!parsed) {
    return interaction.reply({ content: "Paste a Discord message link.", ephemeral: true });
  }
  const channel = await interaction.guild.channels.fetch(parsed.channelId).catch(() => null);
  const message = channel ? await channel.messages.fetch(parsed.messageId).catch(() => null) : null;
  if (!message) return interaction.reply({ content: "Could not fetch that message.", ephemeral: true });
  const embed = message.embeds[0];
  let name = slug(embed?.title || "tickets");
  if (getPanel(interaction.guildId, name)) name = slug(`${name}-${Date.now().toString(36)}`);
  const panel = emptyPanel(name);
  if (embed) {
    panel.title = embed.title || panel.title;
    panel.body = embed.description || panel.body;
    panel.color = embed.color || panel.color;
    panel.footer = embed.footer?.text || "";
    panel.thumbnail = embed.thumbnail?.url || "";
    panel.image = embed.image?.url || "";
  }
  panel.sendChannelId = channel.id;
  savePanel(interaction.guildId, panel);
  return interaction.update(wizardPayload(panel, 1, interaction.guild));
}

async function closeTicket(interaction, panel) {
  const topic = interaction.channel.topic || "";
  if (!topic.startsWith("ticket:")) {
    return interaction.reply({ content: "This is not a ticket channel.", ephemeral: true });
  }
  const openerId = topic.split(":")[2];
  const allowed =
    interaction.user.id === openerId
    || staffIds(panel || {}).some((id) => interaction.member.roles.cache.has(id))
    || canSetup(interaction.member);
  if (!allowed) {
    return interaction.reply({ content: "You can't close this ticket.", ephemeral: true });
  }

  await interaction.reply("Closing this ticket — saving transcript…");
  const history = await buildTicketTranscript(interaction.channel, {
    openerId,
    closedById: interaction.user.id,
    panelName: panel?.name,
  }).catch(() => null);
  if (panel) {
    await sendAudit(interaction.guild, panel, {
      embeds: [
        transcriptAuditEmbed({
          channel: interaction.channel,
          closedBy: interaction.user,
          openerId,
          panelName: panel.name,
          history: history || { count: 0, participants: [], duration: "—" },
        }),
      ],
      files: history?.file ? [history.file] : [],
    });
  }
  setTimeout(() => interaction.channel.delete("Ticket closed").catch(() => {}), 4000);
}

function denySetup(interaction) {
  interaction.reply({ content: "You need **Manage Server** to set up tickets.", ephemeral: true }).catch(() => {});
}

function isMemberAction(id) {
  return id.startsWith("tsb:tix:open:")
    || id.startsWith("tsb:tix:dd:")
    || id.startsWith("tsb:tix:close:")
    || id.startsWith("tsb:tix:claim:");
}

async function handleTickets(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("tsb:tix:")) return false;

  if (interaction.isButton() && id.startsWith("tsb:tix:open:")) {
    const [, , , name, index] = id.split(":");
    const panel = getPanel(interaction.guildId, name);
    if (!panel) return interaction.reply({ content: "This panel no longer exists.", ephemeral: true });
    await openTicket(interaction, panel, itemsOf(panel)[Number(index)]);
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:close:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[3]);
    await closeTicket(interaction, panel);
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:claim:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[3]);
    if (!panel) return interaction.reply({ content: "Panel missing.", ephemeral: true });
    const ok = staffIds(panel).some((rid) => interaction.member.roles.cache.has(rid)) || canSetup(interaction.member);
    if (!ok) return interaction.reply({ content: "Only staff can claim.", ephemeral: true });
    await interaction.reply(`${interaction.user} claimed this ticket.`);
    return true;
  }
  if (interaction.isStringSelectMenu() && id.startsWith("tsb:tix:dd:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[3]);
    if (!panel) return interaction.reply({ content: "This panel no longer exists.", ephemeral: true });
    await openTicket(interaction, panel, itemsOf(panel)[Number(interaction.values[0])]);
    return true;
  }

  if (!isMemberAction(id) && !canSetup(interaction.member)) {
    denySetup(interaction);
    return true;
  }

  if (interaction.isButton() && id === "tsb:tix:home") {
    await interaction.update(homePayload(interaction.guildId));
    return true;
  }
  if (interaction.isButton() && id === "tsb:tix:create") {
    await interaction.showModal(createModal());
    return true;
  }
  if (interaction.isButton() && id === "tsb:tix:import") {
    await interaction.showModal(importModal());
    return true;
  }
  if (interaction.isButton() && id === "tsb:tix:republish_all") {
    const panels = listPanels(interaction.guildId).filter((p) => p.sendChannelId);
    if (!panels.length) {
      return interaction.reply({ content: "No panels are posted yet.", ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const lines = [];
    for (const panel of panels) {
      const result = await publishPanel(interaction.guild, panel);
      lines.push(result.error
        ? `• \`${panel.name}\` — ${result.error}`
        : `• \`${panel.name}\` ${result.updated ? "updated" : "posted"} in ${result.channel}`);
    }
    await interaction.editReply({ content: `**Republished ${panels.length} panel(s)**\n${lines.join("\n")}` });
    return true;
  }
  if (interaction.isStringSelectMenu() && id === "tsb:tix:republish_one") {
    const panel = getPanel(interaction.guildId, interaction.values[0]);
    if (!panel) return interaction.reply({ content: "Panel missing.", ephemeral: true });
    const result = await publishPanel(interaction.guild, panel);
    if (result.error) return interaction.reply({ content: result.error, ephemeral: true });
    await interaction.reply({
      content: `Panel **${panel.title || panel.name}** ${result.updated ? "updated" : "posted"} in ${result.channel}.`,
      ephemeral: true,
    });
    return true;
  }
  if (interaction.isStringSelectMenu() && id === "tsb:tix:pick") {
    const panel = getPanel(interaction.guildId, interaction.values[0]);
    if (!panel) return interaction.reply({ content: "That panel is gone.", ephemeral: true });
    await interaction.update(wizardPayload(panel, 1, interaction.guild));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:next:")) {
    const [, , , name, stepText] = id.split(":");
    const panel = getPanel(interaction.guildId, name);
    if (!panel) return interaction.reply({ content: "Panel missing.", ephemeral: true });
    await interaction.update(wizardPayload(panel, Math.min(LAST_STEP, Number(stepText) + 1), interaction.guild));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:back:")) {
    const [, , , name, stepText] = id.split(":");
    const step = Number(stepText);
    if (step <= 1) {
      await interaction.update(homePayload(interaction.guildId));
      return true;
    }
    const panel = getPanel(interaction.guildId, name);
    if (!panel) return interaction.reply({ content: "Panel missing.", ephemeral: true });
    await interaction.update(wizardPayload(panel, step - 1, interaction.guild));
    return true;
  }

  if (interaction.isChannelSelectMenu() && id.startsWith("tsb:tix:")) {
    const kind = id.split(":")[2];
    const name = id.split(":")[3];
    const panel = getPanel(interaction.guildId, name);
    if (!panel) return interaction.reply({ content: "Panel missing.", ephemeral: true });
    const channelId = interaction.values[0];
    let step = 1;
    if (kind === "send") {
      if (panel.sendChannelId !== channelId) panel.messageId = null;
      panel.sendChannelId = channelId;
      step = 1;
    }
    if (kind === "cat") {
      panel.categoryId = channelId;
      step = 2;
    }
    if (kind === "audit") {
      panel.auditLogChannelId = channelId;
      step = 3;
    }
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, step, interaction.guild));
    return true;
  }

  if (interaction.isRoleSelectMenu() && id.startsWith("tsb:tix:staff:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[3]);
    if (!panel) return interaction.reply({ content: "Panel missing.", ephemeral: true });
    panel.staffRoleIds = interaction.values;
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 4, interaction.guild));
    return true;
  }

  if (interaction.isButton() && id.startsWith("tsb:tix:makecat:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[3]);
    const category = await ensureCategory(interaction.guild, panel);
    panel.categoryId = category.id;
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 2, interaction.guild));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:skipaudit:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[3]);
    panel.auditLogChannelId = null;
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 3, interaction.guild));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:mode:dd:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[4]);
    panel.componentMode = "dropdown";
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 7, interaction.guild));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:mode:btn:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[4]);
    panel.componentMode = "buttons";
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 7, interaction.guild));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:modereset:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[3]);
    panel.componentMode = null;
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 7, interaction.guild));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:additem:")) {
    await interaction.showModal(itemModal(id.split(":")[3]));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:clearitems:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[3]);
    panel.items = [];
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 7, interaction.guild));
    return true;
  }
  if (interaction.isStringSelectMenu() && id.startsWith("tsb:tix:rm:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[3]);
    panel.items.splice(Number(interaction.values[0]), 1);
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 7, interaction.guild));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:edit:")) {
    await interaction.showModal(editModal(getPanel(interaction.guildId, id.split(":")[3])));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:color:")) {
    await interaction.showModal(colorModal(getPanel(interaction.guildId, id.split(":")[3])));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:tickettxt:")) {
    await interaction.showModal(ticketModal(getPanel(interaction.guildId, id.split(":")[3])));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:vars:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[3]);
    await interaction.reply({
      ...ticketVariablesHelpEmbed(panel?.color || COLOR),
      ephemeral: true,
    });
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:editmenu:")) {
    await interaction.showModal(menuModal(getPanel(interaction.guildId, id.split(":")[3])));
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:preview:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[3]);
    if (!panel) return interaction.reply({ content: "Panel missing.", ephemeral: true });
    const ctx = { guild: interaction.guild, panelName: panel.name, panelTitle: panel.title || panel.name, user: interaction.user };
    await interaction.reply({
      content: "Live preview (same embed + buttons/menu members will see):",
      embeds: [panelEmbed(panel, ctx)],
      components: panelComponents(panel, ctx),
      ephemeral: true,
    });
    return true;
  }
  if (interaction.isButton() && id.startsWith("tsb:tix:post:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[3]);
    const result = await publishPanel(interaction.guild, panel);
    if (result.error) return interaction.reply({ content: result.error, ephemeral: true });
    await interaction.reply({
      content: `Panel ${result.updated ? "updated" : "posted"} in ${result.channel}.`,
      ephemeral: true,
    });
    await interaction.message.delete().catch(() => {});
    return true;
  }

  if (interaction.isModalSubmit() && id === "tsb:tix:modal:create") {
    const name = slug(interaction.fields.getTextInputValue("name"));
    if (getPanel(interaction.guildId, name)) {
      return interaction.reply({ content: `Panel \`${name}\` already exists.`, ephemeral: true });
    }
    const panel = savePanel(interaction.guildId, emptyPanel(name));
    await interaction.reply({ ...wizardPayload(panel, 1, interaction.guild), ephemeral: true });
    return true;
  }
  if (interaction.isModalSubmit() && id === "tsb:tix:modal:import") {
    await importFromLink(interaction, interaction.fields.getTextInputValue("link"));
    return true;
  }
  if (interaction.isModalSubmit() && id.startsWith("tsb:tix:modal:edit:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[4]);
    panel.title = interaction.fields.getTextInputValue("title") || panel.title;
    panel.body = interaction.fields.getTextInputValue("body") || panel.body;
    panel.footer = interaction.fields.getTextInputValue("footer");
    panel.image = interaction.fields.getTextInputValue("image");
    panel.thumbnail = interaction.fields.getTextInputValue("thumbnail");
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 5, interaction.guild));
    return true;
  }
  if (interaction.isModalSubmit() && id.startsWith("tsb:tix:modal:ticket:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[4]);
    panel.ticketTitle = interaction.fields.getTextInputValue("ticket_title") || panel.ticketTitle;
    panel.ticketBody = interaction.fields.getTextInputValue("ticket_body") || panel.ticketBody;
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 6, interaction.guild));
    return true;
  }
  if (interaction.isModalSubmit() && id.startsWith("tsb:tix:modal:color:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[4]);
    panel.color = parseColor(interaction.fields.getTextInputValue("color"));
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 5, interaction.guild));
    return true;
  }
  if (interaction.isModalSubmit() && id.startsWith("tsb:tix:modal:menu:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[4]);
    panel.dropdownPlaceholder = interaction.fields.getTextInputValue("placeholder") || panel.dropdownPlaceholder;
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 7, interaction.guild));
    return true;
  }
  if (interaction.isModalSubmit() && id.startsWith("tsb:tix:modal:item:")) {
    const panel = getPanel(interaction.guildId, id.split(":")[4]);
    if (itemsOf(panel).length >= 25) {
      return interaction.reply({ content: "Max 25 options.", ephemeral: true });
    }
    const styleRaw = String(interaction.fields.getTextInputValue("style") || "blue").toLowerCase();
    const style = ["blue", "gray", "green", "red"].includes(styleRaw) ? styleRaw : "blue";
    const emojiRaw = interaction.fields.getTextInputValue("emoji") || "";
    const emoji = emojiRaw ? await resolveEmojiStorage(emojiRaw, interaction.guild) : "";
    panel.items = itemsOf(panel);
    panel.items.push({
      label: interaction.fields.getTextInputValue("label"),
      description: interaction.fields.getTextInputValue("description") || "Open a ticket",
      emoji,
      style,
    });
    savePanel(interaction.guildId, panel);
    await interaction.update(wizardPayload(panel, 7, interaction.guild));
    return true;
  }

  return false;
}

module.exports = {
  homePayload,
  handleTickets,
  canSetup,
  publishPanel,
};
