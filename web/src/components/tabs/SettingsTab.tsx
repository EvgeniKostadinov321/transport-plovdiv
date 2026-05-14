import type { Theme } from '../../types'

export function SettingsTab({
  theme,
  onToggleTheme,
}: {
  theme: Theme
  onToggleTheme: () => void
}) {
  return (
    <div className="settings-tab">
      <div className="settings-section">
        <div className="settings-section__title">Външен вид</div>
        <div className="settings-row">
          <div className="settings-row__label">
            <div className="settings-row__name">Тъмен режим</div>
            <div className="settings-row__desc">
              Картата и интерфейсът в тъмни цветове.
            </div>
          </div>
          <button
            type="button"
            className={
              theme === 'dark' ? 'toggle-switch toggle-switch--on' : 'toggle-switch'
            }
            onClick={onToggleTheme}
            aria-label="Тъмен режим"
            role="switch"
            aria-checked={theme === 'dark'}
          >
            <span className="toggle-switch__handle" />
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">За приложението</div>
        <div className="settings-info">
          <div>Transport Plovdiv</div>
          <div className="settings-info__sub">
            Данни от{' '}
            <a
              href="http://transport.plovdiv.bg/desktop/"
              target="_blank"
              rel="noopener noreferrer"
            >
              виртуалното табло
            </a>{' '}
            на Община Пловдив.
          </div>
        </div>
      </div>
    </div>
  )
}
