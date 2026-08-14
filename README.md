# NoNameTSBBot

Inviteable Discord bot for The Strongest Battlegrounds clans.

Prefix: **`'`** (`'serversetup`, `'profile`). Slash works too.

## Railway (Obscura split)

Two services:

1. **NoNameTSBAPI** — website OAuth + public/staff data  
2. **This bot** — Discord + thin `bot-api` (no `EMBED_API` needed)

Bot env vars:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `API_TOKEN` (same secret as the API)

API should set `DISCORD_BOT_API` to this bot’s Railway URL.

Website: `VITE_API_URL=https://nonametsbapi-production.up.railway.app`

Enable **Message Content Intent** and **Server Members Intent**.

Repo: https://github.com/pgyb41494-create/NoNameTSBBot
