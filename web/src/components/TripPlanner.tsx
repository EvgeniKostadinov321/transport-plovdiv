import { useState } from 'react'
import { planRoute } from '../api'
import { getLineColor } from '../colors'
import { LocationInput, type LocationValue } from './LocationInput'
import type {
  GeoPosition,
  RouteLeg,
  RouteOption,
  RoutePlanResult,
} from '../types'

const KIND_LABEL: Record<RouteOption['kind'], string> = {
  fastest: 'Най-бърз',
  fewestTransfers: 'Най-малко прекачвания',
  leastWalking: 'Най-малко ходене',
}

function formatMin(min: number): string {
  if (min < 1) return '< 1 мин'
  return `${Math.round(min)} мин`
}

function legSummary(leg: RouteLeg): { icon: string; text: string } {
  if (leg.type === 'walk') {
    if (leg.kind === 'access') {
      return { icon: '🚶', text: `${Math.round(leg.meters)} м до спирка ${leg.toStopName}` }
    }
    if (leg.kind === 'egress') {
      return { icon: '🚶', text: `${Math.round(leg.meters)} м от ${leg.fromStopName} до целта` }
    }
    return {
      icon: '🚶',
      text: `прекачване: ${Math.round(leg.meters)} м до ${leg.toStopName}`,
    }
  }
  return {
    icon: '🚌',
    text: `Линия ${leg.line}: ${leg.fromStopName} → ${leg.toStopName} (${leg.stops.length} спирки)`,
  }
}

export function TripPlanner({
  geo,
  onClose,
  selectedOption,
  onSelectOption,
  onStartNavigation,
}: {
  geo: GeoPosition | null
  onClose: () => void
  selectedOption: RouteOption | null
  onSelectOption: (opt: RouteOption | null) => void
  onStartNavigation: (opt: RouteOption) => void
}) {
  const [from, setFrom] = useState<LocationValue | null>(null)
  const [to, setTo] = useState<LocationValue | null>(null)
  const [result, setResult] = useState<RoutePlanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const useMyLocation = () => {
    if (!geo) return
    setFrom({
      label: 'Моята локация',
      lat: geo.lat,
      lng: geo.lng,
      fromGeo: true,
    })
  }

  const handleSearch = async () => {
    if (!from || !to) return
    setLoading(true)
    setError(null)
    setResult(null)
    onSelectOption(null)
    try {
      const r = await planRoute(
        { lat: from.lat, lng: from.lng },
        { lat: to.lat, lng: to.lng }
      )
      setResult(r)
      if (r.options.length > 0) onSelectOption(r.options[0])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const swap = () => {
    const f = from
    setFrom(to)
    setTo(f)
    setResult(null)
    onSelectOption(null)
  }

  return (
    <div className="trip-planner" role="dialog" aria-label="Планиране на пътуване">
      <div className="trip-planner__handle" />
      <header className="trip-planner__header">
        <h2>Планирай пътуване</h2>
        <button
          type="button"
          className="trip-planner__close"
          onClick={onClose}
          aria-label="Затвори"
        >
          ✕
        </button>
      </header>

      <div className="trip-planner__form">
        <div className="trip-planner__inputs">
          <LocationInput
            placeholder="Откъде"
            value={from}
            onChange={setFrom}
            onUseGeo={useMyLocation}
            hasGeo={!!geo}
          />
          <button
            type="button"
            className="trip-planner__swap"
            onClick={swap}
            aria-label="Размени"
            title="Размени откъде/докъде"
            disabled={!from && !to}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
          <LocationInput
            placeholder="Докъде"
            value={to}
            onChange={setTo}
          />
        </div>
        <button
          type="button"
          className="trip-planner__submit"
          onClick={handleSearch}
          disabled={!from || !to || loading}
        >
          {loading ? 'Търсене…' : 'Намери маршрут'}
        </button>
      </div>

      <div className="trip-planner__body">
        {error && <div className="trip-planner__error">Грешка: {error}</div>}
        {result && result.options.length === 0 && (
          <div className="trip-planner__empty">
            Не намерих директен маршрут с автобус. Опитай по-близка крайна точка
            или провери дали имаш спирки в радиус.
          </div>
        )}
        {result?.options.map((opt, i) => {
          const isSelected = selectedOption?.kind === opt.kind && selectedOption?.totalMinutes === opt.totalMinutes
          return (
            <article
              key={`${opt.kind}-${i}`}
              className={
                isSelected
                  ? 'trip-option trip-option--selected'
                  : 'trip-option'
              }
              onClick={() => onSelectOption(opt)}
            >
              <header className="trip-option__head">
                <span className="trip-option__kind">{KIND_LABEL[opt.kind]}</span>
                <span className="trip-option__total">{formatMin(opt.totalMinutes)}</span>
              </header>
              <div className="trip-option__sub">
                {opt.transferCount === 0
                  ? 'без прекачване'
                  : `${opt.transferCount} прекачв${opt.transferCount === 1 ? 'ане' : 'ания'}`}
                {' · '}
                🚶 {formatMin(opt.walkMinutes)}
                {' · '}
                🚌 {formatMin(opt.rideMinutes)}
              </div>
              {/* Compact line ribbon */}
              <div className="trip-option__ribbon">
                {opt.legs.map((leg, j) => {
                  if (leg.type === 'walk') {
                    return (
                      <span key={j} className="trip-option__chip trip-option__chip--walk">
                        🚶
                      </span>
                    )
                  }
                  return (
                    <span
                      key={j}
                      className="trip-option__chip trip-option__chip--ride"
                      style={{ background: getLineColor(leg.line) }}
                    >
                      {leg.line}
                    </span>
                  )
                })}
              </div>
              {isSelected && (
                <>
                  <ol className="trip-option__legs">
                    {opt.legs.map((leg, j) => {
                      const { icon, text } = legSummary(leg)
                      return (
                        <li key={j} className="trip-option__leg">
                          <span className="trip-option__leg-icon">{icon}</span>
                          <span className="trip-option__leg-text">{text}</span>
                          <span className="trip-option__leg-time">{formatMin(leg.minutes)}</span>
                        </li>
                      )
                    })}
                  </ol>
                  <button
                    type="button"
                    className="trip-option__start"
                    onClick={(e) => {
                      e.stopPropagation()
                      onStartNavigation(opt)
                    }}
                  >
                    Започни навигация
                  </button>
                </>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
