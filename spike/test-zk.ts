/**
 * ZK Framework spike test за transport.plovdiv.bg
 *
 * Findings:
 *   - ZK 6.0.1 EE (от 2012 г.), HTTP only, без CAPTCHA/Cloudflare
 *   - Session bootstrap: dtid + JSESSIONID от initial GET
 *   - AU endpoint: POST /zkau, body = url-encoded, response = JSON
 *   - 532 спирки + GPS координати са embed-нати като JSON в initial HTML
 *   - 29 уникални линии в системата
 *
 * Run: npx tsx spike/test-zk.ts
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE_URL = 'http://transport.plovdiv.bg/desktop/'
const AU_URL = 'http://transport.plovdiv.bg/zkau'
const RESPONSES_DIR = join(process.cwd(), 'spike', 'responses')

interface SpikeResult {
  step: string
  ok: boolean
  notes: string[]
}

interface Stop {
  number: number
  name: string
  lat: number
  lng: number
}

const results: SpikeResult[] = []

function log(step: string, ok: boolean, ...notes: string[]) {
  results.push({ step, ok, notes })
  console.log(`${ok ? '[OK]' : '[FAIL]'} ${step}`)
  for (const n of notes) if (n) console.log(`     ${n}`)
}

async function saveFile(name: string, content: string) {
  await writeFile(join(RESPONSES_DIR, name), content, 'utf8')
}

// --- Step 1: GET initial page ---
async function step1_fetchInitial() {
  const res = await fetch(BASE_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'bg-BG,bg;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
  })

  const html = await res.text()
  const cookies = res.headers.get('set-cookie') ?? ''
  await saveFile('01-initial.html', html)

  log(
    'GET initial page',
    res.ok,
    `status=${res.status}`,
    `cookies=${cookies ? 'yes' : 'no'}`,
    `html_length=${html.length}`
  )
  return { html, cookies }
}

// --- Step 2: Parse session ---
function step2_parseSession(html: string, setCookieHeader: string) {
  const dtidMatch = html.match(/\{dt:\s*['"]([a-zA-Z0-9_]+)['"]/)
  const dtid = dtidMatch ? dtidMatch[1] : null

  let jsessionId: string | null = null
  const cookieMatch = setCookieHeader.match(/JSESSIONID=([A-F0-9]+)/i)
  if (cookieMatch) jsessionId = cookieMatch[1]
  if (!jsessionId) {
    const urlMatch = html.match(/jsessionid=([A-F0-9]+)/i)
    if (urlMatch) jsessionId = urlMatch[1]
  }

  const cuMatch = html.match(/cu:\s*['"]([^'"]+)['"]/)
  const cu = cuMatch ? cuMatch[1] : ''
  const uuMatch = html.match(/uu:\s*['"]([^'"]+)['"]/)
  const uu = uuMatch ? uuMatch[1] : '/zkau'

  log(
    'Parse session info',
    !!(dtid && jsessionId),
    `dtid=${dtid}`,
    `jsessionId=${jsessionId}`,
    `cu=${cu}`,
    `uu=${uu}`
  )
  return { dtid, jsessionId, cu, uu }
}

// --- Step 3: Extract 532 stops + GPS от embedded JSON ---
function step3_extractStops(html: string): Stop[] {
  // BIG WIN: HTML съдържа JSON масив от вида:
  //   {"number":1,"name":"срещу ТЕЦ \"Север\"","lat":42.18301,"lng":24.73778}
  // 532 stops с GPS координати, директно от източника.
  // Двустъпков парсинг:
  //   1) намираме всички "number":N anchor позиции
  //   2) от всеки anchor четем напред до "lat":N,"lng":N (тези нямат escape-и)
  //   3) името е каквото е между първото "name":" и последното " преди ,"lat"
  const stops: Stop[] = []
  const anchorRe = /"number":(\d+),"name":"/g
  let anchor: RegExpExecArray | null
  while ((anchor = anchorRe.exec(html))) {
    const number = parseInt(anchor[1], 10)
    const nameStart = anchor.index + anchor[0].length
    // намери ,"lat": след това
    const latIdx = html.indexOf('","lat":', nameStart)
    if (latIdx === -1) continue
    const rawName = html.slice(nameStart, latIdx)
    const tail = html.slice(latIdx + 8) // skip `","lat":`
    const tailMatch = tail.match(/^([0-9.]+),"lng":([0-9.]+)/)
    if (!tailMatch) continue
    stops.push({
      number,
      name: rawName.replace(/\\\\"/g, '"').replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
      lat: parseFloat(tailMatch[1]),
      lng: parseFloat(tailMatch[2]),
    })
  }
  log(
    'Extract stops from embedded JSON',
    stops.length > 500,
    `found ${stops.length} stops with GPS (expected 532)`,
    stops[10]
      ? `sample: #${stops[10].number} "${stops[10].name}" (${stops[10].lat}, ${stops[10].lng})`
      : ''
  )
  return stops
}

// --- Step 4: Extract unique line numbers from Listcell labels ---
function step4_extractLines(html: string): string[] {
  // Линиите се появяват като третия Listcell в всеки Listitem на stops_list_list.
  // Прост подход: вземаме всички label-и които изглеждат като списък от номера.
  const allLines = new Set<string>()
  // Само label-и със запетая = списък от линии (избягваме stop numbers които са самостоятелни)
  const re = /label:'([0-9]+(?:,\s*[0-9]+)+)'/g
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    for (const ln of match[1].split(',')) {
      const t = ln.trim()
      if (t && /^\d+$/.test(t)) allLines.add(t)
    }
  }
  const sorted = [...allLines].sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  log(
    'Extract unique lines',
    sorted.length > 10,
    `found ${sorted.length} unique lines`,
    `lines: ${sorted.join(', ')}`
  )
  return sorted
}

// --- Step 5: Real ZK AU request - filter stops by number ---
async function step5_selectStop(
  session: { dtid: string; cu: string },
  cookies: string,
  textSearchUuid: string,
  stopNumber: string
) {
  const body = new URLSearchParams({
    dtid: session.dtid,
    cmd_0: 'onChanging',
    uuid_0: textSearchUuid,
    data_0: JSON.stringify({ value: stopNumber, start: 0 }),
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: BASE_URL,
    Origin: 'http://transport.plovdiv.bg',
    'ZK-SID': '1',
  }
  if (cookies) headers.Cookie = cookies.split(';')[0]

  const url = `${AU_URL}${session.cu}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: body.toString(),
  })

  const text = await res.text()
  await saveFile(`05-zkau-search-${stopNumber}.txt`, text)

  log(
    `POST /zkau - onChanging stop=${stopNumber}`,
    res.ok,
    `status=${res.status}`,
    `response_length=${text.length}`,
    `first 200 chars: ${text.slice(0, 200).replace(/\s+/g, ' ')}`
  )
  return { ok: res.ok, text }
}

// --- Main ---
async function main() {
  await mkdir(RESPONSES_DIR, { recursive: true })
  console.log('--- ZK spike test v3 ---\n')

  const initial = await step1_fetchInitial()
  if (!initial.html) {
    await writeFindings({})
    return
  }

  const session = step2_parseSession(initial.html, initial.cookies)
  if (!session.dtid || !session.jsessionId) {
    await writeFindings({ session })
    return
  }

  const stops = step3_extractStops(initial.html)
  const lines = step4_extractLines(initial.html)

  await saveFile('stops.json', JSON.stringify(stops, null, 2))
  await saveFile('lines.json', JSON.stringify(lines, null, 2))

  const textSearchMatch = initial.html.match(
    /'([a-zA-Z0-9_]+)',\{id:'text_search'/
  )
  const stopsLineMatch = initial.html.match(
    /'([a-zA-Z0-9_]+)',\{id:'stops_line'/
  )
  log(
    'Extract UI control UUIDs',
    !!(textSearchMatch && stopsLineMatch),
    `text_search uuid=${textSearchMatch?.[1]}`,
    `stops_line uuid=${stopsLineMatch?.[1]}`
  )

  if (textSearchMatch) {
    try {
      await step5_selectStop(
        { dtid: session.dtid, cu: session.cu },
        initial.cookies,
        textSearchMatch[1],
        '27'
      )
    } catch (err) {
      log('POST /zkau - onChanging', false, `error: ${(err as Error).message}`)
    }
  }

  await writeFindings({
    session,
    stopCount: stops.length,
    lineCount: lines.length,
  })
}

async function writeFindings(extra: Record<string, unknown>) {
  const out: string[] = []
  out.push('# ZK Spike — Run results\n')
  out.push(`Run timestamp: ${new Date().toISOString()}\n`)
  out.push('## Results\n')
  for (const r of results) {
    out.push(`### ${r.ok ? '[OK]' : '[FAIL]'} ${r.step}`)
    for (const n of r.notes) if (n) out.push(`- ${n}`)
    out.push('')
  }
  out.push('## Captured data\n')
  out.push('```json')
  out.push(JSON.stringify(extra, null, 2))
  out.push('```')
  out.push('\n> Подробна интерпретация: виж FINDINGS.md')
  await writeFile(
    join(process.cwd(), 'spike', 'RUN.md'),
    out.join('\n'),
    'utf8'
  )
  console.log('\nRun results written to spike/RUN.md')
}

main().catch((err) => {
  console.error('Spike crashed:', err)
  process.exit(1)
})
