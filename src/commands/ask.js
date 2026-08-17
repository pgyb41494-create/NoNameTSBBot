const { SlashCommandBuilder } = require("discord.js");
const api = require("../utils/loadApi");

module.exports = {
  name: "ask",
  aliases: ["tsbl", "tsblask", "tsbcc", "pregunta"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Pregunta de reglas TSBCC / LATAM")
      .addStringOption((o) =>
        o.setName("question").setDescription("Tu pregunta de TSBCC").setRequired(true).setMaxLength(800)
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
        content: "`'ask <pregunta TSBCC>` — ej. `'ask cooldown de retos`\nInglés: `'ask en challenge cooldown`",
        allowedMentions: { repliedUser: false },
      });
    }
    const pending = await message.reply({
      content: "Thinking please wait..",
      allowedMentions: { repliedUser: false },
    });
    try {
      const result = await api.coach.askTsbl(parsed);
      return pending.edit(formatAsk(result));
    } catch (err) {
      return pending.edit({ content: err.message || "Ask failed.", embeds: [] });
    }
  },

  async executeSlash(interaction) {
    const question = interaction.options.getString("question", true);
    const lang = interaction.options.getString("lang") || undefined;
    await interaction.reply({ content: "Thinking please wait.." });
    try {
      const result = await api.coach.askTsbl({ question, lang });
      return interaction.editReply(formatAsk(result));
    } catch (err) {
      return interaction.editReply({ content: err.message || "Ask failed.", embeds: [] });
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

function formatAsk(result) {
  if (!result?.ok) {
    return { content: result?.message || "No se pudo responder.", embeds: [] };
  }
  let body = String(result.answer || "").trim();
  body = body.replace(/^(on_topic|off_topic|refused|unknown)\s*[:\-]?\s*/i, "").trim() || body;
  if (body.length > 1900) body = `${body.slice(0, 1900)}…`;
  return { content: body, embeds: [] };
}
