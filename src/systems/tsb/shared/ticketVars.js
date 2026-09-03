const TICKET_VAR_DOCS = [
  { name: "user", meaning: "Mentions the ticket opener (@user)" },
  { name: "username", meaning: "Opener Discord username" },
  { name: "displayname", meaning: "Server nickname / display name" },
  { name: "globalname", meaning: "Discord global display name" },
  { name: "userid", meaning: "Opener Discord ID" },
  { name: "server", meaning: "Server name" },
  { name: "serverid", meaning: "Server ID" },
  { name: "membercount", meaning: "Member count" },
  { name: "channel", meaning: "Mentions the ticket channel" },
  { name: "channelname", meaning: "Ticket channel name" },
  { name: "ticket", meaning: "Same as {channel}" },
  { name: "ticketid", meaning: "Ticket channel ID" },
  { name: "ticketname", meaning: "Ticket channel name" },
  { name: "reason", meaning: "Button / menu option label they picked" },
  { name: "option", meaning: "Same as {reason}" },
  { name: "staff", meaning: "Mentions configured staff roles" },
  { name: "support", meaning: "Same as {staff}" },
  { name: "panel", meaning: "Panel ID (slug)" },
  { name: "panelid", meaning: "Same as {panel}" },
  { name: "paneltitle", meaning: "Panel title text" },
  { name: "date", meaning: "Today’s date (US/Eastern)" },
  { name: "time", meaning: "Current time (US/Eastern)" },
  { name: "timestamp", meaning: "Unix timestamp (for Discord `<t:…>`)" },
  { name: "opened", meaning: "When the ticket was opened" },
  { name: "claimed", meaning: "Who claimed the ticket (after claim)" },
];

const TICKET_VAR_NAMES = TICKET_VAR_DOCS.map((row) => row.name);

function ticketVarHint() {
  return TICKET_VAR_NAMES.map((name) => `\`{${name}}\``).join(" ");
}

function ticketVariablesHelpEmbed(color = 0x5865f2) {
  const lines = TICKET_VAR_DOCS.map((row) => `\`{${row.name}}\` — ${row.meaning}`);
  return {
    embeds: [{
      title: "Ticket variables",
      color,
      description:
        "Type these **exactly** in panel title/body/footer or the ticket greeting.\n" +
        "They get replaced when the panel posts or a ticket opens.\n\n" +
        "**How to use**\n" +
        "```\n" +
        "Hey {user} — staff: {staff}\n" +
        "Reason: {reason}\n" +
        "Opened {opened} on {server}\n" +
        "```\n" +
        "Discord time: `<t:{timestamp}:R>`\n\n" +
        lines.join("\n"),
    }],
  };
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
  TICKET_VAR_DOCS,
  ticketVarHint,
  ticketVariablesHelpEmbed,
  buildTicketVarMap,
  applyTicketVars,
};
