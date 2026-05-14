import { getLineColor } from '../../colors'

export function LinesTab({
  allLines,
  selected,
  onChange,
  visibleCount,
  totalCount,
}: {
  allLines: string[]
  selected: string[]
  onChange: (next: string[]) => void
  visibleCount: number
  totalCount: number
}) {
  const selectedSet = new Set(selected)

  const toggle = (line: string) => {
    if (selectedSet.has(line)) onChange(selected.filter((l) => l !== line))
    else onChange([...selected, line].sort((a, b) => parseInt(a, 10) - parseInt(b, 10)))
  }
  const clear = () => onChange([])

  return (
    <div className="lines-tab">
      <div className="lines-tab__header">
        <div className="lines-tab__title">Линии в Пловдив</div>
        {selected.length > 0 && (
          <button type="button" className="lines-tab__clear" onClick={clear}>
            Изчисти ({selected.length})
          </button>
        )}
      </div>
      <div className="lines-tab__grid">
        {allLines.map((line) => {
          const active = selectedSet.has(line)
          return (
            <button
              key={line}
              type="button"
              className={active ? 'line-pick line-pick--active' : 'line-pick'}
              style={
                active
                  ? { background: getLineColor(line), borderColor: getLineColor(line) }
                  : undefined
              }
              onClick={() => toggle(line)}
            >
              {line}
            </button>
          )
        })}
      </div>
      <div className="lines-tab__footer">
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
  )
}
