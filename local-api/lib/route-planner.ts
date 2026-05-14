/**
 * Trip planning върху transit graph-а. Multi-objective Dijkstra с три
 * различни weight functions → fastest / fewest-transfers / least-walking.
 * Резултатите de-dup-ват ако дават една и съща leg sequence.
 *
 * Времеви costs са в **минути**. Walking от/до free coords е представено
 * през виртуални source/sink nodes "__SRC__" / "__DST__".
 */

import { haversineMeters, transitGraph, type Edge, type StopNode } from './transit-graph.ts'

/** Максимално walking разстояние от origin/destination до spirka. */
const MAX_ACCESS_WALK_M = 800
/** Walking speed (m/s) — синхронизирано с transit-graph. */
const WALK_SPEED_MPS = 1.2
/** Tunable penalties per scoring profile.
 *  transferMinutes = average wait + walk time for a transfer */
const PENALTY = {
  fastest: { transferMinutes: 7, walkMultiplier: 1.3 },
  fewestTransfers: { transferMinutes: 25, walkMultiplier: 1.3 },
  leastWalking: { transferMinutes: 7, walkMultiplier: 3 },
}

const SRC = '__SRC__'
const DST = '__DST__'

export interface PlanInput {
  fromLat: number
  fromLng: number
  toLat: number
  toLng: number
}

export type LegType = 'walk' | 'ride'

interface WalkLegBase {
  type: 'walk'
  meters: number
  minutes: number
}
export interface WalkAccessLeg extends WalkLegBase {
  /** "от точката до спирка" или "от спирка до точката". */
  kind: 'access' | 'egress' | 'transfer'
  fromCoord?: [number, number]
  toCoord?: [number, number]
  fromStopId?: string
  toStopId?: string
  fromStopName?: string
  toStopName?: string
  fromStopCode?: string
  toStopCode?: string
}

export interface RideLeg {
  type: 'ride'
  line: string
  fromStopId: string
  toStopId: string
  fromStopName: string
  toStopName: string
  fromStopCode: string
  toStopCode: string
  minutes: number
  /** Всички intermediate стопове (включително from/to) за rendering. */
  stops: { id: string; code: string; name: string; lat: number; lng: number }[]
}

export type Leg = WalkAccessLeg | RideLeg

export interface RouteOption {
  /** Етикет за UI. */
  kind: 'fastest' | 'fewestTransfers' | 'leastWalking'
  totalMinutes: number
  walkMinutes: number
  rideMinutes: number
  transferCount: number
  legs: Leg[]
}

export interface PlanResult {
  options: RouteOption[]
  /** За debugging — колко спирки около origin/destination откри. */
  accessStopCount: number
  egressStopCount: number
}

interface PqEntry {
  cost: number
  node: string
  /** Предишен node — за reconstruction. */
  parent: string | null
  /** Edge който е дошъл до тук — null за стартов node. */
  edge: ScoredEdge | null
}

interface ScoredEdge {
  edge: Edge
  /** За transfer detection — какво беше "current line" преди да поемем този edge. */
  prevLine: string | null
  currentLine: string | null
  /** Реални минути за този edge (без penalty). */
  rawMinutes: number
}

/** State-augmented node: (stopId, currentLine). Това превръща transfer-а
 *  в експлицитен edge cost. */
function stateKey(stopId: string, line: string | null): string {
  return `${stopId}|${line ?? '_'}`
}

