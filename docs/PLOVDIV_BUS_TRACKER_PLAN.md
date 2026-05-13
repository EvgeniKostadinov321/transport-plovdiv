# Plovdiv Bus Tracker — Подробен план за имплементация

> **За кого е този документ:** Този план е написан за Claude Code в VS Code. Съдържа цялата техническа информация, контекст, архитектура и стъпки за изграждане на проекта. Чети целия документ преди да започнеш каквато и да е работа.

> **🟢 ОБНОВЕН 2026-05-13:** Spike тестът на ZK Framework е завършен успешно. Виж `spike/FINDINGS.md`. Ключови корекции:
> - ZK 6.0.1 EE (2012) — никакви защити, native fetch работи
> - **Не ни трябва Yurukov gist** — 532 спирки с GPS координати са embed-нати директно в initial HTML
> - **Не ни трябва Trakia Tech GTFS** за base data — нужен е само за: подреждане на спирки по линия + posoki + polyline shapes
> - AU endpoint връща **JSON** (не XML)
> - **Без monorepo** — решено flat layout (single repo засега, ще се решава ad-hoc)

---

## 1. Контекст и цел на проекта

### 1.1 Какво строим

Личен инструмент за проследяване на градските автобуси в Пловдив, България. Уебсайт (PWA), който показва приблизителна позиция на автобусите в реално време на карта, на базата на ETA данните от общинското виртуално табло.

**Краен потребител:** Разработчикът (Евгени) и около 10 негови приятели. **Това НЕ е публичен/комерсиален продукт.** Без брандинг, без маркетинг, без app store.

### 1.2 Защо го строим

В Пловдив градският транспорт регулярно закъснява с до 45 минути. Няма официален публичен GPS API. Съществуващите решения са или с ограничено покритие (Modeshift, 5 линии), или зависят от чужд goodwill (livetransport.eu).

### 1.3 User flow (хипер прост)

1. Потребителят влиза в сайта → Пловдив е дефолтна локация
2. Въвежда линии, които го интересуват (напр. "1, 33, 72")
3. Картата зарежда маршрутите с различни контрастни цветове
4. Картата показва приблизителни позиции на активните автобуси по тези линии
5. Позициите се обновяват на всеки 30 секунди

### 1.4 Какво НЕ строим (важно е да не се разпилява)

- ❌ Регистрация / auth система (минималистично — без потребители)
- ❌ Native mobile app (PWA е достатъчно)
- ❌ Всички 29 линии заредени по подразбиране (само избраните)
- ❌ Краудсорсинг / contributor система
- ❌ Push notifications
- ❌ App Store / Google Play
- ❌ Брандинг, лого, маркетинг страници
- ❌ Аналитика (Google Analytics, Plausible и т.н.)
- ❌ Многоезичност (само български в началото, евентуално английски по-късно)

---

## 2. Технически подход

### 2.1 Източник на данни

**Виртуалното табло на Община Пловдив:** `http://transport.plovdiv.bg/desktop/`

Това е JavaScript приложение, базирано на ZK Framework (Java backend). НЯМА документиран REST API. Цялата комуникация минава през непрозрачни `zkau` AJAX заявки. Данните за изпълнението на курсовете се актуализират на всеки 30 секунди.

**Какво ни дава:** За дадена спирка (по номер/код) — оставащо време до пристигане на автобуси от различни линии.

**Какво НЕ ни дава:** Директни GPS координати. Не дава "автобус X е на координати lat/lng".

### 2.2 Алгоритъм за изчисляване на позиция

Тъй като нямаме директен GPS, ще извличаме приблизителна позиция от ETA данните:

```
За всяка избрана линия (напр. 18):
  1. Знаем подредените спирки по маршрута: stop_1, stop_2, ..., stop_N
  2. Знаем GPS координатите на всяка спирка (от Yurukov gist)
  3. За всеки автобус по линията:
     - Намираме всички ETA-та за следващите N спирки
     - Намираме спирката с най-малко ETA (напр. stop_K с ETA=1мин)
     - Следващата спирка stop_K+1 има ETA=3мин
     - Изчисляваме разстоянието между stop_K и stop_K+1
     - Изчисляваме скоростта: (distance) / (3-1 = 2 минути)
     - Изчисляваме къде е автобусът точно сега:
       progress = elapsed_time / total_segment_time
       position = interpolate(stop_K, stop_K+1, progress)
```

