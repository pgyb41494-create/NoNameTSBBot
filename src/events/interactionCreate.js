const { handleProfileInteraction } = require("../systems/profileUI");
const { handleRulesInteraction } = require("../commands/rules");
const { handleHubSelect, HUB_CUSTOM_ID } = require("../systems/tsb/hub");
const {
  handleLeaderboardButton,
  handleLeaderboardSelect,
  handleLeaderboardModal,
} = require("../systems/tsb/leaderboard/setupStore");
const {
  handleRankingButton,
  handleRankingSelect,
  handleRankingModal,
} = require("../systems/tsb/ranking/setupStore");
const {
  handleScoreButton,
  handleScoreSelect,
  handleScoreModal,
} = require("../systems/tsb/score/setupStore");
const {
  handleLineupButton,
  handleLineupSelect,
  handleLineupModal,
} = require("../systems/tsb/lineup/setupStore");
const {
  handleLineupBotButton,
  handleLineupBotModal,
} = require("../systems/tsb/lineup/botUI");
const {
  handleTryoutButton,
  handleTryoutSelect,
  handleTryoutModal,
} = require("../systems/tsb/tryout/setupStore");
const { handleTryoutRuntime } = require("../systems/tsb/tryout/runtime");
const { handleSetupInteraction } = require("../systems/setupHub");
const { handleAccessInteraction } = require("../systems/tsb/access/panel");
const { handleVerifyInteraction } = require("../systems/tsb/verify/runtime");
const { handleChallengeTickets } = require("../systems/tsb/challengeTickets/runtime");
const { handlePanelButton } = require("../systems/tsb/panels/runtime");
const {
  handleVerifySetupButton,
  handleVerifySetupSelect,
} = require("../systems/tsb/verify/setupStore");

async function handleTsbInteraction(interaction) {
  const id = interaction.customId || "";

  if (interaction.isAutocomplete?.()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (command?.autocomplete) return command.autocomplete(interaction);
    return false;
  }

  if (
    interaction.isStringSelectMenu?.()
    || interaction.isChannelSelectMenu?.()
    || interaction.isRoleSelectMenu?.()
    || interaction.isUserSelectMenu?.()
  ) {
    if (id === HUB_CUSTOM_ID) return handleHubSelect(interaction);
    if (id.startsWith("access_")) return handleAccessInteraction(interaction);
    if (id.startsWith("tsb:lb:")) return handleLeaderboardSelect(interaction);
    if (id.startsWith("tsb:rank:")) return handleRankingSelect(interaction);
    if (id.startsWith("tsb:score:")) return handleScoreSelect(interaction);
    if (id.startsWith("tsb:lu:")) return handleLineupSelect(interaction);
    if (id.startsWith("tsb:verify:cfg_")) return handleVerifySetupSelect(interaction);
    if (id.startsWith("tsb:tryout:")) return handleTryoutSelect(interaction);
    if (id.startsWith("tsb:chaltix:")) return handleChallengeTickets(interaction);
  }

  if (interaction.isButton?.()) {
    if (id.startsWith("access_")) return handleAccessInteraction(interaction);
    if (id.startsWith("tsb:lubot:")) return handleLineupBotButton(interaction);
    if (id.startsWith("tsb:lb:")) return handleLeaderboardButton(interaction);
    if (id.startsWith("tsb:rank:")) return handleRankingButton(interaction);
    if (id.startsWith("tsb:score:")) return handleScoreButton(interaction);
    if (id.startsWith("tsb:lu:")) return handleLineupButton(interaction);
    if (id.startsWith("tsb:verify:cfg_")) return handleVerifySetupButton(interaction);
    if (id.startsWith("tsb:verify:")) return handleVerifyInteraction(interaction);
    if (id.startsWith("tsb:tryout:")) return handleTryoutButton(interaction);
    if (id.startsWith("tsb:chaltix:")) return handleChallengeTickets(interaction);
    if (id.startsWith("panel_btn_") || id.startsWith("pannel_btn_")) return handlePanelButton(interaction);
  }

  if (interaction.isModalSubmit?.()) {
    if (id.startsWith("tsb:lubot:")) return handleLineupBotModal(interaction);
    if (id.startsWith("tsb:lb:")) return handleLeaderboardModal(interaction);
    if (id.startsWith("tsb:rank:")) return handleRankingModal(interaction);
    if (id.startsWith("tsb:score:")) return handleScoreModal(interaction);
    if (id.startsWith("tsb:lu:")) return handleLineupModal(interaction);
    if (id.startsWith("tsb:tryout:")) return handleTryoutModal(interaction);
    if (id.startsWith("tsb:chaltix:")) return handleChallengeTickets(interaction);
  }

  return false;
}

module.exports = {
  async execute(interaction, client) {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) return command.autocomplete(interaction);
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.executeSlash) {
        return interaction.reply({ content: "Unknown command.", ephemeral: true });
      }
      return command.executeSlash(interaction, client);
    }

    if (await handleProfileInteraction(interaction)) return;
    if (await handleTsbInteraction(interaction)) return;
    if (await handleTryoutRuntime(interaction)) return;
    if (await handleSetupInteraction(interaction)) return;
    if (await handleRulesInteraction(interaction)) return;
  },
};
