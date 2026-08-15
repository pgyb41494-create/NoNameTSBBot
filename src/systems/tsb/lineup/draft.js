const { updateLineupConfig } = require("./config");
const { publishRegionLineup, publishAllLineups } = require("./renderer");

async function publishLiveLineup(interaction) {
  await publishAllLineups(interaction.guild);
  return interaction.update({
    embeds: [{
      title: "Lineup published",
      description: "Regional lineups refreshed.",
      color: 0x57F287,
    }],
    components: [],
  });
}

module.exports = {
  publishLiveLineup,
  publishRegionLineup,
  updateLineupConfig,
};
