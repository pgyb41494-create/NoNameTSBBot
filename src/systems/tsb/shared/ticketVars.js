const TICKET_VAR_NAMES = [
  "user",
  "username",
  "displayname",
  "globalname",
  "userid",
  "server",
  "serverid",
  "membercount",
  "channel",
  "channelname",
  "ticket",
  "ticketid",
  "ticketname",
  "reason",
  "option",
  "staff",
  "support",
  "panel",
  "panelid",
  "paneltitle",
  "date",
  "time",
  "timestamp",
  "opened",
  "claimed",
];

function ticketVarHint() {
  return TICKET_VAR_NAMES.map((name) => `\`{${name}}\``).join(" ");
}

function buildTicketVarMap(ctx = {}) {
  const user = ctx.user;
  const member = ctx.member;
  const guild = ctx.guild;
  const channel = ctx.channel;
  const now = ctx.now instanceof Date ? ctx.now : new Date();

  const display =
    member?.displayName ||
    user?.globalName ||
    user?.displayName ||
    user?.username ||
    "";

  const values = {
    user: user ? `<@${user.id}>` : "{user}",
    username: user?.username ?? "{username}",
    displayname: display || "{displayname}",
    globalname: user?.globalName ?? user?.username ?? "{globalname}",
    userid: user?.id ?? "{userid}",
    server: guild?.name ?? "{server}",
    serverid: guild?.id ?? "{serverid}",
    membercount: guild?.memberCount != null ? String(guild.memberCount) : "{membercount}",
    channel: channel ? `<#${channel.id}>` : "{channel}",
    channelname: channel?.name ?? "{channelname}",
    ticket: channel ? `<#${channel.id}>` : "{ticket}",
    ticketid: channel?.id ?? "{ticketid}",
    ticketname: channel?.name ?? "{ticketname}",
    reason: ctx.reason != null ? String(ctx.reason) : "{reason}",
    option: ctx.reason != null ? String(ctx.reason) : "{option}",
    staff: ctx.staff ?? "{staff}",
    support: ctx.staff ?? "{support}",
    panel: ctx.panelName ?? "{panel}",
    panelid: ctx.panelName ?? "{panelid}",
    paneltitle: ctx.panelTitle ?? ctx.panelName ?? "{paneltitle}",
    date: now.toLocaleDateString("en-US", { timeZone: "America/New_York" }),
    time: now.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    }),
    timestamp: String(Math.floor(now.getTime() / 1000)),
    opened: ctx.openedAt ?? now.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
    claimed: ctx.claimedBy ? `<@${ctx.claimedBy}>` : "{claimed}",
  };

  const map = {};
  for (const name of TICKET_VAR_NAMES) {
    map[`{${name}}`] = values[name] ?? `{${name}}`;
  }
  return map;
}

function applyTicketVars(text, ctx = {}) {
  if (text == null || text === "") return text;
  const map = buildTicketVarMap(ctx);
  let out = String(text);
  for (const name of TICKET_VAR_NAMES) {
    const value = map[`{${name}}`];
    out = out.replace(new RegExp(`\\{${name}\\}`, "gi"), String(value));
  }
  return out;
}

module.exports = {
  TICKET_VAR_NAMES,
  ticketVarHint,
  buildTicketVarMap,
  applyTicketVars,
};
