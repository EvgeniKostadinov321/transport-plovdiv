import { API_URL, CLIENT_CACHE_TTL_MS } from './config'
import type {
  ETAResponse,
  LiveTrip,
  Stop,
  VehicleTrip,
} from './types'

// Споделен кеш + in-flight de-dupe между всички StopPopup и hover prefetch
interface CacheEntry {
  data?: ETAResponse
  promise?: Promise<ETAResponse>
  fetchedAt: number
}
const clientCache = new Map<number, CacheEntry>()

export function fetchETA(
  stopNumber: number,
  options: { force?: boolean } = {}
): Promise<ETAResponse> {
  const now = Date.now()
  const existing = clientCache.get(stopNumber)
  if (!options.force && existing) {
    if (existing.data && now - existing.fetchedAt < CLIENT_CACHE_TTL_MS) {
      return Promise.resolve(existing.data)
    }
    if (existing.promise) return existing.promise
  }

  const url = options.force
    ? `${API_URL}/api/eta/${stopNumber}?force=1`
    : `${API_URL}/api/eta/${stopNumber}`

  const promise = fetch(url)
    .then(async (r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      return (await r.json()) as ETAResponse
    })
    .then((data) => {
      clientCache.set(stopNumber, { data, fetchedAt: Date.now() })
      return data
    })
    .catch((err) => {
      clientCache.delete(stopNumber)
      throw err
    })

  clientCache.set(stopNumber, { promise, fetchedAt: now })
  return promise
}

export function getCachedETA(stopNumber: number): ETAResponse | null {
  return clientCache.get(stopNumber)?.data ?? null
}

export async function fetchStops(): Promise<Stop[]> {
  const res = await fetch(`${API_URL}/api/stops`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const data = (await res.json()) as { stops: Stop[] }
  return data.stops
}

export async function fetchLines(): Promise<string[]> {
  const res = await fetch(`${API_URL}/api/lines`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const data = (await res.json()) as { lines: string[] }
  return data.lines
}

export async function fetchVehicleTrip(vehicleId: string): Promise<VehicleTrip> {
  const res = await fetch(
    `${API_URL}/api/vehicle/${encodeURIComponent(vehicleId)}/trip`
  )
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as VehicleTrip
}

export async function fetchLineTrips(line: string): Promise<LiveTrip[]> {
  const res = await fetch(`${API_URL}/api/line/${encodeURIComponent(line)}/trips`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const data = (await res.json()) as { line: string; trips: LiveTrip[] }
  return data.trips
}

/** Премахва излишни кавички и whitespace от ZK label-ите. */
export function cleanText(s: string): string {
  return s
    .replace(/"\s*/g, '"')
    .replace(/\s*"/g, '"')
    .replace(/""+/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}
