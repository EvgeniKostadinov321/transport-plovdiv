import { getLineColor } from '../colors'

export function MenuButton({
  selectedLines,
  hasFilter,
  onClick,
}: {
  selectedLines: string[]
  hasFilter: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="menu-btn"
      onClick={onClick}
      aria-label="Меню"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
      {hasFilter && (
        <span className="menu-btn__chips" aria-hidden="true">
          {selectedLines.slice(0, 3).map((l) => (
            <span
              key={l}
              className="menu-btn__chip"
              style={{ background: getLineColor(l) }}
            >
              {l}
            </span>
          ))}
          {selectedLines.length > 3 && (
            <span className="menu-btn__chip menu-btn__chip--more">
              +{selectedLines.length - 3}
            </span>
          )}
        </span>
      )}
    </button>
  )
}
