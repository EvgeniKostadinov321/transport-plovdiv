/**
 * Compare моят работещ debug-eta.ts срещу spike v5 logic за СЪЩАТА стопа #27.
 * Целта: открием defining разлика.
 */

async function bootstrap() {
  const r = await fetch('http://transport.plovdiv.bg/desktop/', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    },
  })
  const html = await r.text()
  const dtid = html.match(/\{dt:\s*['"]([a-zA-Z0-9_]+)['"]/)?.[1]!
  const cu = html.match(/cu:\s*['"]([^'"]+)['"]/)?.[1] ?? ''
  const cookies = (r.headers.get('set-cookie') ?? '').split(';')[0]
  return { html, dtid, cu, cookies }
}

function findListitemForStop(html: string, stopNumber: number) {
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

async function main() {
  const { html, dtid, cu, cookies } = await bootstrap()
  const textSearchUuid = html.match(/'([a-zA-Z0-9_]+)',\{id:'text_search'/)?.[1]!

  // Метод A: debug-eta.ts (работещ) - hardcoded stop=27
  console.log('=== Метод A: debug-eta.ts style (hardcoded #27) ===')
  const idsA = findListitemForStop(html, 27)
  console.log('A: ids=', idsA)

  const bodyA = new URLSearchParams({
    dtid,
    cmd_0: 'onChange',
    uuid_0: textSearchUuid,
    data_0: JSON.stringify({ value: '27', start: 2 }),
    cmd_1: 'onSelect',
    uuid_1: idsA!.listboxUuid,
    data_1: JSON.stringify({
      items: [idsA!.listitemUuid],
      reference: idsA!.listitemUuid,
      clearFirst: false,
      pageX: 110,
      pageY: 193,
      which: 1,
      x: 100,
      y: 22,
    }),
  })
  console.log('A body:', bodyA.toString())

  const rA = await fetch(`http://transport.plovdiv.bg/zkau${cu}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      Accept: '*/*',
      Referer: 'http://transport.plovdiv.bg/desktop/',
      Origin: 'http://transport.plovdiv.bg',
      'ZK-SID': '1',
      Cookie: cookies,
    },
    body: bodyA.toString(),
  })
  const textA = await rA.text()
  console.log('A status:', rA.status, 'bytes:', textA.length)

  // Метод B: spike v5 style (with start:0)
  console.log('\n=== Метод B: spike v5 style (start:0) ===')
  const idsB = findListitemForStop(html, 27)
  const bodyB = new URLSearchParams({
    dtid,
    cmd_0: 'onChange',
    uuid_0: textSearchUuid,
    data_0: JSON.stringify({ value: '27', start: 0 }), // ← разлика тук!
    cmd_1: 'onSelect',
    uuid_1: idsB!.listboxUuid,
    data_1: JSON.stringify({
      items: [idsB!.listitemUuid],
      reference: idsB!.listitemUuid,
      clearFirst: false,
      pageX: 110,
      pageY: 193,
      which: 1,
      x: 100,
      y: 22,
    }),
  })
  const rB = await fetch(`http://transport.plovdiv.bg/zkau${cu}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      Accept: '*/*',
      Referer: 'http://transport.plovdiv.bg/desktop/',
      Origin: 'http://transport.plovdiv.bg',
      'ZK-SID': '2',
      Cookie: cookies,
    },
    body: bodyB.toString(),
  })
  const textB = await rB.text()
  console.log('B status:', rB.status, 'bytes:', textB.length)
}

main().catch(console.error)
