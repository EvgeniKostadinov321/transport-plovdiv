# Deploy инструкции

## Backend (Railway)

1. Отиди на [railway.app](https://railway.app/) и login с GitHub
2. **New Project** → **Deploy from GitHub repo** → избери този repo
3. Railway ще detect-не monorepo - кажи му да build-не само `api/` папката:
   - **Settings** → **Root Directory**: `api`
4. Setup env vars в **Variables**:
   ```
   PORT=3001
   CORS_ORIGIN=https://your-app.vercel.app
   ```
   (CORS_ORIGIN сложи го след като direct-неш Vercel)
5. **Settings** → **Networking** → **Generate Domain** → копирай URL-а
   (нещо като `transport-plovdiv-api-production.up.railway.app`)
6. Provel-вай че работи: отвори URL-а в браузъра, трябва да видиш `transport-plovdiv api`

### CLI алтернатива

```bash
npm i -g @railway/cli
railway login
cd api
railway init
railway up
railway domain
```

## Frontend (Vercel)

1. Отиди на [vercel.com](https://vercel.com/) и login с GitHub
2. **Add New Project** → импортирай repo-то
3. **Root Directory**: `web` (важно!)
4. **Framework Preset**: Vite (autodetect)
5. **Environment Variables**:
   ```
   VITE_API_URL=https://your-api.up.railway.app
   VITE_MAPTILER_KEY=your_maptiler_key
   ```
6. **Deploy**

### CLI алтернатива

```bash
npm i -g vercel
cd web
vercel
# follow prompts, set env vars
```

## След deploy

1. Копирай Vercel URL-а (`https://transport-plovdiv.vercel.app`)
2. Върни се в Railway → промени `CORS_ORIGIN` на този URL
3. Redeploy backend-а
4. Тествай на телефона: отвори URL-а в Safari/Chrome → "Add to Home Screen"

## Локален preview

```bash
# api
cd api && npm run dev

# web
cd web && npm run dev
```

## Production preview локално

```bash
cd web && npm run build && npm run preview
```