### 2.3 Detection на достоверността

Таблата понякога лъжат (показват "5 мин" а отнема 25 мин). Ще имплементираме confidence система:

```
За всеки автобус, проследяваме ETA-то във времето:
  - Гладко намаляване (8→7→6→5→4 мин/мин): 🟢 HIGH confidence
  - Малки колебания (8→7→8→6→5): 🟡 MEDIUM confidence
  - Хаотични скокове (8→8→9→7→12): 🔴 LOW confidence — не показваме
```

Frontend показва различни цветове / икони според confidence нивото.

### 2.4 Архитектура

```
┌─────────────────┐
│  Виртуално      │
│  табло          │ ← scraping всеки 30 сек
│  (общината)     │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  Backend (Hono) │
│  - Scraper      │
│  - Position calc│
│  - Confidence   │
│  - WebSocket    │
└────────┬────────┘
         │ WebSocket
         ↓
┌─────────────────┐
│  Frontend       │
│  - React        │
│  - Leaflet      │
│  - PWA          │
└─────────────────┘
```

---

## 3. Технологичен стак

Използваме същия стак като SaaS-а на разработчика (за consistency и known infrastructure).

### 3.1 Frontend

- **React 19** + **TypeScript** + **Vite**
- **TailwindCSS 4** за стилизация
- **TanStack Query** за data fetching и кеширане
- **react-leaflet** + **leaflet** за картата
- **OpenStreetMap** tiles (безплатни)
- **PWA** конфигурация (vite-plugin-pwa)

### 3.2 Backend

- **Hono** (Node.js) — REST + WebSocket endpoints
- **Cheerio** или **node-html-parser** за парсване на ZK responses
- **node-fetch** или native fetch за HTTP заявки към таблото
- **ws** (WebSocket library)
- **Redis** или in-memory cache (Map) за кеширане на ETA данни (на този етап in-memory е достатъчно)

### 3.3 Data storage

- **SQLite** (better-sqlite3) за статични данни (линии, спирки, маршрути)
- На този етап **НЯМА нужда от PostgreSQL/Supabase** — статичните данни не се променят, а live данните са ephemeral

### 3.4 Hosting

- **Frontend:** Vercel (free tier)
- **Backend:** Railway (има безплатен план с месечен лимит часове)
- **Domain:** ще ползваме .vercel.app поддомейн в началото (без custom domain)

---

## 4. Monorepo структура

```
plovdiv-bus-tracker/
├── apps/
│   ├── web/                    # React + Vite frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── Map.tsx
│   │   │   │   ├── LineSelector.tsx
│   │   │   │   ├── BusMarker.tsx
│   │   │   │   └── ConfidenceIndicator.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useBusPositions.ts
│   │   │   │   └── useLines.ts
│   │   │   ├── lib/
│   │   │   │   ├── websocket.ts
│   │   │   │   └── colors.ts
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── public/
│   │   │   └── manifest.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   └── api/                    # Hono backend
│       ├── src/
│       │   ├── routes/
│       │   │   ├── lines.ts
│       │   │   ├── stops.ts
│       │   │   └── ws.ts
│       │   ├── services/
│       │   │   ├── scraper.ts        # Парсва transport.plovdiv.bg
│       │   │   ├── position-calc.ts  # Изчислява позиции
│       │   │   ├── confidence.ts     # ETA history & confidence
│       │   │   └── data-loader.ts    # Зарежда static data
│       │   ├── lib/
│       │   │   ├── zk-client.ts      # ZK Framework client
│       │   │   └── geo.ts            # Geo math (interpolation, distance)
│       │   ├── types/
│       │   │   └── index.ts
│       │   ├── db/
│       │   │   ├── schema.sql
│       │   │   └── plovdiv.db        # SQLite file
│       │   └── index.ts
│       └── package.json
│
├── packages/
│   └── shared/                 # Shared types между web и api
│       ├── src/
│       │   └── types.ts
│       └── package.json
│
├── data/
│   ├── raw/
│   │   ├── trakia-tech-gtfs.zip       # Свален Trakia Tech GTFS
│   │   └── yurukov-stops.tsv          # Спирки от Yurukov gist
│   ├── processed/
│   │   ├── routes.json
│   │   ├── stops.json
│   │   └── route-stops.json
│   └── scripts/
│       ├── download-gtfs.ts
│       ├── parse-gtfs.ts
│       └── seed-db.ts
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

## 5. Поетапен план за имплементация

### Фаза 0: Setup (Ден 1, ~2-3 часа)

**Цел:** Празна работеща monorepo структура.

#### 5.0.1 Инициализиране на monorepo

```bash
mkdir plovdiv-bus-tracker && cd plovdiv-bus-tracker
pnpm init
```

Създай `pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

