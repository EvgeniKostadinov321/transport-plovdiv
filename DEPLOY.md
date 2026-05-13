# Deploy инструкции

## Архитектура

Всичко (frontend + API) се deploy-ва като **един проект на Vercel**:

- `web/src/` → React + Vite static build
- `web/api/` → Vercel serverless functions (Node.js)
  - `/api/lines` → 29 линии
  - `/api/stops` → 530 спирки + GPS
  - `/api/eta/[stop]` → live ETA данни

Защо не Railway: общинският сайт (`transport.plovdiv.bg`) блокира Railway IP диапазона.
Vercel functions имат различен outbound IP pool.

## Vercel deploy

1. [vercel.com](https://vercel.com/) → login с GitHub
2. **Add New Project** → импортирай `transport-plovdiv` repo
3. **Root Directory**: `web` (КРИТИЧНО)
4. **Framework**: Vite (auto-detect)
5. **Environment Variables**:
   ```
   VITE_MAPTILER_KEY=твоя_ключ
   ```
   (`VITE_API_URL` не е нужен - API е на същия origin)
6. **Deploy**

## CLI алтернатива

```bash
npm i -g vercel
cd web
vercel
# follow prompts
vercel --prod   # production deploy
```

## Локално

```bash
cd web
cp .env.example .env.local
# edit .env.local за VITE_MAPTILER_KEY
npm install
npm run dev   # → http://localhost:5173 (само frontend)
```

За локален тест на API functions, ползвай `vercel dev`:
```bash
cd web
vercel dev   # → http://localhost:3000 с functions
```

## Тестване след deploy

Отвори:
- `https://<your-app>.vercel.app/` → React app
- `https://<your-app>.vercel.app/api/lines` → JSON с 29 линии
- `https://<your-app>.vercel.app/api/eta/27` → live ETA данни
