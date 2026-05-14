/**
 * Bus position interpolation.
 *
 * Идея: всеки уникален автобус (line + destination + arrivalTime) се появява
 * в ETA-тата на множество спирки със monotonically decreasing minutes
 * (по-близо до to-stop = по-малко минути).
 *
 * Sort observations по stopIndex; разлики в ETA между съседни спирки
 * дават реален gap време. Позицията на автобуса е между текущата спирка
 * (next stop с минимален positive ETA) и предишната спирка по маршрута.
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

/** Truncated string match - поне 10 символа prefix трябва да съвпада. */
function destinationsMatch(a: string, b: string): boolean {
  const na = normalizeDestination(a)
  const nb = normalizeDestination(b)
  if (na === nb) return true
  if (na.length >= 10 && nb.startsWith(na.slice(0, 10))) return true
  if (nb.length >= 10 && na.startsWith(nb.slice(0, 10))) return true
  return false
}

/** Bus identity - различни автобуси на същата линия имат различни arrivalTime. */
function busKey(eta: ETAEntry): string {
  return `${eta.arrivalTime}|${normalizeDestination(eta.destination)}`
}

interface BusObservation {
  stopIndex: number
  stopNumber: number
  minutes: number
  arrivalTime: string
}

export function interpolateBuses(
  line: string,
  route: RouteDirection,
  stopsByNumber: Map<number, Stop>,
  etasByStop: Map<number, ETAEntry[]>
): BusPosition[] {
  // Destination на маршрута = последна спирка
  const routeDestKey = route.stops[route.stops.length - 1]?.name ?? ''

  // За всеки бус (key), collect-ваме observations по route-а
  const busObservations = new Map<string, BusObservation[]>()

  for (let i = 0; i < route.stops.length; i++) {
    const stopMeta = route.stops[i]
    const etas = etasByStop.get(stopMeta.number) ?? []
    for (const eta of etas) {
      if (eta.line !== line) continue
      if (!destinationsMatch(eta.destination, routeDestKey)) continue
      const key = busKey(eta)
      const list = busObservations.get(key) ?? []
      list.push({
        stopIndex: i,
        stopNumber: stopMeta.number,
        minutes: eta.minutes,
        arrivalTime: eta.arrivalTime,
      })
      busObservations.set(key, list)
    }
  }

  const positions: BusPosition[] = []

  for (const [, obs] of busObservations) {
    if (obs.length === 0) continue
    // Sort по stopIndex
    obs.sort((a, b) => a.stopIndex - b.stopIndex)

    // Намираме next stop = първата observation където minutes >= 0
    // и е минималната.
    // ETA-тата decrease-ват от край към начало на маршрута:
    //   route_pos 0 (start) → ETA=20мин
    //   route_pos 5 (current?) → ETA=5мин (next stop за този автобус)
    //   route_pos 10 → ETA=15мин (по-нататък по route-а)
    // Бусът е МЕЖДУ next stop и предишна.
    const sortedByMinutes = [...obs].sort((a, b) => a.minutes - b.minutes)
    const nextStop = sortedByMinutes[0]
    if (!nextStop) continue

    // Sanity: ако минимумът е > 30 мин, скип-ваме (твърде далеч)
    if (nextStop.minutes > 30) continue

    const nextIdx = nextStop.stopIndex

    // Случай 1: Бусът е още преди първа спирка (nextIdx === 0)
    if (nextIdx === 0) {
      const firstStop = stopsByNumber.get(route.stops[0].number)
      if (!firstStop) continue
      positions.push({
        line,
        direction: route.label,
        lat: firstStop.lat,
        lng: firstStop.lng,
        minutesToNext: nextStop.minutes,
        toStopNumber: route.stops[0].number,
        toStopName: route.stops[0].name,
        fromStopNumber: route.stops[0].number,
        fromStopName: route.stops[0].name,
        progress: 0,
      })
      continue
    }

    // Случай 2: Бусът е между prev и next
    const prevIdx = nextIdx - 1
    const fromMeta = route.stops[prevIdx]
    const toMeta = route.stops[nextIdx]
    const fromStop = stopsByNumber.get(fromMeta.number)
    const toStop = stopsByNumber.get(toMeta.number)
    if (!fromStop || !toStop) continue

    // Real gap (минути) ако имаме observation за prev stop:
    // ETA на prev = N1 > ETA на next = N2 (бусът ще стигне prev по-късно)
    // Разликата N1 - N2 е time gap между двете спирки за този автобус.
    // НО: prev може да няма observation (бусът вече го е минал).
    const prevObs = obs.find((o) => o.stopIndex === prevIdx)
    let gapMin: number
    if (prevObs && prevObs.minutes > nextStop.minutes) {
      gapMin = prevObs.minutes - nextStop.minutes
    } else {
      // Fallback: typical gap 1.5 min
      gapMin = 1.5
    }

    // Прогрес: 0 = на prev, 1 = на next
    // ETA до next е nextStop.minutes. Реален път от prev до next е gapMin.
    // Бусът има още nextStop.minutes до next → започнал е преди (gapMin - nextStop.minutes) min от prev
    // → прогрес = (gapMin - nextStop.minutes) / gapMin
    let progress = (gapMin - nextStop.minutes) / gapMin
    progress = Math.max(0.05, Math.min(0.95, progress))

    const point = interpolatePoint(fromStop, toStop, progress)

    positions.push({
      line,
      direction: route.label,
      lat: point.lat,
      lng: point.lng,
      minutesToNext: nextStop.minutes,
      toStopNumber: toMeta.number,
      toStopName: toMeta.name,
      fromStopNumber: fromMeta.number,
      fromStopName: fromMeta.name,
      progress,
    })
  }

  return positions
}
