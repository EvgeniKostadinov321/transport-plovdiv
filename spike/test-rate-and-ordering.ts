/**
 * Spike v3 — Rate limit test + Line ordering discovery
 *
 * Целта на този spike:
 *   (A) Rate test: 20 ETA заявки през 15 сек = 5 мин общо
 *       - Latency на всяка
 *       - Размер на response-а
 *       - Дали status code се променя (429? 503?)
 *       - Дали session-ът expire-ва
 *
 *   (B) Ordering discovery: Дали виртуалното табло има режим
 *       "search by line" (вместо by stop) и дали връща спирките по ред.
 *       Кандидати:
 *       - stops_line бутон (по име: "ТЪРСЕНЕ ПО НОМЕР НА СПИРКА")
 *         → това всъщност отваря search-а ПО СПИРКА.
 *       - Трябва да открием друг бутон, например "ТЪРСЕНЕ ПО ЛИНИЯ".
 *
 * Run: npx tsx spike/test-rate-and-ordering.ts
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE_URL = 'http://transport.plovdiv.bg/desktop/'
const AU_URL = 'http://transport.plovdiv.bg/zkau'
const RESPONSES_DIR = join(process.cwd(), 'spike', 'responses')

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
      Accept: 'text/html,application/xhtml+xml,*/*',
    },
  })
  const html = await res.text()
  const cookies = res.headers.get('set-cookie') ?? ''
  const dtid = html.match(/\{dt:\s*['"]([a-zA-Z0-9_]+)['"]/)?.[1]
  const cu = html.match(/cu:\s*['"]([^'"]+)['"]/)?.[1] ?? ''
  if (!dtid) throw new Error('no dtid')
  return { session: { dtid, cu, cookies: cookies.split(';')[0] }, html }
}

function findListitemForStop(html: string, stopNumber: string) {
  const listboxMatch = html.match(/'([a-zA-Z0-9_]+)',\{id:'stops_list_list'/)
  if (!listboxMatch) return null
  const re = new RegExp(
    `'zul\\.sel\\.Listitem','([a-zA-Z0-9_]+)',[^\\[]*\\[\\s*\\['zul\\.sel\\.Listcell','[a-zA-Z0-9_]+',\\{label:'${stopNumber}'\\}`,
    'g'
  )
  const m = re.exec(html)
  if (!m) return null
  return { listboxUuid: listboxMatch[1], listitemUuid: m[1] }
}

async function sendOnSelect(
  session: Session,
  listboxUuid: string,
  listitemUuid: string,
  zkSid: number
) {
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
  const start = Date.now()
  const res = await fetch(`${AU_URL}${session.cu}`, {
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
  return { status: res.status, bytes: text.length, ms, text }
}

// --- (A) RATE LIMIT TEST ---
async function rateLimitTest() {
  log('rate-test', 'Bootstrap session...')
  const { session, html } = await bootstrap()
  const ids = findListitemForStop(html, '27')
  if (!ids) {
    log('rate-test FATAL', 'cannot find listitem')
    return
  }

  const N = 20
  const intervalMs = 15_000
  log('rate-test', `Plan: ${N} заявки × ${intervalMs / 1000}s = ${(N * intervalMs) / 60_000} min`)

  const results: { i: number; status: number; bytes: number; ms: number; ok: boolean }[] = []
  for (let i = 0; i < N; i++) {
    const r = await sendOnSelect(session, ids.listboxUuid, ids.listitemUuid, i + 10)
    const ok = r.status === 200 && r.bytes > 200
    results.push({ i, status: r.status, bytes: r.bytes, ms: r.ms, ok })
    log(
      'req',
      `i=${i} status=${r.status} bytes=${r.bytes} ms=${r.ms} ok=${ok}`
    )
    if (!ok) {
      await saveFile(`07-rate-fail-${i}.json`, r.text)
    }
    if (i < N - 1) {
      await new Promise((res) => setTimeout(res, intervalMs))
    }
  }

  // Summary
  const avgMs = results.reduce((a, r) => a + r.ms, 0) / results.length
  const maxMs = Math.max(...results.map((r) => r.ms))
  const minBytes = Math.min(...results.map((r) => r.bytes))
  const maxBytes = Math.max(...results.map((r) => r.bytes))
  const failedCount = results.filter((r) => !r.ok).length

  const summary = {
    n: N,
    intervalMs,
    avgMs: Math.round(avgMs),
    maxMs,
    minBytes,
    maxBytes,
    failedCount,
    statusCodes: [...new Set(results.map((r) => r.status))],
    results,
  }
  await saveFile('07-rate-summary.json', JSON.stringify(summary, null, 2))
  log('rate-test SUMMARY', JSON.stringify(summary, null, 2))
}

// --- (B) ORDERING DISCOVERY ---
async function orderingDiscovery() {
  log('ordering', 'Bootstrap session...')
  const { html } = await bootstrap()

  // Списък на всички "ТЪРСЕНЕ" бутони / labels в HTML-а
  const searchHeaders = [
    ...html.matchAll(/label:'(ТЪРСЕНЕ [^']+)'/g),
  ].map((m) => m[1])
  log('ordering', 'Search headers:', searchHeaders)

  // Списък на всички елементи с id - кои са "режимите"?
  const ids = [...html.matchAll(/\{id:'([^']+)'/g)].map((m) => m[1])
  log('ordering', `Total id-ed components: ${ids.length}`)
  log('ordering', 'Sample ids:', ids.slice(0, 30))

  // Има ли нещо специфично с "line" в id-а?
  const lineRelated = ids.filter((i) => /line/i.test(i))
  log('ordering', 'Line-related ids:', lineRelated)

  // Списък на всички label-и с "линия" или "Линия"
  const lineLabels = [...html.matchAll(/label:'([^']*[Лл]ини[^']*)'/g)].map(
    (m) => m[1]
  )
  log('ordering', 'Line-related labels:', lineLabels.slice(0, 10))

  // Запиши findings
  await saveFile(
    '08-ordering-discovery.json',
    JSON.stringify(
      {
        searchHeaders,
        totalComponentIds: ids.length,
        allIds: ids,
        lineRelatedIds: lineRelated,
        lineLabels,
      },
      null,
      2
    )
  )
}

async function main() {
  await mkdir(RESPONSES_DIR, { recursive: true })

  const mode = process.argv[2] ?? 'all'

  if (mode === 'ordering' || mode === 'all') {
    console.log('\n=== (B) ORDERING DISCOVERY ===\n')
    await orderingDiscovery()
  }

  if (mode === 'rate' || mode === 'all') {
    console.log('\n=== (A) RATE LIMIT TEST ===\n')
    await rateLimitTest()
  }
}

main().catch((err) => {
  console.error('Spike crashed:', err)
  process.exit(1)
})