Създай `turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "test": {}
  }
}
```

#### 5.0.2 Инициализиране на web app

```bash
cd apps
pnpm create vite@latest web -- --template react-ts
cd web
pnpm install
pnpm add tailwindcss@next @tailwindcss/vite
pnpm add react-leaflet leaflet @types/leaflet
pnpm add @tanstack/react-query
pnpm add -D vite-plugin-pwa
```

Конфигурирай Tailwind CSS 4 според официалната документация.

#### 5.0.3 Инициализиране на api app

```bash
cd ../
mkdir api && cd api
pnpm init
pnpm add hono @hono/node-server
pnpm add cheerio
pnpm add ws @types/ws
pnpm add better-sqlite3 @types/better-sqlite3
pnpm add -D typescript @types/node tsx
```

Създай `tsconfig.json` и базов `src/index.ts`.

#### 5.0.4 Shared package

```bash
cd ../../packages
mkdir shared && cd shared
pnpm init
# конфигурирай TypeScript за пакета
```

### Фаза 1: Data acquisition (Ден 2-3, ~4-6 часа)

**Цел:** Имаме всички спирки, линии и маршрути в локална база данни.

#### 5.1.1 Сваляне на Trakia Tech GTFS

Създай `data/scripts/download-gtfs.ts`:

```typescript
// Сваля https://trakia.tech/gtfs/plovdiv.zip
// Разархивира в data/raw/gtfs/
// GTFS съдържа: agency.txt, routes.txt, stops.txt, trips.txt,
//               stop_times.txt, calendar.txt, shapes.txt
```

**ВАЖНО:** Trakia Tech GTFS е остарял от 2022 г. Не разчитай 100% на него. Кросс-валидирай с Yurukov данните.

#### 5.1.2 Сваляне на Yurukov stops

URL: `https://gist.github.com/yurukov/d042f0c7145ac79522960e32f7fc53df`

Конкретният TSV файл съдържа ~460 спирки с формат:
```
stop_id  stop_name  lat  lng  lines_list
```

Свали raw TSV и запази в `data/raw/yurukov-stops.tsv`.

#### 5.1.3 Парсване и нормализация

Създай `data/scripts/parse-gtfs.ts`:

1. Парсва GTFS файловете (CSV формат)
2. Извлича:
   - Списък с линии (route_id, route_short_name, route_long_name)
   - Списък със спирки (stop_id, name, lat, lng)
   - Маршрути (shapes.txt — точки на полилинията на всеки маршрут)
   - Подредени спирки по линия (от stop_times.txt + trips.txt)
3. Кросс-проверява срещу Yurukov данните и предпочита по-точните координати
4. Записва в `data/processed/`:
   - `routes.json` — масив от линии
   - `stops.json` — масив от спирки
   - `route-stops.json` — map от route_id към подредени stop_ids
   - `route-shapes.json` — map от route_id към GeoJSON LineString

#### 5.1.4 Seed на SQLite база

Създай `data/scripts/seed-db.ts`:

```sql
CREATE TABLE routes (
  id TEXT PRIMARY KEY,
  short_name TEXT NOT NULL,
  long_name TEXT,
  color TEXT
);

CREATE TABLE stops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  -- Кодът на спирката от virtual board (различен от stop_id в GTFS!)
  board_code TEXT
);

CREATE TABLE route_stops (
  route_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  direction INTEGER NOT NULL,  -- 0 или 1
  sequence INTEGER NOT NULL,
  FOREIGN KEY (route_id) REFERENCES routes(id),
  FOREIGN KEY (stop_id) REFERENCES stops(id),
  PRIMARY KEY (route_id, direction, sequence)
);

CREATE TABLE route_shapes (
  route_id TEXT NOT NULL,
  direction INTEGER NOT NULL,
  geojson TEXT NOT NULL,
  PRIMARY KEY (route_id, direction)
);

CREATE INDEX idx_route_stops_route ON route_stops(route_id);
CREATE INDEX idx_stops_board_code ON stops(board_code);
```

