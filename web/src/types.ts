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
