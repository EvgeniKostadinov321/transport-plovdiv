import { useEffect, useRef, useState } from 'react'
import { fetchVehicleTrip } from '../api'
import { getLineColor } from '../colors'
import type { LiveVehicle, VehicleTrip } from '../types'

const REFRESH_MS = 25_000

function formatDelay(ms: number): { text: string; tone: 'ok' | 'late' | 'early' } {
  if (Math.abs(ms) < 60_000) return { text: 'точно по график', tone: 'ok' }
  const mins = Math.round(Math.abs(ms) / 60_000)
  if (ms > 0) return { text: `закъснява ${mins} мин`, tone: 'late' }
  return { text: `подранява ${mins} мин`, tone: 'early' }
}

function formatScheduled(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString('bg-BG', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function BusTripSheet({
  vehicle,
  onClose,
}: {
  vehicle: LiveVehicle
  onClose: () => void
}) {
  const [trip, setTrip] = useState<VehicleTrip | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const nextStopRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const load = async () => {
      try {
        const data = await fetchVehicleTrip(vehicle.id)
        if (cancelled) return
        setTrip(data)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    timer = window.setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      if (timer) window.clearInterval(timer)
    }
  }, [vehicle.id])

  // Scroll-ваме nextStop във view при първи render с trip data
  useEffect(() => {
    if (trip && nextStopRef.current) {
      nextStopRef.current.scrollIntoView({ block: 'center', behavior: 'auto' })
    }
  }, [trip?.tripId, trip])

  const plate = vehicle.id.includes('/') ? vehicle.id.split('/')[1] : vehicle.id
  const lineColor = vehicle.line ? getLineColor(vehicle.line) : '#888'
  const delay = trip ? formatDelay(trip.delayMs) : null

  return (
    <div className="bus-trip-sheet" role="dialog" aria-label="Подробности за автобус">
      <div className="bus-trip-sheet__handle" />
      <header
        className="bus-trip-sheet__header"
        style={{ borderColor: lineColor }}
      >
        <div className="bus-trip-sheet__line-badge" style={{ background: lineColor }}>
          {vehicle.line ?? '—'}
        </div>
        <div className="bus-trip-sheet__meta">
          <div className="bus-trip-sheet__title">
            {trip?.destination ?? vehicle.destination ?? 'Линия'}
          </div>
          <div className="bus-trip-sheet__sub">
            <span className="bus-trip-sheet__plate">{plate}</span>
            <span>·</span>
            <span>{vehicle.speed} km/h</span>
            {delay && (
              <>
                <span>·</span>
                <span className={`bus-trip-sheet__delay bus-trip-sheet__delay--${delay.tone}`}>
                  {delay.text}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="bus-trip-sheet__close"
          onClick={onClose}
          aria-label="Затвори"
        >
          ✕
        </button>
      </header>

      <div className="bus-trip-sheet__body">
        {loading && !trip && <div className="bus-trip-sheet__loading">Зарежда…</div>}
        {error && !trip && (
          <div className="bus-trip-sheet__error">
            Грешка при зареждане на маршрута: {error}
          </div>
        )}
        {trip && (
          <ol className="bus-trip-sheet__stops">
            {trip.stops.map((s) => {
              const isPast = s.index < trip.nextStopIndex
              const isNext = s.index === trip.nextStopIndex
              return (
                <li
                  key={`${s.stopId}-${s.index}`}
                  ref={isNext ? nextStopRef : undefined}
                  className={[
                    'bus-trip-sheet__stop',
                    isPast && 'bus-trip-sheet__stop--past',
                    isNext && 'bus-trip-sheet__stop--next',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="bus-trip-sheet__dot" style={{ background: lineColor }} />
                  <span className="bus-trip-sheet__stop-info">
                    <span className="bus-trip-sheet__stop-name">
                      {s.name ?? `Спирка ${s.stopId}`}
                    </span>
                    {s.code && (
                      <span className="bus-trip-sheet__stop-code">#{s.code}</span>
                    )}
                  </span>
                  <span className="bus-trip-sheet__stop-time">{formatScheduled(s.scheduled)}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
