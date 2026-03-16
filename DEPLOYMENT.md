# Deployment Runbook

This document reflects the current codebase behavior.
Use it as the source of truth for server deployment.

## Production Architecture

- `apps/web`: Next.js 14 app, served by `next start` on port `3000`
- `apps/server`: Express + Socket.IO API, served on port `3001`
- Database: local SQLite file at `apps/server/data/pundit.db`
- Session/token store: Redis
- Reverse proxy: Nginx
- Process manager: PM2

## What The Server Must Have

- Linux VM or bare metal host
- Node.js 18+ (Node 20 recommended)
- npm
- git
- nginx
- redis-server
- sqlite3
- build tools for native Node modules:
  - `build-essential`
  - `python3`
  - `make`
  - `g++`
- PM2 (`npm install -g pm2`)

## What Is Not Required

- PostgreSQL
- Docker
- Vercel
- Railway

The current backend code uses SQLite directly, not PostgreSQL.

## Recommended Layout

- App root: `/app`
- Public web: `https://your-domain`
- Internal services:
  - `127.0.0.1:3000` -> Next.js
  - `127.0.0.1:3001` -> API + Socket.IO

## Environment Files

### `apps/server/.env`

```env
NODE_ENV=production
PORT=3001
JWT_SECRET=replace_with_long_random_secret
FRONTEND_URL=https://your-domain,https://www.your-domain
FRONTEND_QR_URL=https://your-domain
REDIS_URL=redis://localhost:6379
ADMIN_LOGIN=replace_admin_login
ADMIN_PASSWORD=replace_admin_password
DEMO_START_TRUST_X_FORWARDED_FOR=1
```

Optional tuning vars:

```env
ADMIN_ERROR_LOG_CAP=1000
ADMIN_ERROR_LOG_WINDOW_MINUTES=60
DEMO_START_RATE_WINDOW_MS=10000
DEMO_START_RATE_MAX_REQUESTS=120
DEMO_START_MAX_CONCURRENCY=16
DEMO_START_MAX_QUEUE=500
DEMO_START_QUEUE_TIMEOUT_MS=15000
```

### `apps/web/.env.local`

```env
NEXT_PUBLIC_API_URL=https://your-domain
```

## First-Time Server Setup

Example for Ubuntu/Debian:

```bash
apt update
apt install -y nginx redis-server sqlite3 git build-essential python3 make g++
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2
systemctl enable --now nginx
systemctl enable --now redis-server
```

## App Install

```bash
cd /app
git clone <repo-url> .
npm --prefix apps/server install
npm --prefix apps/web install
```

Create env files:

```bash
cp apps/server/.env.production.example apps/server/.env
cp apps/web/.env.production.example apps/web/.env.local
```

Then edit both files with real values.

## Build

```bash
npm --prefix apps/server run build
npm --prefix apps/web run build
```

## Start With PM2

```bash
cd /app
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

## Nginx

Use `deploy/nginx.conf` as the base config.

Expected routing:

- `/` -> `127.0.0.1:3000`
- `/api/` -> `127.0.0.1:3001`
- `/socket.io/` -> `127.0.0.1:3001` with websocket upgrade headers

Typical activation:

```bash
cp /app/deploy/nginx.conf /etc/nginx/sites-available/tactik
ln -s /etc/nginx/sites-available/tactik /etc/nginx/sites-enabled/tactik
nginx -t
systemctl reload nginx
```

## SSL

After Nginx is working on port 80:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain -d www.your-domain
```

## Data And Backups

SQLite data lives at:

```text
/app/apps/server/data/pundit.db
```

Backup script:

```bash
/app/deploy/backup-db.sh
```

Suggested cron:

```bash
0 3 * * * /app/deploy/backup-db.sh >> /var/log/tactik-backup.log 2>&1
```

## Deploy Update Flow

```bash
cd /app
git pull origin main
npm --prefix apps/server install
npm --prefix apps/web install
npm --prefix apps/server run build
npm --prefix apps/web run build
pm2 reload ecosystem.config.js --env production
```

The repo already contains a helper script for this:

```bash
/app/deploy/deploy.sh
```

## Verification Checklist

```bash
curl http://127.0.0.1:3001/health
pm2 status
systemctl status nginx
systemctl status redis-server
```

In browser, verify:

- landing page loads
- login/register works
- dashboard works
- session page connects
- admin login works
- `/socket.io/` traffic upgrades cleanly

## Important Notes

- Current code uses SQLite + Redis in production.
- `QUICKSTART.md` and some older setup docs mention PostgreSQL or cloud platforms; those do not match the current backend implementation.
- If `next build` fails because `.next/trace` is locked, stop any running `next dev` process first, then rebuild.
