import { useMemo, useState } from 'react'
import { cleanText } from '../../api'
import { getLineColor } from '../../colors'
import type { Stop } from '../../types'

/**
 * Normalize за case-insensitive търсене.
 * Premахваме diacritics (й/Й, ѝ, и т.н. остават - basic Latin folding не помага за български)
 * Просто lowercase + trim.
 */
function normalize(s: string): string {
  return s.toLowerCase().trim()
}

export function StopsTab({
  stops,
  onSelectStop,
}: {
  stops: Stop[]
  onSelectStop: (stop: Stop) => void
}) {
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const q = normalize(query)
    if (!q) return []

    // Match по number или name
    const matches: Stop[] = []
    for (const s of stops) {
      const nameMatch = normalize(s.name).includes(q)
      const numberMatch = String(s.number).startsWith(q) || String(s.number) === q
      if (nameMatch || numberMatch) matches.push(s)
      if (matches.length >= 50) break // performance cap
    }
    return matches
  }, [stops, query])

  return (
    <div className="stops-tab">
      <div className="stops-tab__search">
        <svg
          className="stops-tab__search-icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="stops-tab__input"
          placeholder="Търси по име или номер на спирка..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          inputMode="search"
        />
        {query && (
          <button
            type="button"
            className="stops-tab__clear"
            onClick={() => setQuery('')}
            aria-label="Изчисти търсенето"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      <div className="stops-tab__results">
        {!query && (
          <div className="stops-tab__hint">
            Въведи текст за да намериш спирка.
            <br />
            <span style={{ opacity: 0.7 }}>
              (търси се в {stops.length} спирки)
            </span>
          </div>
        )}
        {query && results.length === 0 && (
          <div className="stops-tab__hint">
            Няма намерени спирки за „{query}"
          </div>
        )}
        {results.map((stop) => (
          <button
            key={`${stop.number}-${stop.lat}`}
            type="button"
            className="stop-result"
            onClick={() => onSelectStop(stop)}
          >
            <span className="stop-result__num">#{stop.number}</span>
            <span className="stop-result__name">{cleanText(stop.name)}</span>
            {stop.lines.length > 0 && (
              <span className="stop-result__lines">
                {stop.lines.slice(0, 5).map((l) => (
                  <span
                    key={l}
                    className="line-badge stop-result__line"
                    style={{ background: getLineColor(l) }}
                  >
                    {l}
                  </span>
                ))}
                {stop.lines.length > 5 && (
                  <span className="stop-result__lines-more">
                    +{stop.lines.length - 5}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
