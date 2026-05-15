import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { EmptyState } from './components/EmptyState'
import { LiveStatusBanner } from './components/LiveStatusBanner'
import { LocationButton } from './components/LocationButton'
import { Map } from './components/Map'
import { MenuButton } from './components/MenuButton'
import type { TabId } from './components/MenuDrawer'

// Lazy: показват се само след user interaction → не са в initial bundle
const MenuDrawer = lazy(() =>
  import('./components/MenuDrawer').then((m) => ({ default: m.MenuDrawer }))
)
const BottomSheet = lazy(() =>
  import('./components/BottomSheet').then((m) => ({ default: m.BottomSheet }))
)
const BusTripSheet = lazy(() =>
  import('./components/BusTripSheet').then((m) => ({ default: m.BusTripSheet }))
)
const GeoIntroModal = lazy(() =>
  import('./components/GeoIntroModal').then((m) => ({ default: m.GeoIntroModal }))
)
const TripPlanner = lazy(() =>
  import('./components/TripPlanner').then((m) => ({ default: m.TripPlanner }))
)
const NavigationBar = lazy(() =>
  import('./components/NavigationBar').then((m) => ({ default: m.NavigationBar }))
)
import { useFavorites } from './hooks/useFavorites'
import { useLineTrips } from './hooks/useLineTrips'
import { useLiveVehicles } from './hooks/useLiveVehicles'
import { useGeolocation } from './hooks/useGeolocation'
import { useIsTouch } from './hooks/useIsTouch'
import { useStopsAndLines } from './hooks/useStopsAndLines'
import { useTheme } from './hooks/useTheme'
import {
  hasShownGeoIntro,
  loadSelectedLines,
  markGeoIntroShown,
  saveSelectedLines,
} from './storage'
import type { LiveVehicle, RouteOption, Stop } from './types'

