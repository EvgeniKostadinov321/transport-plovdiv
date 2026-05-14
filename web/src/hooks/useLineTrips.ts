import { useEffect, useState } from 'react'
import { fetchLineTrips } from '../api'
import type { LiveTrip } from '../types'

/**
 * За всяка избрана линия зарежда LIVE trips (полилинии от livetransport.eu).
 * Резултатът се кеш-ва per-line в hook state-а — не re-fetch при unrelated rerender.
 *
 * Връща { line → trips[] }. Празен array значи "не са fetched още или линията
 * няма активни автобуси". Map.tsx fallback-ва на OSM geometry за такива линии.
 */
export function useLineTrips(selectedLines: string[]): Map<string, LiveTrip[]> {
  const [tripsByLine, setTripsByLine] = useState<Map<string, LiveTrip[]>>(
    () => new Map()
  )

  useEffect(() => {
    let cancelled = false
    const missing = selectedLines.filter((l) => !tripsByLine.has(l))
    if (missing.length === 0) return

    for (const line of missing) {
      fetchLineTrips(line)
        .then((trips) => {
          if (cancelled) return
          setTripsByLine((prev) => {
            if (prev.has(line)) return prev
            const next = new Map(prev)
            next.set(line, trips)
            return next
          })
        })
        .catch(() => {
          // оставяме linе-а unset → ще се fallback-не на OSM
        })
    }
    return () => {
      cancelled = true
    }
  }, [selectedLines, tripsByLine])

  return tripsByLine
}
