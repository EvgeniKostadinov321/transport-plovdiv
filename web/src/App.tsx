import { useEffect, useMemo, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { BottomSheet } from './components/BottomSheet'
import { EmptyState } from './components/EmptyState'
import { LineSelector } from './components/LineSelector'
import { Map } from './components/Map'
import { useIsTouch } from './hooks/useIsTouch'
import { useStopsAndLines } from './hooks/useStopsAndLines'
import { useTheme } from './hooks/useTheme'
import { loadSelectedLines, saveSelectedLines } from './storage'
import type { Stop } from './types'

function App() {
  const { stops, allLines } = useStopsAndLines()
  const [selectedLines, setSelectedLines] = useState<string[]>(loadSelectedLines)
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null)
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

  const showEmptyState =
    !noFilter && stops.length > 0 && visibleStops.length === 0

  return (
    <>
      <Map
        stops={visibleStops}
        filterLines={selectedLinesSet}
        theme={theme}
        isTouch={isTouch}
        onSelectStop={setSelectedStop}
      />
      <LineSelector
        allLines={allLines}
        selected={selectedLines}
        visibleCount={visibleStops.length}
        totalCount={stops.length}
        onChange={setSelectedLines}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      {showEmptyState && <EmptyState onClearFilter={() => setSelectedLines([])} />}
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
