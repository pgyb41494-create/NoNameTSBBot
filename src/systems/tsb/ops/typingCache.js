const { userAvatarFromDiscord } = require("../../../../api/lib/discordUser");

/** channelId -> Map(userId -> { id, username, displayName, avatar, at }) */
const byChannel = new Map();
const TTL_MS = 10_000;

function noteTyping(channelId, user, member = null) {
  if (!channelId || !user?.id || user.bot) return;
  const cid = String(channelId);
  if (!byChannel.has(cid)) byChannel.set(cid, new Map());
  byChannel.get(cid).set(String(user.id), {
    id: String(user.id),
    username: user.username,
    displayName: member?.displayName || user.globalName || user.username,
    avatar: userAvatarFromDiscord(user, 64),
    at: Date.now(),
  });
}

function listTyping(channelId, excludeUserId = null) {
  const cid = String(channelId || "");
  const map = byChannel.get(cid);
  if (!map) return [];
  const now = Date.now();
  const exclude = excludeUserId ? String(excludeUserId) : null;
  const out = [];
  for (const [id, row] of map) {
    if (now - row.at > TTL_MS) {
      map.delete(id);
      continue;
    }
    if (exclude && id === exclude) continue;
    out.push(row);
  }
  if (!map.size) byChannel.delete(cid);
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

module.exports = { noteTyping, listTyping };
