# Transport Plovdiv

Live автобуси Пловдив. PWA с карта на спирките и ETA-та от общинското виртуално табло.

## Structure

```
web/
├── src/                React + Vite frontend (PWA)
├── api/                Vercel serverless functions
│   ├── lines.ts        GET /api/lines
│   ├── stops.ts        GET /api/stops
│   ├── eta/[stop].ts   GET /api/eta/:stop
│   └── _lib/           shared utilities (zk-client, static-data)
└── public/             static assets, иконки

spike/                  research артифакти (FINDINGS, raw responses)
docs/                   проектен план
```

## Setup локално

```bash
cd web
cp .env.example .env.local
# edit .env.local: VITE_MAPTILER_KEY=...
npm install
npm run dev          # frontend на http://localhost:5173

# в отделен терминал, за API functions:
vercel dev           # пълен stack на http://localhost:3000
```

## Deploy

Виж [DEPLOY.md](./DEPLOY.md). Един `vercel` команд deploy-ва и frontend и API.

## Tech stack

- React 19 + TypeScript + Vite
- Leaflet + react-leaflet, MapTiler tiles
- vite-plugin-pwa (offline + install to home screen)
- Vercel serverless functions (Node 22 runtime)
- Native fetch за ZK client към `transport.plovdiv.bg`
