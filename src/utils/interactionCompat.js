const {
  CommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  MessageFlags,
  MessageFlagsBitField,
  MessagePayload,
} = require("discord.js");

let installed = false;

/**
 * discord.js deprecated `ephemeral` in favor of `flags`. Hundreds of call sites still pass it,
 * so reply/deferReply/followUp translate it here instead of every caller.
 */
function toFlags(options) {
  if (!options || typeof options !== "object" || options instanceof MessagePayload) return options;
  if (!("ephemeral" in options)) return options;
  const { ephemeral, ...rest } = options;
  if (!ephemeral) return rest;
  rest.flags = new MessageFlagsBitField(rest.flags ?? 0).add(MessageFlags.Ephemeral).bitfield;
  return rest;
}

function installEphemeralCompat() {
  if (installed) return;
  installed = true;
  for (const Klass of [CommandInteraction, MessageComponentInteraction, ModalSubmitInteraction]) {
    const proto = Klass?.prototype;
    if (!proto) continue;
    for (const method of ["reply", "deferReply", "followUp"]) {
      const original = proto[method];
      if (typeof original !== "function") continue;
      proto[method] = function patched(options, ...rest) {
        return original.call(this, toFlags(options), ...rest);
      };
    }
  }
}

/** Discord errors that just mean the message/channel/interaction is already gone. */
const GONE_CODES = new Set([10003, 10008, 10062, 40060]);

function isGoneError(err) {
  return GONE_CODES.has(Number(err?.code));
}

module.exports = { installEphemeralCompat, isGoneError, toFlags };
