# NoNameTSBBot

Inviteable Discord bot for The Strongest Battlegrounds clans.

Prefix: **`'`** (`'serversetup`, `'profile`). Slash works too.

## Railway

The bot depends on the API package from GitHub:

```json
"NoNameBotAPI": "github:pgyb41494-create/NoNameTSBAPI#main"
```

`npm install` pulls it automatically. No sibling folder needed.

Recommended Railway setup:

1. Deploy **this bot** with `EMBED_API=1` and expose port `8787`
2. Point the website `VITE_API_URL` to this bot’s public Railway URL
3. Set `WEBSITE_URL=https://no-name-tsb-website.vercel.app`

Required env vars: `DISCORD_TOKEN`, `CLIENT_ID`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `WEBSITE_URL`, `API_PUBLIC_URL`

Enable **Message Content Intent** and **Server Members Intent**.

Repo: https://github.com/pgyb41494-create/NoNameTSBBot
