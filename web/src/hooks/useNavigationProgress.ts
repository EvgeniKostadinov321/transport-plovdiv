/**
 * Navigation progress engine.
 *
 * Следи user GPS position спрямо current leg target. Auto-advance-ва когато
 * юзърят влезе в geo-fence на следващата спирка/destination.
 *
 * Извиква callbacks:
 *   - onAdvance(): когато стъпката трябва да напредне
 *   - onArrival(): когато стигаме до final destination
 *   - onMissedBus(): когато ride leg е "просрочен" (Phase B3)
 *   - onSpeak(text, kind): за speech synthesis cues (Phase B4)
 */
import { useEffect, useRef } from 'react'
import { distanceMeters } from '../geo'
import type { GeoPosition, LiveVehicle, RouteLeg, RouteOption } from '../types'

/** Радиус за geo-fence на walk arrival (включително access/transfer/egress). */
const WALK_ARRIVAL_RADIUS_M = 30
/** Радиус за ride arrival (по-голям защото GPS в автобуса е по-малко точен). */
const RIDE_ARRIVAL_RADIUS_M = 60
/** GPS-based missed-bus: vehicle approached this close → past = "passed me". */
const VEHICLE_APPROACH_MIN_M = 100
/** GPS-based missed-bus: vehicle distance grew this much from observed min → passed. */
const VEHICLE_PASSED_DELTA_M = 50
/** Cooldown между speech announcements, за да не spam-ваме (Phase B4). */
const SPEAK_COOLDOWN_MS = 8000

export interface NavSpeakEvent {
  text: string
  kind: 'milestone' | 'warning'
}

interface UseNavParams {
  active: boolean
  route: RouteOption | null
  currentLegIndex: number
  position: GeoPosition | null
  /** Live vehicles за GPS-based missed-bus detection. */
  vehicles?: LiveVehicle[]
  onAdvance: () => void
  onArrival: () => void
  onMissedBus?: (legIndex: number) => void
  onSpeak?: (event: NavSpeakEvent) => void
}

interface LegTarget {
  lat: number
  lng: number
  radius: number
  /** За final leg arrival (egress): това е dest coordinate; иначе stop. */
  isFinal: boolean
}

/** Извлича geo-fence target за конкретен leg. */
function legTarget(leg: RouteLeg, isFinal: boolean): LegTarget | null {
  if (leg.type === 'walk') {
    if (leg.kind === 'egress') {
      if (!leg.toCoord) return null
      return { lat: leg.toCoord[0], lng: leg.toCoord[1], radius: WALK_ARRIVAL_RADIUS_M, isFinal: true }
    }
    // access или transfer → до stop-а
    const stops = leg.toStopId
    if (!stops) return null
    // toStopId е livetransport's internal — нямаме директни coords за него тук;
    // ползваме .toCoord (което е stop's lat/lng при walk access — виж
    // route-planner.reconstruct() — но НЕ е populated за transfer).
    // За access: leg.toCoord съществува (зад. от planner-а).
    // За transfer: трябва да derive coords от ride leg-а наоколо (handled long-form).
    if (leg.toCoord) {
      return { lat: leg.toCoord[0], lng: leg.toCoord[1], radius: WALK_ARRIVAL_RADIUS_M, isFinal }
    }
    return null
  }
  // ride: целта е destination stop — има го в leg.stops[last]
  const last = leg.stops[leg.stops.length - 1]
  if (!last) return null
  return { lat: last.lat, lng: last.lng, radius: RIDE_ARRIVAL_RADIUS_M, isFinal }
}

/**
 * При walk-transfer leg, route-planner-ът не populates `toCoord` — fallback-ваме
 * към coords на стоп-а от следващия ride leg (където прехвърляме).
 */
function transferToCoord(legs: RouteLeg[], walkIdx: number): [number, number] | null {
  const walk = legs[walkIdx]
  if (walk.type !== 'walk' || walk.kind !== 'transfer') return null
  // Намираме следващия ride leg и взимаме coord на първата му спирка
  for (let i = walkIdx + 1; i < legs.length; i++) {
    const r = legs[i]
    if (r.type === 'ride' && r.stops.length > 0) {
      return [r.stops[0].lat, r.stops[0].lng]
    }
  }
  return null
}

