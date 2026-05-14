import { useEffect, useState } from 'react'
import { loadTheme, saveTheme } from '../storage'
import type { Theme } from '../types'

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(loadTheme)

  useEffect(() => {
    saveTheme(theme)
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return [theme, toggle]
}
