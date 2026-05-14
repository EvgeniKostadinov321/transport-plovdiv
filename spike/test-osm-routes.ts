/**
 * Spike: Проверка на OSM Overpass за bus routes в Пловдив.
 *
 * OSM има релации тип `type=route, route=bus, ref=<line_number>`.
 * Ако са mapped правилно - имаме точните полилинии.
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// Bounding box around Plovdiv: south, west, north, east
const QUERY = `
[out:json][timeout:60];
(
  relation["type"="route"]["route"="bus"](42.08,24.65,42.20,24.85);
);
out tags;
`

interface OsmRelation {
  type: string
  id: number
  tags: Record<string, string>
}

interface OverpassResponse {
  elements: OsmRelation[]
}

async function main() {
  console.log('Querying Overpass for bus routes in Пловдив...')
  const params = new URLSearchParams()
  params.set('data', QUERY)
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: params.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'transport-plovdiv-spike/1.0',
    },
  })

  if (!res.ok) {
    console.error(`Overpass failed: ${res.status}`)
    const text = await res.text()
    console.error(text.slice(0, 500))
    return
  }

  const data = (await res.json()) as OverpassResponse
  console.log(`Found ${data.elements.length} bus route relations\n`)

  // Group by line number
  const byLine = new Map<string, OsmRelation[]>()
  for (const rel of data.elements) {
    const ref = rel.tags.ref ?? rel.tags.name ?? '(no ref)'
    const list = byLine.get(ref) ?? []
    list.push(rel)
    byLine.set(ref, list)
  }

  console.log('=== Lines mapped in OSM ===')
  const sorted = [...byLine.entries()].sort(([a], [b]) => {
    const na = parseInt(a, 10)
    const nb = parseInt(b, 10)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })

  for (const [ref, rels] of sorted) {
    console.log(`Line ${ref}: ${rels.length} relations`)
    for (const rel of rels) {
      const name = rel.tags.name ?? rel.tags.from + ' → ' + rel.tags.to ?? '(unknown)'
      console.log(`  - ${rel.id}: ${name}`)
    }
  }

  console.log(`\nTotal unique line numbers: ${byLine.size}`)
}

main().catch((err) => {
  console.error('Spike crashed:', err)
  process.exit(1)
})