export function useNavigationProgress({
  active,
  route,
  currentLegIndex,
  position,
  vehicles,
  onAdvance,
  onArrival,
  onMissedBus,
  onSpeak,
}: UseNavParams) {
  const lastSpokenRef = useRef<number>(0)
  const missedBusFiredRef = useRef<number>(-1)
  const navStartRef = useRef<number>(0)
  /** Per-vehicle min observed distance към моя target stop за detection-а. */
  const vehicleMinDistRef = useRef<Map<string, number>>(new Map())

  // Reset state когато започва нова nav или сменяме leg
  useEffect(() => {
    if (active) {
      navStartRef.current = Date.now()
      missedBusFiredRef.current = -1
      vehicleMinDistRef.current.clear()
    }
  }, [active])

  useEffect(() => {
    // При смяна на leg → reset vehicle tracking
    vehicleMinDistRef.current.clear()
  }, [currentLegIndex])

  // Speech: announce при entry в нова leg
  useEffect(() => {
    if (!active || !route || !onSpeak) return
    const leg = route.legs[currentLegIndex]
    if (!leg) return
    const text = announceText(leg, currentLegIndex === route.legs.length - 1)
    if (text) onSpeak({ text, kind: 'milestone' })
    lastSpokenRef.current = Date.now()
  }, [active, route, currentLegIndex, onSpeak])

  // Geo-fence + missed-bus watcher
  useEffect(() => {
    if (!active || !route || !position) return
    const leg = route.legs[currentLegIndex]
    if (!leg) return
    const isFinal = currentLegIndex === route.legs.length - 1

    // Target coord
    let target = legTarget(leg, isFinal)
    if (!target && leg.type === 'walk' && leg.kind === 'transfer') {
      const c = transferToCoord(route.legs, currentLegIndex)
      if (c) target = { lat: c[0], lng: c[1], radius: WALK_ARRIVAL_RADIUS_M, isFinal }
    }
    if (!target) return

    const dist = distanceMeters(position.lat, position.lng, target.lat, target.lng)

    if (dist <= target.radius) {
      if (target.isFinal) onArrival()
      else onAdvance()
      return
    }

    // Speech proximity warnings (Phase B4)
    if (onSpeak && Date.now() - lastSpokenRef.current > SPEAK_COOLDOWN_MS) {
      if (leg.type === 'ride' && dist < 150) {
        onSpeak({ text: 'Подгответе се да слезете на следваща спирка', kind: 'warning' })
        lastSpokenRef.current = Date.now()
      } else if (leg.type === 'walk' && leg.kind === 'access' && dist < 80) {
        onSpeak({ text: `Спирката е на ${Math.round(dist)} метра`, kind: 'milestone' })
        lastSpokenRef.current = Date.now()
      }
    }

    // Missed-bus (GPS-based): за access/transfer walk legs преди ride —
    // следим vehicles на upcoming ride line. Ако някой се е приближил
    // (distance < APPROACH_MIN), после се отдалечава (distance > min + DELTA)
    // → отминал е без мен.
    if (
      onMissedBus &&
      vehicles &&
      missedBusFiredRef.current !== currentLegIndex &&
      leg.type === 'walk' &&
      leg.kind !== 'egress'
    ) {
      const nextLeg = route.legs[currentLegIndex + 1]
      if (nextLeg?.type === 'ride') {
        const targetLine = nextLeg.line
        // Target stop е walk-а's destination
        const targetLat = target.lat
        const targetLng = target.lng
        const myDistToStop = dist // user-stop distance — реусваме изчисленото
        // Само ако юзърът още не е на спирка (има walking distance)
        if (myDistToStop > 25) {
          for (const v of vehicles) {
            if (v.line !== targetLine) continue
            const vd = distanceMeters(v.lat, v.lng, targetLat, targetLng)
            const prevMin = vehicleMinDistRef.current.get(v.id)
            if (prevMin === undefined || vd < prevMin) {
              vehicleMinDistRef.current.set(v.id, vd)
            } else if (
              prevMin < VEHICLE_APPROACH_MIN_M &&
              vd > prevMin + VEHICLE_PASSED_DELTA_M
            ) {
              // Vehicle беше достатъчно близо (минал е през/край спирката)
              // и сега се отдалечава. Изпуснат.
              missedBusFiredRef.current = currentLegIndex
              onMissedBus(currentLegIndex)
              break
            }
          }
        }
      }
    }
  }, [active, route, currentLegIndex, position, vehicles, onAdvance, onArrival, onMissedBus, onSpeak])
}

function announceText(leg: RouteLeg, isFinal: boolean): string | null {
  if (leg.type === 'walk') {
    if (leg.kind === 'access') {
      return `Върви ${Math.round(leg.meters)} метра до спирка ${leg.toStopName ?? ''}`
    }
    if (leg.kind === 'egress') {
      return `Слез и върви ${Math.round(leg.meters)} метра до целта`
    }
    return `Прекачи се ${Math.round(leg.meters)} метра до ${leg.toStopName ?? ''}`
  }
  if (isFinal) return `Линия ${leg.line}. Слез на ${leg.toStopName}, последна спирка.`
  return `Качи се на Линия ${leg.line}. Слез на ${leg.toStopName} след ${leg.stops.length - 1} спирки.`
}
