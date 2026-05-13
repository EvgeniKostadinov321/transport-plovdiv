# ZK Spike — Findings (Consolidated)

**Дата:** 2026-05-13
**Spike итерации:** v1 (basic ZK), v2 (ETA discovery), v3 (rate + ordering search), v4 (line workflow), v5 (destinations ✅), v6 (sustained rate — partial)

---

## TL;DR

✅ **MVP confidence: ~90%** след всички spikes
- 532 спирки с GPS координати — embedded JSON в initial HTML
- 29 уникални активни линии
- ETA endpoint работи: line + minutes + arrival time + destination
- **Direction detection без GTFS** — destination strings са stable per direction
- ETA-тата decay-ват правилно (validated)
- HTTP, no Cloudflare, no CAPTCHA

⚠️ **Архитектурно ограничение:**
- ZK session-ите са **stateful & fragile** — една заявка „консумира" state
- Production стратегия: **fresh session за всяка ETA query** (acceptable cost given fast bootstrap)

⚠️ **Все още нерешено:**
- Ordering на спирки по линия — нужен Playwright seed или GTFS

---

## 1. Session bootstrap

`GET http://transport.plovdiv.bg/desktop/`

В initial HTML:
```js
zkmx([0,'lTLQ_',{
  dt:'z_zf6',                              // ← desktop ID (dtid)
  cu:';jsessionid=...',                    // ← context URL suffix
  uu:'/zkau;jsessionid=...',               // ← update URL
}, ...])
```

- ZK Framework 6.0.1 EE (2012)
- Bootstrap latency: ~50-200ms (single GET)
- HTTP only, без auth

## 2. Component UUID-и (динамични per session)

UUID-ите се регенерират за всяка сесия. Парсват се по `id` атрибут:

| `id` атрибут               | Описание                                       | Достъпен          |
|----------------------------|------------------------------------------------|-------------------|
| `text_search`              | Bandbox за номер на спирка                     | ✅ onChanging/onChange |
| `stops_list_list`          | Listbox с 532 спирки                           | ✅ onSelect (с filter първо) |
| `lines_list_list`          | Listbox с 37 линии                             | ❌ 500 без preceding sequence |
| `lines_routes_list_list`   | Маршрути за линия                              | ❌ не тестван   |
| `lines_stops_list_list`    | Подредени спирки по линия                      | ❌ 500           |
| `stops_buses_list_list`    | „КОЛИ ПРЕМИНАВАЩИ В БЛИЗКИЯ ЧАС"               | ❌ не тестван    |

**Pattern:** `'([a-zA-Z0-9_]+)',\{id:'TARGET_ID'`

## 3. ETA query — РАБОТЕЩ WORKFLOW

**Критично откритие от потребителски cURL trace:** Реалният браузър изпраща **mouse coordinates** в `data_1` (`pageX, pageY, which, x, y`). БЕЗ тях server връща 500 NPE.

### 3-step workflow (production-ready):

#### Step 1: Bootstrap
```http
GET /desktop/
→ extract dtid, JSESSIONID, text_search uuid, stops_list_list uuid
```

#### Step 2: Filter + parse new UUIDs
ZK Listbox е virtualized. Initial HTML съдържа само първите ~25 listitem-а. За спирки в други pagination buffers ⇒ 500 NPE. Решение: filter първо.

```http
POST /zkau;jsessionid=...
Content-Type: application/x-www-form-urlencoded;charset=UTF-8
ZK-SID: 1
Cookie: JSESSIONID=...

dtid=<dtid>&cmd_0=onChanging&opt_0=i&uuid_0=<text_search>
&data_0={"value":"27","start":1}
```

Response: filtered listitem-и с НОВИ UUID-и (~3 KB).

```javascript
// Парсваме новия listitem UUID за stopNumber
const re = /'zul\.sel\.Listitem','([a-zA-Z0-9_]+)',\{_loaded:true,_index:\d+\},\[\s*\['zul\.sel\.Listcell','[a-zA-Z0-9_]+',\{label:'(\d+)'\}/g
// Match label === stopNumber → newUuid
```