**Критична задача:** Намери mapping между GTFS stop_id и кода на спирката във виртуалното табло. Това може да изисква ръчно изследване — виртуалното табло използва свои кодове (обикновено 4-цифрени числа).

### Фаза 2: Reverse engineering на виртуалното табло (Ден 4-7, ~10-15 часа)

**Цел:** Backend може програмно да получи ETA за дадена спирка.

#### 5.2.1 Ръчно изследване

1. Отвори `http://transport.plovdiv.bg/desktop/` в браузър
2. Отвори DevTools → Network tab
3. Въведи код на спирка (напр. 0027 за някоя централна спирка)
4. Наблюдавай заявките:
   - Първоначалното зареждане прави GET и създава ZK desktop (връща `dtid` UUID)
   - Натискане на бутон / въвеждане прави POST към `/zkau` с form data
   - Response е XML/HTML fragment с командите за update на UI
5. Документирай **точните headers, body формат, и response структура**

#### 5.2.2 ZK Framework basics

ZK работи така:
- Server поддържа stateful UI tree
- Всеки клиент има `dtid` (desktop ID)
- Всеки компонент има `uuid` (component ID)
- Action: клиентът праща `data: cmd_0=onClick;target=z_xx_y;...` 
- Response: server връща XML с команди като `<setAttr u="z_xx_y" n="value" v="новата стойност"/>`

**Полезни референции:**
- ZK manual: https://www.zkoss.org/wiki/ZK_Developer's_Reference
- Yurukov gist: https://gist.github.com/yurukov/d042f0c7145ac79522960e32f7fc53df (има примерен bash скрипт)

#### 5.2.3 Имплементация на ZK client

Създай `apps/api/src/lib/zk-client.ts`:

```typescript
interface ZkSession {
  dtid: string;        // Desktop UUID
  cookies: string;     // Session cookies
  componentIds: Map<string, string>; // role → uuid mapping
}

class ZkClient {
  async initSession(): Promise<ZkSession> {
    // 1. GET http://transport.plovdiv.bg/desktop/
    // 2. Parse HTML, extract dtid от <script> или meta
    // 3. Идентифицирай component UUIDs за:
    //    - input field за код на спирка
    //    - бутон "Покажи"
    //    - резултатния списък
    // 4. Запази cookies
  }

  async queryStop(session: ZkSession, stopCode: string): Promise<StopETAResult> {
    // 1. POST към /zkau/{dtid} с команди:
    //    - setValue към input компонента
    //    - onClick към бутона
    // 2. Parse XML response
    // 3. Извлечи списък с пристигащи автобуси:
    //    [{ line: "18", arrival_minutes: 5, destination: "..." }, ...]
  }
}
```

#### 5.2.4 Тестване

Напиши тестове, които:
1. Инициализират сесия
2. Питат за известна спирка (напр. в центъра)
3. Сравняват резултата с реалното табло в браузъра

**Очаквай шумна работа** — ZK Framework е capricious. Сесии може да expire-нат. Component UUIDs може да се сменят между deploys на общинския сървър.

### Фаза 3: Position calculation (Ден 8-9, ~6-8 часа)

**Цел:** За дадена линия, можем да изчислим приблизителни позиции на всички активни автобуси.

#### 5.3.1 ETA aggregation

Създай `apps/api/src/services/scraper.ts`:

```typescript
interface LineETASnapshot {
  line: string;
  direction: 0 | 1;
  timestamp: number;
  // За всяка спирка по маршрута, ETA в минути (или null ако няма данни)
  stopETAs: Map<string, number | null>;
}

async function getLineSnapshot(routeId: string): Promise<LineETASnapshot> {
  // 1. Зареди подредените спирки за тази линия (от DB)
  // 2. За всяка спирка, направи zkClient.queryStop()
  // 3. Извлечи ETA-то за конкретната линия
  // 4. Върни snapshot
}
```

