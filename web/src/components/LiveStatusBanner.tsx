import { useEffect, useState } from 'react'

/**
 * Banner показван когато SSE feed-ът не получава updates повече от
 * STALE_THRESHOLD_MS (виж useLiveVehicles). Dismiss-ва се само за текущата
 * stale период — ако live данните се възстановят и след това отново станат
 * stale, banner-ът се появява пак.
 */
export function LiveStatusBanner({ stale }: { stale: boolean }) {
  const [dismissed, setDismissed] = useState(false)

  // Reset dismissal когато статусът отново стане live → следваща stale период
  // ще покаже banner-а наново
  useEffect(() => {
    if (!stale) setDismissed(false)
  }, [stale])

  if (!stale || dismissed) return null

  return (
    <div className="live-status-banner" role="status">
      <svg
        className="live-status-banner__icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span className="live-status-banner__text">
        Live GPS feed-ът не отговаря. Позициите може да са остарели.
      </span>
      <button
        type="button"
        className="live-status-banner__close"
        onClick={() => setDismissed(true)}
        aria-label="Скрий"
      >
        ✕
      </button>
    </div>
  )
}
