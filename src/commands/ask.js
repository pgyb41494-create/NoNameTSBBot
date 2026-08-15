const { SlashCommandBuilder } = require("discord.js");
const api = require("../utils/loadApi");
const { surface, danger } = require("../utils/embeds");

module.exports = {
  name: "ask",
  aliases: ["tsbl", "tsblask"],
  slash: () =>
    new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Ask a TSBL / LATAM competitive rules question")
      .addStringOption((o) =>
        o.setName("question").setDescription("Your TSBL question").setRequired(true).setMaxLength(800)
      ),

  async executePrefix(message, args) {
    const question = args.join(" ").trim();
    if (!question) {
      return message.reply({
        embeds: [danger("Usage", "`'ask <TSBL question>` — e.g. `'ask challenge cooldown`")],
      });
    }
    const pending = await message.reply({
      embeds: [surface({ title: "TSBL…", description: "Checking competitive rules." })],
    });
    try {
      const result = await api.coach.askTsbl({ question });
      return pending.edit(formatAsk(result));
    } catch (err) {
      return pending.edit({ embeds: [danger("Ask failed", err.message)] });
    }
  },

  async executeSlash(interaction) {
    const question = interaction.options.getString("question", true);
    await interaction.deferReply();
    try {
      const result = await api.coach.askTsbl({ question });
      return interaction.editReply(formatAsk(result));
    } catch (err) {
      return interaction.editReply({ embeds: [danger("Ask failed", err.message)] });
    }
  },
};

function formatAsk(result) {
  if (!result?.ok) {
    return { embeds: [danger("TSBL Ask", result?.message || "Could not answer.")] };
  }
  let body = String(result.answer || "").trim();
  body = body.replace(/^(on_topic|off_topic|refused|unknown)\s*[:\-]?\s*/i, "").trim() || body;
  if (body.length > 3900) body = `${body.slice(0, 3900)}…`;
  return {
    embeds: [
      surface({
        title: "TSBL",
        description: body,
      }),
    ],
  };
}
