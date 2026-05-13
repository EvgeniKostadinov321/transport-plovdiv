/**
 * Spike v4 — Line-based ordering discovery
 *
 * Workflow в UI:
 *   1. User clicks "ТЪРСЕНЕ ПО ЛИНИЯ И МАРШРУТ" (lines_line бутон)
 *   2. Появява се lines_list_list (всички линии)
 *   3. User избира линия → се появява lines_routes_list_list (маршрути/посоки)
 *   4. User избира маршрут → се появява lines_stops_list_list (СПИРКИ В РЕД!)
 *   5. (бонус) lines_buses_list — автобуси по тази линия
 *
 * Сега правим това програмно:
 *   Step 1: Open lines_line (onClick)
 *   Step 2: Select line "18" (или каквато сме намерили)
 *   Step 3: Select route (направление)
 *   Step 4: Запази stops_list
 *
 * Run: npx tsx spike/test-line-ordering.ts
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE_URL = 'http://transport.plovdiv.bg/desktop/'
const AU_URL = 'http://transport.plovdiv.bg/zkau'
const RESPONSES_DIR = join(process.cwd(), 'spike', 'responses')
const TARGET_LINE = '18' // Една централна линия

interface Session {
  dtid: string
  cu: string
  cookies: string
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
      Accept: 'text/html,*/*',
    },
  })
  const html = await res.text()
  const cookies = res.headers.get('set-cookie') ?? ''
  const dtid = html.match(/\{dt:\s*['"]([a-zA-Z0-9_]+)['"]/)?.[1]
  const cu = html.match(/cu:\s*['"]([^'"]+)['"]/)?.[1] ?? ''
  if (!dtid) throw new Error('no dtid')
  return { session: { dtid, cu, cookies: cookies.split(';')[0] }, html }
}

function findUuid(html: string, id: string) {
  const m = html.match(new RegExp(`'([a-zA-Z0-9_]+)',\\{id:'${id}'`))
  return m ? m[1] : null
}

async function sendCommand(
  session: Session,
  cmd: string,
  uuid: string,
  data: Record<string, unknown> | null,
  zkSid: number
) {
  return sendCommands(session, [{ cmd, uuid, data }], zkSid)
}

async function sendCommands(
  session: Session,
  commands: { cmd: string; uuid: string; data: Record<string, unknown> | null }[],
  zkSid: number
) {
  const params: Record<string, string> = { dtid: session.dtid }
  commands.forEach((c, i) => {
    params[`cmd_${i}`] = c.cmd
    params[`uuid_${i}`] = c.uuid
    if (c.data !== null) params[`data_${i}`] = JSON.stringify(c.data)
  })
  const cmd = commands[0]?.cmd ?? '?'
  const uuid = commands[0]?.uuid ?? '?'
  const body = new URLSearchParams(params)
  const start = Date.now()
  const res = await fetch(`${AU_URL}${session.cu}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0',
      Accept: '*/*',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: BASE_URL,
      Origin: 'http://transport.plovdiv.bg',
      'ZK-SID': String(zkSid),
      Cookie: session.cookies,
    },
    body: body.toString(),
  })
  const text = await res.text()
  const ms = Date.now() - start
  log(
    `${cmd} -> ${uuid}`,
    `status=${res.status} bytes=${text.length} ms=${ms}`
  )
  return { ok: res.ok, status: res.status, text, ms }
}

function findListitemByLabel(html: string, label: string) {
  // Намира listitem чийто първи listcell има label = label
  const re = new RegExp(
    `'zul\\.sel\\.Listitem','([a-zA-Z0-9_]+)',[^\\[]*\\[\\s*\\['zul\\.sel\\.Listcell','[a-zA-Z0-9_]+',\\{label:'${label}'\\}`,
    'g'
  )
  const m = re.exec(html)
  return m ? m[1] : null
}

function extractListitems(text: string) {
  // От AU response - извлича listitems с техните labels
  const items: { uuid: string; labels: string[] }[] = []
  // Pattern: Listitem с N Listcell вътре
  const listitemRe =
    /'zul\.sel\.Listitem','([a-zA-Z0-9_]+)',\{[^}]*\},\[((?:[^[\]]|\[(?:[^[\]]|\[[^[\]]*\])*\])*)\]\]/g
  let m: RegExpExecArray | null
  while ((m = listitemRe.exec(text))) {
    const uuid = m[1]
    const inner = m[2]
    const labels = [...inner.matchAll(/label:'((?:[^'\\]|\\.)*)'/g)].map((mm) =>
      mm[1].replace(/\\'/g, "'")
    )
    items.push({ uuid, labels })
  }
  return items
}

async function main() {
  await mkdir(RESPONSES_DIR, { recursive: true })
  console.log('--- Spike v4: Line-based ordering discovery ---\n')

  // 1. Bootstrap
  const { session, html } = await bootstrap()

  // 2. Find UUID-и на ключовите компоненти
  const linesLineUuid = findUuid(html, 'lines_line') // бутон "ТЪРСЕНЕ ПО ЛИНИЯ"
  const linesListUuid = findUuid(html, 'lines_list_list') // listbox с линии
  const linesRoutesUuid = findUuid(html, 'lines_routes_list_list')
  const linesStopsUuid = findUuid(html, 'lines_stops_list_list')

  log('uuids', {
    lines_line: linesLineUuid,
    lines_list_list: linesListUuid,
    lines_routes_list_list: linesRoutesUuid,
    lines_stops_list_list: linesStopsUuid,
  })

  if (!linesLineUuid || !linesListUuid) {
    log('FATAL', 'missing key UUIDs')
    return
  }

  // 3. SKIP open-ване на бутона - listbox `lines_list_list` съществува в HTML-а
  // (само parent Cell е visible:false). Server-ът ще го попълни при onSelect.

  // 4. Намери listitem-а за линия "18" в initial HTML-а (lines са вече там)
  const lineLabel = `Линия ${TARGET_LINE}`
  const lineItemUuid = findListitemByLabel(html, lineLabel)
  log('line-item', `${lineLabel} → uuid=${lineItemUuid}`)

  if (!lineItemUuid) {
    log('FATAL', `cannot find Listitem for ${lineLabel}`)
    return
  }

  // 5. Select линия 18
  const selectLine = await sendCommand(
    session,
    'onSelect',
    linesListUuid,
    {
      items: [lineItemUuid],
      reference: lineItemUuid,
      selectedIndex: 0,
    },
    2
  )
  await saveFile(`09-select-line-${TARGET_LINE}.json`, selectLine.text)

  // 6. Извлечи routes (направления) от response-а
  const routes = extractListitems(selectLine.text)
  log('routes', `found ${routes.length} routes for ${lineLabel}`)
  for (const r of routes) {
    log('  route', `uuid=${r.uuid} labels=${JSON.stringify(r.labels)}`)
  }

  // 7. Ако има routes, селектирай първия
  if (routes.length > 0 && linesRoutesUuid) {
    const firstRoute = routes[0]
    log('selecting route', firstRoute.uuid)
    const selectRoute = await sendCommand(
      session,
      'onSelect',
      linesRoutesUuid,
      {
        items: [firstRoute.uuid],
        reference: firstRoute.uuid,
        selectedIndex: 0,
      },
      3
    )
    await saveFile(`09-select-route-${TARGET_LINE}-0.json`, selectRoute.text)

    // 8. Извлечи stops (в ред!)
    const stops = extractListitems(selectRoute.text)
    log('stops', `found ${stops.length} stops for ${lineLabel} route 0`)
    if (stops.length > 0) {
      log(
        '  first 5 stops:',
        stops.slice(0, 5).map((s) => s.labels)
      )
      log(
        '  last 3 stops:',
        stops.slice(-3).map((s) => s.labels)
      )
    }

    await saveFile(
      `09-line-${TARGET_LINE}-route-0-stops.json`,
      JSON.stringify(stops, null, 2)
    )
  }
}

main().catch((err) => {
  console.error('Spike crashed:', err)
  process.exit(1)
})
