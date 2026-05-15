import { API_URL, CLIENT_CACHE_TTL_MS } from './config'
import type {
  ETAResponse,
  GeocodeResult,
  LiveTrip,
  RoutePlanResult,
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

export async function planRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<RoutePlanResult> {
  const res = await fetch(`${API_URL}/api/route/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromLat: from.lat,
      fromLng: from.lng,
      toLat: to.lat,
      toLng: to.lng,
    }),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as RoutePlanResult
}

/**
 * Geocoding чрез HERE Geo­coding & Search API (autosuggest endpoint).
 * Покритие на residential адреси в България е значително по-добро от
 * MapTiler / Nominatim — HERE има пълни housenumber данни.
 *
 * Изисква `VITE_HERE_API_KEY` env var.
 *
 * Docs: https://www.here.com/docs/bundle/geocoding-and-search-api-developer-guide/
 */
export async function geocode(query: string): Promise<GeocodeResult[]> {
  if (!query.trim()) return []
  const key = import.meta.env.VITE_HERE_API_KEY
  if (!key) {
    console.warn('VITE_HERE_API_KEY not set — geocoding disabled')
    return []
  }
  const url = new URL('https://autosuggest.search.hereapi.com/v1/autosuggest')
  url.searchParams.set('q', query)
  url.searchParams.set('apiKey', key)
  // Bias към Plovdiv: at=<lat>,<lng> + малък in=country код
  url.searchParams.set('at', '42.1354,24.7453')
  url.searchParams.set('in', 'countryCode:BGR')
  url.searchParams.set('lang', 'bg-BG')
  url.searchParams.set('limit', '6')
  const res = await fetch(url.toString())
  if (!res.ok) return []
  const data = (await res.json()) as {
    items?: Array<{
      title?: string
      address?: { label?: string }
      position?: { lat: number; lng: number }
      resultType?: string
    }>
  }
  return (data.items ?? [])
    .filter((it) => it.position && Number.isFinite(it.position.lat))
    .map((it) => ({
      label: it.address?.label ?? it.title ?? '',
      lat: it.position!.lat,
      lng: it.position!.lng,
    }))
    .filter((g) => g.label.length > 0)
}

export interface LiveEtaEntry {
  vehicleId: string
  arrivalMs: number
  delayMs: number
}

/**
 * Live ETA-та за (line, stop) базирани на real-time GPS positions от
 * livetransport. По-точни от ZK защото отразяват delay-а на конкретния
 * автобус. Връща сортиран list (next bus първи).
 */
export async function fetchLiveEta(
  line: string,
  stop: string
): Promise<LiveEtaEntry[]> {
  const res = await fetch(
    `${API_URL}/api/eta-live?line=${encodeURIComponent(line)}&stop=${encodeURIComponent(stop)}`
  )
  if (!res.ok) return []
  const data = (await res.json()) as { entries?: LiveEtaEntry[] }
  return data.entries ?? []
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