#### Step 3: Select → ETA response
```http
POST /zkau;jsessionid=...
ZK-SID: 2

dtid=<dtid>
&cmd_0=onChange&uuid_0=<text_search>&data_0={"value":"27","start":2}
&cmd_1=onSelect&uuid_1=<listbox>
&data_1={"items":["<newUuid>"],"reference":"<newUuid>",
         "clearFirst":false,"pageX":110,"pageY":193,
         "which":1,"x":100,"y":22}    ← MOUSE COORDS!
```

Response: 2-3 KB JSON със следната структура.

### ETA response format

```javascript
{"rs":[
  ["rm", ["uuid"]],                                    // clear stale items
  ["addChd", ["<listbox_uuid>", [                      // populate ETAs
    ['zul.sel.Listitem','UUID',{_loaded:true,_index:0},[
      ['zul.sel.Listcell','UUID',{label:'1'},[]],     // ← line number
      ['zul.sel.Listcell','UUID',{label:'15'},[]],    // ← minutes
      ['zul.sel.Listcell','UUID',{label:'17:28'},[]], // ← arrival HH:MM
      ['zul.sel.Listcell','UUID',{label:'кв." Коматево"- последна спирка'},[]] // ← destination
    ]]
    // ... up to ~7 buses
  ]]],
  ["script",["map_select_id(462)"]],                  // ← BONUS: internal stop_id!
  ...
]}
```

**Headers на колоните:** `#` / `мин` / `час` / `посока`

## 4. ✅ Direction detection — RESOLVED via destinations

Запазено в `spike/responses/destinations.json`. За 5 топ линии всяка показва точно 2 destinations:

| Линия | Destination A                       | Destination B                          |
|-------|-------------------------------------|----------------------------------------|
| 1     | АПК-Карловско шосе                  | кв." Коматево"- последна спирка        |
| 6     | Прослав - последна                  | кв. "Изгрев" - обръщало ул. "Край      |
| 18    | Колелото на "Цар Симеон"            | ПУ - бул. "България"                   |
| 26    | кв. "Изгрев" - обръщало ул. "Край   | кв."Смирненски"- ул."Юндола"           |
| 99    | 2-ра Авто колона                    | ТК "Марица"                            |

**Implications:**
- Destination string = крайна спирка (terminus) на маршрута
- Можем да decode-нем direction през destination → terminus mapping
- Strings могат да са **truncated** (например „кв. „Изгрев" - обръщало ул. „Край" — обрязва финалния `й")"`).
- Production: stable `direction_key = normalize(destination_string)` (lowercase, trim, без quotes)

**No GTFS dependency for direction detection. ✅**

## 5. ✅ ETA decay validated

Polling test (3 заявки през 30s):

| Час   | T+0 | T+30 | T+60 |
|-------|-----|------|------|
| 17:28 | 15  | 14   | 14   |
| 17:41 | 28  | 28   | 27   |
| 17:43 | 30  | 29   | 29   |

Всичките автобуси показват correct decay (-1 min/60s). Данните се държат разумно.

## 6. ⚠️ Rate limit — наблюдения

### Tests performed:
- **20 заявки × 15s (5 мин, single session)** — 20/20 успешни, latency 23-58ms
- **Sustained 2 req/s (single session)** — **600/600 fail** (всичко 500)
- **Sustained 2 req/s (fresh session per request)** — стартиран, недовършен

### Conclusion:

**ZK session-ите са stateful & не толерират бързи последователни ETA queries от един потребителски workflow.** Server-ът сериализира state-а на „desktop"-а — следваща query се очаква да е от browser-ска interaction, не запалена бомба.

**Production стратегия:**
- ❌ Long-lived single session (не работи за повече от ~20 заявки в кратко време)
- ✅ **Fresh session per ETA query** (bootstrap + 2 AU calls = 3 HTTP requests за всеки stop)
- ✅ Acceptable cost: bootstrap е ~100-200ms, ETA query е ~40ms

