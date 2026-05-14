/**
 * Spike: connect to livetransport.eu WebSocket and log GPS frames.
 *
 * Целта е да разберем:
 *   - какъв е форматът на vehicleData (array of tuples?)
 *   - колко често push-ва updates
 *   - колко vehicles има активни в Plovdiv в момента
 *   - има ли split: bus / trolley / tram (Plovdiv е само bus, но да проверим)
 *   - стабилни ли са ID-тата между frames (= можем ли да track-ваме един и същи bus)
 *
 * Run: tsx spike/test-livetransport-ws.ts
 */

const WS_URL = 'wss://api.livetransport.eu/plovdiv'
const RUN_SECONDS = 60

interface VehicleSnapshot {
  id: string
  lineId: string
  lat: number
  lng: number
  bearing: number
  speed: number
  lastUpdated: number
  destination?: string
}

const allVehiclesSeen = new Map<string, VehicleSnapshot[]>()
let frameCount = 0
let firstFrameAt = 0
let lastFrameAt = 0
let totalBytes = 0

function parseVehicleTuple(t: any[]): VehicleSnapshot | null {
  // Variant A (no delay): [id, type, lineId, blockId, destination, [lat,lng], bearing, speed, lastUpdated]
  // Variant B (with delay): [id, type, lineId, blockId, destination, delay, [lat,lng], bearing, speed, lastUpdated]
  // Detect by where the [lat,lng] array is.
  let coordsIdx = -1
  for (let i = 5; i < Math.min(t.length, 8); i++) {
    if (Array.isArray(t[i]) && t[i].length === 2 && typeof t[i][0] === 'number') {
      coordsIdx = i
      break
    }
  }
  if (coordsIdx === -1) return null
  const [lat, lng] = t[coordsIdx]
  return {
    id: String(t[0]),
    lineId: String(t[2]),
    destination: t[4] != null ? String(t[4]) : undefined,
    lat,
    lng,
    bearing: t[coordsIdx + 1],
    speed: t[coordsIdx + 2],
    lastUpdated: t[coordsIdx + 3],
  }
}

async function run() {
  console.log(`Connecting to ${WS_URL}…`)
  const ws = new WebSocket(WS_URL)

  ws.addEventListener('open', () => {
    console.log('OPEN')
  })

  ws.addEventListener('error', (e) => {
    console.error('ERROR', e)
  })

  ws.addEventListener('close', (e) => {
    console.log(`CLOSE code=${e.code} reason=${e.reason}`)
  })

  ws.addEventListener('message', (event) => {
    const now = Date.now()
    if (!firstFrameAt) firstFrameAt = now
    lastFrameAt = now
    frameCount++

    const raw = typeof event.data === 'string' ? event.data : '[binary]'
    totalBytes += raw.length

    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.log(`Frame #${frameCount} unparseable (${raw.length} bytes), preview:`, raw.slice(0, 200))
      return
    }

    // Първия frame — печатаме структурата подробно
    if (frameCount === 1) {
      console.log('\n=== FIRST FRAME ===')
      console.log('Type:', Array.isArray(parsed) ? `Array(${parsed.length})` : typeof parsed)
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log('First element raw:', JSON.stringify(parsed[0]))
        if (parsed.length > 1) console.log('Second element raw:', JSON.stringify(parsed[1]))
      } else {
        console.log('Top-level keys:', Object.keys(parsed))
        console.log('Sample:', JSON.stringify(parsed).slice(0, 500))
      }
      console.log('=== END FIRST FRAME ===\n')
    }

    // Опит за parsing като array от vehicle tuples
    const vehiclesArr = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.vehicles)
        ? parsed.vehicles
        : null

    if (!vehiclesArr) {
      console.log(`Frame #${frameCount}: not array, keys=${Object.keys(parsed)}`)
      return
    }

    let parsedOK = 0
    for (const t of vehiclesArr) {
      if (!Array.isArray(t)) continue
      const snap = parseVehicleTuple(t)
      if (!snap) continue
      parsedOK++
      const history = allVehiclesSeen.get(snap.id) ?? []
      history.push(snap)
      allVehiclesSeen.set(snap.id, history)
    }

    console.log(
      `Frame #${frameCount} @ +${((now - firstFrameAt) / 1000).toFixed(1)}s — ` +
        `${vehiclesArr.length} entries, parsed ${parsedOK}, ${raw.length}B`
    )
  })

  setTimeout(() => {
    console.log('\n=== SHUTDOWN — analyzing ===\n')
    ws.close(4000)

    const durationS = (lastFrameAt - firstFrameAt) / 1000
    console.log(`Frames: ${frameCount} over ${durationS.toFixed(1)}s`)
    console.log(`Avg interval: ${(durationS / Math.max(frameCount - 1, 1)).toFixed(2)}s`)
    console.log(`Total payload: ${(totalBytes / 1024).toFixed(1)} KB`)
    console.log(`Unique vehicle IDs seen: ${allVehiclesSeen.size}`)

    // Колко обновявания получи всеки vehicle?
    const updateCounts = [...allVehiclesSeen.values()].map((h) => h.length)
    updateCounts.sort((a, b) => b - a)
    console.log(`Updates/vehicle: max=${updateCounts[0]}, median=${updateCounts[Math.floor(updateCounts.length / 2)]}, min=${updateCounts[updateCounts.length - 1]}`)

    // Sample движение — vehicle с най-много updates
    if (allVehiclesSeen.size > 0) {
      const sorted = [...allVehiclesSeen.entries()].sort((a, b) => b[1].length - a[1].length)
      const [topId, topHistory] = sorted[0]
      console.log(`\nMost-updated vehicle ${topId} (${topHistory.length} updates):`)
      for (const s of topHistory.slice(0, 10)) {
        console.log(
          `  line=${s.lineId} dest="${s.destination}" pos=[${s.lat.toFixed(5)},${s.lng.toFixed(5)}] bearing=${s.bearing}° speed=${s.speed} ts=${s.lastUpdated}`
        )
      }
    }

    // Линии covered
    const byLine = new Map<string, number>()
    for (const history of allVehiclesSeen.values()) {
      const lineId = history[history.length - 1].lineId
      byLine.set(lineId, (byLine.get(lineId) ?? 0) + 1)
    }
    console.log(`\nVehicles per line (line: count):`)
    const lineEntries = [...byLine.entries()].sort((a, b) => b[1] - a[1])
    for (const [line, count] of lineEntries) {
      console.log(`  line ${line}: ${count}`)
    }

    process.exit(0)
  }, RUN_SECONDS * 1000)
}

run()
