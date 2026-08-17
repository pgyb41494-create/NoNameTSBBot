/**
 * Discord gateway + commands. Loaded after HTTP is listening.
 */
module.exports = function bootDiscord(setClient) {
  const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
  if (!token || token.length < 50) {
    console.error("Missing DISCORD_TOKEN — HTTP is up, but Discord will not connect.");
    return;
  }

  const {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
  } = require("discord.js");

  const api = require("./utils/loadApi");
  const { brand } = api;
  const loadCommands = require("./handlers/loadCommands");
  const { deployCommands, deployGuildCommands } = require("./deploy-commands");

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildInvites,
    ],
    partials: [Partials.GuildMember, Partials.Message, Partials.Channel],
  });

  client.commands = new Collection();
  client.prefix = brand.prefix;
  try {
    loadCommands(client);
  } catch (err) {
    console.error("loadCommands failed:", err);
  }

  client.on("messageCreate", (message) => {
    try {
      require("./events/messageCreate").execute(message, client);
    } catch (err) {
      console.error("messageCreate error:", err);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      await require("./events/interactionCreate").execute(interaction, client);
    } catch (err) {
      console.error("Interaction error:", err);
      const payload = { content: "Something went wrong running that.", ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  });

  client.on("guildMemberAdd", async (member) => {
    try {
      await require("./systems/tsb/ops/invites").onMemberAdd(member);
    } catch (err) {
      console.warn("invite tracker join failed:", err.message);
    }
    if (!member.user?.bot) {
      try {
        const { postAudit } = require("./systems/tsb/ops/audit");
        await postAudit(member.guild, {
          title: "Member joined",
          color: 0x57f287,
          description: `${member.user} (${member.user.tag})`,
          user: member.user,
        });
      } catch {}
    }
  });

  client.on("guildMemberRemove", async (member) => {
    if (member.user?.bot) return;
    try {
      const { postAudit } = require("./systems/tsb/ops/audit");
      await postAudit(member.guild, {
        title: "Member left",
        color: 0xed4245,
        description: `${member.user || member.id} left.`,
        user: member.user,
      });
    } catch {}
  });

  client.on("guildBanAdd", async (ban) => {
    try {
      const { postAudit } = require("./systems/tsb/ops/audit");
      await postAudit(ban.guild, {
        title: "Member banned",
        color: 0xdc2626,
        description: `${ban.user} (${ban.user.tag})\n${ban.reason || "No reason"}`,
        user: ban.user,
      });
    } catch {}
  });

  client.on("messageDelete", async (message) => {
    try {
      if (!message.guild || message.author?.bot) return;
      const { postAudit } = require("./systems/tsb/ops/audit");
      await postAudit(message.guild, {
        title: "Message deleted",
        color: 0xef4444,
        description: `${message.author || "Unknown"} in ${message.channel}\n${String(message.content || "").slice(0, 800) || "*no text*"}`,
        user: message.author,
      });
    } catch {}
  });

  client.on("inviteCreate", (invite) => {
    try {
      require("./systems/tsb/ops/invites").onInviteChange(invite);
    } catch {}
  });

  client.on("inviteDelete", (invite) => {
    try {
      require("./systems/tsb/ops/invites").onInviteChange({
        guild: invite.guild,
        code: invite.code,
        uses: null,
      });
    } catch {}
  });

  client.on("guildCreate", async (guild) => {
    try {
      await Promise.resolve(api.guilds.updateGuild(guild.id, { name: guild.name }));
    } catch (err) {
      console.warn("guildCreate update failed:", err.message);
    }
    try {
      const n = await deployGuildCommands(guild.id, client);
      console.log(`Slash commands synced for ${guild.name} (${n} commands)`);
    } catch (err) {
      console.error(`Slash sync failed for ${guild.name}:`, err.message);
    }
  });

  let readyHandled = false;
  const onReady = async () => {
    if (readyHandled) return;
    readyHandled = true;
    setClient(client);
    try {
      api.botBridge.setClient(client);
    } catch {}
    console.log(`${brand.name} online as ${client.user.tag}`);
    client.user.setActivity(`${brand.prefix}help · /profile`, { type: 3 });
    try {
      await client.application.fetch();
      const result = await deployCommands(client);
      console.log(
        `Slash commands registered per guild (${result.commands} commands × ${result.guilds} servers). Global commands cleared.`
      );
    } catch (err) {
      console.warn("Slash deploy skipped:", err.message);
    }
    try {
      await require("./systems/tsb/ops/invites").refreshEnabled(client);
    } catch (err) {
      console.warn("Invite cache skipped:", err.message);
    }
  };

  // v14 emits "ready"; v15 prefers "clientReady"
  client.once("clientReady", onReady);
  client.once("ready", onReady);

  client.login(token).catch((err) => {
    console.error("Discord login failed:", err.message);
  });
};
