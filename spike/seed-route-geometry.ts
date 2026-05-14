/**
 * Spike: Extract real bus route geometries from OSM Overpass.
 *
 * За всяка линия + посока, връща ordered list of GPS coordinates представящи
 * реалния път по който пътува автобуса (mapped от OSM contributors).
 *
 * Output: data/seed/route-geometry.json
 *
 * Structure:
 * {
 *   "1": [
 *     {
 *       "name": "Автобус 1: АПК → кв. Коматево",
 *       "from": "АПК",
 *       "to": "кв. Коматево",
 *       "coords": [[42.18, 24.73], [42.18, 24.74], ...]
 *     },
 *     ...
 *   ]
 * }
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const OUT_DIR = join(process.cwd(), 'data', 'seed')

// Bounding box around Plovdiv
const BBOX = '42.08,24.65,42.20,24.85'

interface OverpassNode {
  type: 'node'
  id: number
  lat: number
  lon: number
}

interface OverpassWay {
  type: 'way'
  id: number
  nodes: number[]
}

interface OverpassMember {
  type: 'node' | 'way' | 'relation'
  ref: number
  role: string
}

interface OverpassRelation {
  type: 'relation'
  id: number
  members: OverpassMember[]
  tags: Record<string, string>
}

type OverpassElement = OverpassNode | OverpassWay | OverpassRelation

interface OverpassResponse {
  elements: OverpassElement[]
}

async function fetchOverpass(query: string): Promise<OverpassResponse> {
  const params = new URLSearchParams()
  params.set('data', query)
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
    const text = await res.text()
    throw new Error(`Overpass ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as OverpassResponse
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  console.log('Step 1: Fetching all bus routes + their nodes/ways...')
  // Запитваме за relations + recurse надолу (всички ways и nodes)
  const fullQuery = `
[out:json][timeout:120];
(
  relation["type"="route"]["route"="bus"](${BBOX});
);
>>;
out body;
`

  const data = await fetchOverpass(fullQuery)
  console.log(`Got ${data.elements.length} elements`)

  // Index nodes by ID
  const nodesById = new Map<number, OverpassNode>()
  const waysById = new Map<number, OverpassWay>()
  const relations: OverpassRelation[] = []

  for (const el of data.elements) {
    if (el.type === 'node') nodesById.set(el.id, el)
    else if (el.type === 'way') waysById.set(el.id, el)
    else if (el.type === 'relation') relations.push(el)
  }

  console.log(
    `  Nodes: ${nodesById.size}, Ways: ${waysById.size}, Relations: ${relations.length}\n`
  )

  console.log('Step 2: Building geometry per relation...')

  interface RouteGeometry {
    osmId: number
    name: string
    from: string | null
    to: string | null
    coords: [number, number][]
    nodeCount: number
  }

  const byLine = new Map<string, RouteGeometry[]>()

  for (const rel of relations) {
    const ref = rel.tags.ref
    if (!ref) continue

    // Skip Flixbus etc (multi-day intercity)
    if (rel.tags.network && /flixbus/i.test(rel.tags.network)) continue
    if (/^N\d+$/.test(ref)) continue

    // Колектираме координатите от ways в правилен ред
    const coords: [number, number][] = []
    let lastNodeId: number | null = null

    for (const m of rel.members) {
      if (m.type !== 'way') continue
      const way = waysById.get(m.ref)
      if (!way) continue

      // way.nodes е ordered list. Може да трябва да го обърнем.
      let nodeIds = way.nodes
      if (lastNodeId !== null && nodeIds[0] !== lastNodeId && nodeIds[nodeIds.length - 1] === lastNodeId) {
        nodeIds = [...nodeIds].reverse()
      }

      for (const nodeId of nodeIds) {
        const node = nodesById.get(nodeId)
        if (!node) continue
        // Skip if duplicate с предишния
        const last = coords[coords.length - 1]
        if (last && last[0] === node.lat && last[1] === node.lon) continue
        coords.push([node.lat, node.lon])
      }
      lastNodeId = nodeIds[nodeIds.length - 1]
    }

    if (coords.length < 5) continue // sanity - твърде къс маршрут

    const geom: RouteGeometry = {
      osmId: rel.id,
      name: rel.tags.name ?? `Линия ${ref}`,
      from: rel.tags.from ?? null,
      to: rel.tags.to ?? null,
      coords,
      nodeCount: coords.length,
    }

    const list = byLine.get(ref) ?? []
    list.push(geom)
    byLine.set(ref, list)
  }

  console.log(`\nLines extracted: ${byLine.size}`)
  for (const [ref, geoms] of byLine) {
    console.log(`  Line ${ref}: ${geoms.length} directions, total nodes:`, geoms.map(g => g.nodeCount).join(', '))
  }

  // Save
  const output: Record<string, RouteGeometry[]> = {}
  // Sort by line number
  const sorted = [...byLine.entries()].sort(([a], [b]) => {
    const na = parseInt(a, 10)
    const nb = parseInt(b, 10)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })
  for (const [ref, geoms] of sorted) {
    output[ref] = geoms
  }

  const outFile = join(OUT_DIR, 'route-geometry.json')
  await writeFile(
    outFile,
    JSON.stringify(
      {
        extractedAt: new Date().toISOString(),
        source: 'OpenStreetMap Overpass API',
        lineCount: byLine.size,
        lines: output,
      },
      null,
      2
    )
  )

  console.log(`\nSaved: ${outFile}`)
}

main().catch((err) => {
  console.error('Crashed:', err)
  process.exit(1)
})
