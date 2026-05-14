import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchETA, fetchRouteStops } from '../api'
import { interpolateBuses } from '../busPosition'
import type {
  BusPosition,
  ETAEntry,
  RouteStopsData,
  Stop,
} from '../types'

/** Колко често да polling-ваме ETA-тата. */
const POLLING_INTERVAL_MS = 30_000
/** Concurrent fetches limit - да не slam-ваме backend-а. */
const CONCURRENCY = 3

/**
 * За избраните линии:
 * - Зарежда route ordering (once cached)
 * - Намира всички уникални спирки в избраните routes
 * - Polling-ва ETA за всяка спирка
 * - Изчислява bus positions
 *
 * Polling-ът върви само ако има избрани линии и stops са loaded.
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
  const stopsToPoll = useMemo(() => {
    if (!routeStops) return [] as number[]
    const set = new Set<number>()
    for (const line of selectedLines) {
      const lineData = routeStops.lines[line]
      if (!lineData) continue
      for (const route of lineData.routes) {
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

    async function pollOnce() {
      setLoading(true)
      const etasByStop = new Map<number, ETAEntry[]>()

      // Concurrent fetch с rate limit
      const queue = [...stopsToPoll]
      const workers = Array(Math.min(CONCURRENCY, queue.length))
        .fill(0)
        .map(async () => {
          while (queue.length > 0 && !cancelled) {
            const stopNum = queue.shift()!
            try {
              const r = await fetchETA(stopNum)
              if (!cancelled) etasByStop.set(stopNum, r.etas)
            } catch {
              // skip - ETA fetch може да fail-не occasionally
            }
          }
        })
      await Promise.all(workers)
      if (cancelled) return

      // Calculate positions
      const allPositions: BusPosition[] = []
      for (const line of selectedLines) {
        const lineData = routeStops!.lines[line]
        if (!lineData) continue
        // Само 2-те основни посоки - игнорираме alt routes
        // (route label не започва с "След")
        const mainRoutes = lineData.routes.filter(
          (r) => !/^След/i.test(r.label)
        ).slice(0, 2)
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

      if (!cancelled) {
        setPositions(allPositions)
        setLoading(false)
      }
    }

    pollOnce()
    pollingRef.current = window.setInterval(pollOnce, POLLING_INTERVAL_MS)

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
