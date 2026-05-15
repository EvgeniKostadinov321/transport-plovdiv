/**
 * Proxy + cache за livetransport trip data (encoded polyline + stops + destination).
 *
 * Стратегия:
 *   - Cache key = trip ID (напр. "27_9534_9612_20260514_1058"). Trip ID-тата
 *     се повтарят между автобуси и потребители → LRU кеш ги retain-ва.
 *   - За даден line number: намираме активен автобус (от liveTransport snapshot),
 *     fetch-ваме неговия trip от livetransport, групираме по `destination` за
 *     да покрием двете посоки (и алтернативни варианти).
 *   - Per-line cache на групираните trips (TTL 5 min — destinations могат
 *     да се променят през деня при пик/нощен режим).
 */

import { decodePolyline } from './polyline.ts'
import { liveTransport } from './livetransport-client.ts'

const TRIP_BASE = 'https://api.livetransport.eu/plovdiv/vehicle'
const PER_LINE_TTL_MS = 5 * 60_000
const TRIP_CACHE_MAX = 500

export interface DecodedTrip {
  id: string
  /** Публично име на линия (напр. "6"). */
  line: string
  destination: string | null
  /** Decoded polyline coords [[lat,lng], ...]. */
  coords: [number, number][]
  /** Stop IDs in scheduled order. */
  stopIds: string[]
  /** Scheduled timestamps (ms) per stop, in order. */
  stopScheduled: number[]
}

/** Per-vehicle trip status — нужно за trip-popup-а. */
export interface VehicleTripStatus {
  trip: DecodedTrip
  /** Index in trip.stopIds — следваща спирка. */
  nextStop: number
  /** Закъснение в милисекунди (positive = късно). */
  delayMs: number
  /** Vehicle ID за който това е fetched. */
  vehicleId: string
}

interface RawTripResponse {
  nextStop?: number
  delay?: number
  trip?: {
    id: string
    lineId: string
    shape: string
    destination?: { bg?: string; en?: string } | string
    stops?: { id: string; scheduled: number }[]
  }
}

interface VehicleTripCacheEntry {
  status: VehicleTripStatus
  fetchedAt: number
}
const vehicleTripCache = new Map<string, VehicleTripCacheEntry>()
const vehicleInflight = new Map<string, Promise<VehicleTripStatus | null>>()
/** Per-vehicle trip cache — kratko TTL защото nextStop+delay се сменят. */
const VEHICLE_TTL_MS = 30_000

// LRU-ish: Map preserves insertion order, на overflow махаме first key
const tripCache = new Map<string, DecodedTrip>()

interface PerLineEntry {
  trips: DecodedTrip[]
  fetchedAt: number
}
const perLineCache = new Map<string, PerLineEntry>()
const inflight = new Map<string, Promise<DecodedTrip[]>>()

function cacheGet(id: string): DecodedTrip | undefined {
  const t = tripCache.get(id)
  if (t) {
    // refresh recency (re-insert)
    tripCache.delete(id)
    tripCache.set(id, t)
  }
  return t
}

function cachePut(t: DecodedTrip) {
  tripCache.set(t.id, t)
  if (tripCache.size > TRIP_CACHE_MAX) {
    const first = tripCache.keys().next().value
    if (first) tripCache.delete(first)
  }
}

async function fetchVehicleTrip(vehicleId: string): Promise<DecodedTrip | null> {
  const url = `${TRIP_BASE}/${encodeURIComponent(vehicleId)}/trip`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const data = (await res.json()) as RawTripResponse
  if (!data.trip?.shape || !data.trip.id) return null

  const cached = cacheGet(data.trip.id)
  if (cached) return cached

  const coords = decodePolyline(data.trip.shape)
  const destRaw = data.trip.destination
  const destination =
    typeof destRaw === 'object' && destRaw?.bg
      ? destRaw.bg
      : typeof destRaw === 'string'
        ? destRaw
        : null
  const lineName = liveTransport.getLineName(data.trip.lineId) ?? data.trip.lineId

  const stopsData = data.trip.stops ?? []
  const decoded: DecodedTrip = {
    id: data.trip.id,
    line: lineName,
    destination,
    coords,
    stopIds: stopsData.map((s) => s.id),
    stopScheduled: stopsData.map((s) => s.scheduled),
  }
  cachePut(decoded)
  return decoded
}

/**
 * Live ETA-та за (line, stopId). Намира всички active vehicles на тази линия
 * чиято trip ще премине през stopId на/след nextStop. Връща сортиран list
 * от arrival timestamps + vehicleId-та.
 *
 * За точно ETA ползваме `trip.stopScheduled[i] + trip.delayMs` (т.е. live
 * delay от vehicle, не raw schedule).
 */
