import type { Favorite, Theme } from './types'

const LINES_KEY = 'transport-plovdiv.selectedLines'
const THEME_KEY = 'transport-plovdiv.theme'
const FAVORITES_KEY = 'transport-plovdiv.favorites'
const GEO_INTRO_SHOWN_KEY = 'transport-plovdiv.geoIntroShown'

export function loadSelectedLines(): string[] {
  try {
    const raw = localStorage.getItem(LINES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveSelectedLines(lines: string[]): void {
  localStorage.setItem(LINES_KEY, JSON.stringify(lines))
}

export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === 'dark' || raw === 'light') return raw
  } catch {}
  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark'
  }
  return 'light'
}

export function saveTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme)
}

export function loadFavorites(): Favorite[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is Favorite =>
        x != null &&
        typeof x === 'object' &&
        typeof x.stopNumber === 'number' &&
        typeof x.pinnedAt === 'number'
    )
  } catch {
    return []
  }
}

export function saveFavorites(favorites: Favorite[]): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
}

export function hasShownGeoIntro(): boolean {
  try {
    return localStorage.getItem(GEO_INTRO_SHOWN_KEY) === '1'
  } catch {
    return false
  }
}

export function markGeoIntroShown(): void {
  try {
    localStorage.setItem(GEO_INTRO_SHOWN_KEY, '1')
  } catch {}
}
