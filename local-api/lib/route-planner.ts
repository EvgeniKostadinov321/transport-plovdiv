/**
 * Trip planning върху transit graph-а.
 *
 * Yen's K-shortest paths алгоритъм отгоре на augmented-state Dijkstra
 * `(stopId, currentLine)`. Yen-овия loop produces до K алтернативни пътища
 * чрез блокиране на edges по previous path-овете.
 *
 * Времеви costs са в **минути**. Walking от/до free coords е представено
 * през виртуални source/sink nodes "__SRC__" / "__DST__".
 */

import { haversineMeters, transitGraph, type Edge, type StopNode } from './transit-graph.ts'

/** Максимално walking разстояние от origin/destination до spirka. */
const MAX_ACCESS_WALK_M = 800
/** Walking speed (m/s) — синхронизирано с transit-graph. */
const WALK_SPEED_MPS = 1.2
/** Базови penalty-та. */
const TRANSFER_MIN = 7
const WALK_MULTIPLIER = 1.3
/** Колко алтернативни пътища да върнем. */
const K_PATHS = 5
/** Колко candidate paths да съхраним вътрешно (по-голямо за по-добро diversity). */
const K_CANDIDATES = 30
/** Максимум cost increase спрямо best path преди да спрем (avoid absurd alternatives). */
const MAX_COST_OVER_BEST = 1.7

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
  /** Лейбъл за UI: 'fastest' за best, 'alternative' за останалите. */
  kind: 'fastest' | 'fewestTransfers' | 'leastWalking' | 'alternative'
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

  const accessCandidates = nearbyStops(allStops, input.fromLat, input.fromLng)
  const egressCandidates = nearbyStops(allStops, input.toLat, input.toLng)
  if (accessCandidates.length === 0 || egressCandidates.length === 0) {
    return {
      options: [],
      accessStopCount: accessCandidates.length,
      egressStopCount: egressCandidates.length,
    }
  }

  // Yen's K-shortest paths.
  // A = списък confirmed shortest paths.
  // B = candidates (sorted by cost).
  const A: PathResult[] = []
  const B: PathResult[] = []

  // 1. Initial: best path без блокирани edges.
  const first = dijkstra(input, accessCandidates, egressCandidates, new Set())
  if (!first) {
    return {
      options: [],
      accessStopCount: accessCandidates.length,
      egressStopCount: egressCandidates.length,
    }
  }
  A.push(first)

  // Yen's main loop.
  for (let k = 1; k < K_PATHS; k++) {
    const prev = A[k - 1]
    // За всеки prefix-node на prev (всеки stop в пътя освен sink),
    // блокираме edge-а от prefix.end → next-state-in-prev и пускаме Dijkstra.
    for (let i = 0; i < prev.steps.length - 1; i++) {
      const spurKey = prev.steps[i].key

      // Forbid edges: за всеки confirmed path който shares-ва същия root prefix,
      // забраняваме next-edge от spurKey.
      const forbidden = new Set<string>()
      for (const p of A) {
        if (p.steps.length <= i + 1) continue
        let sharedPrefix = true
        for (let j = 0; j <= i; j++) {
          if (p.steps[j].key !== prev.steps[j].key) {
            sharedPrefix = false
            break
          }
        }
        if (sharedPrefix) {
          // Block edge spurKey → p.steps[i+1].key
          forbidden.add(`${p.steps[i].key}>>${p.steps[i + 1].key}`)
        }
      }

      // Yen's classical: forbid also nodes on root path (за да не loop-ваме).
      // Тук reusing nodes is OK тъй като state-augmented (different lines = different states).
      // Skip this constraint — work with edge-only forbidding.

      const spurResult = dijkstraFromSpur(
        spurKey,
        prev,
        i,
        egressCandidates,
        forbidden
      )
      if (spurResult) {
        // Compose full path: root prefix (prev steps 0..i-1) + spur steps (i..end)
        const rootPrefix = prev.steps.slice(0, i)
        const fullSteps = [...rootPrefix, ...spurResult.steps]
        const fullPath: PathResult = {
          steps: fullSteps,
          totalCost: spurResult.totalCost,
          egress: spurResult.egress,
        }
        const sig = pathSignature(fullPath)
        if (!B.some((p) => pathSignature(p) === sig) && !A.some((p) => pathSignature(p) === sig)) {
          B.push(fullPath)
        }
      }
    }

    if (B.length === 0) break
    // Pick lowest-cost candidate
    B.sort((a, b) => a.totalCost - b.totalCost)
    const next = B.shift()!
    // Cost sanity — спираме ако next е значително по-лош от best
    if (next.totalCost > A[0].totalCost * MAX_COST_OVER_BEST) break
    A.push(next)
    if (B.length > K_CANDIDATES) B.length = K_CANDIDATES
  }

  // Reconstruct as RouteOptions
  const opts: RouteOption[] = A.map((p, i) =>
    reconstructPath(p, i === 0 ? 'fastest' : 'alternative', input)
  )

  // De-dup по leg signature (safety net — Yen shouldn't produce identical paths)
  const seen = new Set<string>()
  const unique: RouteOption[] = []
  for (const opt of opts) {
    const sig = legSignature(opt.legs)
    if (seen.has(sig)) continue
    seen.add(sig)
    unique.push(opt)
  }

  // Sort by REAL total minutes (Yen-овия cost включва transfer penalty, което
  // изкривява ranking-а). User вижда реалното време, не cost-а.
  unique.sort((a, b) => a.totalMinutes - b.totalMinutes)
  // Label first as 'fastest', rest as 'alternative'
  if (unique.length > 0) unique[0].kind = 'fastest'
  for (let i = 1; i < unique.length; i++) unique[i].kind = 'alternative'

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

