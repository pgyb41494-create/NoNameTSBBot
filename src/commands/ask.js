const { SlashCommandBuilder } = require("discord.js");
const api = require("../utils/loadApi");
const { surface, danger } = require("../utils/embeds");

module.exports = {
  name: "ask",
  aliases: ["tsbl", "tsblask", "pregunta"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Pregunta de reglas TSBL / LATAM")
      .addStringOption((o) =>
        o.setName("question").setDescription("Tu pregunta de TSBL").setRequired(true).setMaxLength(800)
      )
      .addStringOption((o) =>
        o
          .setName("lang")
          .setDescription("Idioma de la respuesta")
          .addChoices(
            { name: "Español", value: "es" },
            { name: "English", value: "en" }
          )
      ),

  async executePrefix(message, args) {
    const parsed = parseAskArgs(args);
    if (!parsed.question) {
      return message.reply({
        embeds: [
          danger(
            "Uso",
            "`'ask <pregunta TSBL>` — ej. `'ask cooldown de retos`\nInglés: `'ask en challenge cooldown`"
          ),
        ],
      });
    }
    const pending = await message.reply({
      embeds: [surface({ title: "TSBL…", description: "Revisando las reglas competitivas." })],
    });
    try {
      const result = await api.coach.askTsbl(parsed);
      return pending.edit(formatAsk(result, parsed.lang));
    } catch (err) {
      return pending.edit({ embeds: [danger("Ask failed", err.message)] });
    }
  },

  async executeSlash(interaction) {
    const question = interaction.options.getString("question", true);
    const lang = interaction.options.getString("lang") || undefined;
    await interaction.deferReply();
    try {
      const result = await api.coach.askTsbl({ question, lang });
      return interaction.editReply(formatAsk(result, lang));
    } catch (err) {
      return interaction.editReply({ embeds: [danger("Ask failed", err.message)] });
    }
  },
};

function parseAskArgs(args) {
  const raw = args.join(" ").trim();
  const m = raw.match(/^(es|en|español|espanol|spanish|english|inglés|ingles)\s+(.+)$/i);
  if (m) {
    const tag = m[1].toLowerCase();
    const lang = /^(en|english|inglés|ingles)$/.test(tag) ? "en" : "es";
    return { question: m[2].trim(), lang };
  }
  return { question: raw };
}

function formatAsk(result, lang) {
  if (!result?.ok) {
    return { embeds: [danger("TSBL", result?.message || "No se pudo responder.")] };
  }
  let body = String(result.answer || "").trim();
  body = body.replace(/^(on_topic|off_topic|refused|unknown)\s*[:\-]?\s*/i, "").trim() || body;
  if (body.length > 3900) body = `${body.slice(0, 3900)}…`;
  return {
    embeds: [
      surface({
        title: lang === "en" ? "TSBL" : "TSBL",
        description: body,
      }),
    ],
  };
}
