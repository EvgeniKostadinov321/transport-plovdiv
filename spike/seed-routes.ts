/**
 * Spike v7 - Пълен seed на route ordering за всички линии.
 *
 * Output: data/seed/route-stops.json
 *
 * Structure:
 * {
 *   "lines": {
 *     "18": {
 *       "label": "Линия 18",
 *       "routes": [
 *         {
 *           "label": "Устрем - Хангарите",
 *           "stops": [{ "number": 434, "name": "..." }, ...]
 *         },
 *         ...
 *       ]
 *     }
 *   },
 *   "extractedAt": "2026-05-14T...",
 *   "lineCount": 29,
 *   "totalRoutes": ...
 * }
 *
 * Run: npx tsx spike/seed-routes.ts
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE_URL = 'http://transport.plovdiv.bg/desktop/'
const AU_URL = 'http://transport.plovdiv.bg/zkau'
const SEED_DIR = join(process.cwd(), 'data', 'seed')
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

interface Session {
  dtid: string
  cu: string
  cookies: string
  linesLineUuid: string
  linesListUuid: string
  linesRoutesUuid: string
  linesStopsUuid: string
  lineItemUuids: Map<string, string>
}

async function bootstrap(): Promise<Session> {
  const res = await fetch(BASE_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
  })
  const html = await res.text()
  const dtid = html.match(/\{dt:\s*['"]([a-zA-Z0-9_]+)['"]/)?.[1]
  const cu = html.match(/cu:\s*['"]([^'"]+)['"]/)?.[1] ?? ''
  const cookies = (res.headers.get('set-cookie') ?? '').split(';')[0]

  const findUuid = (id: string) =>
    html.match(new RegExp(`'([a-zA-Z0-9_]+)',\\{id:'${id}'`))?.[1]

  const linesLineUuid = findUuid('lines_line')
  const linesListUuid = findUuid('lines_list_list')
  const linesRoutesUuid = findUuid('lines_routes_list_list')
  const linesStopsUuid = findUuid('lines_stops_list_list')

  if (!dtid || !linesLineUuid || !linesListUuid || !linesRoutesUuid || !linesStopsUuid) {
    throw new Error('bootstrap parse failed')
  }

  const lineItemUuids = new Map<string, string>()
  const sectionStart = html.indexOf(`'${linesListUuid}'`)
  const sectionEnd = html.indexOf(`'${linesRoutesUuid}'`)
  if (sectionStart !== -1 && sectionEnd !== -1) {
    const section = html.slice(sectionStart, sectionEnd)
    const itemRe =
      /'zul\.sel\.Listitem','([a-zA-Z0-9_]+)',\{_loaded:true,_index:\d+\},\[\s*\['zul\.sel\.Listcell','[a-zA-Z0-9_]+',\{label:'(Линия [0-9]+[^']*)'\}/g
    let m: RegExpExecArray | null
    while ((m = itemRe.exec(section))) {
      lineItemUuids.set(m[2], m[1])
    }
  }

  return {
    dtid,
    cu,
    cookies,
    linesLineUuid,
    linesListUuid,
    linesRoutesUuid,
    linesStopsUuid,
    lineItemUuids,
  }
}

async function auPost(
  session: Session,
  params: Record<string, string>,
  zkSid: number
): Promise<string> {
  const body = new URLSearchParams({ dtid: session.dtid, ...params })
  const res = await fetch(`${AU_URL}${session.cu}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      Referer: BASE_URL,
      Origin: 'http://transport.plovdiv.bg',
      'ZK-SID': String(zkSid),
      Cookie: session.cookies,
    },
    body: body.toString(),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`AU POST failed: ${res.status} ${text.slice(0, 200)}`)
  }
  return text
}

const mouseCoords = { pageX: 110, pageY: 200, which: 1, x: 100, y: 50 }

async function clickLinesLine(session: Session, zkSid: number) {
  return auPost(
    session,
    {
      cmd_0: 'onClick',
      uuid_0: session.linesLineUuid,
      data_0: JSON.stringify(mouseCoords),
    },
    zkSid
  )
}

async function selectLine(session: Session, lineItemUuid: string, zkSid: number) {
  return auPost(
    session,
    {
      cmd_0: 'onAnchorPos',
      uuid_0: session.linesListUuid,
      data_0: JSON.stringify({ top: 0, left: 0 }),
      cmd_1: 'onSelect',
      uuid_1: session.linesListUuid,
      data_1: JSON.stringify({
        items: [lineItemUuid],
        reference: lineItemUuid,
        clearFirst: false,
        ...mouseCoords,
      }),
    },
    zkSid
  )
}

async function selectRoute(session: Session, routeItemUuid: string, zkSid: number) {
  return auPost(
    session,
    {
      cmd_0: 'onSelect',
      uuid_0: session.linesRoutesUuid,
      data_0: JSON.stringify({
        items: [routeItemUuid],
        reference: routeItemUuid,
        clearFirst: false,
        ...mouseCoords,
      }),
    },
    zkSid
  )
}

interface ParsedItem {
  uuid: string
  labels: string[]
}

function parseListitems(text: string, listboxUuid: string): ParsedItem[] {
  const addIdx = text.indexOf(`["addChd",["${listboxUuid}"`)
  const start = addIdx >= 0 ? addIdx : 0

  const anchorRe = /'zul\.sel\.Listitem','([a-zA-Z0-9_]+)',\{_loaded:true,_index:\d+\}/g
  const items: ParsedItem[] = []
  const anchors: { idx: number; uuid: string }[] = []
  let am: RegExpExecArray | null
  while ((am = anchorRe.exec(text.slice(start)))) {
    anchors.push({ idx: am.index + start, uuid: am[1] })
  }
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i].idx
    const b = i + 1 < anchors.length ? anchors[i + 1].idx : a + 600
    const block = text.slice(a, b)
    const labels = [...block.matchAll(/label:'((?:[^'\\]|\\.)*)'/g)].map((mm) =>
      mm[1].replace(/\\'/g, "'")
    )
    items.push({ uuid: anchors[i].uuid, labels })
  }
  return items
}

interface OrderedStops {
  label: string
  stops: { number: number; name: string }[]
}

interface LineSeed {
  label: string
  routes: OrderedStops[]
}

async function processLine(
  session: Session,
  lineLabel: string,
  lineItemUuid: string,
  zkSidStart: number
): Promise<LineSeed> {
  let zkSid = zkSidStart
  const routesResponse = await selectLine(session, lineItemUuid, zkSid++)
  const routes = parseListitems(routesResponse, session.linesRoutesUuid)

  const result: LineSeed = { label: lineLabel, routes: [] }

  for (const route of routes) {
    const routeLabel = route.labels[0] ?? '(unknown)'
    const stopsResponse = await selectRoute(session, route.uuid, zkSid++)
    const stops = parseListitems(stopsResponse, session.linesStopsUuid)

    const orderedStops: { number: number; name: string }[] = []
    for (const s of stops) {
      const num = parseInt(s.labels[0] ?? '', 10)
      const name = s.labels[1] ?? ''
      if (!isNaN(num)) {
        orderedStops.push({ number: num, name })
      }
    }
    result.routes.push({ label: routeLabel, stops: orderedStops })

    // Throttle: don't slam the server
    await new Promise((r) => setTimeout(r, 300))
  }

  return result
}

async function main() {
  await mkdir(SEED_DIR, { recursive: true })
  console.log('=== Route ordering seed ===\n')

  const session = await bootstrap()
  console.log(`Bootstrapped. ${session.lineItemUuids.size} lines available.`)

  // Click lines_line button first
  await clickLinesLine(session, 1)

  // Извличаме номера от label-а ("Линия 18" → "18") за key-а
  const allLines: Array<[string, string, string]> = []
  for (const [label, uuid] of session.lineItemUuids) {
    const m = label.match(/Линия (\d+)/)
    if (m) allLines.push([m[1], label, uuid])
  }
  // Sort by line number
  allLines.sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
  console.log(`Will process ${allLines.length} lines.\n`)

  const seed: Record<string, LineSeed> = {}
  let zkSid = 2
  let totalRoutes = 0
  let totalStops = 0
  const failures: string[] = []

  for (const [lineNumber, lineLabel, uuid] of allLines) {
    try {
      const lineSeed = await processLine(session, lineLabel, uuid, zkSid)
      zkSid += lineSeed.routes.length + 1
      seed[lineNumber] = lineSeed
      totalRoutes += lineSeed.routes.length
      totalStops += lineSeed.routes.reduce((sum, r) => sum + r.stops.length, 0)
      console.log(
        `✓ ${lineLabel}: ${lineSeed.routes.length} routes, ` +
          `total ${lineSeed.routes.reduce((s, r) => s + r.stops.length, 0)} stop entries`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`✗ ${lineLabel}: ${msg}`)
      failures.push(`${lineLabel}: ${msg}`)
    }
    // Throttle между линиите
    await new Promise((r) => setTimeout(r, 500))
  }

  const output = {
    extractedAt: new Date().toISOString(),
    lineCount: Object.keys(seed).length,
    totalRoutes,
    totalStopEntries: totalStops,
    failures,
    lines: seed,
  }

  const outputPath = join(SEED_DIR, 'route-stops.json')
  await writeFile(outputPath, JSON.stringify(output, null, 2))
  console.log(`\n=== DONE ===`)
  console.log(`Lines: ${output.lineCount}`)
  console.log(`Routes: ${output.totalRoutes}`)
  console.log(`Stop entries: ${output.totalStopEntries}`)
  console.log(`Failures: ${failures.length}`)
  console.log(`Saved: ${outputPath}`)
}

main().catch((err) => {
  console.error('Seed crashed:', err)
  process.exit(1)
})
