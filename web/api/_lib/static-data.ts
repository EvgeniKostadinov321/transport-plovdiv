/**
 * Static data за линии и спирки.
 *
 * Извлича се от initial HTML на transport.plovdiv.bg/desktop/ при startup.
 * Cache-ва се forever (статични данни се променят рядко - месеци).
 *
 * Данни:
 *   - 532 спирки с GPS координати (number, name, lat, lng)
 *   - 29 активни линии
 *   - Mapping stop number → linии които я обслужват
 */

const BASE_URL = 'http://transport.plovdiv.bg/desktop/'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

export interface Stop {
  number: number
  name: string
  lat: number
  lng: number
  lines: string[]
}

export interface StaticData {
  stops: Stop[]
  lines: string[] // sorted active line numbers
  loadedAt: number
}

let cached: StaticData | null = null
let loading: Promise<StaticData> | null = null
let lastFailureAt: number = 0
const FAILURE_RETRY_AFTER_MS = 5_000 // retry след 5 сек при провал

function parseStops(html: string): { number: number; name: string; lat: number; lng: number }[] {
  const re = /"number":(\d+),"name":"/g
  const stops: { number: number; name: string; lat: number; lng: number }[] = []
  let anchor: RegExpExecArray | null
  while ((anchor = re.exec(html))) {
    const number = parseInt(anchor[1], 10)
    const nameStart = anchor.index + anchor[0].length
    const latIdx = html.indexOf('","lat":', nameStart)
    if (latIdx === -1) continue
    const rawName = html.slice(nameStart, latIdx)
    const tail = html.slice(latIdx + 8)
    const tailMatch = tail.match(/^([0-9.]+),"lng":([0-9.]+)/)
    if (!tailMatch) continue
    stops.push({
      number,
      name: rawName.replace(/\\\\"/g, '"').replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
      lat: parseFloat(tailMatch[1]),
      lng: parseFloat(tailMatch[2]),
    })
  }
  return stops
}

function parseStopLines(html: string): Map<number, string[]> {
  // Парсваме секцията на stops_list_list. Всеки Listitem има 3 Listcell-а:
  //   #1: stop number, #2: stop name, #3: lines (напр. "1, 25, 4")
  const result = new Map<number, string[]>()
  const start = html.indexOf("id:'stops_list_list'")
  const end = html.indexOf("id:'lines_stops_list'", start)
  if (start === -1) return result
  const section = html.slice(start, end !== -1 ? end : start + 100000)

  const anchorRe = /'zul\.sel\.Listitem','([a-zA-Z0-9_]+)',\{_loaded:true,_index:\d+\}/g
  const anchors: number[] = []
  let am: RegExpExecArray | null
  while ((am = anchorRe.exec(section))) anchors.push(am.index)

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]
    const b = i + 1 < anchors.length ? anchors[i + 1] : a + 1000
    const block = section.slice(a, b)
    const labels = [...block.matchAll(/label:'((?:[^'\\]|\\.)*)'/g)].map((mm) =>
      mm[1].replace(/\\'/g, "'")
    )
    if (labels.length >= 1) {
      const num = parseInt(labels[0], 10)
      if (isNaN(num)) continue
      const linesStr = labels[2] ?? ''
      const lines = linesStr
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s))
      result.set(num, lines)
    }
  }
  return result
}

async function load(): Promise<StaticData> {
  console.log(`[static-data] fetching ${BASE_URL}`)
  let res: Response
  try {
    res = await fetch(BASE_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
    })
  } catch (err) {
    const cause = (err as Error).cause
    console.error('[static-data] fetch threw:', err, 'cause:', cause)
    throw new Error(
      `fetch desktop/ threw: ${(err as Error).message}${cause ? ` (cause: ${JSON.stringify(cause)})` : ''}`
    )
  }
  console.log(`[static-data] response status=${res.status}`)
  if (!res.ok) throw new Error(`fetch desktop/ failed: ${res.status}`)
  const html = await res.text()

  const rawStops = parseStops(html)
  const linesMap = parseStopLines(html)

  // Filter невалидни (number=0 е тестова, без име)
  const stops: Stop[] = rawStops
    .filter((s) => s.number > 0 && s.name.length > 0)
    .map((s) => ({
      ...s,
      lines: linesMap.get(s.number) ?? [],
    }))

  // Уникални линии (сортирани числово)
  const allLines = new Set<string>()
  for (const s of stops) for (const l of s.lines) allLines.add(l)
  const lines = [...allLines].sort((a, b) => parseInt(a, 10) - parseInt(b, 10))

  return { stops, lines, loadedAt: Date.now() }
}

export async function getStaticData(): Promise<StaticData> {
  if (cached) return cached
  if (loading) return loading
  // Throttle retry-ите при failure - не спираме до общинския сайт ако се счупи
  const sinceFailure = Date.now() - lastFailureAt
  if (sinceFailure < FAILURE_RETRY_AFTER_MS) {
    throw new Error(
      `static data load failed recently (${Math.floor(sinceFailure / 1000)}s ago), retry in a few seconds`
    )
  }
  loading = load()
    .then((d) => {
      cached = d
      loading = null
      return d
    })
    .catch((err) => {
      loading = null
      lastFailureAt = Date.now()
      throw err
    })
  return loading
}
