/**
 * Spike v2 — ETA endpoint discovery
 *
 * Цел: Симулираме `onSelect` на listitem от stops_list_list и виждаме
 * какво response получаваме. Хипотеза: ще видим списък с пристигащи
 * автобуси с ETA в минути.
 *
 * Steps:
 *   1. GET initial — session bootstrap
 *   2. Парс на dtid + UUID-и на stops_list_list + listitem за спирка #27
 *   3. POST /zkau с cmd_0=onSelect, uuid=listitem
 *   4. Запази response
 *   5. (по-късно) Polling test — 3 заявки през 30 сек
 *
 * Run: npx tsx spike/test-eta.ts
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE_URL = 'http://transport.plovdiv.bg/desktop/'
const AU_URL = 'http://transport.plovdiv.bg/zkau'
const RESPONSES_DIR = join(process.cwd(), 'spike', 'responses')

const TARGET_STOP_NUMBER = '27' // "Коматевско шосе" — централна спирка с много линии

interface Session {
  dtid: string
  jsessionId: string
  cu: string
  cookies: string
}

async function saveFile(name: string, content: string) {
  await writeFile(join(RESPONSES_DIR, name), content, 'utf8')
}

function log(label: string, ...rest: unknown[]) {
  console.log(`[${label}]`, ...rest)
}

// --- 1. Bootstrap session ---
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
  const jsessionId =
    cookies.match(/JSESSIONID=([A-F0-9]+)/i)?.[1] ??
    html.match(/jsessionid=([A-F0-9]+)/i)?.[1]
  const cu = html.match(/cu:\s*['"]([^'"]+)['"]/)?.[1] ?? ''

  if (!dtid || !jsessionId) {
    throw new Error('Bootstrap failed: missing dtid or jsessionId')
  }

  log('bootstrap', `dtid=${dtid} jsessionId=${jsessionId.slice(0, 12)}...`)
  return {
    session: { dtid, jsessionId, cu, cookies: cookies.split(';')[0] },
    html,
  }
}

// --- 2. Locate Listbox + Listitem UUID за спирка #N ---
function findListitemForStop(
  html: string,
  stopNumber: string
): { listboxUuid: string; listitemUuid: string } | null {
  // Първо намери UUID-а на stops_list_list
  const listboxMatch = html.match(
    /'([a-zA-Z0-9_]+)',\{id:'stops_list_list'/
  )
  if (!listboxMatch) {
    log('findListitem', 'no stops_list_list found')
    return null
  }
  const listboxUuid = listboxMatch[1]

  // Намери Listitem-а, чийто първи Listcell label е stopNumber.
  // Pattern в HTML-а:
  //   ['zul.sel.Listitem','UUID',{_loaded:true,_index:N},[
  //     ['zul.sel.Listcell','UUID2',{label:'27'},[]],
  //     ['zul.sel.Listcell','UUID3',{label:'име'},[]],
  //     ['zul.sel.Listcell','UUID4',{label:'линии'},[]]]]
  //
  // Искаме да хванем _външния_ Listitem UUID, не вътрешните Listcell UUIDs.
  const re = new RegExp(
    `'zul\\.sel\\.Listitem','([a-zA-Z0-9_]+)',[^\\[]*\\[\\s*\\['zul\\.sel\\.Listcell','[a-zA-Z0-9_]+',\\{label:'${stopNumber}'\\}`,
    'g'
  )
  const m = re.exec(html)
  if (!m) {
    log('findListitem', `no Listitem found for stop #${stopNumber}`)
    return null
  }
  return { listboxUuid, listitemUuid: m[1] }
}

// --- 3. Send onSelect ---
async function sendOnSelect(
  session: Session,
  listboxUuid: string,
  listitemUuid: string,
  zkSid: number
): Promise<{ ok: boolean; status: number; text: string; ms: number }> {
  // ZK Listbox onSelect payload:
  //   data_0 = {items:[<listitemUuid>], reference:<listitemUuid>}
  const body = new URLSearchParams({
    dtid: session.dtid,
    cmd_0: 'onSelect',
    uuid_0: listboxUuid,
    data_0: JSON.stringify({
      items: [listitemUuid],
      reference: listitemUuid,
      selectedIndex: 0,
    }),
  })

  const url = `${AU_URL}${session.cu}`
  const start = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: BASE_URL,
      Origin: 'http://transport.plovdiv.bg',
      'ZK-SID': String(zkSid),
      Cookie: session.cookies,
    },
    body: body.toString(),
  })
  const ms = Date.now() - start
  const text = await res.text()
  return { ok: res.ok, status: res.status, text, ms }
}

// --- 4. Parse ETA-like data from AU response ---
function extractInsights(text: string) {
  // Търсим: всякакви label-и с минути, имена на линии, destination-и
  const labels = [...text.matchAll(/label:'((?:[^'\\]|\\.)*)'/g)].map((m) =>
    m[1].replace(/\\'/g, "'")
  )

  // Минути могат да изглеждат като: "5 мин", "1 мин", "<1 мин", "след 3 мин"
  const minuteLike = labels.filter((l) =>
    /\d+\s*мин|<\s*\d+\s*мин|сега|now/i.test(l)
  )

  // ZK команди — какво server-ът прави
  const commands = [...text.matchAll(/\["([a-z]+)",/g)].map((m) => m[1])
  const commandCounts: Record<string, number> = {}
  for (const c of commands) commandCounts[c] = (commandCounts[c] ?? 0) + 1

  // Listitem UUIDs в outer — това са новопоявилите се елементи
  const outerListitems = [
    ...text.matchAll(/'zul\.sel\.Listitem','([a-zA-Z0-9_]+)'/g),
  ].map((m) => m[1])

  return {
    totalLabels: labels.length,
    minuteLikeLabels: minuteLike,
    sampleLabels: labels.slice(0, 30),
    commandCounts,
    outerListitemCount: outerListitems.length,
  }
}

// --- Main ---
async function main() {
  await mkdir(RESPONSES_DIR, { recursive: true })
  console.log('--- Spike v2: ETA endpoint discovery ---\n')

  // Bootstrap
  const { session, html } = await bootstrap()
  await saveFile('06-bootstrap.html', html)

  // Find UUID-и
  const ids = findListitemForStop(html, TARGET_STOP_NUMBER)
  if (!ids) {
    log('FATAL', `Cannot find listitem for stop #${TARGET_STOP_NUMBER}`)
    return
  }
  log(
    'uuids',
    `listbox=${ids.listboxUuid} listitem=${ids.listitemUuid} for stop #${TARGET_STOP_NUMBER}`
  )

  // --- Single onSelect call ---
  log('phase 1', 'Single onSelect call')
  const r1 = await sendOnSelect(session, ids.listboxUuid, ids.listitemUuid, 1)
  log('response', `status=${r1.status} bytes=${r1.text.length} ms=${r1.ms}`)
  await saveFile('06-stop-select.json', r1.text)

  const insights = extractInsights(r1.text)
  log('insights', JSON.stringify(insights, null, 2))

  // --- Polling test: 3 calls × 30s ---
  // Само ако първата заявка върна нещо съдържателно
  if (r1.text.length > 200) {
    log('phase 2', 'Polling test — 3 заявки × 30 сек')
    const polls: { iter: number; ms: number; bytes: number; insights: ReturnType<typeof extractInsights> }[] = [
      { iter: 0, ms: r1.ms, bytes: r1.text.length, insights },
    ]

    for (let i = 1; i < 3; i++) {
      log('wait', `30s before poll ${i}...`)
      await new Promise((res) => setTimeout(res, 30_000))
      const rN = await sendOnSelect(
        session,
        ids.listboxUuid,
        ids.listitemUuid,
        i + 1
      )
      log('response', `iter=${i} status=${rN.status} bytes=${rN.text.length} ms=${rN.ms}`)
      await saveFile(`06-stop-select-poll-${i}.json`, rN.text)
      const ins = extractInsights(rN.text)
      polls.push({ iter: i, ms: rN.ms, bytes: rN.text.length, insights: ins })
    }

    await saveFile('06-polling-summary.json', JSON.stringify(polls, null, 2))

    // Comparison: дали минутите намаляват?
    log('ETA evolution per poll:')
    for (const p of polls) {
      log(`  poll ${p.iter}`, p.insights.minuteLikeLabels.join(' | ') || '(none)')
    }
  } else {
    log(
      'phase 2 skipped',
      'first response is too small - probably wrong protocol; investigate raw response first'
    )
  }
}

main().catch((err) => {
  console.error('Spike crashed:', err)
  process.exit(1)
})
