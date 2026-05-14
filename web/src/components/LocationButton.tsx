import type { GeoStatus } from '../hooks/useGeolocation'

/**
 * Кратък локационен бутон до menu иконата.
 *
 * States:
 *   - idle / not granted yet → click отваря custom permission модал
 *   - tracking → зелен person icon, center map
 *   - denied / error → червен warning, click → retry
 */
export function LocationButton({
  status,
  active,
  onClick,
}: {
  status: GeoStatus
  active: boolean
  onClick: () => void
}) {
  const isDenied = status === 'denied' || status === 'error'

  return (
    <button
      type="button"
      className={
        active
          ? 'location-btn location-btn--active'
          : isDenied
            ? 'location-btn location-btn--denied'
            : 'location-btn'
      }
      onClick={onClick}
      aria-label={active ? 'Центрирай моята позиция' : 'Покажи моята позиция'}
      title={active ? 'Центрирай моята позиция' : 'Покажи моята позиция'}
    >
      {active ? (
        // Green person icon (active state)
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="7" r="3.5" />
          <path d="M5 22c0-4 3-7 7-7s7 3 7 7" />
        </svg>
      ) : isDenied ? (
        // Crossed circle for denied/error
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
      ) : (
        // Crosshair / target (idle)
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3" />
          <line x1="12" y1="1" x2="12" y2="4" />
          <line x1="12" y1="20" x2="12" y2="23" />
          <line x1="1" y1="12" x2="4" y2="12" />
          <line x1="20" y1="12" x2="23" y2="12" />
        </svg>
      )}
    </button>
  )
}
