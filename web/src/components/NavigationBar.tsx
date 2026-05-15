/**
 * Active navigation bar — показва се при `navState.active`.
 * MVP version: current step + Next/End controls, без auto-advance.
 *
 * Phase B ще добави: geo-fence auto-advance, live ETA, missed-bus detection,
 * speech synthesis, wake lock.
 */
import { useEffect, useState } from 'react'
import { fetchETA } from '../api'
import { getLineColor } from '../colors'
import type { RouteLeg, RouteOption } from '../types'

const ETA_REFRESH_MS = 25_000

function legSummary(leg: RouteLeg): { title: string; sub: string; color: string } {
  if (leg.type === 'walk') {
    if (leg.kind === 'access') {
      return {
        title: `Върви ${Math.round(leg.meters)} м`,
        sub: `до спирка ${leg.toStopName ?? ''}`,
        color: '#9ca3af',
      }
    }
    if (leg.kind === 'egress') {
      return {
        title: `Слез на ${leg.fromStopName ?? ''}`,
        sub: `и върви ${Math.round(leg.meters)} м до целта`,
        color: '#9ca3af',
      }
    }
    return {
      title: `Прекачи се`,
      sub: `${Math.round(leg.meters)} м до ${leg.toStopName ?? ''}`,
      color: '#9ca3af',
    }
  }
  return {
    title: `Линия ${leg.line}`,
    sub: `от ${leg.fromStopName} → слез на ${leg.toStopName} (${leg.stops.length} спирки)`,
    color: getLineColor(leg.line),
  }
}

export function NavigationBar({
  route,
  currentLegIndex,
  missedBus,
  onAdvance,
  onPrev,
  onEnd,
}: {
  route: RouteOption
  currentLegIndex: number
  /** True ако auto-detection е flag-нал "автобусът е заминал". */
  missedBus?: boolean
  onAdvance: () => void
  onPrev: () => void
  onEnd: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [liveEtaMin, setLiveEtaMin] = useState<number | null>(null)
  const leg = route.legs[currentLegIndex]
  const isLast = currentLegIndex >= route.legs.length - 1

  // За access/transfer walk leg-а, fetch-ваме live ETA на target stop за
  // upcoming ride leg-а.
  useEffect(() => {
    if (!leg || leg.type !== 'walk' || leg.kind === 'egress' || !leg.toStopCode) {
      setLiveEtaMin(null)
      return
    }
    const next = route.legs[currentLegIndex + 1]
    if (!next || next.type !== 'ride') {
      setLiveEtaMin(null)
      return
    }
    const stopCode = parseInt(leg.toStopCode, 10)
    if (!Number.isFinite(stopCode)) return
    const targetLine = next.line
    let cancelled = false

    const load = async () => {
      try {
        const r = await fetchETA(stopCode)
        if (cancelled) return
        const match = r.etas.find((e) => e.line === targetLine)
        setLiveEtaMin(match ? match.minutes : null)
      } catch {
        // skip
      }
    }
    load()
    const id = window.setInterval(load, ETA_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [leg, route, currentLegIndex])

  // Reset expanded когато стъпката се сменя
  useEffect(() => {
    setExpanded(false)
  }, [currentLegIndex])

  if (!leg) return null
  const summary = legSummary(leg)

  return (
    <div className="nav-bar" role="region" aria-label="Активна навигация">
      <button
        type="button"
        className="nav-bar__expand"
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? 'Свий' : 'Разшири'}
      >
        <span className="nav-bar__chevron" data-up={expanded ? '1' : '0'}>▾</span>
      </button>

      <div className="nav-bar__main">
        <div
          className="nav-bar__step-marker"
          style={{ background: summary.color }}
          aria-hidden
        >
          {leg.type === 'ride' ? leg.line : '🚶'}
        </div>
        <div className="nav-bar__text">
          <div className="nav-bar__title">{summary.title}</div>
          <div className="nav-bar__sub">{summary.sub}</div>
          {liveEtaMin !== null && (
            <div className="nav-bar__live-eta">
              🚌 следваш автобус след{' '}
              <strong>
                {liveEtaMin === 0 ? 'сега' : `${liveEtaMin} мин`}
              </strong>
            </div>
          )}
        </div>
        <div className="nav-bar__progress">
          {currentLegIndex + 1}/{route.legs.length}
        </div>
      </div>

      {missedBus && (
        <div className="nav-bar__alert">
          ⚠️ Изглежда автобусът е заминал. Провери оставащите опции в планера или
          изчакай следваща.
        </div>
      )}

      {expanded && (
        <ol className="nav-bar__all-legs">
          {route.legs.map((l, i) => {
            const s = legSummary(l)
            const cls =
              i < currentLegIndex
                ? 'nav-bar__leg nav-bar__leg--past'
                : i === currentLegIndex
                  ? 'nav-bar__leg nav-bar__leg--current'
                  : 'nav-bar__leg'
            return (
              <li key={i} className={cls}>
                <span
                  className="nav-bar__leg-dot"
                  style={{ background: s.color }}
                />
                <span className="nav-bar__leg-text">
                  <strong>{s.title}</strong>
                  <span>{s.sub}</span>
                </span>
              </li>
            )
          })}
        </ol>
      )}

      <div className="nav-bar__actions">
        <button
          type="button"
          className="nav-bar__action nav-bar__action--secondary"
          onClick={onEnd}
        >
          Край
        </button>
        <button
          type="button"
          className="nav-bar__action nav-bar__action--secondary"
          onClick={onPrev}
          disabled={currentLegIndex === 0}
        >
          ← Назад
        </button>
        <button
          type="button"
          className="nav-bar__action nav-bar__action--primary"
          onClick={onAdvance}
        >
          {isLast ? 'Готово' : 'Напред →'}
        </button>
      </div>
    </div>
  )
}
