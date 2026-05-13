/**
 * ZK client за transport.plovdiv.bg.
 *
 * Workflow за получаване на ETA за спирка:
 *   1. Bootstrap (GET /desktop/) → dtid, JSESSIONID, UUIDs
 *   2. Filter (POST onChanging) → нови listitem UUIDs за filtered спирки
 *   3. Select (POST onChange + onSelect с mouse coords) → ETA данни
 *
 * Стратегия: fresh session per query (ZK state е fragile при reuse).
 */

const BASE_URL = 'http://transport.plovdiv.bg/desktop/'
const AU_URL = 'http://transport.plovdiv.bg/zkau'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

export interface ETAEntry {
  /** Линия номер (напр. "18", "99") */
  line: string
  /** Остатъчни минути до пристигане */
  minutes: number
  /** Час на пристигане HH:MM */
  arrivalTime: string
  /** Destination string (крайна спирка / посока) */
  destination: string
}

export interface Session {
  dtid: string
  cu: string
  cookies: string
  textSearchUuid: string
  listboxUuid: string
}

async function bootstrap(): Promise<Session> {
  const res = await fetch(BASE_URL, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'bg-BG,bg;q=0.9,en;q=0.8',
    },
  })
  if (!res.ok) {
    throw new Error(`bootstrap failed: ${res.status}`)
  }
  const html = await res.text()
  const dtid = html.match(/\{dt:\s*['"]([a-zA-Z0-9_]+)['"]/)?.[1]
  const cu = html.match(/cu:\s*['"]([^'"]+)['"]/)?.[1] ?? ''
  const cookies = (res.headers.get('set-cookie') ?? '').split(';')[0]
  const textSearchUuid = html.match(
    /'([a-zA-Z0-9_]+)',\{id:'text_search'/
  )?.[1]
  const listboxUuid = html.match(
    /'([a-zA-Z0-9_]+)',\{id:'stops_list_list'/
  )?.[1]
  if (!dtid || !textSearchUuid || !listboxUuid) {
    throw new Error('bootstrap parse failed: missing required UUIDs')
  }
  return { dtid, cu, cookies, textSearchUuid, listboxUuid }
}

async function auPost(
  session: Session,
  body: URLSearchParams,
  zkSid: number
): Promise<string> {
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
    throw new Error(`AU POST failed: ${res.status} (${text.slice(0, 100)})`)
  }
  return text
}

function findNewListitemUuid(
  filterResponse: string,
  stopNumber: number
): string | null {
  const re =
    /'zul\.sel\.Listitem','([a-zA-Z0-9_]+)',\{_loaded:true,_index:\d+\},\[\s*\['zul\.sel\.Listcell','[a-zA-Z0-9_]+',\{label:'(\d+)'\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(filterResponse))) {
    if (parseInt(m[2], 10) === stopNumber) {
      return m[1]
    }
  }
  return null
}

function parseETAResponse(text: string): ETAEntry[] {
  const rows: ETAEntry[] = []
  const anchorRe =
    /'zul\.sel\.Listitem','[a-zA-Z0-9_]+',\{_loaded:true,_index:\d+\}/g
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
    if (
      labels.length >= 4 &&
      /^\d+$/.test(labels[0]) &&
      /^\d+$/.test(labels[1])
    ) {
      rows.push({
        line: labels[0],
        minutes: parseInt(labels[1], 10),
        arrivalTime: labels[2],
        destination: labels[3],
      })
    }
  }
  return rows
}

/**
 * Връща списък с пристигащи автобуси за дадена спирка.
 *
 * @param stopNumber Номерът на спирката (напр. 27 за „Коматевско шосе")
 */
export async function getStopETA(stopNumber: number): Promise<ETAEntry[]> {
  const session = await bootstrap()

  // Step 1: Filter с onChanging - server генерира filtered listitems с нови UUIDs
  const filterBody = new URLSearchParams({
    dtid: session.dtid,
    cmd_0: 'onChanging',
    opt_0: 'i',
    uuid_0: session.textSearchUuid,
    data_0: JSON.stringify({ value: String(stopNumber), start: 1 }),
  })
  const filterResponse = await auPost(session, filterBody, 1)

  const newListitemUuid = findNewListitemUuid(filterResponse, stopNumber)
  if (!newListitemUuid) {
    throw new Error(
      `Stop #${stopNumber} not found in filter response (probably invalid stop number)`
    )
  }

  // Step 2: onChange + onSelect със mouse coords (server изисква)
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
  const selectResponse = await auPost(session, selectBody, 2)

  return parseETAResponse(selectResponse)
}
