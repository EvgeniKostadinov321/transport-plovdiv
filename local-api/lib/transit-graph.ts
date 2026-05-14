/**
 * Transit graph за routing.
 *
 * Строим adjacency list от:
 *   - Live trip data от livetransport (ordered stops + scheduled times per line)
 *   - Walk edges между близки спирки (≤ TRANSFER_RADIUS_M метра)
 *
 * Граф-а се build-ва при startup (след първи snapshot от livetransport),
 * после се refresh-ва на REFRESH_INTERVAL_MS.
 *
 * Nodes: stop IDs (използваме livetransport's internal stopId — string, e.g. "9534")
 * Edges:
 *   - "ride": (stopA → stopB) по линия L. Тегло = travel minutes.
 *   - "walk": (stopA → stopB) ако са в радиус TRANSFER_RADIUS_M.
 */

import { liveTransport, type Vehicle } from './livetransport-client.ts'
import { decodePolyline } from './polyline.ts'

/** Walk threshold за transfer edges. 300m ≈ 4 минути ходене. */
const TRANSFER_RADIUS_M = 300
/** Walking speed за изчисление на walk time. */
const WALK_SPEED_MPS = 1.2
/** Refresh на graph-а — schedules се променят. */
const REFRESH_INTERVAL_MS = 30 * 60_000
/** Default ride минути ако scheduled times липсват (никога shouldn't happen). */
const DEFAULT_RIDE_MIN = 2

const TRIP_BASE = 'https://api.livetransport.eu/plovdiv/vehicle'

export interface RideEdge {
  type: 'ride'
  toStopId: string
  line: string
  /** Travel minutes (scheduled). */
  minutes: number
}

export interface WalkEdge {
  type: 'walk'
  toStopId: string
  meters: number
  minutes: number
}

export type Edge = RideEdge | WalkEdge

export interface StopNode {
  id: string
  code: string
  name: string
  lat: number
  lng: number
}

interface LineTripInfo {
  line: string
  destination: string
  /** Ordered stopIds в посоката. */
  stopIds: string[]
  /** Travel минути between consecutive stops. */
  segmentMinutes: number[]
  /** Encoded shape за визуализация на маршрут. */
  shape: string
}

class TransitGraph {
  private stops = new Map<string, StopNode>()
  private adjacency = new Map<string, Edge[]>()
  /** За всяка линия → all directions (trips). За UI отгоре, когато показваме маршрут. */
  private lineTrips = new Map<string, LineTripInfo[]>()
  private ready = false
  private buildingPromise: Promise<void> | null = null
  private refreshTimer: NodeJS.Timeout | null = null
  private lastBuildAt = 0

  isReady(): boolean {
    return this.ready
  }

  getStats() {
    let edgeCount = 0
    for (const edges of this.adjacency.values()) edgeCount += edges.length
    return {
      ready: this.ready,
      stopCount: this.stops.size,
      edgeCount,
      lineTripsCount: this.lineTrips.size,
      lastBuildAt: this.lastBuildAt,
      lastBuildAgoMs: this.lastBuildAt ? Date.now() - this.lastBuildAt : null,
    }
  }

  getStop(id: string): StopNode | null {
    return this.stops.get(id) ?? null
  }

  getAllStops(): StopNode[] {
    return [...this.stops.values()]
  }

  getEdges(stopId: string): Edge[] {
    return this.adjacency.get(stopId) ?? []
  }

  getLineTrips(line: string): LineTripInfo[] {
    return this.lineTrips.get(line) ?? []
  }

