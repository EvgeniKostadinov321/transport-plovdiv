/**
 * Debug ETA - точна симулация на browser AU sequence.
 *
 * От реален браузър cURL (заявка 5):
 *   POST /zkau
 *   Body:
 *     dtid=z_fbe
 *     cmd_0=onChange        ← НЕ onSelect самостоятелно!
 *     uuid_0=g71Qq          ← text_search Bandbox
 *     data_0={"value":"27","start":2}
 *
 *     cmd_1=onSelect
 *     uuid_1=g71Qt          ← stops_list_list
 *     data_1={"items":["g71Qlo"],"reference":"g71Qlo","clearFirst":false,
 *             "pageX":110,"pageY":193,"which":1,"x":100,"y":22}
 */

async function main() {
  // 1. Bootstrap
  const r = await fetch('http://transport.plovdiv.bg/desktop/', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    },
  })
  const html = await r.text()
  const dtid = html.match(/\{dt:\s*['"]([a-zA-Z0-9_]+)['"]/)?.[1]
  const cu = html.match(/cu:\s*['"]([^'"]+)['"]/)?.[1] ?? ''
  const cookies = (r.headers.get('set-cookie') ?? '').split(';')[0]

  const listboxUuid = html.match(
    /'([a-zA-Z0-9_]+)',\{id:'stops_list_list'/
  )?.[1]
  const textSearchUuid = html.match(
    /'([a-zA-Z0-9_]+)',\{id:'text_search'/
  )?.[1]

  // Намери listitem за спирка #27 (която знам че работи)
  const reStr = `'zul\\.sel\\.Listitem','([a-zA-Z0-9_]+)',[^\\[]*\\[\\s*\\['zul\\.sel\\.Listcell','[a-zA-Z0-9_]+',\\{label:'27'\\}`
  const m = new RegExp(reStr, 'g').exec(html)
  const listitemUuid = m?.[1]

  console.log({
    dtid,
    listboxUuid,
    textSearchUuid,
    listitemUuid,
  })

  if (!dtid || !listboxUuid || !textSearchUuid || !listitemUuid) {
    console.error('Missing IDs')
    return
  }

  // 2. EXACT browser-style: onChange (filter input) + onSelect (pick item)
  // в един POST request
  const body = new URLSearchParams({
    dtid,
    cmd_0: 'onChange',
    uuid_0: textSearchUuid,
    data_0: JSON.stringify({ value: '27', start: 2 }),
    cmd_1: 'onSelect',
    uuid_1: listboxUuid,
    data_1: JSON.stringify({
      items: [listitemUuid],
      reference: listitemUuid,
      clearFirst: false,
      pageX: 110,
      pageY: 193,
      which: 1,
      x: 100,
      y: 22,
    }),
  })

  const r2 = await fetch(`http://transport.plovdiv.bg/zkau${cu}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'http://transport.plovdiv.bg/desktop/',
      Origin: 'http://transport.plovdiv.bg',
      'ZK-SID': '1',
      Cookie: cookies,
    },
    body: body.toString(),
  })
  const text = await r2.text()
  console.log('status:', r2.status, 'bytes:', text.length)
  console.log('--- response: ---')
  console.log(text.slice(0, 3000))
}
main().catch(console.error)
