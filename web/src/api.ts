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
 * Geocoding чрез Nominatim (OSM). MapTiler има слабо residential покритие
 * в Пловдив — Nominatim има пълните OSM данни.
 * Filter-ва resultats със viewbox около Plovdiv (bounded=1) за да изключи
 * far-away matches.
 */
export async function geocode(query: string): Promise<GeocodeResult[]> {
  if (!query.trim()) return []
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', '6')
  url.searchParams.set('accept-language', 'bg')
  // Plovdiv bounding box (south,north,west,east) — focused, но не bounded
  // (за да позволим търсене на близки села)
  url.searchParams.set('viewbox', '24.6,42.20,24.85,42.06')
  url.searchParams.set('bounded', '0')
  url.searchParams.set('countrycodes', 'bg')
  const res = await fetch(url.toString(), {
    headers: {
      // Nominatim usage policy изисква identifying User-Agent
      Accept: 'application/json',
    },
  })
  if (!res.ok) return []
  const data = (await res.json()) as Array<{
    display_name?: string
    name?: string
    lat: string
    lon: string
    address?: Record<string, string>
  }>
  return data
    .map((f) => {
      const lat = parseFloat(f.lat)
      const lng = parseFloat(f.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      // Compose readable label: name + city / street + number + city
      const addr = f.address ?? {}
      const parts: string[] = []
      if (f.name) parts.push(f.name)
      else if (addr.road) {
        parts.push(addr.road + (addr.house_number ? ` ${addr.house_number}` : ''))
      }
      const place = addr.city ?? addr.town ?? addr.village ?? addr.suburb
      if (place && !parts.join(' ').includes(place)) parts.push(place)
      const label = parts.join(', ') || f.display_name || ''
      return { label, lat, lng }
    })
    .filter((x): x is GeocodeResult => x !== null && x.label.length > 0)
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
