export interface Stop {
  number: number
  name: string
  lat: number
  lng: number
  lines: string[]
}

export interface ETAEntry {
  line: string
  minutes: number
  arrivalTime: string
  destination: string
}

export interface ETAResponse {
  stop: number
  etas: ETAEntry[]
  fetchedAt: string
  cached?: boolean
  ageSeconds?: number
}

export type Theme = 'light' | 'dark'

export interface Favorite {
  stopNumber: number
  label?: string
  pinnedAt: number
}

export interface GeoPosition {
  lat: number
  lng: number
  accuracy: number
  timestamp: number
}

/** Per-stop info вътре в VehicleTrip. */
export interface VehicleTripStop {
  index: number
  stopId: string
  /** Public stop code (напр. "1001"). null ако не е резолвен. */
  code: string | null
  name: string | null
  /** Scheduled timestamp (ms). null ако липсва. */
  scheduled: number | null
}

/** Pop-up data за конкретен автобус: trip status + всички спирки. */
export interface VehicleTrip {
  vehicleId: string
  tripId: string
  line: string
  destination: string | null
  nextStopIndex: number
  delayMs: number
  stops: VehicleTripStop[]
}

/** Live trip от livetransport — decoded polyline + destination. */
export interface LiveTrip {
  id: string
  line: string
  destination: string | null
  coords: [number, number][]
  stopIds: string[]
}

/** Реален GPS vehicle от backend live feed. */
export interface LiveVehicle {
  id: string
  line: string | null
  destination: string | null
  lat: number
  lng: number
  bearing: number
  speed: number
  delayMs: number
  lastUpdated: number
}