export interface LiveETAEntry {
  vehicleId: string
  arrivalMs: number
  delayMs: number
}

export async function getLiveETA(
  line: string,
  stopId: string
): Promise<LiveETAEntry[]> {
  const vehicles = liveTransport.getSnapshot().filter((v) => v.line === line)
  const results: LiveETAEntry[] = []
  const promises = vehicles.map(async (v) => {
    try {
      const status = await getVehicleTripStatus(v.id)
      if (!status) return
      const idx = status.trip.stopIds.indexOf(stopId)
      if (idx < 0) return // тази vehicle не минава през stop
      if (idx < status.nextStop) return // вече е минала
      const scheduled = status.trip.stopScheduled[idx]
      if (!scheduled) return
      const arrival = scheduled + status.delayMs
      results.push({
        vehicleId: status.vehicleId,
        arrivalMs: arrival,
        delayMs: status.delayMs,
      })
    } catch {
      // skip vehicles whose trip endpoint fails
    }
  })
  await Promise.all(promises)
  results.sort((a, b) => a.arrivalMs - b.arrivalMs)
  return results
}

/**
 * Per-vehicle trip status. Връща trip metadata + текущия nextStop + delay.
 * Кеш-ва се за 30s — достатъчно бързо за UI, не натоварва livetransport.
 */
export async function getVehicleTripStatus(
  vehicleId: string
): Promise<VehicleTripStatus | null> {
  const now = Date.now()
  const cached = vehicleTripCache.get(vehicleId)
  if (cached && now - cached.fetchedAt < VEHICLE_TTL_MS) {
    return cached.status
  }
  const existing = vehicleInflight.get(vehicleId)
  if (existing) return existing

  const promise = (async () => {
    const url = `${TRIP_BASE}/${encodeURIComponent(vehicleId)}/trip`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data = (await res.json()) as RawTripResponse
    if (!data.trip?.shape || !data.trip.id) return null

    let trip = cacheGet(data.trip.id)
    if (!trip) {
      const coords = decodePolyline(data.trip.shape)
      const destRaw = data.trip.destination
      const destination =
        typeof destRaw === 'object' && destRaw?.bg
          ? destRaw.bg
          : typeof destRaw === 'string'
            ? destRaw
            : null
      const lineName = liveTransport.getLineName(data.trip.lineId) ?? data.trip.lineId
      const stopsData = data.trip.stops ?? []
      trip = {
        id: data.trip.id,
        line: lineName,
        destination,
        coords,
        stopIds: stopsData.map((s) => s.id),
        stopScheduled: stopsData.map((s) => s.scheduled),
      }
      cachePut(trip)
    }

    const status: VehicleTripStatus = {
      trip,
      nextStop: data.nextStop ?? 0,
      delayMs: data.delay ?? 0,
      vehicleId,
    }
    vehicleTripCache.set(vehicleId, { status, fetchedAt: Date.now() })
    return status
  })().finally(() => vehicleInflight.delete(vehicleId))

  vehicleInflight.set(vehicleId, promise)
  return promise
}

/**
 * Връща trips за дадена линия — по един sample trip за всеки destination,
 * което покрива двете (или повече) посоки.
 */
export async function getTripsForLine(line: string): Promise<DecodedTrip[]> {
  const now = Date.now()
  const cached = perLineCache.get(line)
  if (cached && now - cached.fetchedAt < PER_LINE_TTL_MS) {
    return cached.trips
  }

  const existing = inflight.get(line)
  if (existing) return existing

  const promise = (async () => {
    const vehicles = liveTransport
      .getSnapshot()
      .filter((v) => v.line === line)

    // Избираме до 1 sample vehicle per (line, destination) — за да покрием
    // всички уникални shapes без излишни fetches.
    const sampleByDest = new Map<string, string>() // destination → vehicleId
    for (const v of vehicles) {
      const key = v.destination ?? '__none__'
      if (!sampleByDest.has(key)) sampleByDest.set(key, v.id)
      if (sampleByDest.size >= 4) break // safety cap
    }

    if (sampleByDest.size === 0) {
      // Няма активни автобуси → нищо за връщане
      return []
    }

    const results = await Promise.allSettled(
      [...sampleByDest.values()].map((id) => fetchVehicleTrip(id))
    )
    const trips: DecodedTrip[] = []
    const seenTripIds = new Set<string>()
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && !seenTripIds.has(r.value.id)) {
        seenTripIds.add(r.value.id)
        trips.push(r.value)
      }
    }

    perLineCache.set(line, { trips, fetchedAt: Date.now() })
    return trips
  })().finally(() => inflight.delete(line))

  inflight.set(line, promise)
  return promise
}