export function plan(input: PlanInput): PlanResult {
  if (!transitGraph.isReady()) {
    return { options: [], accessStopCount: 0, egressStopCount: 0 }
  }
  const allStops = transitGraph.getAllStops()

  // Access spirki (от origin)
  const accessCandidates = nearbyStops(allStops, input.fromLat, input.fromLng)
  // Egress spirki (до destination)
  const egressCandidates = nearbyStops(allStops, input.toLat, input.toLng)
  if (accessCandidates.length === 0 || egressCandidates.length === 0) {
    return {
      options: [],
      accessStopCount: accessCandidates.length,
      egressStopCount: egressCandidates.length,
    }
  }

  const profiles: RouteOption['kind'][] = ['fastest', 'fewestTransfers', 'leastWalking']
  const collected: RouteOption[] = []

  for (const kind of profiles) {
    const option = dijkstra(kind, input, accessCandidates, egressCandidates)
    if (option) collected.push(option)
  }

  // De-dup по leg signature
  const seen = new Set<string>()
  const unique: RouteOption[] = []
  for (const opt of collected) {
    const sig = legSignature(opt.legs)
    if (seen.has(sig)) continue
    seen.add(sig)
    unique.push(opt)
  }
  // Sort: fastest първи, после по totalMinutes
  unique.sort((a, b) => {
    if (a.kind === 'fastest' && b.kind !== 'fastest') return -1
    if (b.kind === 'fastest' && a.kind !== 'fastest') return 1
    return a.totalMinutes - b.totalMinutes
  })

  return {
    options: unique,
    accessStopCount: accessCandidates.length,
    egressStopCount: egressCandidates.length,
  }
}

interface AccessCandidate {
  stop: StopNode
  meters: number
  minutes: number
}

function nearbyStops(
  stops: StopNode[],
  lat: number,
  lng: number
): AccessCandidate[] {
  const result: AccessCandidate[] = []
  for (const s of stops) {
    const m = haversineMeters(lat, lng, s.lat, s.lng)
    if (m > MAX_ACCESS_WALK_M) continue
    result.push({ stop: s, meters: m, minutes: m / WALK_SPEED_MPS / 60 })
  }
  result.sort((a, b) => a.meters - b.meters)
  // Cap до 10 най-близки за perf
  return result.slice(0, 10)
}

