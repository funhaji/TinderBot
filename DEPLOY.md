# Deploying this bot on a VPS (simple path)

This guide assumes a fresh **Ubuntu 22.04/24.04** VPS with SSH access, a public IP, and a domain **optional** (Telegram works with long polling; HTTPS is only needed if you switch to webhooks later).

## 1. Install system packages

```bash
sudo apt update
sudo apt install -y git curl build-essential
```

Install **Node.js 20+** (example using NodeSource):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

Install **PostgreSQL 14+**:

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

## 2. Create database and user

```bash
sudo -u postgres psql -c "CREATE USER tgbot WITH PASSWORD 'change_me_strong';"
sudo -u postgres psql -c "CREATE DATABASE tinderbot OWNER tgbot;"
```

Connection string (save for `.env`):

`DATABASE_URL=postgres://tgbot:change_me_strong@127.0.0.1:5432/tinderbot`

## 3. Deploy the code

```bash
cd /opt
sudo git clone <YOUR_REPO_URL> tgbot
sudo chown -R $USER:$USER tgbot
cd tgbot
npm ci
```

Create `.env` in the project root:

```env
BOT_TOKEN=123456:ABC-from-BotFather
DATABASE_URL=postgres://tgbot:change_me_strong@127.0.0.1:5432/tinderbot
ADMIN_TELEGRAM_IDS=111111111,222222222
BOT_OWNER_TELEGRAM_ID=111111111
LOG_LEVEL=info
DISCOVERY_BATCH_SIZE=25
DISCOVERY_RADIUS_METERS=20000
```

- `ADMIN_TELEGRAM_IDS`: comma-separated **numeric Telegram user IDs** that may use `/admin`.
- `BOT_OWNER_TELEGRAM_ID` (optional): shows the owner crown badge; defaults to a built-in fallback if unset.

Build:

```bash
npm run build
```

Migrations run **automatically on startup** (first boot applies `src/db/migrations/*.sql`). To run migrations only once manually:

```bash
npm run migrate
```

## 4. Run under systemd (recommended)

Create `/etc/systemd/system/tgbot.service`:

```ini
[Unit]
Description=Telegram bot
After=network.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/tgbot
EnvironmentFile=/opt/tgbot/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tgbot
sudo journalctl -u tgbot -f
```

## 5. Operations checklist

- **Updates**: `git pull && npm ci && npm run build && sudo systemctl restart tgbot`
- **Database backup**: use `pg_dump` on a schedule (cron) — keep backups off-server.
- **Logs**: `journalctl -u tgbot` (or your host’s log stack).
- **Firewall**: allow SSH; **no inbound port is required** for long polling.

## 6. Referral file rewards (admin)

1. Open `/admin` → **Referral file rewards** (or the localized label).
2. Send one line: `minReferrals captionFa | captionEn` (example: `10 فایل شما | Your file`).
3. Send the **document** Telegram should deliver to eligible users.

Thresholds for VIP / verified-style badges are configurable in `system_settings` keys `referral_vip_threshold` and `referral_badge_verify_threshold` (defaults seeded in migration `004`).

## 7. Menu / localization note

The **main reply keyboard** (home rows) is built from **code + i18n**, so it stays consistent after `/start` without relying on DB-stored button labels. Editable marketing copy still lives in `bot_config` where the project already used it (welcome text, explorer keys, etc.).
