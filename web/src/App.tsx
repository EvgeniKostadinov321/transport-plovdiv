import { useEffect, useMemo, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { BottomSheet } from './components/BottomSheet'
import { EmptyState } from './components/EmptyState'
import { GeoIntroModal } from './components/GeoIntroModal'
import { LocationButton } from './components/LocationButton'
import { Map } from './components/Map'
import { MenuButton } from './components/MenuButton'
import { MenuDrawer, type TabId } from './components/MenuDrawer'
import { useFavorites } from './hooks/useFavorites'
import { useLiveVehicles } from './hooks/useLiveVehicles'
import { useGeolocation } from './hooks/useGeolocation'
import { useIsTouch } from './hooks/useIsTouch'
import { useRouteGeometry } from './hooks/useRouteGeometry'
import { useStopsAndLines } from './hooks/useStopsAndLines'
import { useTheme } from './hooks/useTheme'
import {
  hasShownGeoIntro,
  loadSelectedLines,
  markGeoIntroShown,
  saveSelectedLines,
} from './storage'
import type { Stop } from './types'

function App() {
  const { stops, allLines } = useStopsAndLines()
  const [selectedLines, setSelectedLines] = useState<string[]>(loadSelectedLines)
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuInitialTab, setMenuInitialTab] = useState<TabId | undefined>(undefined)
  /** Спирка която Map-а ще focus-не (flyTo + open popup). */
  const [focusStop, setFocusStop] = useState<Stop | null>(null)
  const [theme, toggleTheme] = useTheme()
  const isTouch = useIsTouch()
  const {
    favorites,
    isFavorite,
    toggleFavorite,
    removeFavorite,
  } = useFavorites()
  const geo = useGeolocation()
  const liveVehicles = useLiveVehicles(selectedLines)
  const routeGeometryData = useRouteGeometry(selectedLines.length > 0)
  // Показваме модала автоматично при първо влизане
  const [showGeoIntro, setShowGeoIntro] = useState(() => !hasShownGeoIntro())
  /** Token се сменя при click на location button - заставя Map да re-center. */
  const [userRecenterToken, setUserRecenterToken] = useState(0)

  /**
   * Click on location button:
   *   - Already tracking → re-center map to position
   *   - Idle → show intro modal (if first time) else start
   *   - Denied → show modal again (explain how to enable)
   */
  const handleLocationClick = () => {
    if (geo.active) {
      // Recenter
      setUserRecenterToken((t) => t + 1)
      return
    }
    if (geo.status === 'denied' || geo.status === 'error' || !hasShownGeoIntro()) {
      setShowGeoIntro(true)
    } else {
      geo.toggle()
    }
  }

  /**
   * Settings tab toggle - същата логика като location button.
   */
  const handleToggleGeo = () => {
    if (geo.active) {
      geo.toggle()
      return
    }
    if (!hasShownGeoIntro()) {
      setShowGeoIntro(true)
    } else {
      geo.toggle()
    }
  }

  const handleGeoIntroAllow = () => {
    markGeoIntroShown()
    setShowGeoIntro(false)
    if (!geo.active) geo.toggle()
  }

  const handleGeoIntroDismiss = () => {
    markGeoIntroShown()
    setShowGeoIntro(false)
  }

  useEffect(() => {
    saveSelectedLines(selectedLines)
  }, [selectedLines])

  const selectedLinesSet = useMemo(() => new Set(selectedLines), [selectedLines])
  const favoriteSet = useMemo(
    () => new Set(favorites.map((f) => f.stopNumber)),
    [favorites]
  )

  const noFilter = selectedLines.length === 0
  const visibleStops = useMemo(
    () =>
      noFilter
        ? stops
        : stops.filter((s) => s.lines.some((l) => selectedLinesSet.has(l))),
    [stops, noFilter, selectedLinesSet]
  )

  const showEmptyState =
    !noFilter && stops.length > 0 && visibleStops.length === 0

  /** За всяка избрана линия - вземаме geometry-та й (или празно ако още не е заредено). */
  const routeGeometries = useMemo(() => {
    if (!routeGeometryData) return []
    return selectedLines
      .map((line) => ({
        line,
        routes: routeGeometryData.lines[line] ?? [],
      }))
      .filter((g) => g.routes.length > 0)
  }, [selectedLines, routeGeometryData])

  const openMenu = (tab?: TabId) => {
    setMenuInitialTab(tab)
    setMenuOpen(true)
  }

  const handleSelectFromSearch = (stop: Stop) => {
    setFocusStop(stop)
    if (isTouch) {
      setSelectedStop(stop)
    }
  }

  return (
    <>
      <Map
        stops={visibleStops}
        filterLines={selectedLinesSet}
        theme={theme}
        isTouch={isTouch}
        focusStop={focusStop}
        userPosition={geo.position}
        userRecenterToken={userRecenterToken}
        favoriteSet={favoriteSet}
        liveVehicles={liveVehicles}
        routeGeometries={routeGeometries}
        onSelectStop={setSelectedStop}
        onFocusHandled={() => setFocusStop(null)}
        onToggleFavorite={toggleFavorite}
      />
      <div className="top-controls">
        <LocationButton
          status={geo.status}
          active={geo.active}
          onClick={handleLocationClick}
        />
        <MenuButton
          selectedLines={selectedLines}
          hasFilter={!noFilter}
          favoritesCount={favorites.length}
          geoActive={geo.active}
          onClick={() => openMenu()}
        />
      </div>
      <MenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        initialTab={menuInitialTab}
        allLines={allLines}
        selectedLines={selectedLines}
        onChangeLines={setSelectedLines}
        visibleStopsCount={visibleStops.length}
        totalStopsCount={stops.length}
        stops={stops}
        onSelectStop={handleSelectFromSearch}
        favorites={favorites}
        onRemoveFavorite={removeFavorite}
        theme={theme}
        onToggleTheme={toggleTheme}
        geoStatus={geo.status}
        geoError={geo.error}
        geoActive={geo.active}
        onToggleGeo={handleToggleGeo}
      />
      {showEmptyState && (
        <EmptyState onClearFilter={() => setSelectedLines([])} />
      )}
      {showGeoIntro && (
        <GeoIntroModal
          onAllow={handleGeoIntroAllow}
          onDismiss={handleGeoIntroDismiss}
        />
      )}
      {isTouch && selectedStop && (
        <BottomSheet
          stop={selectedStop}
          filterLines={selectedLinesSet}
          isFavorite={isFavorite(selectedStop.number)}
          onToggleFavorite={toggleFavorite}
          onClose={() => setSelectedStop(null)}
        />
      )}
    </>
  )
}

export default App
