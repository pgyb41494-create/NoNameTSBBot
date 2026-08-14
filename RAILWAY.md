# Production URLs (split like Obscura)

## API (website + OAuth + data)
https://nonametsbapi-production.up.railway.app

Set on the **API** Railway service:
- `WEBSITE_URL=https://no-name-tsb-website.vercel.app`
- `API_PUBLIC_URL=https://nonametsbapi-production.up.railway.app`
- `DISCORD_REDIRECT_URI=https://nonametsbapi-production.up.railway.app/auth/discord/callback`
- `DISCORD_BOT_API=https://nonametsbbot-production.up.railway.app`
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `API_TOKEN` / `STAFF_DISCORD_IDS`

## Bot (Discord)
https://nonametsbbot-production.up.railway.app

Set on the **Bot** Railway service:
- `DISCORD_TOKEN`, `CLIENT_ID`
- `EMBED_API=0` (API is a separate service)
- `API_TOKEN` (same secret as the API)
- Optional: `PORT` is set by Railway automatically

## Discord Developer Portal → OAuth2 → Redirects
Use exactly this (API, not bot — and no duplicated domain):

https://nonametsbapi-production.up.railway.app/auth/discord/callback

Wrong example (do not use):
https://nonametsbbot-production.up.railway.app.up.railway.app/auth/discord/callback

## Vercel website
`VITE_API_URL=https://nonametsbapi-production.up.railway.app`
