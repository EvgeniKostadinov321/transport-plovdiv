import { useEffect, useState } from 'react'
import type { GeoStatus } from '../hooks/useGeolocation'
import type { Favorite, Stop, Theme } from '../types'
import { FavoritesTab } from './tabs/FavoritesTab'
import { LinesTab } from './tabs/LinesTab'
import { SettingsTab } from './tabs/SettingsTab'
import { StopsTab } from './tabs/StopsTab'

export type TabId = 'lines' | 'stops' | 'favorites' | 'settings'

interface TabDef {
  id: TabId
  label: string
  icon: React.ReactNode
}

const TABS: TabDef[] = [
  {
    id: 'lines',
    label: 'Линии',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <circle cx="4" cy="6" r="1.5" />
        <circle cx="4" cy="12" r="1.5" />
        <circle cx="4" cy="18" r="1.5" />
      </svg>
    ),
  },
  {
    id: 'stops',
    label: 'Спирки',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    id: 'favorites',
    label: 'Любими',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Настройки',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
]

export function MenuDrawer({
  open,
  onClose,
  // Lines tab
  allLines,
  selectedLines,
  onChangeLines,
  visibleStopsCount,
  totalStopsCount,
  // Stops tab
  stops,
  onSelectStop,
  // Favorites tab
  favorites,
  onRemoveFavorite,
  // Settings tab
  theme,
  onToggleTheme,
  geoStatus,
  geoError,
  geoActive,
  onToggleGeo,
  // Optional: initial tab
  initialTab,
}: {
  open: boolean
  onClose: () => void
  allLines: string[]
  selectedLines: string[]
  onChangeLines: (next: string[]) => void
  visibleStopsCount: number
  totalStopsCount: number
  stops: Stop[]
  onSelectStop: (stop: Stop) => void
  favorites: Favorite[]
  onRemoveFavorite: (stopNumber: number) => void
  theme: Theme
  onToggleTheme: () => void
  geoStatus: GeoStatus
  geoError: string | null
  geoActive: boolean
  onToggleGeo: () => void
  initialTab?: TabId
}) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? 'lines')

  useEffect(() => {
    if (open && initialTab) setActiveTab(initialTab)
  }, [open, initialTab])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Меню">
        <div className="drawer__header">
          <div className="drawer__title">Меню</div>
          <button
            type="button"
            className="drawer__close"
            onClick={onClose}
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
        </div>
        <nav className="drawer__tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              className={
                activeTab === t.id ? 'drawer__tab drawer__tab--active' : 'drawer__tab'
              }
              onClick={() => setActiveTab(t.id)}
            >
              <span className="drawer__tab-icon" aria-hidden="true">
                {t.icon}
              </span>
              <span className="drawer__tab-label">{t.label}</span>
              {t.id === 'favorites' && favorites.length > 0 && (
                <span className="drawer__tab-badge">{favorites.length}</span>
              )}
              {t.id === 'lines' && selectedLines.length > 0 && (
                <span className="drawer__tab-badge">{selectedLines.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="drawer__body">
          {activeTab === 'lines' && (
            <LinesTab
              allLines={allLines}
              selected={selectedLines}
              onChange={onChangeLines}
              visibleCount={visibleStopsCount}
              totalCount={totalStopsCount}
            />
          )}
          {activeTab === 'stops' && (
            <StopsTab
              stops={stops}
              onSelectStop={(s) => {
                onSelectStop(s)
                onClose()
              }}
            />
          )}
          {activeTab === 'favorites' && (
            <FavoritesTab
              favorites={favorites}
              stops={stops}
              onSelectStop={(s) => {
                onSelectStop(s)
                onClose()
              }}
              onRemove={onRemoveFavorite}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsTab
              theme={theme}
              onToggleTheme={onToggleTheme}
              geoStatus={geoStatus}
              geoError={geoError}
              geoActive={geoActive}
              onToggleGeo={onToggleGeo}
            />
          )}
        </div>
      </div>
    </>
  )
}
