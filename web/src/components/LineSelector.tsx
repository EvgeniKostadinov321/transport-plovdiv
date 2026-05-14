import { useState } from 'react'
import { getLineColor } from '../colors'
import type { Theme } from '../types'

export function LineSelector({
  allLines,
  selected,
  visibleCount,
  totalCount,
  onChange,
  theme,
  onToggleTheme,
}: {
  allLines: string[]
  selected: string[]
  visibleCount: number
  totalCount: number
  onChange: (next: string[]) => void
  theme: Theme
  onToggleTheme: () => void
}) {
  const [open, setOpen] = useState(false)
  const selectedSet = new Set(selected)
  const hasFilter = selected.length > 0

  const toggle = (line: string) => {
    if (selectedSet.has(line)) onChange(selected.filter((l) => l !== line))
    else onChange([...selected, line].sort((a, b) => parseInt(a, 10) - parseInt(b, 10)))
  }

  const clear = () => onChange([])

  const handleClearClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    clear()
  }
  const handleThemeClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleTheme()
  }

  return (
    <div className={`line-selector ${open ? 'line-selector--open' : ''}`}>
      <div className="line-selector__bar">
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
            className={
              open
                ? 'line-selector__chevron line-selector__chevron--open'
                : 'line-selector__chevron'
            }
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <div className="line-selector__actions">
          {hasFilter && (
            <button
              type="button"
              className="line-selector__action"
              onClick={handleClearClick}
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
            className="line-selector__action"
            onClick={handleThemeClick}
            aria-label={theme === 'dark' ? 'Светъл режим' : 'Тъмен режим'}
            title={theme === 'dark' ? 'Светъл режим' : 'Тъмен режим'}
          >
            {theme === 'dark' ? (
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
      </div>
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
                  style={
                    active
                      ? {
                          background: getLineColor(line),
                          borderColor: getLineColor(line),
                        }
                      : undefined
                  }
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
