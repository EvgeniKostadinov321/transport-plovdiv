/**
 * Bus position interpolation.
 *
 * Подход:
 * За дадена линия + посока, всеки автобус се идентифицира с (line, destination, arrivalTime).
 * За всеки такъв уникален автобус, обхождаме route-а от край до начало и намираме
 * първата спирка където този автобус ще пристигне (най-малък ETA).
 *
 * Това е "next stop" на автобуса.
 * Той е МЕЖДУ предишна спирка (която вече е минал) и next stop.
 *
 * Прогрес:
 *   - Имаме ETA до next stop (N мин)
 *   - Очакваме average gap между спирки ≈ 1.5-2 мин (Plovdiv тypical)
 *   - Прогрес = 1 - (N / typicalGap), clamped [0, 1]
 *
 * Това дава **движение** на автобуса между спирки.
 */

import type { BusPosition, ETAEntry, RouteDirection, Stop } from './types'
import { interpolatePoint } from './geoInterp'

function normalizeDestination(s: string): string {
  return s
    .toLowerCase()
    .replace(/['"„"`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Опит за matching на destination strings - truncated string handling. */
function destinationsMatch(a: string, b: string): boolean {
  const na = normalizeDestination(a)
  const nb = normalizeDestination(b)
  if (na === nb) return true
  if (na.length >= 12 && nb.startsWith(na.slice(0, 12))) return true
  if (nb.length >= 12 && na.startsWith(nb.slice(0, 12))) return true
  return false
}

/**
 * Bus identity key - комбинация от arrivalTime + destination.
 * Различни автобуси на същата линия имат различни arrival times.
 */
function busKey(eta: ETAEntry): string {
  return `${eta.arrivalTime}|${normalizeDestination(eta.destination)}`
}

/** Typical gap между съседни спирки в минути. Approximate. */
const TYPICAL_STOP_GAP_MIN = 1.7

export function interpolateBuses(
  line: string,
  route: RouteDirection,
  stopsByNumber: Map<number, Stop>,
  etasByStop: Map<number, ETAEntry[]>
): BusPosition[] {
  const routeDestKey = route.stops[route.stops.length - 1]?.name ?? ''

  // Step 1: За всяка спирка, събираме ETA-та матчващи тази линия + посока
  const stopEtas = new Map<number, ETAEntry[]>()
  for (const stop of route.stops) {
    const all = etasByStop.get(stop.number) ?? []
    const filtered = all.filter(
      (e) => e.line === line && destinationsMatch(e.destination, routeDestKey)
    )
    stopEtas.set(stop.number, filtered)
  }

  // Step 2: Обединяваме всички ETA-та per bus (line + destination + arrivalTime),
  // и за всеки автобус ето къде се намира в момента
  // bus key → (route stop index, ETA min)
  interface BusObs {
    stopIndex: number
    stopNumber: number
    minutes: number
    arrivalTime: string
    destination: string
  }
  const busObservations = new Map<string, BusObs[]>()

  for (let i = 0; i < route.stops.length; i++) {
    const stopMeta = route.stops[i]
    const etas = stopEtas.get(stopMeta.number) ?? []
    for (const eta of etas) {
      const key = busKey(eta)
      const list = busObservations.get(key) ?? []
      list.push({
        stopIndex: i,
        stopNumber: stopMeta.number,
        minutes: eta.minutes,
        arrivalTime: eta.arrivalTime,
        destination: eta.destination,
      })
      busObservations.set(key, list)
    }
  }

  const positions: BusPosition[] = []

  for (const [, obs] of busObservations) {
    if (obs.length === 0) continue
    // Sort observations by stopIndex along the route
    obs.sort((a, b) => a.stopIndex - b.stopIndex)

    // Намираме next stop = първата observation с най-малък minutes
    // (или най-ранната по route-а с positive ETA)
    const minMin = Math.min(...obs.map((o) => o.minutes))
    const nextStopObs = obs.find((o) => o.minutes === minMin)
    if (!nextStopObs) continue

    const nextIdx = nextStopObs.stopIndex
    if (nextIdx === 0) {
      // Bus още не е достигнал първата спирка - показваме го на нея
      const stop = stopsByNumber.get(route.stops[0].number)
      if (!stop) continue
      positions.push({
        line,
        direction: route.label,
        lat: stop.lat,
        lng: stop.lng,
        minutesToNext: nextStopObs.minutes,
        toStopNumber: route.stops[0].number,
        toStopName: route.stops[0].name,
        fromStopNumber: route.stops[0].number,
        fromStopName: route.stops[0].name,
        progress: 0,
      })
      continue
    }

    // Предишна спирка - тази която бусът току-що мина
    const prevIdx = nextIdx - 1
    const fromMeta = route.stops[prevIdx]
    const toMeta = route.stops[nextIdx]
    const fromStop = stopsByNumber.get(fromMeta.number)
    const toStop = stopsByNumber.get(toMeta.number)
    if (!fromStop || !toStop) continue

    // Прогрес: ако ETA до next stop е N мин, типична секция е ~1.7 мин,
    // тогава прогресът е (typicalGap - N) / typicalGap
    // Clamped [0.05, 0.95] за да виждаме автобуса между спирките
    const progress = Math.max(
      0.05,
      Math.min(0.95, 1 - nextStopObs.minutes / TYPICAL_STOP_GAP_MIN)
    )
    const point = interpolatePoint(fromStop, toStop, progress)

    positions.push({
      line,
      direction: route.label,
      lat: point.lat,
      lng: point.lng,
      minutesToNext: nextStopObs.minutes,
      toStopNumber: toMeta.number,
      toStopName: toMeta.name,
      fromStopNumber: fromMeta.number,
      fromStopName: fromMeta.name,
      progress,
    })
  }

  return positions
}
