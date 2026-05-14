import { useCallback, useEffect, useState } from 'react'
import { loadFavorites, saveFavorites } from '../storage'
import type { Favorite } from '../types'

export function useFavorites(): {
  favorites: Favorite[]
  isFavorite: (stopNumber: number) => boolean
  toggleFavorite: (stopNumber: number, label?: string) => void
  removeFavorite: (stopNumber: number) => void
  setLabel: (stopNumber: number, label: string) => void
} {
  const [favorites, setFavorites] = useState<Favorite[]>(loadFavorites)

  useEffect(() => {
    saveFavorites(favorites)
  }, [favorites])

  const isFavorite = useCallback(
    (stopNumber: number) => favorites.some((f) => f.stopNumber === stopNumber),
    [favorites]
  )

  const toggleFavorite = useCallback(
    (stopNumber: number, label?: string) => {
      setFavorites((prev) => {
        const idx = prev.findIndex((f) => f.stopNumber === stopNumber)
        if (idx >= 0) return prev.filter((f) => f.stopNumber !== stopNumber)
        return [...prev, { stopNumber, label, pinnedAt: Date.now() }]
      })
    },
    []
  )

  const removeFavorite = useCallback((stopNumber: number) => {
    setFavorites((prev) => prev.filter((f) => f.stopNumber !== stopNumber))
  }, [])

  const setLabel = useCallback((stopNumber: number, label: string) => {
    setFavorites((prev) =>
      prev.map((f) =>
        f.stopNumber === stopNumber ? { ...f, label: label.trim() || undefined } : f
      )
    )
  }, [])

  return { favorites, isFavorite, toggleFavorite, removeFavorite, setLabel }
}
