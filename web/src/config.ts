import type { Theme } from './types'

export const API_URL = import.meta.env.VITE_API_URL ?? ''
export const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY ?? ''

export const PLOVDIV_CENTER: [number, number] = [42.1354, 24.7453]
export const DEFAULT_ZOOM = 13

export const CLIENT_CACHE_TTL_MS = 25_000
export const REFRESH_INTERVAL_MS = 30_000
/** Polling за bus positions - по-бавно от refresh защото е burst (60+ заявки). */
export const BUS_POLLING_INTERVAL_MS = 45_000

export function tileUrlForTheme(theme: Theme): string {
  const style = theme === 'dark' ? 'streets-v2-dark' : 'streets-v2'
  return MAPTILER_KEY
    ? `https://api.maptiler.com/maps/${style}/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
}