**Оптимизация:** Не питай всички спирки последователно — паралелизирай с rate limiting (max 3 concurrent заявки, 200ms delay между batch-ове). Това дава ~20-30 секунди за линия с 30 спирки, което е твоят 30-секунден polling interval.

#### 5.3.2 Position interpolation

Създай `apps/api/src/services/position-calc.ts`:

```typescript
interface BusPosition {
  line: string;
  direction: 0 | 1;
  lat: number;
  lng: number;
  confidence: 'high' | 'medium' | 'low';
  // Откъде идва (между кои спирки):
  betweenStops: [string, string];
  progress: number; // 0 = at stop A, 1 = at stop B
}

function calculatePositions(snapshot: LineETASnapshot, stops: Stop[]): BusPosition[] {
  // Алгоритъм:
  // 1. Намери "low points" в ETA масива — спирки, където ETA е малко (1-2 мин)
  //    и следващата спирка има по-голямо ETA. Това означава автобус току-що мина.
  // 2. За всеки low point:
  //    - stop_K има ETA = t_K
  //    - stop_K+1 има ETA = t_K+1
  //    - Ако t_K+1 > t_K, имаме автобус между K и K+1
  //    - progress = t_K / (t_K+1)
  //    - position = interpolate_along_segment(stop_K, stop_K+1, progress)
  // 3. Може да има няколко автобуса по същата линия (не само 1)
}
```

**Гранични случаи:**
- Автобус току-що е стигнал крайна спирка → ETA = 0 на последната, няма ETA нататък
- Първа спирка показва ETA = 0 (автобусът е там) → позиция = координатите на спирката
- ETA скача нагоре (от 5 на 8) → конфликт с предположението, ниска confidence

#### 5.3.3 Geo interpolation

Създай `apps/api/src/lib/geo.ts`:

```typescript
// Прост вариант: линейна интерполация между две точки
function interpolatePoint(a: LatLng, b: LatLng, progress: number): LatLng {
  return {
    lat: a.lat + (b.lat - a.lat) * progress,
    lng: a.lng + (b.lng - a.lng) * progress
  };
}

// По-точен вариант: интерполация по shape на маршрута
function interpolateAlongShape(
  shape: GeoJSON.LineString,
  fromStop: LatLng,
  toStop: LatLng,
  progress: number
): LatLng {
  // 1. Намери на коя позиция в shape-а е fromStop
  // 2. Намери на коя позиция в shape-а е toStop
  // 3. Изчисли progress между двете точки по shape-а
  // 4. Върни точката
}
```

### Фаза 4: Confidence tracking (Ден 10, ~3-4 часа)

**Цел:** За всеки автобус, знаем дали данните се държат "разумно".

#### 5.4.1 ETA history

Създай `apps/api/src/services/confidence.ts`:

```typescript
// Keep last N snapshots per line (e.g., N=10)
const HISTORY_SIZE = 10;
const history: Map<string, LineETASnapshot[]> = new Map();

function addSnapshot(routeId: string, snapshot: LineETASnapshot) {
  const list = history.get(routeId) ?? [];
  list.push(snapshot);
  if (list.length > HISTORY_SIZE) list.shift();
  history.set(routeId, list);
}

function calculateConfidence(routeId: string, stopId: string): Confidence {
  const list = history.get(routeId) ?? [];
  if (list.length < 3) return 'low'; // Не достатъчно данни
  
  // Извлечи ETA-та за тази спирка през последните snapshots
  const etas = list.map(s => s.stopETAs.get(stopId)).filter(Boolean);
  
  // Изчисли delta-та между последователни ETA-та
  // Идеално: всеки 30 сек ETA-то намалява с ~0.5 мин
  // Лошо: ETA-то скача нагоре/надолу
  
  const expectedDelta = -0.5; // мин/snapshot (30 сек)
  const deltas = [];
  for (let i = 1; i < etas.length; i++) {
    deltas.push(etas[i] - etas[i-1]);
  }
  
  const avgDeviation = deltas.reduce((acc, d) => acc + Math.abs(d - expectedDelta), 0) / deltas.length;
  
  if (avgDeviation < 0.5) return 'high';
  if (avgDeviation < 1.5) return 'medium';
  return 'low';
}
```

