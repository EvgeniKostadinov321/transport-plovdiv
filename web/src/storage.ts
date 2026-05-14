import type { Theme } from './types'

const LINES_KEY = 'transport-plovdiv.selectedLines'
const THEME_KEY = 'transport-plovdiv.theme'

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
