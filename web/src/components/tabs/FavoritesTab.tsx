import { useMemo } from 'react'
import { cleanText } from '../../api'
import { getLineColor } from '../../colors'
import type { Favorite, Stop } from '../../types'

interface FavoriteRow {
  fav: Favorite
  stop: Stop | null
}

export function FavoritesTab({
  favorites,
  stops,
  onSelectStop,
  onRemove,
}: {
  favorites: Favorite[]
  stops: Stop[]
  onSelectStop: (stop: Stop) => void
  onRemove: (stopNumber: number) => void
}) {
  const rows: FavoriteRow[] = useMemo(() => {
    const byNumber = new Map<number, Stop>()
    for (const s of stops) byNumber.set(s.number, s)
    // Newest first
    return [...favorites]
      .sort((a, b) => b.pinnedAt - a.pinnedAt)
      .map((fav) => ({ fav, stop: byNumber.get(fav.stopNumber) ?? null }))
  }, [favorites, stops])

  if (favorites.length === 0) {
    return (
      <div className="tab-placeholder">
        <div className="tab-placeholder__icon">⭐</div>
        <div className="tab-placeholder__title">Нямаш любими спирки</div>
        <div className="tab-placeholder__msg">
          Кликни ⭐ в попъпа на спирка, за да я добавиш тук.
        </div>
      </div>
    )
  }

  return (
    <div className="favorites-tab">
      <div className="favorites-tab__header">
        <div className="favorites-tab__title">
          {favorites.length}{' '}
          {favorites.length === 1 ? 'любима спирка' : 'любими спирки'}
        </div>
      </div>
      <div className="favorites-tab__list">
        {rows.map(({ fav, stop }) => (
          <div key={fav.stopNumber} className="favorite-row">
            <button
              type="button"
              className="favorite-row__main"
              onClick={() => stop && onSelectStop(stop)}
              disabled={!stop}
            >
              <span className="favorite-row__num">#{fav.stopNumber}</span>
              <span className="favorite-row__name">
                {stop ? cleanText(stop.name) : '(непозната спирка)'}
              </span>
              {stop && stop.lines.length > 0 && (
                <span className="favorite-row__lines">
                  {stop.lines.slice(0, 5).map((l) => (
                    <span
                      key={l}
                      className="line-badge favorite-row__line"
                      style={{ background: getLineColor(l) }}
                    >
                      {l}
                    </span>
                  ))}
                  {stop.lines.length > 5 && (
                    <span className="favorite-row__lines-more">
                      +{stop.lines.length - 5}
                    </span>
                  )}
                </span>
              )}
            </button>
            <button
              type="button"
              className="favorite-row__remove"
              onClick={() => onRemove(fav.stopNumber)}
              aria-label="Премахни от любими"
              title="Премахни от любими"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
