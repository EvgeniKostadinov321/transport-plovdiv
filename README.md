# Transport Plovdiv

Live автобуси Пловдив. PWA с карта на спирките и ETA-та от общинското виртуално табло.

**Live:** https://transport-plovdiv-mu.vercel.app

## Architecture

```
User browser (HTTPS)
   ↓
Vercel (web/dist/ static + PWA)
   ↓
https://185-52-207-151.nip.io (Let's Encrypt SSL)
   ↓
Nginx (Delta VPS Sofia)
   ↓
Node + Hono API (systemd: transport-api.service)
   ↓
transport.plovdiv.bg (ZK Framework scraping)
```

**Защо Delta VPS, а не Vercel functions/Railway/Cloudflare?**
Общинският сайт block-ва datacenter IP диапазони (AWS, GCP, Cloudflare).
Само BG residential / BG hosting ASN-и минават. Delta.bg Sofia е валиден.

## Structure

```
web/                React 19 + Vite frontend (deploy: Vercel)
├── src/            App.tsx, colors.ts, App.css, UpdatePrompt.tsx
└── public/         иконки, manifest

local-api/          Node + Hono API (deploy: Delta VPS)
├── server.ts
└── lib/            zk-client.ts, static-data.ts

spike/              Research артифакти, FINDINGS.md
docs/               PLOVDIV_BUS_TRACKER_PLAN.md
```

## Локално dev

```bash
# Терминал 1: API
cd local-api
npm install
PORT=3001 npx tsx server.ts

# Терминал 2: Web
cd web
cp .env.example .env.local
# Edit .env.local: VITE_MAPTILER_KEY=...
# VITE_API_URL=http://localhost:3001 (за локален API)
npm install
npm run dev
```

## Production deploy

Виж [DEPLOY.md](./DEPLOY.md) за пълните инструкции.

**Quick update flow:**
```bash
# Локално: commit + push
git push

# На сървъра (SSH):
ssh -F NUL ubuntu@185.52.207.151
cd ~/transport-plovdiv && git pull
cd local-api && npm install
sudo systemctl restart transport-api
```

Vercel auto-deploy-ва web/ при всеки push.

## Tech stack

- React 19 + TypeScript + Vite
- Leaflet + react-leaflet, MapTiler tiles
- vite-plugin-pwa (install to home screen, offline tiles cache)
- Hono + Node 22 (backend)
- Native fetch за ZK Framework client
