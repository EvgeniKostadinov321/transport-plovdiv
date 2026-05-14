import { useEffect, useRef, useState } from 'react'
import { fetchETA, getCachedETA, cleanText } from '../api'
import { getLineColor } from '../colors'
import { REFRESH_INTERVAL_MS } from '../config'
import type { ETAResponse, Stop } from '../types'

export function StopPopupContent({
  stop,
  filterLines,
  isFavorite,
  onToggleFavorite,
}: {
  stop: Stop
  filterLines: Set<string>
  isFavorite?: boolean
  onToggleFavorite?: (stopNumber: number) => void
}) {
  const [data, setData] = useState<ETAResponse | null>(() => getCachedETA(stop.number))
  const [loading, setLoading] = useState(!data)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)
  const loadRef = useRef<((force: boolean) => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    let intervalId: number | null = null

    const load = (force: boolean) => {
      if (force) setRefreshing(true)
      else setLoading(true)
      setError(null)
      const minDuration = force ? 500 : 0
      const startedAt = Date.now()

      fetchETA(stop.number, { force })
        .then((json) => {
          if (cancelled) return
          const elapsed = Date.now() - startedAt
          const wait = Math.max(0, minDuration - elapsed)
          window.setTimeout(() => {
            if (cancelled) return
            setData(json)
            setLoading(false)
            setRefreshing(false)
          }, wait)
        })
        .catch((err) => {
          if (cancelled) return
          const elapsed = Date.now() - startedAt
          const wait = Math.max(0, minDuration - elapsed)
          window.setTimeout(() => {
            if (cancelled) return
            setError(err.message)
            setLoading(false)
            setRefreshing(false)
          }, wait)
        })
    }
    loadRef.current = load

    load(false)
    intervalId = window.setInterval(() => {
      if (!cancelled) load(true)
    }, REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      loadRef.current = null
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [stop.number])

  const handleManualRefresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (refreshing) return
    loadRef.current?.(true)
  }

  // Tick всяка секунда за live "преди Xs" indicator
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  void tick

  const hasFilter = filterLines.size > 0
  const visibleEtas = data
    ? hasFilter
      ? data.etas.filter((eta) => filterLines.has(eta.line))
      : data.etas
    : []
  const hiddenCount = data ? data.etas.length - visibleEtas.length : 0

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleFavorite?.(stop.number)
  }

  return (
    <div className="eta-popup">
      <div className="eta-popup__title">
        <span className="eta-popup__stop-num">#{stop.number}</span>
        <span className="eta-popup__stop-name">{cleanText(stop.name)}</span>
        {onToggleFavorite && (
          <button
            type="button"
            className={
              isFavorite
                ? 'eta-popup__pin eta-popup__pin--active'
                : 'eta-popup__pin'
            }
            onClick={handlePinClick}
            aria-label={isFavorite ? 'Премахни от любими' : 'Добави в любими'}
            title={isFavorite ? 'Премахни от любими' : 'Добави в любими'}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill={isFavorite ? '#f5b400' : 'none'}
              stroke={isFavorite ? '#f5b400' : 'currentColor'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
        )}
      </div>
      {loading && !data && <div className="eta-popup__msg">Зареждане…</div>}
      {error && <div className="eta-popup__msg eta-popup__msg--err">Грешка: {error}</div>}
      {data && data.etas.length === 0 && (
        <div className="eta-popup__msg">Няма пристигащи автобуси.</div>
      )}
      {data && data.etas.length > 0 && visibleEtas.length === 0 && (
        <div className="eta-popup__msg">
          Няма пристигащи автобуси от избраните линии.
          <br />
          <span style={{ fontSize: 12 }}>
            ({data.etas.length} други автобуса скрити от филтъра)
          </span>
        </div>
      )}
      {visibleEtas.length > 0 && (
        <>
          <div className="eta-table__scroll">
            <table className="eta-table">
              <thead>
                <tr>
                  <th className="eta-table__col-line">Линия</th>
                  <th className="eta-table__col-min">мин</th>
                  <th className="eta-table__col-time">час</th>
                  <th className="eta-table__col-dest">Посока</th>
                </tr>
              </thead>
              <tbody>
                {visibleEtas.map((eta, i) => {
                  const lineColor = getLineColor(eta.line)
                  return (
                    <tr key={i}>
                      <td className="eta-table__col-line">
                        <span
                          className="line-badge"
                          style={hasFilter ? { background: lineColor } : undefined}
                        >
                          {eta.line}
                        </span>
                      </td>
                      <td className="eta-table__col-min">
                        {eta.minutes === 0 ? (
                          <strong style={{ color: 'var(--error)' }}>сега</strong>
                        ) : (
                          <strong>{eta.minutes}</strong>
                        )}
                      </td>
                      <td className="eta-table__col-time">{eta.arrivalTime}</td>
                      <td className="eta-table__col-dest" title={cleanText(eta.destination)}>
                        {cleanText(eta.destination)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {hasFilter && hiddenCount > 0 && (
            <div className="eta-popup__filter-note">
              Филтър: {hiddenCount}{' '}
              {hiddenCount === 1 ? 'автобус скрит' : 'автобуса скрити'}
            </div>
          )}
        </>
      )}
      {data && (
        <div className="eta-popup__footer">
          <span>
            обновено преди{' '}
            {Math.floor((Date.now() - new Date(data.fetchedAt).getTime()) / 1000)}s
          </span>
          <button
            type="button"
            className="eta-popup__refresh-btn"
            onClick={handleManualRefresh}
            disabled={refreshing}
            title="Обнови сега"
            aria-label="Обнови сега"
          >
            <svg
              className={refreshing ? 'spinning' : ''}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
