import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchETA, fetchRouteStops, getCachedETA } from '../api'
import { interpolateBuses } from '../busPosition'
import { BUS_POLLING_INTERVAL_MS } from '../config'
import type {
  BusPosition,
  ETAEntry,
  RouteStopsData,
  Stop,
} from '../types'

/** Concurrent fetches limit - да не slam-ваме backend-а. */
const CONCURRENCY = 4

/**
 * За избраните линии:
 * - Зарежда route ordering (once cached)
 * - Намира всички уникални спирки в избраните routes
 * - Polling-ва ETA за всяка спирка (с client-side cache - skip fresh entries)
 * - Изчислява bus positions
 */
export function useBusPositions(
  selectedLines: string[],
  stops: Stop[]
): {
  positions: BusPosition[]
  loading: boolean
  routeStopsLoaded: boolean
} {
  const [routeStops, setRouteStops] = useState<RouteStopsData | null>(null)
  const [positions, setPositions] = useState<BusPosition[]>([])
  const [loading, setLoading] = useState(false)
  const stopsByNumber = useMemo(() => {
    const m = new Map<number, Stop>()
    for (const s of stops) m.set(s.number, s)
    return m
  }, [stops])

  // Lazy-load route-stops веднъж
  useEffect(() => {
    if (routeStops) return
    if (selectedLines.length === 0) return
    fetchRouteStops()
      .then(setRouteStops)
      .catch(() => {})
  }, [selectedLines.length, routeStops])

  // Намираме спирки за polling - union на всички спирки от избраните routes
  // (само main routes - без "След HH:MM" варианти)
  const stopsToPoll = useMemo(() => {
    if (!routeStops) return [] as number[]
    const set = new Set<number>()
    for (const line of selectedLines) {
      const lineData = routeStops.lines[line]
      if (!lineData) continue
      const mainRoutes = lineData.routes
        .filter((r) => !/^След/i.test(r.label))
        .slice(0, 2)
      for (const route of mainRoutes) {
        for (const s of route.stops) set.add(s.number)
      }
    }
    return [...set]
  }, [selectedLines, routeStops])

  const pollingRef = useRef<number | null>(null)

  useEffect(() => {
    if (stopsToPoll.length === 0 || !routeStops) {
      setPositions([])
      return
    }

    let cancelled = false

    /** Computes positions from whatever ETAs are currently in client cache. */
    function recomputeFromCache() {
      const etasByStop = new Map<number, ETAEntry[]>()
      for (const stopNum of stopsToPoll) {
        const cached = getCachedETA(stopNum)
        if (cached) etasByStop.set(stopNum, cached.etas)
      }
      const allPositions: BusPosition[] = []
      for (const line of selectedLines) {
        const lineData = routeStops!.lines[line]
        if (!lineData) continue
        const mainRoutes = lineData.routes
          .filter((r) => !/^След/i.test(r.label))
          .slice(0, 2)
        for (const route of mainRoutes) {
          const buses = interpolateBuses(
            line,
            route,
            stopsByNumber,
            etasByStop
          )
          allPositions.push(...buses)
        }
      }
      if (!cancelled) setPositions(allPositions)
    }

    /** Fetch-ва само стопове без свеж client cache. */
    async function pollOnce() {
      // fetchETA сам skip-ва ако има свеж cache → 0 заявки във втори cycle
      setLoading(true)

      const queue = [...stopsToPoll]
      const workers = Array(Math.min(CONCURRENCY, queue.length))
        .fill(0)
        .map(async () => {
          while (queue.length > 0 && !cancelled) {
            const stopNum = queue.shift()!
            try {
              await fetchETA(stopNum)
            } catch {
              // skip - ETA fetch може да fail-не occasionally
            }
          }
        })
      await Promise.all(workers)
      if (cancelled) return

      recomputeFromCache()
      setLoading(false)
    }

    pollOnce()
    pollingRef.current = window.setInterval(pollOnce, BUS_POLLING_INTERVAL_MS)

    return () => {
      cancelled = true
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [stopsToPoll, selectedLines, routeStops, stopsByNumber])

  return { positions, loading, routeStopsLoaded: !!routeStops }
}