### Фаза 5: Backend API (Ден 11-12, ~6-8 часа)

**Цел:** Frontend може да получи данни през HTTP + WebSocket.

#### 5.5.1 REST endpoints

В `apps/api/src/index.ts`:

```typescript
app.get('/api/routes', (c) => {
  // Връща списък с всички линии
});

app.get('/api/routes/:id', (c) => {
  // Връща детайли за линия: stops (подредени), shape (GeoJSON)
});

app.get('/api/positions/:routeId', (c) => {
  // Връща текущите позиции на автобусите по тази линия
});
```

#### 5.5.2 WebSocket endpoint

```typescript
// Клиентът се subscribe-ва за конкретни линии
// Server push-ва updates на всеки 30 сек

interface WSMessage {
  type: 'subscribe' | 'unsubscribe' | 'positions';
  routes?: string[]; // напр. ['18', '33', '72']
  data?: BusPosition[];
}
```

#### 5.5.3 Scraping loop

```typescript
// Background job, който върви постоянно
async function scrapingLoop() {
  while (true) {
    const subscribedRoutes = getAllSubscribedRoutes();
    for (const routeId of subscribedRoutes) {
      try {
        const snapshot = await getLineSnapshot(routeId);
        addSnapshot(routeId, snapshot);
        const positions = calculatePositions(snapshot, stops);
        broadcastToSubscribers(routeId, positions);
      } catch (err) {
        console.error(`Failed to scrape ${routeId}:`, err);
      }
    }
    await sleep(30_000);
  }
}
```

**ВАЖНО:** Само линиите, които някой реално гледа, се scrape-ват. Не scrape-вай всички 29 линии — общината ще те блокира.

### Фаза 6: Frontend (Ден 13-15, ~10-12 часа)

**Цел:** Работещ UI с карта и избор на линии.

#### 5.6.1 Базов UI

```tsx
// apps/web/src/App.tsx
function App() {
  const [selectedLines, setSelectedLines] = useState<string[]>(() => {
    const saved = localStorage.getItem('selectedLines');
    return saved ? JSON.parse(saved) : [];
  });

  return (
    <div className="h-screen flex flex-col">
      <LineSelector lines={selectedLines} onChange={setSelectedLines} />
      <Map lines={selectedLines} />
    </div>
  );
}
```

#### 5.6.2 LineSelector компонент

```tsx
function LineSelector({ lines, onChange }) {
  const [input, setInput] = useState('');
  
  const addLine = (line: string) => {
    onChange([...lines, line]);
    saveToLocalStorage([...lines, line]);
  };
  
  // Простичък input + chips за избраните линии
}
```

#### 5.6.3 Map компонент

```tsx
import { MapContainer, TileLayer, Polyline, Marker } from 'react-leaflet';

function Map({ lines }) {
  const { routes } = useRoutes(lines);
  const { positions } = useBusPositions(lines); // WebSocket hook
  
  return (
    <MapContainer center={[42.1354, 24.7453]} zoom={13} className="h-full">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© OpenStreetMap contributors'
      />
      {routes.map(route => (
        <Polyline 
          key={route.id} 
          positions={route.shape} 
          color={getLineColor(route.id)}
        />
      ))}
      {positions.map(pos => (
        <BusMarker key={`${pos.line}-${pos.id}`} position={pos} />
      ))}
    </MapContainer>
  );
}
```

#### 5.6.4 Color assignment

Създай `apps/web/src/lib/colors.ts`:

```typescript
// Контрастна, distinguishable палитра от ~12 цвята
const PALETTE = [
  '#e6194B', '#3cb44b', '#ffe119', '#4363d8',
  '#f58231', '#911eb4', '#42d4f4', '#f032e6',
  '#bfef45', '#fabed4', '#469990', '#9A6324',
];

export function getLineColor(lineId: string): string {
  // Hash-based deterministic color
  let hash = 0;
  for (let i = 0; i < lineId.length; i++) {
    hash = (hash << 5) - hash + lineId.charCodeAt(i);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
```

#### 5.6.5 WebSocket hook

