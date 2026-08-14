# Railway deploy (Obscura-style)

## Recommended: one Bot service

Deploy **NoNameTSBBot** only. It starts Discord **and** the website API (vendored `./api`), same idea as Obscura’s bot process exposing HTTP.

### Env vars on the Bot service

- `DISCORD_TOKEN`, `CLIENT_ID`, `CLIENT_SECRET`
- `EMBED_API=1`
- `WEBSITE_URL=https://no-name-tsb-website.vercel.app`
- `API_PUBLIC_URL=https://YOUR-BOT.up.railway.app`
- `DISCORD_REDIRECT_URI=https://YOUR-BOT.up.railway.app/auth/discord/callback`
- `API_TOKEN=` (long random secret)
- `PUBLIC_GUILD_ID=` (your clan Discord server id)
- `STAFF_DISCORD_IDS=1515419032520626261,1196512159266504797`
- Optional: `DATA_DIR=/data` with a Railway volume

### Discord Developer Portal

OAuth redirect URL must be the **API/bot** callback, not the Vercel site:

`https://YOUR-BOT.up.railway.app/auth/discord/callback`

### Vercel website

`VITE_API_URL=https://YOUR-BOT.up.railway.app`

---

## Optional split (two Railway services)

Like Obscura’s `discord-bot` + `api-server`:

| Service | Repo | Notes |
|--------|------|--------|
| Bot | NoNameTSBBot | `EMBED_API=0` → thin Discord `bot-api` on `PORT` |
| API | NoNameTSBAPI | Website OAuth + JSON data; `DISCORD_BOT_API=https://bot.up.railway.app` |

Website `VITE_API_URL` → the API service. Keep clan data on **one** service only (prefer the API in split mode, and point the bot at it with `API_SERVER_URL` + `EMBED_API=0` only if you are ready for async remote calls).
