/**
 * Spike v5 — Destination string collection
 *
 * Цел: За топ 5 линии (1, 6, 18, 26, 99), събери uniqe destination strings
 * които се появяват в ETA responses. Това ще ни даде direction detection
 * без GTFS dependency.
 *
 * Подход:
 *   - За всяка линия, намираме поне 2-3 спирки (от stops.json) които я обслужват
 *   - За всяка спирка, правим ETA query (onSelect)
 *   - От response-а извличаме всички destination strings за тази линия
 *   - Aggregate-ваме в map: line → Set<destination>
 *
 * Очакваме всяка линия да има 2 destinations (по 1 за всяка посока).
 *
 * Run: npx tsx spike/test-destinations.ts
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE_URL = 'http://transport.plovdiv.bg/desktop/'
const AU_URL = 'http://transport.plovdiv.bg/zkau'
const RESPONSES_DIR = join(process.cwd(), 'spike', 'responses')

const TARGET_LINES = ['1', '6', '18', '26', '99']
const STOPS_PER_LINE = 5 // колко спирки да опитаме за всяка линия

interface Session {
  dtid: string
  cu: string
  cookies: string
}

interface Stop {
  number: number
  name: string
  lat: number
  lng: number
}

async function saveFile(name: string, content: string) {
  await writeFile(join(RESPONSES_DIR, name), content, 'utf8')
}

function log(label: string, ...rest: unknown[]) {
  console.log(`[${label}]`, ...rest)
}

async function bootstrap(): Promise<{ session: Session; html: string }> {
  const res = await fetch(BASE_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'bg-BG,bg;q=0.9,en;q=0.8',
    },
  })
  const html = await res.text()
  const cookies = res.headers.get('set-cookie') ?? ''
  const dtid = html.match(/\{dt:\s*['"]([a-zA-Z0-9_]+)['"]/)?.[1]
  const cu = html.match(/cu:\s*['"]([^'"]+)['"]/)?.[1] ?? ''
  if (!dtid) throw new Error('no dtid')
  return { session: { dtid, cu, cookies: cookies.split(';')[0] }, html }
}

function findListitemForStop(html: string, stopNumber: number) {
  const listboxMatch = html.match(/'([a-zA-Z0-9_]+)',\{id:'stops_list_list'/)
  if (!listboxMatch) return null
  // Заради заявки като 'label:'27'' търсим точно за този номер
  const re = new RegExp(
    `'zul\\.sel\\.Listitem','([a-zA-Z0-9_]+)',[^\\[]*\\[\\s*\\['zul\\.sel\\.Listcell','[a-zA-Z0-9_]+',\\{label:'${stopNumber}'\\}`,
    'g'
  )
  const m = re.exec(html)
  if (!m) return null
  return { listboxUuid: listboxMatch[1], listitemUuid: m[1] }
}

async function fetchETAs(
  session: Session,
  textSearchUuid: string,
  listboxUuid: string,
  _listitemUuid: string,
  stopNumber: number,
  zkSid: number
) {
  // STEP 1: filter с onChanging - server рендерира filtered listitems с НОВИ UUIDs
  const filterBody = new URLSearchParams({
    dtid: session.dtid,
    cmd_0: 'onChanging',
    opt_0: 'i',
    uuid_0: textSearchUuid,
    data_0: JSON.stringify({ value: String(stopNumber), start: 1 }),
  })
  const filterRes = await fetch(`${AU_URL}${session.cu}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0',
      Accept: '*/*',
      Referer: BASE_URL,
      Origin: 'http://transport.plovdiv.bg',
      'ZK-SID': String(zkSid),
      Cookie: session.cookies,
    },
    body: filterBody.toString(),
  })
  const filterText = await filterRes.text()
  if (filterText.length < 200) return filterText // 500 case

  // STEP 2: Парсваме новите Listitem UUIDs от filter response.
  // Намираме този който има label = stopNumber (exact match).
  const itemRe =
    /'zul\.sel\.Listitem','([a-zA-Z0-9_]+)',\{_loaded:true,_index:\d+\},\[\s*\['zul\.sel\.Listcell','[a-zA-Z0-9_]+',\{label:'(\d+)'\}/g
  let newListitemUuid: string | null = null
  let im: RegExpExecArray | null
  while ((im = itemRe.exec(filterText))) {
    if (parseInt(im[2], 10) === stopNumber) {
      newListitemUuid = im[1]
      break
    }
  }
  if (!newListitemUuid) {
    return `NO_MATCH_IN_FILTER:${filterText.slice(0, 200)}`
  }

  // STEP 3: onChange + onSelect с новия UUID
  const body = new URLSearchParams({
    dtid: session.dtid,
    cmd_0: 'onChange',
    uuid_0: textSearchUuid,
    data_0: JSON.stringify({
      value: String(stopNumber),
      start: String(stopNumber).length,
    }),
    cmd_1: 'onSelect',
    uuid_1: listboxUuid,
    data_1: JSON.stringify({
      items: [newListitemUuid],
      reference: newListitemUuid,
      clearFirst: false,
      pageX: 110,
      pageY: 193,
      which: 1,
      x: 100,
      y: 22,
    }),
  })
  const res = await fetch(`${AU_URL}${session.cu}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0',
      Accept: '*/*',
      Referer: BASE_URL,
      Origin: 'http://transport.plovdiv.bg',
      'ZK-SID': String(zkSid + 1),
      Cookie: session.cookies,
    },
    body: body.toString(),
  })
  return await res.text()
}

// Парсва ETA response: extract (line, minutes, time, destination) tuples
// Подход: намираме всички Listitem anchor-и и за всеки взимаме следващите 4 label-а
function parseETARows(text: string) {
  const rows: { line: string; minutes: string; time: string; destination: string }[] = []
  const anchorRe = /'zul\.sel\.Listitem','([a-zA-Z0-9_]+)',\{_loaded:true,_index:\d+\}/g
  const anchors: number[] = []
  let am: RegExpExecArray | null
  while ((am = anchorRe.exec(text))) anchors.push(am.index)

  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i]
    const end = i + 1 < anchors.length ? anchors[i + 1] : start + 800
    const block = text.slice(start, end)
    const labels = [...block.matchAll(/label:'((?:[^'\\]|\\.)*)'/g)].map((mm) =>
      mm[1].replace(/\\'/g, "'")
    )
    if (labels.length >= 4 && /^\d+$/.test(labels[0]) && /^\d+$/.test(labels[1])) {
      rows.push({
        line: labels[0],
        minutes: labels[1],
        time: labels[2],
        destination: labels[3],
      })
    }
  }
  return rows
}

async function main() {
  await mkdir(RESPONSES_DIR, { recursive: true })
  console.log('--- Spike v5: Destination collection ---\n')

  // Зареждаме stops.json от предишен spike
  const stopsRaw = await readFile(join(RESPONSES_DIR, 'stops.json'), 'utf8')
  const stops: Stop[] = JSON.parse(stopsRaw)
  log('stops loaded', stops.length)

  // Bootstrap
  const { session, html } = await bootstrap()
  const textSearchUuid = html.match(/'([a-zA-Z0-9_]+)',\{id:'text_search'/)?.[1]
  if (!textSearchUuid) {
    console.error('cannot find text_search uuid')
    return
  }

  // Намираме за всяка target line няколко спирки
  // Парсваме HTML-а за labels на третата Listcell (lines) — но в нашия stops.json нямаме това,
  // затова го извличаме отново от HTML-а.

  // Парсваме секцията на stops_list_list така:
  //   Намираме всеки Listitem anchor (с _index:N).
  //   Между два anchor-а взимаме label-ите чрез регекс.
  const stopLinesMap: Record<number, string[]> = {}
  const stopListSection = (() => {
    const start = html.indexOf("id:'stops_list_list'")
    const end = html.indexOf("id:'lines_stops_list'", start)
    return start !== -1 ? html.slice(start, end !== -1 ? end : start + 100000) : ''
  })()

  const anchorRe = /'zul\.sel\.Listitem','([a-zA-Z0-9_]+)',\{_loaded:true,_index:\d+\}/g
  const anchors: { idx: number; uuid: string }[] = []
  let am: RegExpExecArray | null
  while ((am = anchorRe.exec(stopListSection))) {
    anchors.push({ idx: am.index, uuid: am[1] })
  }
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].idx
    const end = i + 1 < anchors.length ? anchors[i + 1].idx : start + 1000
    const block = stopListSection.slice(start, end)
    const labels = [...block.matchAll(/label:'((?:[^'\\]|\\.)*)'/g)].map((mm) =>
      mm[1].replace(/\\'/g, "'")
    )
    if (labels.length >= 1) {
      const num = parseInt(labels[0], 10)
      if (!isNaN(num)) {
        const linesStr = labels[2] ?? ''
        stopLinesMap[num] = linesStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
    }
  }
  log('stops with line info', Object.keys(stopLinesMap).length)

  // Резултат
  const destinationsByLine: Record<string, Set<string>> = {}
  for (const ln of TARGET_LINES) destinationsByLine[ln] = new Set()

  // За всяка target line, намираме STOPS_PER_LINE спирки и правим ETA query
  let zkSid = 1
  for (const line of TARGET_LINES) {
    const candidateStops = Object.entries(stopLinesMap)
      .filter(([, lines]) => lines.includes(line))
      .map(([num]) => parseInt(num, 10))

    log(
      `line ${line}`,
      `${candidateStops.length} candidate stops, querying ${Math.min(STOPS_PER_LINE, candidateStops.length)}`
    )

    // Вземаме равномерно разпределени стопове (begin, middle, end)
    const stopsToQuery: number[] = []
    const step = Math.max(1, Math.floor(candidateStops.length / STOPS_PER_LINE))
    for (let i = 0; i < candidateStops.length && stopsToQuery.length < STOPS_PER_LINE; i += step) {
      stopsToQuery.push(candidateStops[i])
    }

    for (const stopNum of stopsToQuery) {
      // ФРЕШНА session за всяка стопа - server state-а може да е причината за 500
      const fresh = await bootstrap()
      const freshTextSearch = fresh.html.match(/'([a-zA-Z0-9_]+)',\{id:'text_search'/)?.[1]
      const ids = findListitemForStop(fresh.html, stopNum)
      if (!ids || !freshTextSearch) {
        log(`  stop #${stopNum}`, 'not found in HTML')
        continue
      }

      try {
        const text = await fetchETAs(
          fresh.session,
          freshTextSearch,
          ids.listboxUuid,
          ids.listitemUuid,
          stopNum,
          1
        )
        if (text.length < 200 || text.includes('Internal Server Error')) {
          log(`  stop #${stopNum}`, `bad response (${text.length} bytes)`)
          continue
        }
        const rows = parseETARows(text)
        if (rows.length === 0) {
          log(`  stop #${stopNum}`, `0 ETAs parsed, response head: ${text.slice(0, 300)}`)
        }
        const lineRows = rows.filter((r) => r.line === line)
        for (const r of lineRows) {
          destinationsByLine[line].add(r.destination)
        }
        log(
          `  stop #${stopNum}`,
          `total ETAs=${rows.length}, line ${line} ETAs=${lineRows.length}, destinations=${lineRows.map((r) => r.destination).join(' | ')}`
        )
      } catch (err) {
        log(`  stop #${stopNum}`, `error: ${(err as Error).message}`)
      }

      // Малък throttle между requests
      await new Promise((res) => setTimeout(res, 500))
    }
  }

  // Сериализирай
  const output: Record<string, string[]> = {}
  for (const [line, dests] of Object.entries(destinationsByLine)) {
    output[line] = [...dests].sort()
  }
  await saveFile('destinations.json', JSON.stringify(output, null, 2))

  console.log('\n=== SUMMARY ===\n')
  for (const [line, dests] of Object.entries(output)) {
    console.log(`Line ${line}: ${dests.length} unique destinations`)
    for (const d of dests) console.log(`   - "${d}"`)
  }
}

main().catch((err) => {
  console.error('Spike crashed:', err)
  process.exit(1)
})
