const { SlashCommandBuilder } = require("discord.js");
const api = require("../utils/loadApi");

module.exports = {
  name: "ask",
  aliases: ["tsbl", "tsblask", "tsbcc", "pregunta"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Ask a TSBCC rules question")
      .addStringOption((o) =>
        o.setName("question").setDescription("Your TSBCC question").setRequired(true).setMaxLength(800)
      )
      .addStringOption((o) =>
        o
          .setName("lang")
          .setDescription("Reply language")
          .addChoices(
            { name: "English", value: "en" },
            { name: "Spanish", value: "es" }
          )
      ),

  async executePrefix(message, args) {
    const parsed = parseAskArgs(args);
    if (!parsed.question) {
      return message.reply({
        content: "`'ask <TSBCC question>` — e.g. `'ask can I dodge a war`",
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
      return pending.edit({ content: safeAskError(err), embeds: [] });
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
      return interaction.editReply({ content: safeAskError(err), embeds: [] });
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

function safeAskError(err) {
  const m = String(err?.message || "");
  if (/ASK_BLOCKED|prohibited use|input blocked/i.test(m)) {
    return "Couldn't answer that. Try a specific TSBCC rules question, e.g. `'ask war range`.";
  }
  const stripped = m.replace(/https?:\/\/\S+/gi, "").trim();
  return stripped.slice(0, 400) || "Ask failed.";
}

function formatAsk(result) {
  if (!result?.ok) {
    return { content: result?.message || "Could not answer that.", embeds: [] };
  }
  let body = String(result.answer || "").trim();
  body = body.replace(/^(on_topic|off_topic|refused|unknown)\s*[:\-]?\s*/i, "").trim() || body;
  if (body.length > 1900) body = `${body.slice(0, 1900)}…`;
  return { content: body, embeds: [] };
}