```tsx
// apps/web/src/hooks/useBusPositions.ts
export function useBusPositions(lines: string[]) {
  const [positions, setPositions] = useState<BusPosition[]>([]);
  
  useEffect(() => {
    const ws = new WebSocket(import.meta.env.VITE_WS_URL);
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', routes: lines }));
    };
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'positions') {
        setPositions(prev => mergePositions(prev, msg.data));
      }
    };
    
    return () => ws.close();
  }, [lines]);
  
  return { positions };
}
```

#### 5.6.6 BusMarker с анимация

```tsx
function BusMarker({ position }: { position: BusPosition }) {
  // Smooth animation от старата позиция към новата
  const animatedPos = useAnimatedPosition(position, 30_000);
  
  const icon = L.divIcon({
    className: 'bus-marker',
    html: `<div style="background:${getLineColor(position.line)};
                       opacity:${position.confidence === 'high' ? 1 : 0.5}">
             ${position.line}
           </div>`,
  });
  
  return <Marker position={[animatedPos.lat, animatedPos.lng]} icon={icon} />;
}
```

### Фаза 7: PWA setup (Ден 16, ~2-3 часа)

```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Plovdiv Bus Tracker',
        short_name: 'PlovdivBus',
        theme_color: '#1a73e8',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          // 192x192 и 512x512 PNG
        ]
      }
    })
  ]
});
```

### Фаза 8: Deploy (Ден 17, ~3-4 часа)

#### 5.8.1 Backend на Railway

```bash
# В apps/api
railway init
railway up
```

Конфигурирай environment variables:
- `PORT` (Railway го дава)
- `CORS_ORIGIN=https://plovdiv-bus.vercel.app`

#### 5.8.2 Frontend на Vercel

```bash
cd apps/web
vercel
```

Environment variables:
- `VITE_API_URL=https://plovdiv-bus-api.up.railway.app`
- `VITE_WS_URL=wss://plovdiv-bus-api.up.railway.app/ws`

### Фаза 9: Testing с реалност (Седмица 1 след deploy)

**Цел:** Разбираме колко точна е системата.

Метод:
1. Ползваш сайта седмица време при реални пътувания
2. Когато тръгваш към спирка, отбелязваш:
   - Какво казва нашия сайт (ETA, позиция)
   - Какво казва общинското табло
   - Реалното време на пристигане
3. След седмица:
   - Среден delta между нашия ETA и реалния → точност
   - % случаи, когато confidence=high е била точно → надеждност
   - % случаи, когато automatically сме показали low confidence → правилно detection

**Threshold за продължаване:**
- Ако точност в 70%+ от случаите → продължаваме, проектът е полезен
- Ако точност в <40% → виртуалното табло просто лъже прекалено често, продуктът няма смисъл

---

## 6. Известни проблеми и rate limiting

### 6.1 Общината може да блокира IP

Митигиране:
- Rate limit: max 1 заявка / 2 сек към виртуалното табло
- Кеширай ETA за 30 сек (не питай два пъти в рамките на 30 сек за същата спирка)
- При 429/403 response → exponential backoff
- При persistent блок → Cloudflare Workers proxy с ротация на IP

### 6.2 ZK сесии expire-ват

Митигиране:
- Re-initialize session при failure
- Pool от 2-3 сесии rotating
- Heartbeat към server-а на всеки 5 мин за keep-alive

### 6.3 Component UUIDs може да се сменят

Митигиране:
- Не hardcode-вай UUIDs
- При всяка нова сесия → парсвай HTML и идентифицирай компонентите по техните CSS класове / атрибути
- Log warnings когато се сменят

### 6.4 Trakia Tech GTFS е остарял

Митигиране:
- Кросс-валидация с Yurukov stops
- Manual проверка на топ 10 линии — дали стартовите/крайните спирки са верни
- Възможност за ръчно корекции в `data/manual-overrides.json`

### 6.5 Smen на концесионера (март 2026)

Новата фирма (консорциум "Градски транспорт – 2026" / Петко Ангелов) може да:
- Промени маршрути
- Промени номерата на спирките в таблото
- Да направи нова система (по-малко вероятно в първите 6 мес.)

Митигиране: периодично re-check на статичните данни (веднъж месечно). Може да поискаме от Trakia Tech дали ще обновят GTFS-а.

---

## 7. Технически референции

### 7.1 Източници на данни

