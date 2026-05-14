import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { getLineColor, getStopColor } from './colors'

interface Stop {
  number: number
  name: string
  lat: number
  lng: number
  lines: string[]
}

interface ETAEntry {
  line: string
  minutes: number
  arrivalTime: string
  destination: string
}

interface ETAResponse {
  stop: number
  etas: ETAEntry[]
  fetchedAt: string
  cached?: boolean
  ageSeconds?: number
}

// API URL - в production е Cloudflare Tunnel към твоя PC (Vercel datacenter не може да го достигне)
// В .env.production или Vercel env: VITE_API_URL=https://<tunnel>.trycloudflare.com
const API_URL = import.meta.env.VITE_API_URL ?? ''
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY ?? ''
const PLOVDIV_CENTER: [number, number] = [42.1354, 24.7453]
const CLIENT_CACHE_TTL_MS = 25_000
const REFRESH_INTERVAL_MS = 30_000
const THEME_STORAGE_KEY = 'transport-plovdiv.theme'

type Theme = 'light' | 'dark'

function tileUrlForTheme(theme: Theme): string {
  const style = theme === 'dark' ? 'streets-v2-dark' : 'streets-v2'
  return MAPTILER_KEY
    ? `https://api.maptiler.com/maps/${style}/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
}

// Споделен кеш + in-flight de-dupe между всички StopPopup и hover prefetch
interface CacheEntry {
  data?: ETAResponse
  promise?: Promise<ETAResponse>
  fetchedAt: number
}
const clientCache = new Map<number, CacheEntry>()

function fetchETA(
  stopNumber: number,
  options: { force?: boolean } = {}
): Promise<ETAResponse> {
  const now = Date.now()
  const existing = clientCache.get(stopNumber)
  if (!options.force && existing) {
    if (existing.data && now - existing.fetchedAt < CLIENT_CACHE_TTL_MS) {
      return Promise.resolve(existing.data)
    }
    if (existing.promise) return existing.promise
  }

  const url = options.force
    ? `${API_URL}/api/eta/${stopNumber}?force=1`
    : `${API_URL}/api/eta/${stopNumber}`

  const promise = fetch(url)
    .then(async (r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      return (await r.json()) as ETAResponse
    })
    .then((data) => {
      clientCache.set(stopNumber, { data, fetchedAt: Date.now() })
      return data
    })
    .catch((err) => {
      clientCache.delete(stopNumber)
      throw err
    })

  clientCache.set(stopNumber, { promise, fetchedAt: now })
  return promise
}

function StopPopupContent({
  stop,
  filterLines,
}: {
  stop: Stop
  filterLines: Set<string>
}) {
  const [data, setData] = useState<ETAResponse | null>(() => {
    const c = clientCache.get(stop.number)
    return c?.data ?? null
  })
  const [loading, setLoading] = useState(!data)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0) // forces re-render за live age display
  const loadRef = useRef<((force: boolean) => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    let intervalId: number | null = null

    const load = (force: boolean) => {
      if (force) setRefreshing(true)
      else setLoading(true)
      setError(null)
      // Guarantee минимум 500ms за визуална обратна връзка дори при cache hit
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

    // Първоначално зареждане (ще ползва cache ако има)
    load(false)

    // Auto-refresh на всеки 30 сек докато popup-ът е отворен
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
  void tick // използва се само за re-render trigger

  return (
    <div className="eta-popup">
      <div className="eta-popup__title">
        <span className="eta-popup__stop-num">#{stop.number}</span>
        <span className="eta-popup__stop-name">{cleanText(stop.name)}</span>
      </div>
      {loading && !data && <div className="eta-popup__msg">Зареждане…</div>}
      {error && <div className="eta-popup__msg eta-popup__msg--err">Грешка: {error}</div>}
      {(() => {
        if (!data) return null
        const hasFilter = filterLines.size > 0
        const visibleEtas = hasFilter
          ? data.etas.filter((eta) => filterLines.has(eta.line))
          : data.etas
        const hiddenCount = data.etas.length - visibleEtas.length

        if (data.etas.length === 0) {
          return <div className="eta-popup__msg">Няма пристигащи автобуси.</div>
        }
        if (visibleEtas.length === 0) {
          return (
            <div className="eta-popup__msg">
              Няма пристигащи автобуси от избраните линии.
              <br />
              <span style={{ fontSize: 12 }}>
                ({data.etas.length} други автобуса скрити от филтъра)
              </span>
            </div>
          )
        }
        return (
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
                            <strong style={{ color: '#c0392b' }}>сега</strong>
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
                Филтър: {hiddenCount} {hiddenCount === 1 ? 'автобус скрит' : 'автобуса скрити'}
              </div>
            )}
          </>
        )
      })()}
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

/** Премахва излишни кавички и whitespace от ZK label-ите. */
function cleanText(s: string): string {
  return s
    .replace(/"\s*/g, '"')
    .replace(/\s*"/g, '"')
    .replace(/""+/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function useIsTouch() {
  const [isTouch, setIsTouch] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(hover: none), (pointer: coarse)').matches
      : false
  )
  useEffect(() => {
    const mq = window.matchMedia('(hover: none), (pointer: coarse)')
    const handler = (e: MediaQueryListEvent) => setIsTouch(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isTouch
}

function StopMarker({
  stop,
  isTouch,
  filterLines,
  onSelect,
}: {
  stop: Stop
  isTouch: boolean
  filterLines: Set<string>
  onSelect: (stop: Stop) => void
}) {
  const prefetchTimer = useRef<number | null>(null)
  const color = getStopColor(stop.lines, filterLines)

  // На desktop: hover prefetch + popup. На mobile: tap → bottom sheet (no popup)
  if (isTouch) {
    return (
      <CircleMarker
        center={[stop.lat, stop.lng]}
        radius={9}
        pathOptions={{
          fillColor: color,
          fillOpacity: 0.9,
          color: '#fff',
          weight: 2,
        }}
        eventHandlers={{
          click: () => {
            fetchETA(stop.number).catch(() => {}) // start prefetch
            onSelect(stop)
          },
        }}
      />
    )
  }

  return (
    <CircleMarker
      center={[stop.lat, stop.lng]}
      radius={filterLines.size > 0 ? 6 : 5}
      pathOptions={{
        fillColor: color,
        fillOpacity: filterLines.size > 0 ? 0.9 : 0.7,
        color: '#fff',
        weight: filterLines.size > 0 ? 2 : 1,
      }}
      eventHandlers={{
        mouseover: () => {
          if (prefetchTimer.current) window.clearTimeout(prefetchTimer.current)
          prefetchTimer.current = window.setTimeout(() => {
            fetchETA(stop.number).catch(() => {})
          }, 150)
        },
        mouseout: () => {
          if (prefetchTimer.current) {
            window.clearTimeout(prefetchTimer.current)
            prefetchTimer.current = null
          }
        },
      }}
    >
      <Popup>
        <StopPopupContent stop={stop} filterLines={filterLines} />
      </Popup>
    </CircleMarker>
  )
}

function BottomSheet({
  stop,
  filterLines,
  onClose,
}: {
  stop: Stop
  filterLines: Set<string>
  onClose: () => void
}) {
  // ESC за close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true">
        <button
          type="button"
          className="sheet__handle"
          onClick={onClose}
          aria-label="Затвори"
        />
        <StopPopupContent stop={stop} filterLines={filterLines} />
      </div>
    </>
  )
}

const LINES_STORAGE_KEY = 'transport-plovdiv.selectedLines'

function loadSelectedLines(): string[] {
  try {
    const raw = localStorage.getItem(LINES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (raw === 'dark' || raw === 'light') return raw
  } catch {}
  // Default: следваме system preference
  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark'
  }
  return 'light'
}

function App() {
  const [stops, setStops] = useState<Stop[]>([])
  const [allLines, setAllLines] = useState<string[]>([])
  const [selectedLines, setSelectedLines] = useState<string[]>(loadSelectedLines)
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const isTouch = useIsTouch()

  useEffect(() => {
    fetch(`${API_URL}/api/stops`)
      .then((r) => r.json())
      .then((data: { stops: Stop[] }) => setStops(data.stops))
      .catch(() => {})
    fetch(`${API_URL}/api/lines`)
      .then((r) => r.json())
      .then((data: { lines: string[] }) => setAllLines(data.lines))
      .catch(() => {})
  }, [])

  useEffect(() => {
    localStorage.setItem(LINES_STORAGE_KEY, JSON.stringify(selectedLines))
  }, [selectedLines])

  // Theme: запазваме + прилагаме class на <html>
  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    document.documentElement.dataset.theme = theme
  }, [theme])

  const selectedLinesSet = useMemo(
    () => new Set(selectedLines),
    [selectedLines]
  )
  const noFilter = selectedLines.length === 0
  const visibleStops = useMemo(
    () =>
      noFilter
        ? stops
        : stops.filter((s) => s.lines.some((l) => selectedLinesSet.has(l))),
    [stops, noFilter, selectedLinesSet]
  )

  const showEmptyState = !noFilter && stops.length > 0 && visibleStops.length === 0

  return (
    <>
      <MapContainer
        center={PLOVDIV_CENTER}
        zoom={13}
        className="map-root"
        zoomControl={!isTouch}
        attributionControl={false}
      >
        <TileLayer url={tileUrlForTheme(theme)} key={theme} />
        {visibleStops.map((stop) => (
          <StopMarker
            key={`${stop.number}-${stop.lat}-${stop.lng}`}
            stop={stop}
            isTouch={isTouch}
            filterLines={selectedLinesSet}
            onSelect={setSelectedStop}
          />
        ))}
      </MapContainer>
      <LineSelector
        allLines={allLines}
        selected={selectedLines}
        visibleCount={visibleStops.length}
        totalCount={stops.length}
        onChange={setSelectedLines}
      />
      <Toolbar
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        hasFilter={!noFilter}
        onClearFilter={() => setSelectedLines([])}
      />
      {showEmptyState && (
        <div className="empty-state">
          <div className="empty-state__icon">🚏</div>
          <div className="empty-state__title">Няма спирки</div>
          <div className="empty-state__msg">
            За избраните линии не намерихме спирки. Опитай с други.
          </div>
          <button
            type="button"
            className="empty-state__btn"
            onClick={() => setSelectedLines([])}
          >
            Изчисти филтъра
          </button>
        </div>
      )}
      {isTouch && selectedStop && (
        <BottomSheet
          stop={selectedStop}
          filterLines={selectedLinesSet}
          onClose={() => setSelectedStop(null)}
        />
      )}
    </>
  )
}

function Toolbar({
  theme,
  onToggleTheme,
  hasFilter,
  onClearFilter,
}: {
  theme: Theme
  onToggleTheme: () => void
  hasFilter: boolean
  onClearFilter: () => void
}) {
  return (
    <div className="toolbar">
      {hasFilter && (
        <button
          type="button"
          className="toolbar__btn"
          onClick={onClearFilter}
          aria-label="Изчисти филтъра"
          title="Покажи всички спирки"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
            <line x1="3" y1="3" x2="21" y2="21" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className="toolbar__btn"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Светъл режим' : 'Тъмен режим'}
        title={theme === 'dark' ? 'Светъл режим' : 'Тъмен режим'}
      >
        {theme === 'dark' ? (
          // Sun icon
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          // Moon icon
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>
    </div>
  )
}

function LineSelector({
  allLines,
  selected,
  visibleCount,
  totalCount,
  onChange,
}: {
  allLines: string[]
  selected: string[]
  visibleCount: number
  totalCount: number
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedSet = new Set(selected)

  const toggle = (line: string) => {
    if (selectedSet.has(line)) onChange(selected.filter((l) => l !== line))
    else onChange([...selected, line].sort((a, b) => parseInt(a, 10) - parseInt(b, 10)))
  }

  const clear = () => onChange([])

  return (
    <div className={`line-selector ${open ? 'line-selector--open' : ''}`}>
      <button
        type="button"
        className="line-selector__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label="Избор на линии"
        aria-expanded={open}
      >
        {selected.length === 0 ? (
          <span className="line-selector__placeholder">Избери линии</span>
        ) : (
          <span className="line-selector__chips">
            {selected.map((l) => (
              <span
                key={l}
                className="line-badge"
                style={{ background: getLineColor(l) }}
              >
                {l}
              </span>
            ))}
          </span>
        )}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={open ? 'line-selector__chevron line-selector__chevron--open' : 'line-selector__chevron'}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="line-selector__panel">
          <div className="line-selector__header">
            <span>Линии в Пловдив</span>
            {selected.length > 0 && (
              <button type="button" className="line-selector__clear" onClick={clear}>
                Изчисти ({selected.length})
              </button>
            )}
          </div>
          <div className="line-selector__grid">
            {allLines.map((line) => {
              const active = selectedSet.has(line)
              return (
                <button
                  key={line}
                  type="button"
                  className={active ? 'line-pick line-pick--active' : 'line-pick'}
                  style={active ? { background: getLineColor(line), borderColor: getLineColor(line) } : undefined}
                  onClick={() => toggle(line)}
                >
                  {line}
                </button>
              )
            })}
          </div>
          <div className="line-selector__footer">
            {totalCount === 0 ? (
              <span>Зареждане…</span>
            ) : selected.length === 0 ? (
              <span>Показват се всички {totalCount} спирки</span>
            ) : (
              <span>
                {visibleCount} от {totalCount} спирки
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
