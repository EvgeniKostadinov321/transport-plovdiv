# Plan за нови функционалности

## Анализ на сегашния код

**App.tsx — 734 реда.** Започва да става твърде голям. Има всички components в един файл:
- `fetchETA` + `clientCache` (network logic)
- `StopPopupContent` (popup)
- `StopMarker` (marker logic)
- `BottomSheet` (mobile)
- `LineSelector` (filter UI)
- `App` (root)
- helper: `cleanText`, `useIsTouch`, `loadSelectedLines`, `loadTheme`

**Препоръка преди да добавяме features:** Refactor на App.tsx в няколко файла. Иначе ще нараства до 1500+ реда и ще става тромаво.

---

## ✅ Препоръчителен ред

1. **Refactor first** — разбиваме App.tsx (Фаза 0)
2. **Search bar** (най-просто, валидира refactor-а)
3. **Geolocation** ("къде съм")
4. **Favorites** (pin спирки)
5. **Bus position interpolation** (изисква Playwright seed)
6. **Notifications** (последно — нужни са по-стабилни workflow-и)

---

## Фаза 0: Refactor (preparation)

**Цел:** App.tsx → разбит на focused файлове. Поддържаемо за нови features.

### Нова структура

```
web/src/
├── App.tsx                       (~100 реда - just App + routes)
├── colors.ts                     (вече има)
├── types.ts                      (Stop, ETAEntry, ETAResponse, Theme)
├── api.ts                        (fetchETA, fetchStops, fetchLines, clientCache)
├── hooks/
│   ├── useIsTouch.ts
│   ├── useStopsAndLines.ts       (fetch + state)
│   └── useTheme.ts               (theme + persist + apply)
├── storage.ts                    (localStorage helpers: lines, theme, favorites)
└── components/
    ├── Map.tsx                   (MapContainer + TileLayer + markers)
    ├── StopMarker.tsx
    ├── StopPopupContent.tsx
    ├── BottomSheet.tsx
    ├── LineSelector.tsx
    └── EmptyState.tsx
```

### Тестване
- Build трябва да минава
- Hot reload работи
- Нула функционални промени

**Време:** ~1-1.5 часа

---

## Фаза 1: Search bar

**Цел:** Бързо намиране на спирка по име.

### UX
- Search input ВЪТРЕ в line selector panel-а (горе, над grid-а с линиите)
- Placeholder: "Търси спирка..."
- При въвеждане → fuzzy match по `stop.name` И `stop.number` (примерно "тран" → "Транспортна болница")
- Резултати: list с спирки → click показва popup на map-а с този стоп (zoom + open)

### Технически
- Debounced filter (200ms)
- Match: case-insensitive, ignore diacritics ("Бул." === "бул"), substring
- Не overcomplicate — обикновен JS string match е достатъчен за 530 elements

### UI варианти

**Опция А (по-просто):** Search в same panel като line picker
```
┌─────────────────────────────────┐
│ Линии в Пловдив       Изчисти ✕ │
├─────────────────────────────────┤
│ 🔍 [Търси спирка...]           │
├─────────────────────────────────┤
│  1   4   6   7   9  10   ...   │
└─────────────────────────────────┘
```

**Опция Б (отделен tab/mode):** Tab toggle "Линии | Спирки"

### Тестване
- Намери "Транспортна болница" → лесно
- Кликни на резултата → карта се premest-ва и popup-а се отваря
- Изчисти search → стандартен view

**Време:** ~1 час

---

## Фаза 2: Geolocation

**Цел:** Бутон "къде съм" + auto-center.

### UX
1. Нов бутон в toolbar (между clear filter и theme): "📍 близо до мен"
2. Кликни → browser permission prompt (вграден)
3. Permission granted → 
   - Карта се центрира на твоята позиция
   - Marker на твоята позиция (различен цвят, синя точка със ring)
   - Auto-sort на близките спирки (изчислява разстояние)
4. Permission denied → toast "Геолокацията е изключена"

### Технически
- `navigator.geolocation.getCurrentPosition` (one-shot)
- `navigator.geolocation.watchPosition` за live tracking (опционално)
- Haversine formula за разстояние
- localStorage flag: `transport-plovdiv.locationAsked` за да не питаме всеки път

### Bonus
- "Близки спирки" sortирани списък в bottom sheet на mobile (бутон → отваря sheet)
- На desktop: floating panel с top 5 близки спирки

### Privacy
- Не запазваме координати
- Сесия-only state

**Време:** ~1.5 часа

---

## Фаза 3: Favorites (pin)

**Цел:** Bookmark на често ползвани спирки.

### Data model
```ts
interface Favorite {
  stopNumber: number
  label?: string        // user-defined: "до вкъщи", "до работа"
  pinnedAt: number      // timestamp
  selectedLines?: string[]  // optional: pin to specific lines too
}
```

localStorage: `transport-plovdiv.favorites: Favorite[]`

### UX

**Star button в popup-а:**
- ⭐ pin/unpin бутон до stop name
- Filled когато е pinned

**Favorites view:**
- Нов tab в line selector panel: "Линии | Favorites"
- List от pinned стопове с:
  - #номер + име
  - last ETA cache (если в cache-а)
  - quick action: open popup, remove pin
- Optional: drag-to-reorder

**Hotkey button в toolbar:**
- ⭐ бутон → отваря favorites list

### Bonus
- Custom labels: "Tap to edit" → input
- Color coding (за визуално разграничаване)
- Export/import favorites (JSON)

### Edge cases
- Pin спирка → визуален indicator на картата (golden ring around marker)
- При hover на pinned спирка → tooltip с label-а

**Време:** ~2 часа

---

## Фаза 4: Bus position interpolation

