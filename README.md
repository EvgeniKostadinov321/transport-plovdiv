# Transport Plovdiv

Live автобуси Пловдив. PWA с карта на спирките, real-time GPS feed и ETA от общинското виртуално табло.

**Live:** https://transport-plovdiv-mu.vercel.app

## Какво прави

- **Real-time позиции на автобусите** (~5s WebSocket updates от livetransport.eu)
- **Карта на спирките** (485 спирки от общинското табло, кеширани offline)
- **ETA на спирка** (live от transport.plovdiv.bg при tap)
- **Bus trip popup** — click на автобус → списък със спирки, scheduled times, текуща позиция, закъснение
- **Live маршрути per линия** (encoded polylines от livetransport)
- **Trip planner** (FAB долу-дясно) — от точка А до точка Б, с прехвърляния. MapTiler geocoding за destination search. In-house multi-objective Dijkstra: fastest / fewest-transfers / least-walking
- **Геолокация, favorites, theme switching, PWA install, offline cache**

## Architecture

```
Browser (PWA)
   │
   ├── HTTPS GET /api/stops, /lines, /line/:line/trips, /vehicle/:id/trip
   ├── HTTPS GET /api/eta/:stop          (когато юзър tap-не спирка)
   └── SSE  /api/vehicles/stream         (real-time GPS push)
   │
   ▼
Vercel CDN (web/dist static + PWA)
   │
   ▼
https://185-52-207-151.nip.io (Let's Encrypt SSL via nip.io wildcard)
   │
   ▼
Nginx → Node + Hono (systemd: transport-api.service) on Delta VPS Sofia
   │
   ├── WSS wss://api.livetransport.eu/plovdiv     (1 shared GPS feed)
   └── HTTPS transport.plovdiv.bg                  (ZK Framework scraping за ETA)
```

**Защо Delta VPS, а не Vercel functions / Railway / Cloudflare?**
transport.plovdiv.bg блокира datacenter IP диапазони (AWS, GCP, Cloudflare). Само BG residential / BG hosting ASN-и минават. Delta.bg Sofia е валиден.

**Защо един shared WS connection към livetransport, а не директно от browser-а?**
- 1 connection към тях независимо от брой потребители → много по-малък shame factor
- IP whitelisting / blocking ще удари само VPS-а, не клиентите
- Shared in-memory snapshot + per-line trip cache → много по-малко backend заявки

## Structure

```
web/                React 19 + Vite frontend (deploy: Vercel)
├── src/
│   ├── App.tsx
│   ├── components/   BusMarker, BusTripSheet, Map, MenuDrawer, …
│   ├── hooks/        useLiveVehicles (SSE), useLineTrips, useFavorites, …
│   ├── api.ts        fetch helpers
│   ├── colors.ts     line color hashing + shading
│   └── types.ts
├── vite.config.ts    PWA + runtime caching strategies
└── public/

local-api/           Node + Hono API (deploy: Delta VPS)
├── server.ts        HTTP endpoints + SSE stream
└── lib/
    ├── livetransport-client.ts   WS клиент + snapshot + line/stop mapping
    ├── trips-client.ts           Trip proxy + LRU cache + polyline decoder
    ├── transit-graph.ts          Routing graph build от live trips + walk edges
    ├── route-planner.ts          Multi-objective Dijkstra (3 alternatives)
    ├── polyline.ts               Google encoded polyline decoder
    ├── zk-client.ts              ZK Framework scraping за ETA
    └── static-data.ts            Spirki / lines reference data

spike/                Research артифакти (test-livetransport-ws.ts, FINDINGS.md, …)
```

## API endpoints (backend)

| Endpoint | Description |
|----------|-------------|
| `GET /api/stops` | Всички спирки (≈485). Кеширан 7 дни client-side. |
| `GET /api/lines` | Всички линии. |
| `GET /api/eta/:stop[?force=1]` | Live ETA за спирка от ZK. 25s server cache. |
| `GET /api/vehicles` | Snapshot на всички live vehicles. |
| `GET /api/vehicles/stream` | SSE stream — snapshot + delta updates. |
| `GET /api/line/:line/trips` | Trip polylines (decoded) за избрана линия. 5 min server cache. |
| `GET /api/vehicle/:id/trip` | Trip status за конкретен автобус (nextStop + delay + stops). 30s cache. |
| `POST /api/route/plan` | Trip planner. Body: `{fromLat, fromLng, toLat, toLng}`. Връща до 3 alternatives (fastest / fewestTransfers / leastWalking) с walk + ride legs. Изисква transit graph да е ready. |
| `GET /api/route/stats` | Debug — graph build state (stops, edges, lines covered, last build time). |

## Локално dev

```bash
# Терминал 1: API
cd local-api
npm install
npm start   # PORT 3001

# Терминал 2: Web
cd web
echo "VITE_API_URL=http://localhost:3001" > .env.development.local
# Опционално: VITE_MAPTILER_KEY=... (без него = OSM tiles)
npm install
npm run dev   # http://localhost:5173
```

## Production deploy

Виж [DEPLOY.md](./DEPLOY.md) за пълните инструкции.

**Quick update flow:**
```bash
# Локално
git push
# Vercel auto-deploy-ва web/

# На сървъра (SSH)
ssh -F NUL ubuntu@185.52.207.151
cd ~/transport-plovdiv && git pull
cd local-api && npm install   # ако зависимости са сменени
sudo systemctl restart transport-api
journalctl -u transport-api -f
```

Очакван log при successful start:
```
✓ local-api listening on http://localhost:3001
[livetransport] bootstrap loaded: 29 lines, 485 stops
[livetransport] connecting to wss://api.livetransport.eu/plovdiv
[livetransport] WS open
[transit-graph] building…
[transit-graph] built in ~10000-15000ms: 485 stops, ~3000 edges, 29 lines
```

Routing graph се build-ва ~10-15s след livetransport bootstrap. `POST /api/route/plan` връща `503 routing graph not ready` ако се удари преди това.

## Tech stack

- React 19 + TypeScript + Vite
- Leaflet + react-leaflet, MapTiler/OSM tiles
- vite-plugin-pwa (offline cache, install to home screen)
- Hono + Node 22 (backend)
- Native WebSocket + EventSource (no extra deps)
