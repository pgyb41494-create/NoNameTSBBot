const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const api = require("../../../utils/loadApi");
const { hasMod } = require("../../../utils/permissions");
const { danger } = require("../../../utils/embeds");
const { parseEmoji } = require("../shared/parseEmoji");

function canSendPanel(member) {
  return hasMod(member, PermissionFlagsBits.ManageMessages);
}

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.panels)) return data.panels;
  if (data && typeof data === "object") {
    return Object.entries(data)
      .filter(([, panel]) => panel && typeof panel === "object" && !Array.isArray(panel))
      .map(([key, panel]) => ({ ...panel, key: panel.key || key }));
  }
  return [];
}

function localPanelStore() {
  try {
    return require("./store");
  } catch {
    return null;
  }
}

async function fetchRemotePanels(guildId) {
  const listed = [];
  if (typeof api.panels?.list === "function") {
    try {
      listed.push(...normalizeList(await api.panels.list(guildId)));
    } catch {}
  }
  if (!listed.length && typeof api.panels?.map === "function") {
    try {
      listed.push(...normalizeList(await api.panels.map(guildId)));
    } catch {}
  }
  return listed.filter((p) => p && p.key);
}

async function listPanels(guildId) {
  const local = localPanelStore();
  const localList = local ? local.list(guildId) : [];
  const remote = await fetchRemotePanels(guildId);
  if (remote.length) {
    if (local?.replaceAll) {
      try {
        local.replaceAll(guildId, { panels: remote });
      } catch {}
    }
    return remote;
  }
  return localList;
}

async function fetchPanel(guildId, key) {
  const local = localPanelStore();
  if (local?.get) {
    const panel = local.get(guildId, key);
    if (panel) return panel;
  }
  if (typeof api.panels?.get === "function") {
    try {
      const panel = await api.panels.get(guildId, key);
      if (panel) return panel;
    } catch {}
  }
  const listed = await listPanels(guildId);
  const want = String(key || "").toLowerCase();
  return listed.find((p) => String(p.key || "").toLowerCase() === want) || null;
}

function buttonStyle(style, action) {
  if (action === "url") return ButtonStyle.Link;
  const key = String(style || "PRIMARY").toUpperCase();
  if (key === "SECONDARY") return ButtonStyle.Secondary;
  if (key === "SUCCESS") return ButtonStyle.Success;
  if (key === "DANGER") return ButtonStyle.Danger;
  if (key === "LINK") return ButtonStyle.Link;
  return ButtonStyle.Primary;
}

function panelMessage(guildId, panel, key, guild = null) {
  const embed = new EmbedBuilder();
  if (panel.title) embed.setTitle(String(panel.title).slice(0, 256));
  if (panel.description) embed.setDescription(String(panel.description).slice(0, 4096));
  else if (!panel.title && !panel.image && !panel.thumbnail) embed.setDescription("\u200b");
  try {
    if (panel.color) embed.setColor(panel.color);
  } catch {}
  if (panel.footer) embed.setFooter({ text: String(panel.footer).slice(0, 2048) });
  if (panel.thumbnail) embed.setThumbnail(String(panel.thumbnail));
  if (panel.image) embed.setImage(String(panel.image));

  const rows = [];
  let row = new ActionRowBuilder();
  const buttons = Array.isArray(panel.buttons) ? panel.buttons : [];
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (!b) continue;
    const action = b.action || (b.url ? "url" : "role");
    const style = buttonStyle(b.style, action);
    const btn = new ButtonBuilder().setLabel(String(b.label || "Button").slice(0, 80)).setStyle(style);
    if (style === ButtonStyle.Link) {
      btn.setURL(String(b.url || "https://example.com").trim() || "https://example.com");
    } else {
      btn.setCustomId(`panel_btn_${guildId}_${key}_${i}`);
    }
    if (b.emoji) {
      const emoji = parseEmoji(b.emoji, guild);
      if (emoji) btn.setEmoji(emoji);
    }
    row.addComponents(btn);
    if (row.components.length === 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
  }
  if (row.components.length) rows.push(row);
  return { embeds: [embed], components: rows };
}

async function sendPanel(channel, guildId, panel, key) {
  return channel.send(panelMessage(guildId, panel, key || panel.key, channel.guild));
}

function parseCustomId(customId) {
  const raw = customId.startsWith("panel_btn_")
    ? customId.slice("panel_btn_".length)
    : customId.startsWith("pannel_btn_")
      ? customId.slice("pannel_btn_".length)
      : null;
  if (!raw) return null;
  const firstSep = raw.indexOf("_");
  if (firstSep === -1) return null;
  const guildId = raw.slice(0, firstSep);
  const rest = raw.slice(firstSep + 1);
  const lastSep = rest.lastIndexOf("_");
  if (lastSep === -1) return null;
  return {
    guildId,
    key: rest.slice(0, lastSep),
    idx: parseInt(rest.slice(lastSep + 1), 10),
  };
}

function isTextChannel(channel) {
  return (
    channel &&
    (channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement ||
      channel.isTextBased?.())
  );
}