**Implication за production load:**
- 10 потребители × 3 линии × 30 спирки = 900 spike отделни spec ETA queries / 30s = 30 fresh sessions/s
- При 3 HTTP/session = **90 req/s peak**
- ⚠️ Тази стойност е извън comfort zone — задължително **shared cache между потребителите** (single backend, кеш 25-30 сек, общо ~5 unique queries/s ⇒ 15 req/s)

## 7. ⚠️ Ordering на спирки по линия — нерешен

`lines_list_list` отговаря с 500 на onSelect (без preceding sequence). Server-side state machine блокира.

**Решение:** Playwright one-time seed script.
- Headless Chromium отваря `transport.plovdiv.bg/desktop/`
- Кликва „ТЪРСЕНЕ ПО ЛИНИЯ" → избира всяка от 29 линии × 2 посоки
- Извлича ordered list of stops от DOM
- Записва в `data/seed/route-stops.json`
- One-time, offline (не runtime dependency)
- 2-3 часа работа за script + 5-10 мин run time

**Alternative:** Дъмпваме static data от GTFS (Trakia Tech) за топ 10 линии + cross-validation срещу destinations.

## 8. Bonus findings

- **`map_select_id(N)` JS call:** Server връща internal stop ID (e.g. `462` за `#27`). Може да го свържем с board_code → internal_id mapping ако потрябва за map UI.
- **„КОЛИ, ПРЕМИНАВАЩИ В БЛИЗКИЯ ЧАС"** компонент съществува — може да даде per-bus tracking (v2 enhancement).

---

## Какво променя това за плана

### ✅ Resolved:
- ETA endpoint format
- Direction detection (no GTFS needed)
- Static data (532 stops + GPS + 29 lines) — единствен GET
- Rate limit behavior

### ⚠️ Architectural decisions needed:

1. **Backend ZK client стратегия:**
   - Pool от 1 fresh session за всяка ETA query (max 30 concurrent)
   - 25-30 sec ETA cache между потребители
   - Това директно влияе на API дизайна

2. **Ordering source:**
   - **Препоръка:** Playwright seed (3 часа работа, one-shot)
   - Fallback: GTFS top 10 lines

3. **Production rate budget:**
   - Worst case: ~15 req/s към transport.plovdiv.bg (with caching)
   - Mid case: 3-5 req/s
   - Тестваме това на staging преди production deploy

### 🟢 Зачертано от плана:
- ~~Puppeteer/Playwright за runtime~~ (само за seed)
- ~~Cloudflare workaround~~
- ~~Cheerio dependency~~
- ~~Yurukov gist dependency~~
- ~~Trakia Tech GTFS dependency за base data~~
- ~~GTFS dependency за direction detection~~

---

## Артифакти в `spike/responses/`

| Файл                                  | Съдържание                                  |
|---------------------------------------|---------------------------------------------|
| `01-initial.html`                     | Bootstrap HTML (184 KB)                     |
| `stops.json`                          | 532 спирки + GPS                            |
| `lines.json`                          | 29 активни линии                            |
| `destinations.json`                   | **Direction strings per top-5 линии** ⭐    |
| `06-stop-select.json`                 | Example ETA response                        |
| `06-stop-select-poll-*.json`          | 3 polls с decay validation                  |
| `07-rate-summary.json`                | 20×15s rate test (single session, success)  |
| `08-ordering-discovery.json`          | Всички UI component IDs                     |
| `09-*.json`                           | Failed onClick attempts (за reference)      |

---

## Препоръчителни следващи стъпки

1. **Update `PLOVDIV_BUS_TRACKER_PLAN.md`** с тези нови findings (особено: fresh session per query, destination-based direction)
2. **Playwright seed script** за ordering (Spike v7)
3. **Production rate validation** (in staging след първоначална имплементация)
4. **Започни Фаза 0** — restructure + setup