function dijkstra(
  kind: RouteOption['kind'],
  input: PlanInput,
  access: AccessCandidate[],
  egress: AccessCandidate[]
): RouteOption | null {
  const penalty = PENALTY[kind]
  const egressSet = new Map<string, AccessCandidate>()
  for (const e of egress) egressSet.set(e.stop.id, e)

  /** distances[stateKey] = minutes от SRC */
  const dist = new Map<string, number>()
  /** parents за reconstruction */
  const parents = new Map<string, { prevKey: string; edge: ScoredEdge | null; accessChoice?: AccessCandidate }>()
  /** Min-heap (тривиална имплементация: sorted array с push + shift)
   *  За graph с ~500 стопа е достатъчно бързо. */
  const pq: PqEntry[] = []
  const pushPq = (e: PqEntry) => {
    // Insertion sort — fine за тоя размер
    let lo = 0
    let hi = pq.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pq[mid].cost < e.cost) lo = mid + 1
      else hi = mid
    }
    pq.splice(lo, 0, e)
  }

  // Initialize: SRC → всеки access stop с walking cost
  for (const acc of access) {
    const startKey = stateKey(acc.stop.id, null) // entry state, още без line
    const cost = acc.minutes * penalty.walkMultiplier
    if (cost < (dist.get(startKey) ?? Infinity)) {
      dist.set(startKey, cost)
      parents.set(startKey, { prevKey: SRC, edge: null, accessChoice: acc })
      pushPq({ cost, node: startKey, parent: SRC, edge: null })
    }
  }

  let bestSinkKey: string | null = null
  let bestSinkCost = Infinity

  while (pq.length > 0) {
    const cur = pq.shift()!
    if (cur.cost > (dist.get(cur.node) ?? Infinity)) continue

    const [stopId, currentLine] = cur.node.split('|')
    const lineKey = currentLine === '_' ? null : currentLine

    // Check egress
    const egCandidate = egressSet.get(stopId)
    if (egCandidate) {
      const total = cur.cost + egCandidate.minutes * penalty.walkMultiplier
      if (total < bestSinkCost) {
        bestSinkCost = total
        bestSinkKey = cur.node
      }
    }

    if (cur.cost >= bestSinkCost) continue // дъл прекъсваме

    // Predecessor info — нужно за да познаем дали последният edge е walk
    const parentInfo = parents.get(cur.node)
    const lastEdgeWasWalk =
      parentInfo?.edge !== null && parentInfo?.edge?.edge?.type === 'walk'

    // Expand edges
    const edges = transitGraph.getEdges(stopId)
    for (const edge of edges) {
      let edgeMinutes = edge.minutes
      let weight = edgeMinutes
      let nextLine: string | null = null

      if (edge.type === 'ride') {
        nextLine = edge.line
        // Transfer penalty: при смяна на линия (true transfer)
        if (lineKey !== null && lineKey !== edge.line) {
          weight += penalty.transferMinutes
        }
        // Boarding penalty след walk transfer (waiting for next bus)
        else if (lastEdgeWasWalk && parentInfo?.accessChoice === undefined) {
          weight += penalty.transferMinutes
        }
      } else {
        // walk transfer
        // Disallow consecutive walks — те произвеждат странични loops
        // и реално един walk transfer покрива достатъчно дистанция (300m).
        if (lastEdgeWasWalk) continue
        // Disallow walking веднага след access (юзърът вече ходи, не трябва
        // да пресича пеша към друга спирка преди да хване автобус).
        if (parentInfo?.accessChoice !== undefined) continue
        nextLine = null
        weight = edgeMinutes * penalty.walkMultiplier
      }

      const nextKey = stateKey(edge.toStopId, nextLine)
      const nextCost = cur.cost + weight
      if (nextCost < (dist.get(nextKey) ?? Infinity)) {
        dist.set(nextKey, nextCost)
        const scored: ScoredEdge = {
          edge,
          prevLine: lineKey,
          currentLine: nextLine,
          rawMinutes: edgeMinutes,
        }
        parents.set(nextKey, { prevKey: cur.node, edge: scored })
        pushPq({ cost: nextCost, node: nextKey, parent: cur.node, edge: scored })
      }
    }
  }

  if (!bestSinkKey) return null
  return reconstruct(kind, input, parents, bestSinkKey, egressSet)
}