async function handlePanelButton(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("panel_btn_") && !id.startsWith("pannel_btn_")) return false;
  try {
    const parsed = parseCustomId(id);
    if (!parsed || Number.isNaN(parsed.idx)) {
      await interaction.reply({ content: "That panel button is invalid.", ephemeral: true });
      return true;
    }
    const panel = await fetchPanel(parsed.guildId, parsed.key);
    if (!panel) {
      await interaction.reply({ content: "This panel was removed or renamed.", ephemeral: true });
      return true;
    }
    const btn = (panel.buttons || [])[parsed.idx];
    if (!btn) {
      await interaction.reply({ content: "That button is no longer on this panel.", ephemeral: true });
      return true;
    }

    if (btn.action === "reply") {
      await interaction.reply({
        content: btn.reply || `You pressed **${btn.label || "button"}**.`,
        ephemeral: true,
      });
      return true;
    }

    const roleIds = Array.isArray(btn.roleIds) && btn.roleIds.length
      ? btn.roleIds.map(String)
      : btn.roleId
        ? [String(btn.roleId)]
        : [];
    const removeRoleIds = Array.isArray(btn.removeRoleIds) && btn.removeRoleIds.length
      ? btn.removeRoleIds.map(String)
      : btn.removeRoleId
        ? [String(btn.removeRoleId)]
        : [];

    if ((btn.action === "role" || btn.action === "toggle_role") && (roleIds.length || removeRoleIds.length)) {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) {
        await interaction.reply({ content: "Could not load your member data.", ephemeral: true });
        return true;
      }
      const added = [];
      const removed = [];
      const failed = [];
      const roleMode = ["toggle", "add", "remove", "exclusive"].includes(btn.roleMode) ? btn.roleMode : "toggle";

      const tryRemove = async (rid, reason) => {
        const role = interaction.guild.roles.cache.get(rid) || (await interaction.guild.roles.fetch(rid).catch(() => null));
        if (!role) {
          failed.push(rid);
          return;
        }
        try {
          if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role.id, reason);
            removed.push(role.name);
          }
        } catch {
          failed.push(role.id);
        }
      };

      const tryAdd = async (rid, reason) => {
        const role = interaction.guild.roles.cache.get(rid) || (await interaction.guild.roles.fetch(rid).catch(() => null));
        if (!role) {
          failed.push(rid);
          return;
        }
        try {
          if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role.id, reason);
            added.push(role.name);
          }
        } catch {
          failed.push(role.id);
        }
      };

      for (const rid of removeRoleIds) await tryRemove(rid, "Panel button remove");

      if (roleMode === "exclusive") {
        for (let si = 0; si < (panel.buttons || []).length; si++) {
          if (si === parsed.idx) continue;
          const sib = panel.buttons[si];
          if (!sib || sib.action === "url" || sib.action === "reply") continue;
          if ((sib.roleMode || "toggle") !== "exclusive") continue;
          const sibRoles = Array.isArray(sib.roleIds) && sib.roleIds.length
            ? sib.roleIds
            : sib.roleId
              ? [sib.roleId]
              : [];
          for (const rid of sibRoles) {
            if (roleIds.includes(String(rid))) continue;
            await tryRemove(String(rid), "Panel exclusive swap");
          }
        }
        for (const rid of roleIds) await tryAdd(rid, "Panel exclusive select");
      } else if (roleMode === "add") {
        for (const rid of roleIds) await tryAdd(rid, "Panel button add");
      } else if (roleMode === "remove") {
        for (const rid of roleIds) await tryRemove(rid, "Panel button remove-only");
      } else {
        for (const rid of roleIds) {
          const role = interaction.guild.roles.cache.get(rid) || (await interaction.guild.roles.fetch(rid).catch(() => null));
          if (!role) {
            failed.push(rid);
            continue;
          }
          try {
            if (member.roles.cache.has(role.id)) {
              await member.roles.remove(role.id, "Panel button toggle");
              removed.push(role.name);
            } else {
              await member.roles.add(role.id, "Panel button toggle");
              added.push(role.name);
            }
          } catch {
            failed.push(role.id);
          }
        }
      }

      const parts = [];
      if (added.length) parts.push(`Added: ${added.map((n) => `**${n}**`).join(", ")}`);
      if (removed.length) parts.push(`Removed: ${removed.map((n) => `**${n}**`).join(", ")}`);
      if (failed.length) parts.push(`Failed: ${failed.length} role${failed.length === 1 ? "" : "s"}`);
      await interaction.reply({
        content: `Roles updated. ${parts.length ? parts.join(" · ") : "No role changes."}`,
        ephemeral: true,
      });
      return true;
    }

    await interaction.reply({ content: `Pressed **${btn.label || "button"}**.`, ephemeral: true });
    return true;
  } catch (err) {
    console.error("Panel button error:", err);
    try {
      await interaction.reply({ content: "That panel action failed.", ephemeral: true });
    } catch {}
    return true;
  }
}

function denied() {
  return { embeds: [danger("Missing permissions", "You need **Manage Messages** to send panels.")] };
}

module.exports = {
  canSendPanel,
  listPanels,
  fetchPanel,
  sendPanel,
  handlePanelButton,
  isTextChannel,
  denied,
};
