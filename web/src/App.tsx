import { useEffect, useMemo, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { BottomSheet } from './components/BottomSheet'
import { EmptyState } from './components/EmptyState'
import { Map } from './components/Map'
import { MenuButton } from './components/MenuButton'
import { MenuDrawer } from './components/MenuDrawer'
import { useIsTouch } from './hooks/useIsTouch'
import { useStopsAndLines } from './hooks/useStopsAndLines'
import { useTheme } from './hooks/useTheme'
import { loadSelectedLines, saveSelectedLines } from './storage'
import type { Stop } from './types'

function App() {
  const { stops, allLines } = useStopsAndLines()
  const [selectedLines, setSelectedLines] = useState<string[]>(loadSelectedLines)
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  /** Спирка която Map-а ще focus-не (flyTo + open popup). От search results. */
  const [focusStop, setFocusStop] = useState<Stop | null>(null)
  const [theme, toggleTheme] = useTheme()
  const isTouch = useIsTouch()

  useEffect(() => {
    saveSelectedLines(selectedLines)
  }, [selectedLines])

  const selectedLinesSet = useMemo(() => new Set(selectedLines), [selectedLines])
  const noFilter = selectedLines.length === 0
  const visibleStops = useMemo(
    () =>
      noFilter
        ? stops
        : stops.filter((s) => s.lines.some((l) => selectedLinesSet.has(l))),
    [stops, noFilter, selectedLinesSet]
  )

  const showEmptyState = !noFilter && stops.length > 0 && visibleStops.length === 0

  const handleSelectFromSearch = (stop: Stop) => {
    // Прескачаме filter ако е скрит → го показваме като focused марker
    setFocusStop(stop)
    if (isTouch) {
      // Mobile: отваряме bottom sheet директно
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
        onSelectStop={setSelectedStop}
        onFocusHandled={() => setFocusStop(null)}
      />
      <MenuButton
        selectedLines={selectedLines}
        hasFilter={!noFilter}
        onClick={() => setMenuOpen(true)}
      />
      <MenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        allLines={allLines}
        selectedLines={selectedLines}
        onChangeLines={setSelectedLines}
        visibleStopsCount={visibleStops.length}
        totalStopsCount={stops.length}
        stops={stops}
        onSelectStop={handleSelectFromSearch}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      {showEmptyState && (
        <EmptyState onClearFilter={() => setSelectedLines([])} />
      )}
      {isTouch && selectedStop && (
        <BottomSheet
          stop={selectedStop}
          filterLines={selectedLinesSet}
          onClose={() => setSelectedStop(null)}
        />
      )}
    </>
  )
}

export default App
