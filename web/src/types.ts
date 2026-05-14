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

/** Single направление (посока) на линия. */
export interface RouteDirection {
  label: string
  stops: { number: number; name: string }[]
}

/** Една линия с всички нейни посоки. */
export interface LineRoutes {
  label: string
  routes: RouteDirection[]
}

/** Цялото съдържание на /api/route-stops. */
export interface RouteStopsData {
  extractedAt: string
  lineCount: number
  totalRoutes: number
  totalStopEntries: number
  failures: string[]
  lines: Record<string, LineRoutes>
}

/** Резултат от position interpolation - bus на картата. */
export interface BusPosition {
  line: string
  direction: string
  lat: number
  lng: number
  /** Минути до следваща спирка */
  minutesToNext: number
  /** Към коя спирка пътува */
  toStopNumber: number
  toStopName: string
  /** Откъде идва */
  fromStopNumber: number
  fromStopName: string
  /** Прогрес от 0 (току що мина from) до 1 (стига to) */
  progress: number
}
