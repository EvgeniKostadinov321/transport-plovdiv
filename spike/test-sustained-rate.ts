/**
 * Spike v6 - Sustained rate test
 *
 * Цел: 2 заявки/сек за 15 минути (1800 заявки) непрекъснато,
 * с mix от различни спирки. Production-realistic.
 *
 * Меря:
 *   - Latency curve (avg, p50, p95, max) на всеки минута
 *   - Status code distribution
 *   - Session stability (преоткриване ако умре)
 *   - Silent throttling (latency скока)
 *
 * Run: npx tsx spike/test-sustained-rate.ts
 *      или: npx tsx spike/test-sustained-rate.ts 5   # 5 мин вместо 15
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE_URL = 'http://transport.plovdiv.bg/desktop/'
const AU_URL = 'http://transport.plovdiv.bg/zkau'
const RESPONSES_DIR = join(process.cwd(), 'spike', 'responses')

const TARGET_RPS = 2 // requests per second
const DURATION_MIN = parseInt(process.argv[2] ?? '15', 10)

interface Session {
  dtid: string
  cu: string
  cookies: string
  textSearchUuid: string
  listboxUuid: string
}

async function bootstrap(): Promise<Session & { html: string }> {
  const r = await fetch(BASE_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0',
    },
  })
  const html = await r.text()
  const dtid = html.match(/\{dt:\s*['"]([a-zA-Z0-9_]+)['"]/)?.[1]
  const cu = html.match(/cu:\s*['"]([^'"]+)['"]/)?.[1] ?? ''
  const cookies = (r.headers.get('set-cookie') ?? '').split(';')[0]
  const textSearchUuid = html.match(
    /'([a-zA-Z0-9_]+)',\{id:'text_search'/
  )?.[1]
  const listboxUuid = html.match(
    /'([a-zA-Z0-9_]+)',\{id:'stops_list_list'/
  )?.[1]
  if (!dtid || !textSearchUuid || !listboxUuid) {
    throw new Error('bootstrap failed')
  }
  return { dtid, cu, cookies, textSearchUuid, listboxUuid, html }
}

async function queryStop(
  session: Session,
  stopNumber: number,
  zkSid: number
): Promise<{ status: number; bytes: number; ms: number; etaCount: number; error?: string }> {
  // 2-step: onChanging filter -> parse new UUID -> onSelect
  const filterStart = Date.now()
  const filterBody = new URLSearchParams({
    dtid: session.dtid,
    cmd_0: 'onChanging',
    opt_0: 'i',
    uuid_0: session.textSearchUuid,
    data_0: JSON.stringify({ value: String(stopNumber), start: 1 }),
  })
  let filterRes
  try {
    filterRes = await fetch(`${AU_URL}${session.cu}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 Chrome/148.0.0.0',
        Accept: '*/*',
        Referer: BASE_URL,
        Origin: 'http://transport.plovdiv.bg',
        'ZK-SID': String(zkSid),
        Cookie: session.cookies,
      },
      body: filterBody.toString(),
    })
  } catch (err) {
    return {
      status: 0,
      bytes: 0,
      ms: Date.now() - filterStart,
      etaCount: 0,
      error: `filter network: ${(err as Error).message}`,
    }
  }
  const filterText = await filterRes.text()
  if (!filterRes.ok || filterText.length < 200) {
    return {
      status: filterRes.status,
      bytes: filterText.length,
      ms: Date.now() - filterStart,
      etaCount: 0,
      error: 'filter failed',
    }
  }

  // Parse new listitem UUID
  const itemRe =
    /'zul\.sel\.Listitem','([a-zA-Z0-9_]+)',\{_loaded:true,_index:\d+\},\[\s*\['zul\.sel\.Listcell','[a-zA-Z0-9_]+',\{label:'(\d+)'\}/g
  let newUuid: string | null = null
  let im: RegExpExecArray | null
  while ((im = itemRe.exec(filterText))) {
    if (parseInt(im[2], 10) === stopNumber) {
      newUuid = im[1]
      break
    }
  }
  if (!newUuid) {
    return {
      status: filterRes.status,
      bytes: filterText.length,
      ms: Date.now() - filterStart,
      etaCount: 0,
      error: 'no listitem in filter result',
    }
  }

  // Select - the main ETA query
  const selectBody = new URLSearchParams({
    dtid: session.dtid,
    cmd_0: 'onChange',
    uuid_0: session.textSearchUuid,
    data_0: JSON.stringify({
      value: String(stopNumber),
      start: String(stopNumber).length,
    }),
    cmd_1: 'onSelect',
    uuid_1: session.listboxUuid,
    data_1: JSON.stringify({
      items: [newUuid],
      reference: newUuid,
      clearFirst: false,
      pageX: 110,
      pageY: 193,
      which: 1,
      x: 100,
      y: 22,
    }),
  })
  const selectRes = await fetch(`${AU_URL}${session.cu}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 Chrome/148.0.0.0',
      Accept: '*/*',
      Referer: BASE_URL,
      Origin: 'http://transport.plovdiv.bg',
      'ZK-SID': String(zkSid + 1),
      Cookie: session.cookies,
    },
    body: selectBody.toString(),
  })
  const selectText = await selectRes.text()
  const totalMs = Date.now() - filterStart

  // Count ETAs in response
  const etaCount = (selectText.match(/'zul\.sel\.Listitem'/g) ?? []).length

  return {
    status: selectRes.status,
    bytes: selectText.length,
    ms: totalMs,
    etaCount,
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.floor(((sorted.length - 1) * p) / 100)
  return sorted[idx]
}

async function main() {
  await mkdir(RESPONSES_DIR, { recursive: true })
  console.log(
    `--- Spike v6: Sustained rate test (${TARGET_RPS} req/s for ${DURATION_MIN} min) ---\n`
  )

  // Зареди централни спирки (избягваме pagination edge-cases)
  // Това са спирки които работят добре: централни, с трафик
  const stopPool = [
    1, 12, 14, 27, 34, 46, 69, 97, 104, 120, 138, 140, 165, 177, 215, 273, 300, 338,
  ]

  console.log(`Strategy: fresh session per request (ZK state limitation)`)

  const totalRequests = TARGET_RPS * 60 * DURATION_MIN
  const intervalMs = 1000 / TARGET_RPS

  type Result = {
    i: number
    timestamp: number
    stop: number
    status: number
    bytes: number
    ms: number
    etaCount: number
    error?: string
  }
  const results: Result[] = []
  const startTime = Date.now()
  let sessionRecreated = 0

  for (let i = 0; i < totalRequests; i++) {
    const stop = stopPool[i % stopPool.length]
    const ts = Date.now()
    let r
    try {
      const session = await bootstrap()
      r = await queryStop(session, stop, 1)
    } catch (err) {
      r = {
        status: 0,
        bytes: 0,
        ms: Date.now() - ts,
        etaCount: 0,
        error: `bootstrap: ${(err as Error).message}`,
      }
    }
    results.push({
      i,
      timestamp: ts - startTime,
      stop,
      status: r.status,
      bytes: r.bytes,
      ms: r.ms,
      etaCount: r.etaCount,
      error: r.error,
    })

    // No session recovery нужен - fresh session per request

    // Per-minute mini summary
    if ((i + 1) % (TARGET_RPS * 60) === 0) {
      const lastMin = results.slice(-(TARGET_RPS * 60))
      const okCount = lastMin.filter((x) => x.status === 200).length
      const latencies = lastMin.map((x) => x.ms)
      console.log(
        `min ${Math.floor((i + 1) / (TARGET_RPS * 60))}:`,
        `ok=${okCount}/${lastMin.length}`,
        `avg=${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)}ms`,
        `p95=${percentile(latencies, 95)}ms`,
        `max=${Math.max(...latencies)}ms`
      )
    }

    // Throttle to target RPS
    const elapsed = Date.now() - ts
    if (elapsed < intervalMs) {
      await new Promise((res) => setTimeout(res, intervalMs - elapsed))
    }
  }

  // Final summary
  const okResults = results.filter((r) => r.status === 200)
  const failedResults = results.filter((r) => r.status !== 200)
  const okLatencies = okResults.map((r) => r.ms)
  const summary = {
    durationMin: DURATION_MIN,
    targetRps: TARGET_RPS,
    totalRequests,
    sessionRecreated,
    success: okResults.length,
    failures: failedResults.length,
    failureRate: ((failedResults.length / totalRequests) * 100).toFixed(2) + '%',
    statusCodes: results.reduce(
      (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
      {} as Record<number, number>
    ),
    latency: {
      avg: Math.round(
        okLatencies.reduce((a, b) => a + b, 0) / okLatencies.length
      ),
      p50: percentile(okLatencies, 50),
      p95: percentile(okLatencies, 95),
      p99: percentile(okLatencies, 99),
      max: Math.max(...okLatencies),
    },
    bytesAvg: Math.round(
      okResults.reduce((a, r) => a + r.bytes, 0) / okResults.length
    ),
    errorsByType: failedResults.reduce(
      (acc, r) => ({ ...acc, [r.error ?? `http_${r.status}`]: (acc[r.error ?? `http_${r.status}`] ?? 0) + 1 }),
      {} as Record<string, number>
    ),
  }

  console.log('\n=== SUMMARY ===\n')
  console.log(JSON.stringify(summary, null, 2))

  await writeFile(
    join(RESPONSES_DIR, '10-sustained-rate-summary.json'),
    JSON.stringify({ summary, results }, null, 2)
  )
}

main().catch((err) => {
  console.error('Spike crashed:', err)
  process.exit(1)
})