function App() {
  const { stops, allLines } = useStopsAndLines()
  const [selectedLines, setSelectedLines] = useState<string[]>(loadSelectedLines)
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null)
  const [selectedVehicle, setSelectedVehicle] = useState<LiveVehicle | null>(null)
  const [tripPlannerOpen, setTripPlannerOpen] = useState(false)
  const [plannedRoute, setPlannedRoute] = useState<RouteOption | null>(null)
  /** Active navigation state. null = не сме в nav mode. */
  const [navState, setNavState] = useState<{
    route: RouteOption
    currentLegIndex: number
  } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  /** Веднъж отворено меню → остава mounted (с open=false), за да запази state. */
  const [menuEverOpened, setMenuEverOpened] = useState(false)
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
  /** При route plan филтрираме vehicles + trips по route lines, иначе по selectedLines. */
  const effectiveLines = useMemo(
    () => (plannedRoute ? [...new Set(plannedRoute.legs.flatMap((l) => l.type === 'ride' ? [l.line] : []))] : selectedLines),
    [plannedRoute, selectedLines]
  )
  const { vehicles: liveVehicles, status: liveStatus } = useLiveVehicles(effectiveLines)
  const liveTrips = useLineTrips(effectiveLines)
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

  /**
   * Когато имаме selected route, картата се филтрира към само неговите
   * stops + lines (route override). Иначе се ползва обичайният `selectedLines`
   * филтър от menu drawer-а.
   */
  const routeFilter = useMemo(() => {
    if (!plannedRoute) return null
    const lines = new Set<string>()
    const stopCodes = new Set<number>()
    for (const leg of plannedRoute.legs) {
      if (leg.type === 'ride') {
        lines.add(leg.line)
        for (const s of leg.stops) {
          const code = parseInt(s.code, 10)
          if (Number.isFinite(code)) stopCodes.add(code)
        }
      } else {
        if (leg.fromStopCode) {
          const c = parseInt(leg.fromStopCode, 10)
          if (Number.isFinite(c)) stopCodes.add(c)
        }
        if (leg.toStopCode) {
          const c = parseInt(leg.toStopCode, 10)
          if (Number.isFinite(c)) stopCodes.add(c)
        }
      }
    }
    return { lines, stopCodes }
  }, [plannedRoute])

  const selectedLinesSet = useMemo(
    () => (routeFilter ? routeFilter.lines : new Set(selectedLines)),
    [routeFilter, selectedLines]
  )
  const favoriteSet = useMemo(
    () => new Set(favorites.map((f) => f.stopNumber)),
    [favorites]
  )

  const noFilter = !routeFilter && selectedLines.length === 0
  const visibleStops = useMemo(() => {
    if (routeFilter) {
      return stops.filter((s) => routeFilter.stopCodes.has(s.number))
    }
    return noFilter
      ? stops
      : stops.filter((s) => s.lines.some((l) => selectedLinesSet.has(l)))
  }, [stops, noFilter, selectedLinesSet, routeFilter])

  const showFilteredEmptyState =
    !noFilter && stops.length > 0 && visibleStops.length === 0

  /** За всяка избрана линия — polyline-ите от livetransport (когато са fetched). */
  const routeGeometries = useMemo(() => {
    return selectedLines
      .map((line) => ({
        line,
        routes: (liveTrips.get(line) ?? []).map((t) => ({ coords: t.coords })),
      }))
      .filter((g) => g.routes.length > 0)
  }, [selectedLines, liveTrips])

  const openMenu = (tab?: TabId) => {
    setMenuInitialTab(tab)
    setMenuOpen(true)
    setMenuEverOpened(true)
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
        followUser={navState !== null}
        favoriteSet={favoriteSet}
        liveVehicles={liveVehicles}
        routeGeometries={routeGeometries}
        plannedRoute={plannedRoute}
        onSelectStop={(s) => {
          setSelectedVehicle(null)
          setSelectedStop(s)
        }}
        onSelectVehicle={(v) => {
          setSelectedStop(null)
          setSelectedVehicle(v)
        }}
        onFocusHandled={() => setFocusStop(null)}
        onToggleFavorite={toggleFavorite}
      />
      <LiveStatusBanner stale={liveStatus === 'stale'} />
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
      <button
        type="button"
        className="trip-fab"
        onClick={() => setTripPlannerOpen(true)}
        aria-label="Планирай пътуване"
        title="Планирай пътуване"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="10" r="3" />
          <path d="M12 2a8 8 0 0 0-8 8c0 5.5 8 12 8 12s8-6.5 8-12a8 8 0 0 0-8-8z" />
        </svg>
      </button>
      <Suspense fallback={null}>
        {menuEverOpened && (
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
        {selectedVehicle && (
          <BusTripSheet
            vehicle={
              liveVehicles.find((v) => v.id === selectedVehicle.id) ??
              selectedVehicle
            }
            onClose={() => setSelectedVehicle(null)}
          />
        )}
        {tripPlannerOpen && !navState && (
          <TripPlanner
            geo={geo.position}
            selectedOption={plannedRoute}
            onSelectOption={setPlannedRoute}
            onClose={() => {
              setTripPlannerOpen(false)
              setPlannedRoute(null)
            }}
            onStartNavigation={(opt) => {
              setPlannedRoute(opt)
              setNavState({ route: opt, currentLegIndex: 0 })
              setTripPlannerOpen(false)
              // Auto-activate GPS ако не е активен
              if (!geo.active && hasShownGeoIntro()) geo.toggle()
            }}
          />
        )}
        {navState && (
          <NavigationBar
            route={navState.route}
            currentLegIndex={navState.currentLegIndex}
            onAdvance={() => {
              setNavState((s) => {
                if (!s) return s
                if (s.currentLegIndex >= s.route.legs.length - 1) {
                  // last → end
                  return null
                }
                return { ...s, currentLegIndex: s.currentLegIndex + 1 }
              })
            }}
            onPrev={() => {
              setNavState((s) =>
                s && s.currentLegIndex > 0
                  ? { ...s, currentLegIndex: s.currentLegIndex - 1 }
                  : s
              )
            }}
            onEnd={() => {
              setNavState(null)
              setPlannedRoute(null)
            }}
          />
        )}
      </Suspense>
      {showFilteredEmptyState && (
        <EmptyState onClearFilter={() => setSelectedLines([])} />
      )}
    </>
  )
}

export default App
