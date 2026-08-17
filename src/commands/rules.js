const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { surface } = require("../utils/embeds");
const {
  tsblSection,
  tsblSectionKeys,
  tsblPack,
  normalizeLang,
  TSBL,
} = require("../../api/coach/tsblRules");

const SELECT_PREFIX = "tsbl_rules_sec:";
const LANG_PREFIX = "tsbl_rules_lang:";

function rulesPayload(sectionKey = "leaderboard", lang = "en") {
  const L = normalizeLang(lang);
  const pack = tsblPack(L);
  const section = tsblSection(sectionKey, L);
  const body = section.items.map((line) => `• ${line}`).join("\n");
  return {
    embeds: [
      surface({
        title: `TSBCC · ${section.title}`,
        description: `${TSBL.name}\n\n${body}\n\n${pack.ui.askHint}`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${SELECT_PREFIX}${L}`)
          .setPlaceholder(pack.ui.pick)
          .addOptions(
            tsblSectionKeys().map((key) => ({
              label: tsblSection(key, L).title,
              value: key,
              default: key === sectionKey,
            }))
          )
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${LANG_PREFIX}es:${sectionKey}`)
          .setLabel("Spanish")
          .setStyle(L === "es" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`${LANG_PREFIX}en:${sectionKey}`)
          .setLabel("English")
          .setStyle(L === "en" ? ButtonStyle.Primary : ButtonStyle.Secondary)
      ),
    ],
  };
}

module.exports = {
  name: "rules",
  aliases: ["tsblrules", "1v1rules", "reglas"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("rules")
      .setDescription("Official TSBCC / LATAM rules")
      .addStringOption((o) =>
        o
          .setName("section")
          .setDescription("Section")
          .addChoices(
            { name: "Leaderboard", value: "leaderboard" },
            { name: "Fair play", value: "fairplay" },
            { name: "Match conduct / 1v1", value: "conduct" },
            { name: "Tryouts", value: "tryouts" },
            { name: "Phases", value: "phases" },
            { name: "Clans", value: "clans" },
            { name: "Gladiators", value: "glads" },
            { name: "Autowin strikes", value: "autowin" }
          )
      )
      .addStringOption((o) =>
        o
          .setName("lang")
          .setDescription("Language")
          .addChoices(
            { name: "English", value: "en" },
            { name: "Spanish", value: "es" }
          )
      ),

  async executePrefix(message, args) {
    const { section, lang } = parseRulesArgs(args);
    return message.reply(rulesPayload(section, lang));
  },

  async executeSlash(interaction) {
    const section = interaction.options.getString("section") || "leaderboard";
    const lang = interaction.options.getString("lang") || "en";
    return interaction.reply(rulesPayload(section, lang));
  },
};

function parseRulesArgs(args) {
  const raw = args.join(" ").trim().toLowerCase();
  let lang = "en";
  let rest = raw;
  if (/^(en|english|inglés|ingles)\b/.test(raw)) {
    lang = "en";
    rest = raw.replace(/^(en|english|inglés|ingles)\s*/i, "");
  } else if (/^(es|español|espanol|spanish)\b/.test(raw)) {
    lang = "es";
    rest = raw.replace(/^(es|español|espanol|spanish)\s*/i, "");
  }
  return { section: normalizeSection(rest), lang };
}

function normalizeSection(raw) {
  const t = String(raw || "").toLowerCase();
  if (/clan|tag|roster|registro/.test(t)) return "clans";
  if (/glad|gladiator|3v3|7v7|ping/.test(t)) return "glads";
  if (/autowin|strike|clumsy|suspen/.test(t)) return "autowin";
  if (/fair|fflag|blox|macro|exploit|fps|cliente|trampas/.test(t)) return "fairplay";
  if (/conduct|passive|run|character|ultimate|1v1|pasiv|correr|personaje/.test(t)) return "conduct";
  if (/tryout|host|ft3|ft5/.test(t)) return "tryouts";
  if (/phase|tier|stage|rank|fase|fases/.test(t)) return "phases";
  if (/board|cooldown|challenge|spot|reto|leaderboard/.test(t)) return "leaderboard";
  return "leaderboard";
}

async function handleRulesInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(SELECT_PREFIX)) {
    const lang = interaction.customId.slice(SELECT_PREFIX.length);
    await interaction.update(rulesPayload(interaction.values[0], lang));
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(LANG_PREFIX)) {
    const rest = interaction.customId.slice(LANG_PREFIX.length);
    const [lang, section] = rest.split(":");
    await interaction.update(rulesPayload(section || "leaderboard", lang));
    return true;
  }
  return false;
}

module.exports.handleRulesInteraction = handleRulesInteraction;
