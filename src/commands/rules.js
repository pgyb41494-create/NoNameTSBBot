const fs = require("fs");
const path = require("path");
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder,
} = require("discord.js");
const { surface } = require("../utils/embeds");
const {
  tsblSection,
  tsblSectionKeys,
  tsblPack,
  TSBL,
} = require("../../api/coach/tsblRules");

const SELECT_PREFIX = "tsbl_rules_sec:";
const BORDERS_IMAGE = path.join(__dirname, "..", "..", "assets", "rules", "gladiator-borders.png");

function sectionBody(section) {
  return section.items.join("\n\n").slice(0, 3900);
}

function rulesPayload(sectionKey = "overview") {
  const pack = tsblPack("en");
  const section = tsblSection(sectionKey, "en");
  const hasImage = section.image && fs.existsSync(BORDERS_IMAGE);
  const imageName = section.image || "gladiator-borders.png";

  const payload = {
    embeds: [
      surface({
        title: `${TSBL.name} · ${section.title}`,
        description: `${sectionBody(section)}\n\n${pack.ui.askHint}`,
        image: hasImage ? `attachment://${imageName}` : undefined,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${SELECT_PREFIX}en`)
          .setPlaceholder(pack.ui.pick)
          .addOptions(
            tsblSectionKeys().map((key) => ({
              label: tsblSection(key, "en").title.slice(0, 100),
              value: key,
              default: key === sectionKey,
            }))
          )
      ),
    ],
  };

  if (hasImage) {
    payload.files = [new AttachmentBuilder(BORDERS_IMAGE, { name: imageName })];
  } else {
    payload.files = [];
  }

  return payload;
}

module.exports = {
  name: "rules",
  aliases: ["tsbccrules", "tsblrules", "1v1rules", "reglas", "gladiators", "5v5rules"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("rules")
      .setDescription("Official TSBCC rules")
      .addStringOption((o) =>
        o
          .setName("section")
          .setDescription("Section")
          .addChoices(
            { name: "Overview", value: "overview" },
            { name: "About TSBCC", value: "about" },
            { name: "Blacklist", value: "blacklist" },
            { name: "Blacklist (cont.)", value: "blacklist2" },
            { name: "Bail", value: "bail" },
            { name: "Clan verification", value: "verification" },
            { name: "War rights", value: "wars" },
            { name: "5v5 Gladiators", value: "gladiators" },
            { name: "5v5 In-match", value: "gladiators2" },
            { name: "5v5 Borders", value: "borders" },
            { name: "OCW Regions", value: "ocw" },
            { name: "FAQ", value: "faq" },
            { name: "Links", value: "links" }
          )
      ),

  async executePrefix(message, args) {
    return message.reply(rulesPayload(normalizeSection(args.join(" "))));
  },

  async executeSlash(interaction) {
    const section = interaction.options.getString("section") || "overview";
    return interaction.reply(rulesPayload(section));
  },
};

function normalizeSection(raw) {
  const t = String(raw || "").toLowerCase();
  if (/link|invite|vanity|advertise|ticket|register|promote|agent/.test(t)) return "links";
  if (/about|tsbcc is|community|founded|vanity/.test(t)) return "about";
  if (/bail/.test(t)) return "bail";
  if (/verif|clan apply|100 member/.test(t)) return "verification";
  if (/faq|question/.test(t)) return "faq";
  if (/border|red line|black border|arena map/.test(t)) return "borders";
  if (/ocw|open.?clan.?war|central server|split.*(region|server)/.test(t)) return "ocw";
  if (/within|in.?match|awakening|trashcan|m1 reset|backdash|sneak|spectator|referee|garou|saitama|metal bat/.test(t)) {
    return "gladiators2";
  }
  if (/glad|5\s*v\s*5|challeng|subs?|clanless|ally|alt/.test(t)) return "gladiators";
  if (/war|dodge|range|top 10/.test(t)) return "wars";
  if (/blacklist|dox|nuke|scam|nsfw|alt/.test(t)) return "blacklist";
  return "overview";
}

async function handleRulesInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(SELECT_PREFIX)) {
    await interaction.update(rulesPayload(interaction.values[0]));
    return true;
  }
  return false;
}

module.exports.handleRulesInteraction = handleRulesInteraction;