**Цел:** Движещи се автобуси на картата.

### Зависимости

**КРИТИЧНО:** Изисква **stop ordering** — кои спирки следват една след друга по маршрут и в коя посока.

Текущо имаме само:
- `Stop.lines` (кои линии минават през спирка)

Трябва:
- `RouteOrder { line, direction, orderedStops[] }`

### Подходи за извличане на ordering

#### Подход А: Playwright seed (от плана)
- Headless Chromium посещава transport.plovdiv.bg
- За всяка от 29 линии × 2 посоки → клик в UI и extract
- Output: `data/seed/route-stops.json`
- One-time, ~5-10 мин run

**Минус:** ZK Framework state machine е fragile (видяхме в spike v4)

#### Подход Б: Експлоатиране на ETA destination strings
Идея: всяка ETA има `destination`. Destination = крайна спирка на маршрут.
- За всяка линия в данните → разпознаваме 2 destination string-а (= 2 посоки)
- За всеки stop, ETA destination = посоката от която идва автобуса
- Но не дава **order**, само grouping by direction

**Минус:** Само destination, не порядък.

#### Подход В: Манифестно (best effort)
- Започваме с 5-10 най-популярни линии
- Ръчно construct-ваме order като се обадим на общинския сайт за всяка спирка по линията и видим destination patterns
- Записваме в JSON

**Минус:** Време-консумиращо ръчно (~3-4 часа за 5 линии)

#### Препоръка: Подход А (Playwright)
Нека отделим **~3 часа** за proper Playwright seed. Това е one-time investment който отключва bus positions, route polylines, и т.н.

### Position interpolation algorithm

След като имаме ordering:

```typescript
// За дадена линия в дадена посока:
function estimateBusPositions(
  line: string,
  direction: 'A' | 'B',
  etaByStop: Map<number, ETAEntry[]>,  // ETA-та за всяка спирка от поллинг
  routeStops: Stop[]  // подредени спирки
): BusPosition[] {
  // 1. За всяка двойка съседни спирки (i, i+1):
  // 2. Намери ETA за двете спирки за тази линия и посока
  // 3. Ако ETA[i] < ETA[i+1]: има автобус между тях
  // 4. Линейна интерполация на координати по time progress
}
```

### Visual

- Bus icon (SVG) с цвета на линията
- Движение: smooth CSS animation между updates (every 30s polling)
- Tooltip на hover: "Линия 18 към ПУ, след 3 мин на сп. #14"

### Технически complexities

- Multiple buses on same line (от ETA-тата виждаме до 7 автобуса)
- Polling — нужни много заявки (5 линии × 30 спирки = 150 заявки/30s = 5 req/s)
- Очаквай rate limiting от общината
- Confidence система: ако ETA скача → low confidence → не показваме

**Време:** Playwright seed (3ч) + position calc + UI (3ч) = ~6 часа

---

## Фаза 5: Notifications

**Цел:** "Уведоми ме когато линия 18 е на 5 мин от спирка #27"

### UX
1. В popup → бутон "🔔 Уведоми ме"
2. Modal/sheet: избор линия + минути before
3. Confirm → стартира polling в service worker
4. Когато trigger → notification + sound

### Технически
- **Browser Notification API** (Permission API)
- **Service Worker** background polling
  - Опасно: повишена battery drain
  - Алтернатива: foreground polling докато tab-а е отворен
- **localStorage**: active subscriptions
- **Auto-cleanup**: cancel notification when triggered (one-shot)

### Compatibility
- iOS Safari: requires PWA installed to home screen (от 16.4+)
- Android Chrome: works directly

**Време:** ~2 часа

---

## Storage architecture (всички features)

`localStorage` keys:
```
transport-plovdiv.selectedLines      string[]
transport-plovdiv.theme              'light' | 'dark'
transport-plovdiv.favorites          Favorite[]            (NEW)
transport-plovdiv.locationAsked      boolean               (NEW)
transport-plovdiv.notifications      NotificationSub[]     (NEW)
```

Considered: IndexedDB ако стане > 5 MB. Засега localStorage е достатъчен (~5-10 KB total).

---

## Performance considerations

### Текущо state
- 530 markers на картата — на zoom-out работи OK, но леко lag
- Без clustering или virtualization

### Когато добавим bus positions
- + до 50 bus markers (~10 линии × 5 buses)
- Total ~580 anims → може да хапна с performance

### Подобрения (Фаза 6, опционално)
1. **Marker clustering** на zoom < 12 (`react-leaflet-cluster`)
2. **Canvas renderer** за CircleMarker (по-бърз от SVG)
3. **React.memo** на StopMarker (за да не re-render-ва при theme/filter промени които не го засягат)

---

## ⏱ Time estimates общо

| Phase | Описание | Време |
|---|---|---|
| 0 | Refactor App.tsx | 1.5ч |
| 1 | Search bar | 1ч |
| 2 | Geolocation | 1.5ч |
| 3 | Favorites | 2ч |
| 4 | Bus positions | 6ч |
| 5 | Notifications | 2ч |
| **Total** | | **~14ч** |

Можем да правим по 1 фаза на сесия. Или по 2 свързани (1+2 или 3+5).

---

## Open questions преди да тръгнем

1. **Refactor — съгласен ли си с предложената структура?** Може и да я опростим.
2. **Search bar** — Опция А (вграден в panel-а) или Опция Б (отделен tab)?
3. **Geolocation** — само "къде съм" бутон, или активно tracking (live позиция как се движа)?
4. **Favorites** — отделен tab вътре в line selector, или нов отделен panel/button?
5. **Bus positions** — да отделим време за Playwright seed, или fallback към GTFS / OSM?
