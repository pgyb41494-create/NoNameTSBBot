# NoNameTSBBot

Inviteable Discord bot for The Strongest Battlegrounds clans. Working name is **ASA**.

Prefix: **`'`** (`'serversetup`, `'profile`). Slash commands work too (`/profile`, `/tsbcoach`, `/kick`, `/ban`, …).

## Setup

1. Clone this repo next to the API:

```text
NoNameTSBBot/
NoNameTSBAPI/   (or NoNameBotAPI/)
```

2. Copy `.env.example` to `.env` and set `DISCORD_TOKEN` + `CLIENT_ID`.
3. `npm install`
4. `npm start`

If the API folder is not a sibling, set `API_PACKAGE` to its path.

Enable **Message Content Intent** and **Server Members Intent** on the Discord bot.

Repo: https://github.com/pgyb41494-create/NoNameTSBBot
