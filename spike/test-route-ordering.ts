/**
 * Spike v7 - HTTP-based extraction на route ordering.
 *
 * Workflow:
 *   1. Bootstrap session (известно от spike v2)
 *   2. onClick lines_line - отваря панела с линии
 *   3. onSelect линия от lines_list_list - server връща routes (посоки)
 *   4. За всяка посока: onSelect route - server връща ordered stops
 *
 * Run: npx tsx spike/test-route-ordering.ts
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE_URL = 'http://transport.plovdiv.bg/desktop/'
const AU_URL = 'http://transport.plovdiv.bg/zkau'
const RESPONSES_DIR = join(process.cwd(), 'spike', 'responses')
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

interface Session {
  dtid: string
  cu: string
  cookies: string
  linesLineUuid: string // ТЪРСЕНЕ ПО ЛИНИЯ button
  linesListUuid: string // listbox с всички линии
  linesRoutesUuid: string // listbox с посоки за избрана линия
  linesStopsUuid: string // listbox с ordered stops
  /** Map: line label "Линия 18" → listitem UUID */
  lineItemUuids: Map<string, string>
}

async function bootstrap(): Promise<Session> {
  const res = await fetch(BASE_URL, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,*/*',
    },
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

  // Парсваме line items от lines_list_list секцията
  const lineItemUuids = new Map<string, string>()
  const sectionStart = html.indexOf(`'${linesListUuid}'`)
  // Лимит на секцията - lines_routes_list_list е следваща
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

/** Mouse coords payload similar to real browser */
const mouseCoords = { pageX: 110, pageY: 200, which: 1, x: 100, y: 50 }

async function clickLinesLine(session: Session, zkSid: number): Promise<string> {
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

async function selectLine(
  session: Session,
  lineItemUuid: string,
  zkSid: number
): Promise<string> {
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

async function selectRoute(
  session: Session,
  routeItemUuid: string,
  zkSid: number
): Promise<string> {
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

/**
 * Парсва Listitem-и от ZK response.
 * За всеки anchor (Listitem с _loaded:true,_index:N) събира label-ите.
 */
function parseListitems(text: string, listboxUuid: string): ParsedItem[] {
  // Намираме addChd към target listbox или outer/setAttr
  // По-просто: парсваме всички Listitem-и след addChd към listboxUuid
  const addIdx = text.indexOf(`["addChd",["${listboxUuid}"`)
  if (addIdx === -1) {
    // fallback - parse целия text
  }
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

/** Опит за разпознаване на route label-а от setAttr команди (server-ът update-ва UI title). */
function extractRouteLabel(text: string): string | null {
  // ["setAttr",[{$u:'mPGQe0'},"label","Устрем - Хангарите"]]
  const m = text.match(/"setAttr",\[\{\$u:'[^']+'\},"label","([^"]+)"\]/)
  return m ? m[1] : null
}

interface OrderedStops {
  routeLabel: string
  stops: { number: number; name: string }[]
}

async function getRouteOrderingForLine(
  session: Session,
  lineLabel: string,
  lineItemUuid: string,
  zkSidStart: number
): Promise<OrderedStops[]> {
  let zkSid = zkSidStart
  console.log(`\n=== ${lineLabel} (${lineItemUuid}) ===`)

  // 1. onClick lines_line - в случай ако не е отворен
  // (Може да е no-op ако вече е отворен; safe)
  // Skip - bootstrap-ът обикновено go-toggle-ва...
  // Actually safer да включваме - моят browser recording го прави всеки път.

  // 2. Select линията
  const routesResponse = await selectLine(session, lineItemUuid, zkSid++)
  // Парсваме routes
  const routes = parseListitems(routesResponse, session.linesRoutesUuid)
  console.log(`  routes found: ${routes.length}`)
  if (routes.length === 0) {
    console.log(`  RAW response head: ${routesResponse.slice(0, 300)}`)
    return []
  }
  for (const r of routes) {
    console.log(`    [route ${r.uuid}] labels: ${JSON.stringify(r.labels)}`)
  }

  const result: OrderedStops[] = []

  // 3. За всяка посока
  for (const route of routes) {
    const routeName = route.labels[0] ?? '(unknown)'
    const stopsResponse = await selectRoute(session, route.uuid, zkSid++)
    const stops = parseListitems(stopsResponse, session.linesStopsUuid)
    const routeLabel = extractRouteLabel(stopsResponse) ?? routeName
    console.log(`  → "${routeLabel}": ${stops.length} stops`)

    const orderedStops: { number: number; name: string }[] = []
    for (const s of stops) {
      const num = parseInt(s.labels[0] ?? '', 10)
      const name = s.labels[1] ?? ''
      if (!isNaN(num)) {
        orderedStops.push({ number: num, name })
      }
    }
    result.push({ routeLabel, stops: orderedStops })

    // Малък throttle
    await new Promise((r) => setTimeout(r, 200))
  }

  return result
}

async function main() {
  await mkdir(RESPONSES_DIR, { recursive: true })
  console.log('--- Spike v7: Route ordering extraction ---\n')

  const session = await bootstrap()
  console.log(`dtid=${session.dtid}`)
  console.log(`linesLineUuid=${session.linesLineUuid}`)
  console.log(`linesListUuid=${session.linesListUuid}`)
  console.log(`linesRoutesUuid=${session.linesRoutesUuid}`)
  console.log(`linesStopsUuid=${session.linesStopsUuid}`)
  console.log(`lineItems extracted: ${session.lineItemUuids.size}`)
  console.log(`Sample line items:`)
  let i = 0
  for (const [label, uuid] of session.lineItemUuids) {
    console.log(`  ${label} → ${uuid}`)
    if (++i >= 5) break
  }

  // Step 1: Click lines_line (open panel)
  console.log('\nClicking lines_line button...')
  await clickLinesLine(session, 1)

  // Step 2: Test с една линия - например "Линия 18"
  const testLineLabel = 'Линия 18'
  const lineUuid = session.lineItemUuids.get(testLineLabel)
  if (!lineUuid) {
    console.log(`Line "${testLineLabel}" not found.`)
    console.log('Available lines:', [...session.lineItemUuids.keys()].slice(0, 10))
    return
  }

  const result = await getRouteOrderingForLine(session, testLineLabel, lineUuid, 2)
  console.log('\n=== FINAL ===')
  console.log(JSON.stringify(result, null, 2))

  await writeFile(
    join(RESPONSES_DIR, 'route-ordering-line-18.json'),
    JSON.stringify(result, null, 2)
  )
}

main().catch((err) => {
  console.error('Spike crashed:', err)
  process.exit(1)
})
