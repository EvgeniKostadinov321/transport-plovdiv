import { useEffect } from 'react'
import type { Stop } from '../types'
import { StopPopupContent } from './StopPopupContent'

export function BottomSheet({
  stop,
  filterLines,
  isFavorite,
  onToggleFavorite,
  onClose,
}: {
  stop: Stop
  filterLines: Set<string>
  isFavorite?: boolean
  onToggleFavorite?: (stopNumber: number) => void
  onClose: () => void
}) {
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
        <StopPopupContent
          stop={stop}
          filterLines={filterLines}
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
        />
      </div>
    </>
  )
}