function reconstruct(
  kind: RouteOption['kind'],
  input: PlanInput,
  parents: Map<string, { prevKey: string; edge: ScoredEdge | null; accessChoice?: AccessCandidate }>,
  sinkKey: string,
  egressSet: Map<string, AccessCandidate>
): RouteOption {
  // Walk backwards до SRC
  type Step = { key: string; edge: ScoredEdge | null; accessChoice?: AccessCandidate }
  const steps: Step[] = []
  let curKey = sinkKey
  while (true) {
    const p = parents.get(curKey)
    if (!p) break
    steps.push({ key: curKey, edge: p.edge, accessChoice: p.accessChoice })
    if (p.prevKey === SRC) break
    curKey = p.prevKey
  }
  steps.reverse()

  // Build legs
  const legs: Leg[] = []
  let walkMin = 0
  let rideMin = 0
  let transferCount = 0

  // Access walk
  const firstStep = steps[0]
  if (firstStep?.accessChoice) {
    const ac = firstStep.accessChoice
    legs.push({
      type: 'walk',
      kind: 'access',
      meters: ac.meters,
      minutes: ac.minutes,
      fromCoord: [input.fromLat, input.fromLng],
      toStopId: ac.stop.id,
      toStopName: ac.stop.name,
      toStopCode: ac.stop.code,
      toCoord: [ac.stop.lat, ac.stop.lng],
    })
    walkMin += ac.minutes
  }

  // Group consecutive rides on same line
  let i = 0
  while (i < steps.length) {
    const step = steps[i]
    if (!step.edge) {
      i++
      continue
    }
    if (step.edge.edge.type === 'ride') {
      const line = step.edge.edge.line
      const startKey = i === 0 ? steps[0].key : steps[i - 1]?.key ?? steps[0].key
      // start stopId — извличаме от предишния step или от accessChoice
      let fromStopId: string
      if (i === 0) {
        fromStopId = step.accessChoice!.stop.id
      } else {
        fromStopId = steps[i - 1].key.split('|')[0]
      }
      // Collect consecutive rides with same line
      const rideStopsIds: string[] = [fromStopId]
      let rideMinutes = 0
      while (
        i < steps.length &&
        steps[i].edge &&
        steps[i].edge!.edge.type === 'ride' &&
        (steps[i].edge!.edge as { line: string }).line === line
      ) {
        const e = steps[i].edge!
        rideMinutes += e.rawMinutes
        const toStopId = (e.edge as { toStopId: string }).toStopId
        rideStopsIds.push(toStopId)
        i++
      }
      const fromStop = transitGraph.getStop(fromStopId)!
      const toStop = transitGraph.getStop(rideStopsIds[rideStopsIds.length - 1])!
      legs.push({
        type: 'ride',
        line,
        fromStopId,
        toStopId: toStop.id,
        fromStopName: fromStop.name,
        toStopName: toStop.name,
        fromStopCode: fromStop.code,
        toStopCode: toStop.code,
        minutes: rideMinutes,
        stops: rideStopsIds
          .map((id) => transitGraph.getStop(id))
          .filter((s): s is StopNode => s !== null)
          .map((s) => ({ id: s.id, code: s.code, name: s.name, lat: s.lat, lng: s.lng })),
      })
      rideMin += rideMinutes
      // Ако следва ride от друга линия → transfer broke без walk edge
      if (
        i < steps.length &&
        steps[i].edge &&
        steps[i].edge!.edge.type === 'ride' &&
        (steps[i].edge!.edge as { line: string }).line !== line
      ) {
        transferCount++
      }
      void startKey
    } else {
      // walk transfer mid-trip
      const e = steps[i].edge!.edge as { toStopId: string; meters: number; minutes: number }
      const fromStopId = i === 0 ? '' : steps[i - 1].key.split('|')[0]
      const fromStop = fromStopId ? transitGraph.getStop(fromStopId) : null
      const toStop = transitGraph.getStop(e.toStopId)
      if (fromStop && toStop) {
        legs.push({
          type: 'walk',
          kind: 'transfer',
          meters: e.meters,
          minutes: e.minutes,
          fromStopId: fromStop.id,
          fromStopName: fromStop.name,
          fromStopCode: fromStop.code,
          toStopId: toStop.id,
          toStopName: toStop.name,
          toStopCode: toStop.code,
        })
        walkMin += e.minutes
        transferCount++
      }
      i++
    }
  }

  // Egress walk
  const lastStopId = sinkKey.split('|')[0]
  const eg = egressSet.get(lastStopId)
  if (eg) {
    legs.push({
      type: 'walk',
      kind: 'egress',
      meters: eg.meters,
      minutes: eg.minutes,
      fromStopId: eg.stop.id,
      fromStopName: eg.stop.name,
      fromStopCode: eg.stop.code,
      fromCoord: [eg.stop.lat, eg.stop.lng],
      toCoord: [input.toLat, input.toLng],
    })
    walkMin += eg.minutes
  }

  const totalMinutes = walkMin + rideMin
  return { kind, totalMinutes, walkMinutes: walkMin, rideMinutes: rideMin, transferCount, legs }
}

function legSignature(legs: Leg[]): string {
  return legs
    .map((l) => {
      if (l.type === 'ride') return `R:${l.line}:${l.fromStopId}-${l.toStopId}`
      return `W:${l.fromStopId ?? '_'}-${l.toStopId ?? '_'}`
    })
    .join('|')
}