  /**
   * Starts background build + periodic refresh. Safe to call once at server
   * startup. Build-а изисква liveTransport да има bootstrap-а (stops map +
   * sample vehicles), затова retry-ва ако още не е готов.
   */
  async start() {
    await this.buildWhenReady()
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) =>
        console.error('[transit-graph] refresh failed:', err)
      )
    }, REFRESH_INTERVAL_MS)
  }

  stop() {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
  }

  /** Иначе ако liveTransport още не е bootstrap-нал — retry-ваме с backoff. */
  private async buildWhenReady() {
    for (let attempt = 0; attempt < 30; attempt++) {
      const stats = liveTransport.getStats()
      if (stats.linesMapped > 0 && stats.vehicleCount > 0) {
        return this.refresh()
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    console.error('[transit-graph] liveTransport not ready after 60s, giving up initial build')
  }

  private async refresh() {
    if (this.buildingPromise) return this.buildingPromise
    this.buildingPromise = this.doBuild().finally(() => {
      this.buildingPromise = null
    })
    return this.buildingPromise
  }

  private async doBuild() {
    const t0 = Date.now()
    console.log('[transit-graph] building…')

    // 1. Populate stops map от liveTransport's bootstrap
    this.stops.clear()
    const stopIds = liveTransport.getAllStopIds()
    for (const id of stopIds) {
      const meta = liveTransport.getStopMeta(id)
      const geo = liveTransport.getStopGeo(id)
      if (!meta || !geo) continue
      this.stops.set(id, {
        id,
        code: meta.code,
        name: meta.name,
        lat: geo[0],
        lng: geo[1],
      })
    }

    // 2. Намираме sample vehicles per (line, destination) → fetch trips
    const vehicles = liveTransport.getSnapshot().filter((v) => v.line !== null)
    const sampleKey = (v: Vehicle) => `${v.line}|${v.destination ?? '_'}`
    const samples = new Map<string, Vehicle>()
    for (const v of vehicles) {
      const k = sampleKey(v)
      if (!samples.has(k)) samples.set(k, v)
    }

    const lineTripsMap = new Map<string, LineTripInfo[]>()
    const adjacency = new Map<string, Edge[]>()

    const fetchPromises = [...samples.values()].map(async (v) => {
      try {
        const trip = await fetchVehicleTripRaw(v.id)
        if (!trip || !v.line) return
        const list = lineTripsMap.get(v.line) ?? []
        // De-dup by tripId — same trip ID = same shape
        if (list.some((t) => t.stopIds.join() === trip.stopIds.join())) return
        list.push({
          line: v.line,
          destination: trip.destination ?? v.destination ?? '',
          stopIds: trip.stopIds,
          segmentMinutes: trip.segmentMinutes,
          shape: trip.shape,
        })
        lineTripsMap.set(v.line, list)
      } catch (err) {
        // skip — graph остава incomplete за тази линия
      }
    })
    await Promise.all(fetchPromises)

    // 3. Build ride edges от trips
    for (const trips of lineTripsMap.values()) {
      for (const t of trips) {
        for (let i = 0; i < t.stopIds.length - 1; i++) {
          const from = t.stopIds[i]
          const to = t.stopIds[i + 1]
          const min = t.segmentMinutes[i] || DEFAULT_RIDE_MIN
          const list = adjacency.get(from) ?? []
          list.push({ type: 'ride', toStopId: to, line: t.line, minutes: min })
          adjacency.set(from, list)
        }
      }
    }

    // 4. Build walk edges (transfers) — spatial scan
    this.buildWalkEdges(adjacency)

    this.adjacency = adjacency
    this.lineTrips = lineTripsMap
    this.ready = true
    this.lastBuildAt = Date.now()
    let edgeCount = 0
    for (const edges of adjacency.values()) edgeCount += edges.length
    console.log(
      `[transit-graph] built in ${Date.now() - t0}ms: ${this.stops.size} stops, ${edgeCount} edges, ${lineTripsMap.size} lines`
    )
  }

  /**
   * За всяка двойка спирки в TRANSFER_RADIUS_M добавя walk edges двупосочно.
   * O(n²) ще е 485² = 235k операции — приемливо при startup. Spatial grid може
   * да оптимизира до O(n log n) ако стане проблем.
   */
  private buildWalkEdges(adjacency: Map<string, Edge[]>) {
    const stops = [...this.stops.values()]
    const RADIUS_DEG = TRANSFER_RADIUS_M / 111_000 // approx, latitude-corrected по-долу
    const RADIUS_DEG_SQ = RADIUS_DEG * RADIUS_DEG
    for (let i = 0; i < stops.length; i++) {
      const a = stops[i]
      const cosLat = Math.cos((a.lat * Math.PI) / 180)
      for (let j = i + 1; j < stops.length; j++) {
        const b = stops[j]
        const dLat = a.lat - b.lat
        const dLng = (a.lng - b.lng) * cosLat
        const distSq = dLat * dLat + dLng * dLng
        if (distSq > RADIUS_DEG_SQ) continue
        const meters = haversineMeters(a.lat, a.lng, b.lat, b.lng)
        if (meters > TRANSFER_RADIUS_M) continue
        const minutes = meters / WALK_SPEED_MPS / 60
        const listA = adjacency.get(a.id) ?? []
        const listB = adjacency.get(b.id) ?? []
        listA.push({ type: 'walk', toStopId: b.id, meters, minutes })
        listB.push({ type: 'walk', toStopId: a.id, meters, minutes })
        adjacency.set(a.id, listA)
        adjacency.set(b.id, listB)
      }
    }
  }
}

export const transitGraph = new TransitGraph()

// ---- Helpers ----

interface RawTripResult {
  shape: string
  destination: string | null
  stopIds: string[]
  segmentMinutes: number[]
}

async function fetchVehicleTripRaw(vehicleId: string): Promise<RawTripResult | null> {
  const url = `${TRIP_BASE}/${encodeURIComponent(vehicleId)}/trip`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const data = (await res.json()) as {
    trip?: {
      shape: string
      destination?: { bg?: string; en?: string } | string
      stops?: { id: string; scheduled: number }[]
    }
  }
  if (!data.trip?.shape) return null
  const stops = data.trip.stops ?? []
  if (stops.length < 2) return null
  const stopIds = stops.map((s) => s.id)
  const segmentMinutes: number[] = []
  for (let i = 0; i < stops.length - 1; i++) {
    const diff = (stops[i + 1].scheduled - stops[i].scheduled) / 60_000
    segmentMinutes.push(diff > 0 && diff < 60 ? diff : DEFAULT_RIDE_MIN)
  }
  const destRaw = data.trip.destination
  const destination =
    typeof destRaw === 'object' && destRaw?.bg
      ? destRaw.bg
      : typeof destRaw === 'string'
        ? destRaw
        : null
  return { shape: data.trip.shape, destination, stopIds, segmentMinutes }
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// suppress unused warning for the decodePolyline import (planned future use)
void decodePolyline
