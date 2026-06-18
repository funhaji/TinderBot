# Telegram Friend-Finding Bot (FA/EN)

Node.js (TypeScript) Telegram bot using grammY + PostgreSQL.

## Features (MVP)
- Language selection on `/start` (FA/EN)
- Profile wizard: name, age, city, optional location, bio, interests, 1–3 photos (`file_id` reuse)
- Discovery feed with swipe UI using message editing (`editMessageMedia` / `editMessageText`)
- Matches and basic chat relay using `copyMessage`

## Setup
1. Copy env:
   - `cp .env.example .env` (Windows: copy manually)
2. Set `BOT_TOKEN`, `DATABASE_URL`, and optional comma-separated `ADMIN_TELEGRAM_IDS` (numeric Telegram user ids for `/admin`).
   - Optional: `BOT_OWNER_TELEGRAM_ID` (numeric Telegram id for owner crown badge).
   - Optional proxy (for restricted networks): set `PROXY_URL=127.0.0.1:10808`
3. Install deps:
   - `npm i`
4. Start dev:
   - `npm run dev`

## VPS deployment

See **[DEPLOY.md](./DEPLOY.md)** for a step-by-step production setup (PostgreSQL, build, systemd, operations).

## Notes
- Migrations run automatically on startup (disable with `SKIP_MIGRATIONS=true`).
- Proxy is enabled by default (disable with `DISABLE_PROXY=true`).
- If `DATABASE_URL` is empty, the bot starts in **no-DB test mode** (minimal functionality; no persistence).

## VPS notes (optimized)
- Use long polling for a single-instance deployment.
- Prefer message editing + `file_id` reuse to reduce bandwidth.
- Keep DB indexes as defined in migrations.

