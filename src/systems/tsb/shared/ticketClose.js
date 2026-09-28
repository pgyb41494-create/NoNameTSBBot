const closing = new Map();
const STALE_MS = 60_000;

/** Returns false when this channel is already being closed (double-click on Close). */
function beginClose(channelId) {
  if (!channelId) return false;
  const since = closing.get(channelId);
  if (since && Date.now() - since < STALE_MS) return false;
  closing.set(channelId, Date.now());
  return true;
}

function isClosing(channelId) {
  const since = closing.get(channelId);
  return Boolean(since && Date.now() - since < STALE_MS);
}

/** Pass the channel object captured up front — `interaction.channel` is null once the channel is gone. */
function scheduleChannelDelete(channel, reason, delayMs = 5000, after) {
  if (!channel?.id) return;
  closing.set(channel.id, closing.get(channel.id) || Date.now());
  setTimeout(async () => {
    try {
      await channel.delete(reason);
    } catch {}
    closing.delete(channel.id);
    if (after) {
      try {
        await after();
      } catch {}
    }
  }, delayMs);
}

module.exports = { beginClose, isClosing, scheduleChannelDelete };