/** Структура за internal path representation в Yen-овия loop. */
interface PathStep {
  key: string
  edge: ScoredEdge | null
  accessChoice?: AccessCandidate
}

interface PathResult {
  steps: PathStep[]
  totalCost: number
  egress: AccessCandidate
}

function pathSignature(p: PathResult): string {
  return p.steps.map((s) => s.key).join('>') + ':' + p.egress.stop.id
}

/**
 * Augmented Dijkstra. Връща best path който избягва `forbiddenEdges`
 * (set от "fromKey>>toKey" strings). Connect-ва SRC (виртуален) през
 * access stops, expand-ва graph, finds best egress stop.
 */
function dijkstra(
  _input: PlanInput,
  access: AccessCandidate[],
  egress: AccessCandidate[],
  forbiddenEdges: Set<string>
): PathResult | null {
  void _input
  return dijkstraRun(access, egress, forbiddenEdges)
}

/**
 * Same Dijkstra но стартиращ от spurKey със зададена `initialCost` и `prev`
 * (което вече sets root-а на path-а). Yen ползва това за да extend-ва spur-ове.
 *
 * spurInitState: ако !== null, се ползва вместо access-initialization. Полето
 * `prev` указва каква е root-цената + parent-link за reconstruction.
 */
function dijkstraFromSpur(
  spurKey: string,
  prevPath: PathResult,
  spurIndex: number,
  egress: AccessCandidate[],
  forbiddenEdges: Set<string>
): PathResult | null {
  const egressSet = new Map<string, AccessCandidate>()
  for (const e of egress) egressSet.set(e.stop.id, e)

  // Cost до spurKey = sum на step costs до spurIndex.
  // Тъй като нямаме per-step cost запазен явно, ще re-construct-ваме чрез
  // running cumulative cost reconstruction. Лесно — взимаме prevPath.steps[spurIndex].cumCost.
  const rootCost = stepCumCost(prevPath, spurIndex)

  const dist = new Map<string, number>()
  const parents = new Map<string, PathStep & { prevKey: string }>()
  const pq: PqEntry[] = []
  const pushPq = (e: PqEntry) => {
    let lo = 0
    let hi = pq.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pq[mid].cost < e.cost) lo = mid + 1
      else hi = mid
    }
    pq.splice(lo, 0, e)
  }

  // Initialize в spurKey с rootCost.
  dist.set(spurKey, rootCost)
  // Inherit accessChoice + edge от prev path
  const spurStep = prevPath.steps[spurIndex]
  parents.set(spurKey, {
    prevKey: SRC,
    key: spurKey,
    edge: spurStep.edge,
    accessChoice: spurStep.accessChoice,
  })
  pushPq({ cost: rootCost, node: spurKey, parent: SRC, edge: spurStep.edge })

  return runDijkstraLoop(dist, parents, pq, pushPq, egressSet, forbiddenEdges, spurStep)
}

function dijkstraRun(
  access: AccessCandidate[],
  egress: AccessCandidate[],
  forbiddenEdges: Set<string>
): PathResult | null {
  const egressSet = new Map<string, AccessCandidate>()
  for (const e of egress) egressSet.set(e.stop.id, e)

  const dist = new Map<string, number>()
  const parents = new Map<string, PathStep & { prevKey: string }>()
  const pq: PqEntry[] = []
  const pushPq = (e: PqEntry) => {
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
    const startKey = stateKey(acc.stop.id, null)
    const cost = acc.minutes * WALK_MULTIPLIER
    if (cost < (dist.get(startKey) ?? Infinity)) {
      dist.set(startKey, cost)
      parents.set(startKey, {
        prevKey: SRC,
        key: startKey,
        edge: null,
        accessChoice: acc,
      })
      pushPq({ cost, node: startKey, parent: SRC, edge: null })
    }
  }

  return runDijkstraLoop(dist, parents, pq, pushPq, egressSet, forbiddenEdges, null)
}

