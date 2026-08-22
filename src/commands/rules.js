const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const { surface } = require("../utils/embeds");
const {
  tsblSection,
  tsblSectionKeys,
  tsblPack,
  TSBL,
} = require("../../api/coach/tsblRules");

const SELECT_PREFIX = "tsbl_rules_sec:";

function sectionBody(section) {
  return section.items.join("\n\n").slice(0, 3900);
}

function rulesPayload(sectionKey = "overview") {
  const pack = tsblPack("en");
  const section = tsblSection(sectionKey, "en");
  return {
    embeds: [
      surface({
        title: `${TSBL.name} · ${section.title}`,
        description: `${sectionBody(section)}\n\n${pack.ui.askHint}`,
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
}

module.exports = {
  name: "rules",
  aliases: ["tsbccrules", "tsblrules", "1v1rules", "reglas"],
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
  if (/war|challenge|dodge|range|top 10/.test(t)) return "wars";
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
