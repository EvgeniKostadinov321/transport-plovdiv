# Transport Plovdiv

Live автобуси Пловдив. PWA с карта на спирките и ETA-та от общинското виртуално табло.

## Structure

- **`web/`** — React + Vite frontend (PWA, MapTiler карта)
- **`api/`** — Hono + Node backend (ZK Framework client за virtual board)
- **`spike/`** — research артифакти (FINDINGS, raw responses)
- **`docs/`** — проектен план

## Setup

```bash
# API
cd api
cp .env.example .env
npm install
npm run dev   # http://localhost:3001

# Web (в отделен терминал)
cd web
cp .env.example .env.local
# редактирай .env.local за VITE_MAPTILER_KEY
npm install
npm run dev   # http://localhost:5173
```

## Deploy

Виж [DEPLOY.md](./DEPLOY.md) за production deploy инструкции (Vercel + Railway).

## Tech stack

- React 19 + TypeScript + Vite
- Leaflet + react-leaflet за картата
- MapTiler за tiles
- vite-plugin-pwa за offline + install
- Hono за backend HTTP server
- Native fetch за ZK client към `transport.plovdiv.bg`
