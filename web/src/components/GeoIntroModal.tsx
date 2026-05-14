import { useEffect } from 'react'

/**
 * Custom модал който обяснява value-то на geolocation преди browser permission prompt-а.
 * Показва се само първи път (преди user-ът да е виждал browser prompt-а).
 */
export function GeoIntroModal({
  onAllow,
  onDismiss,
}: {
  onAllow: () => void
  onDismiss: () => void
}) {
  // ESC за close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onDismiss])

  return (
    <>
      <div
        className="geo-intro-backdrop"
        onClick={onDismiss}
        aria-hidden="true"
      />
      <div
        className="geo-intro"
        role="dialog"
        aria-modal="true"
        aria-labelledby="geo-intro-title"
      >
        <button
          type="button"
          className="geo-intro__close"
          onClick={onDismiss}
          aria-label="Затвори"
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="geo-intro__illustration" aria-hidden="true">
          <svg
            width="120"
            height="120"
            viewBox="0 0 120 120"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Pulse rings */}
            <circle cx="60" cy="60" r="50" fill="var(--accent-soft)" opacity="0.4">
              <animate
                attributeName="r"
                from="35"
                to="50"
                dur="2s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                from="0.6"
                to="0"
                dur="2s"
                repeatCount="indefinite"
              />
            </circle>
            <circle cx="60" cy="60" r="40" fill="var(--accent-soft)" opacity="0.5" />
            {/* Pin shape */}
            <path
              d="M60 28C49 28 40 37 40 48C40 64 60 88 60 88C60 88 80 64 80 48C80 37 71 28 60 28Z"
              fill="var(--accent)"
            />
            <circle cx="60" cy="48" r="7" fill="#fff" />
          </svg>
        </div>

        <h2 id="geo-intro-title" className="geo-intro__title">
          Покажи къде си на картата
        </h2>
        <p className="geo-intro__desc">
          Разреши достъп до локацията си, за да:
        </p>

        <ul className="geo-intro__benefits">
          <li>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Виждаш близки спирки около теб</span>
          </li>
          <li>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Картата се центрира автоматично</span>
          </li>
          <li>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Винаги да знаеш кое е най-близо</span>
          </li>
        </ul>

        <div className="geo-intro__privacy">
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
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>
            Локацията се ползва само от твоя браузър. Не я споделяме с никого.
          </span>
        </div>

        <button
          type="button"
          className="geo-intro__cta"
          onClick={onAllow}
          autoFocus
        >
          Включи локация
        </button>
      </div>
    </>
  )
}
