export function EmptyState({ onClearFilter }: { onClearFilter: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">🚏</div>
      <div className="empty-state__title">Няма спирки</div>
      <div className="empty-state__msg">
        За избраните линии не намерихме спирки. Опитай с други.
      </div>
      <button type="button" className="empty-state__btn" onClick={onClearFilter}>
        Изчисти филтъра
      </button>
    </div>
  )
}