function runDijkstraLoop(
  dist: Map<string, number>,
  parents: Map<string, PathStep & { prevKey: string }>,
  pq: PqEntry[],
  pushPq: (e: PqEntry) => void,
  egressSet: Map<string, AccessCandidate>,
  forbiddenEdges: Set<string>,
  spurInitial: PathStep | null
): PathResult | null {
  let bestSinkKey: string | null = null
  let bestSinkCost = Infinity
  let bestEgress: AccessCandidate | null = null

  while (pq.length > 0) {
    const cur = pq.shift()!
    if (cur.cost > (dist.get(cur.node) ?? Infinity)) continue

    const [stopId, currentLine] = cur.node.split('|')
    const lineKey = currentLine === '_' ? null : currentLine

    // Check egress
    const egCandidate = egressSet.get(stopId)
    if (egCandidate) {
      const total = cur.cost + egCandidate.minutes * WALK_MULTIPLIER
      if (total < bestSinkCost) {
        bestSinkCost = total
        bestSinkKey = cur.node
        bestEgress = egCandidate
      }
    }

    if (cur.cost >= bestSinkCost) continue

    // Predecessor info
    const parentInfo = parents.get(cur.node)
    // При spur init, parentInfo за spurKey идва от inherited edge — третираме като normal
    const lastEdgeWasWalk =
      parentInfo?.edge !== null && parentInfo?.edge?.edge?.type === 'walk'

    const edges = transitGraph.getEdges(stopId)
    for (const edge of edges) {
      let edgeMinutes = edge.minutes
      let weight = edgeMinutes
      let nextLine: string | null = null

      if (edge.type === 'ride') {
        nextLine = edge.line
        if (lineKey !== null && lineKey !== edge.line) {
          weight += TRANSFER_MIN
        } else if (lastEdgeWasWalk && parentInfo?.accessChoice === undefined) {
          weight += TRANSFER_MIN
        }
      } else {
        if (lastEdgeWasWalk) continue
        if (parentInfo?.accessChoice !== undefined) continue
        // При spur init: ако spur е достигнат след walk, не разрешаваме нов walk
        if (spurInitial && spurInitial.edge?.edge?.type === 'walk' && cur.node === parents.keys().next().value) {
          continue
        }
        nextLine = null
        weight = edgeMinutes * WALK_MULTIPLIER
      }

      const nextKey = stateKey(edge.toStopId, nextLine)
      const edgeKey = `${cur.node}>>${nextKey}`
      if (forbiddenEdges.has(edgeKey)) continue
      const nextCost = cur.cost + weight
      if (nextCost < (dist.get(nextKey) ?? Infinity)) {
        dist.set(nextKey, nextCost)
        const scored: ScoredEdge = {
          edge,
          prevLine: lineKey,
          currentLine: nextLine,
          rawMinutes: edgeMinutes,
        }
        parents.set(nextKey, {
          prevKey: cur.node,
          key: nextKey,
          edge: scored,
        })
        pushPq({ cost: nextCost, node: nextKey, parent: cur.node, edge: scored })
      }
    }
  }

  if (!bestSinkKey || !bestEgress) return null

  // Reconstruct PathStep[] от parents map
  const steps: PathStep[] = []
  let curKey: string = bestSinkKey
  while (curKey !== SRC) {
    const p = parents.get(curKey)
    if (!p) break
    steps.push({ key: p.key, edge: p.edge, accessChoice: p.accessChoice })
    if (p.prevKey === SRC) break
    curKey = p.prevKey
  }
  steps.reverse()

  return { steps, totalCost: bestSinkCost, egress: bestEgress }
}

/**
 * Cumulative cost до step i (inclusive of step[i]'s edge).
 * Замомия weight calculation от Dijkstra-та — TRANSFER_MIN при line change или
 * boarding след walk. WALK_MULTIPLIER при walk edges.
 */
function stepCumCost(path: PathResult, stepIndex: number): number {
  let cost = 0
  let prevLine: string | null = null
  let lastWasWalk = false
  let hadAccessOnly = true

  for (let i = 0; i <= stepIndex; i++) {
    const step = path.steps[i]
    if (step.accessChoice && !step.edge) {
      cost += step.accessChoice.minutes * WALK_MULTIPLIER
      prevLine = null
      lastWasWalk = false
      hadAccessOnly = true
      continue
    }
    if (!step.edge) continue
    const e = step.edge.edge
    if (e.type === 'ride') {
      const line = e.line
      let weight = e.minutes
      if (prevLine !== null && prevLine !== line) {
        weight += TRANSFER_MIN
      } else if (lastWasWalk && !hadAccessOnly) {
        weight += TRANSFER_MIN
      }
      cost += weight
      prevLine = line
      lastWasWalk = false
      hadAccessOnly = false
    } else {
      cost += e.minutes * WALK_MULTIPLIER
      prevLine = null
      lastWasWalk = true
      hadAccessOnly = false
    }
  }
  return cost
}

function reconstructPath(
  path: PathResult,
  kind: RouteOption['kind'],
  input: PlanInput
): RouteOption {
  const steps = path.steps
  const sinkKey = path.egress.stop.id
  const egressSet = new Map<string, AccessCandidate>()
  egressSet.set(path.egress.stop.id, path.egress)
  void sinkKey

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
  const eg = path.egress
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