- **Trakia Tech GTFS:** `https://trakia.tech/gtfs/plovdiv.zip`
- **Yurukov stops gist:** `https://gist.github.com/yurukov/d042f0c7145ac79522960e32f7fc53df`
- **Виртуално табло:** `http://transport.plovdiv.bg/desktop/`
- **OpenStreetMap tiles:** `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` (с attribution!)

### 7.2 Документация

- **GTFS specification:** https://gtfs.org/schedule/reference/
- **ZK Framework:** https://www.zkoss.org/wiki/ZK_Developer's_Reference
- **Hono:** https://hono.dev/
- **react-leaflet:** https://react-leaflet.js.org/
- **TanStack Query:** https://tanstack.com/query/latest

### 7.3 Inspiration (само за reference, не copy-paste)

- **Sofia Public Transport API:** https://github.com/ivkos/Sofia-Public-Transport-API (различен град, но добър пример за scraping архитектура)
- **livetransport.eu:** Closed source, но визуално inspiration

---

## 8. Координати и константи

```typescript
// Център на Пловдив
export const PLOVDIV_CENTER = {
  lat: 42.1354,
  lng: 24.7453
};

// Bounding box за валидация (data sanity checks)
export const PLOVDIV_BOUNDS = {
  north: 42.20,
  south: 42.08,
  east: 24.85,
  west: 24.65
};

// Дефолтни настройки
export const DEFAULT_ZOOM = 13;
export const SCRAPE_INTERVAL_MS = 30_000;
export const ETA_HISTORY_SIZE = 10;
```

---

## 9. Контролни точки и критерии за успех

| Фаза | Контролна точка | Критерий за успех |
|------|----------------|-------------------|
| 0 | Setup | Monorepo стартира, pnpm install работи |
| 1 | Data | SQLite база има 29 линии и 460 спирки |
| 2 | Scraper | Можем програмно да получим ETA за спирка |
| 3 | Position | Имаме позиция на автобус за поне една линия |
| 4 | Confidence | Различни confidence нива се генерират |
| 5 | API | WebSocket клиент може да subscribe и получи updates |
| 6 | Frontend | Картата показва маршрути и движещи се автобуси |
| 7 | PWA | Може да се "инсталира" на телефон |
| 8 | Deploy | Достъпно на public URL |
| 9 | Reality | 70%+ точност в реални тестове |

---

## 10. Известни рискове за провал

1. **ZK Framework е твърде труден за reverse engineering** → ще трябва Selenium/Puppeteer + headless browser (по-бавно, по-скъпо, но работи)
2. **Общината блокира IP** → Cloudflare Workers proxy или хостинг с ротиращи IP-та
3. **Виртуалното табло лъже в 50%+ от случаите** → продуктът няма достатъчна стойност, спираме
4. **Trakia Tech GTFS е твърде остарял** → ръчно construct-ваме поне топ 10 линии
5. **Mapping между GTFS stops и board codes е невъзможен** → ръчно mapping за топ спирки

---

## 11. Какво да правиш ПЪРВО когато получиш този план

1. Прочети целия документ внимателно
2. Започни с **Фаза 0** — setup на monorepo
3. Преди да продължиш с Фаза 2 (scraping), направи **manual exploration** на виртуалното табло в браузъра, за да разбереш ZK протокола
4. Документирай находките си в `RESEARCH.md` като референция
5. **Не оптимизирай прерано.** In-memory cache > Redis в началото. SQLite > PostgreSQL.
6. При всеки етап **тествай ръчно** преди да продължиш напред
7. Ако нещо не работи (виртуалното табло, GTFS-ът, и т.н.) — спри и преоцени, не насилвай

---

## 12. Кратка контекстна информация за разработчика

- **Опит:** Frontend програмист, активно работи върху SaaS продукт с React 19, TypeScript, Vite, TailwindCSS 4, TanStack Query, Hono, Drizzle, PostgreSQL, Supabase, Firebase Auth, Railway, Vercel.
- **Не иска:** RE на мобилни приложения, партньорства, краудсорсинг.
- **Бюджет:** Безплатни tier-и в началото.
- **Аудитория:** ~10 души приятели в Пловдив.
- **Времеви хоризонт:** Дългосрочен проект, без deadline.

---

**Край на плана. Започни с Фаза 0.**
