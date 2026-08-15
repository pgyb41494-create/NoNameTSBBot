const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const { surface } = require("../utils/embeds");
const { tsblSection, tsblSectionKeys, TSBL } = require("../../api/coach/tsblRules");

const MENU_ID = "tsbl_rules_section";

function rulesPayload(sectionKey = "leaderboard") {
  const section = tsblSection(sectionKey);
  const body = section.items.map((line) => `• ${line}`).join("\n");
  return {
    embeds: [
      surface({
        title: `TSBL · ${section.title}`,
        description: `${TSBL.name}\n\n${body}\n\nAsk a specific question with \`'ask …\`.`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(MENU_ID)
          .setPlaceholder("Pick a rules section")
          .addOptions(
            tsblSectionKeys().map((key) => ({
              label: tsblSection(key).title,
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
  aliases: ["tsblrules", "1v1rules"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("rules")
      .setDescription("Official TSBL / LATAM competitive rules")
      .addStringOption((o) =>
        o
          .setName("section")
          .setDescription("Which rules")
          .addChoices(
            { name: "Leaderboard", value: "leaderboard" },
            { name: "Fair play", value: "fairplay" },
            { name: "Match conduct", value: "conduct" },
            { name: "Tryouts", value: "tryouts" },
            { name: "Phases", value: "phases" }
          )
      ),

  async executePrefix(message, args) {
    const key = normalizeSection(args.join(" "));
    return message.reply(rulesPayload(key));
  },

  async executeSlash(interaction) {
    const key = interaction.options.getString("section") || "leaderboard";
    return interaction.reply(rulesPayload(key));
  },
};

function normalizeSection(raw) {
  const t = String(raw || "").toLowerCase();
  if (/fair|fflag|blox|macro|exploit|fps/.test(t)) return "fairplay";
  if (/conduct|passive|run|character|ultimate|1v1/.test(t)) return "conduct";
  if (/tryout|host|ft3|ft5/.test(t)) return "tryouts";
  if (/phase|tier|stage|rank/.test(t)) return "phases";
  if (/board|cooldown|challenge|spot/.test(t)) return "leaderboard";
  return "leaderboard";
}

async function handleRulesInteraction(interaction) {
  if (!interaction.isStringSelectMenu() || interaction.customId !== MENU_ID) return false;
  await interaction.update(rulesPayload(interaction.values[0]));
  return true;
}

module.exports.handleRulesInteraction = handleRulesInteraction;
