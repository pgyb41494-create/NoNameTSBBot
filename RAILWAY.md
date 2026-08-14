# Production (Obscura split — no EMBED_API needed)

## API — website + OAuth + data
https://nonametsbapi-production.up.railway.app

Variables:
- `WEBSITE_URL=https://no-name-tsb-website.vercel.app`
- `API_PUBLIC_URL=https://nonametsbapi-production.up.railway.app`
- `DISCORD_REDIRECT_URI=https://nonametsbapi-production.up.railway.app/auth/discord/callback`
- `DISCORD_BOT_API=https://nonametsbbot-production.up.railway.app`
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `API_TOKEN` / `STAFF_DISCORD_IDS`
- `DATA_DIR=/data` — attach a Railway **Volume** to the API service, mount path `/data` (or `/app/data`)

## Bot — Discord only (+ thin bot-api on PORT)
https://nonametsbbot-production.up.railway.app

Variables (delete `EMBED_API` if it’s still there):
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `API_TOKEN` (same value as the API service)

You do **not** need `EMBED_API`, `API_PUBLIC_URL`, `DISCORD_REDIRECT_URI`, or `WEBSITE_URL` on the bot.

## Discord OAuth redirect
https://nonametsbapi-production.up.railway.app/auth/discord/callback

## Vercel
`VITE_API_URL=https://nonametsbapi-production.up.railway.app`
