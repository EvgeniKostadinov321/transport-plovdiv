import { useEffect, useRef } from 'react'
import type { Map as LeafletMap, CircleMarker as LeafletCircleMarker } from 'leaflet'
import { MapContainer, TileLayer, useMap, CircleMarker, Popup } from 'react-leaflet'
import { DEFAULT_ZOOM, PLOVDIV_CENTER, tileUrlForTheme } from '../config'
import type { Stop, Theme } from '../types'
import { StopMarker } from './StopMarker'
import { StopPopupContent } from './StopPopupContent'
import { fetchETA } from '../api'
import { getStopColor } from '../colors'

/**
 * Inner component с достъп до map instance.
 * Прави flyTo + open popup когато focusStop се промени.
 */
function MapFocusController({
  focusStop,
  isTouch,
  onFocusHandled,
}: {
  focusStop: Stop | null
  isTouch: boolean
  onFocusHandled: () => void
}) {
  const map = useMap()
  useEffect(() => {
    if (!focusStop) return
    const targetZoom = Math.max(map.getZoom(), 15)
    map.flyTo([focusStop.lat, focusStop.lng], targetZoom, { duration: 0.6 })
    onFocusHandled()
    void isTouch
  }, [focusStop, map, isTouch, onFocusHandled])
  return null
}

/**
 * Ad-hoc marker за focused stop (от search) - винаги се показва дори когато
 * филтърът би го скрил. Auto-opens popup на desktop.
 */
function FocusMarker({
  stop,
  filterLines,
  isTouch,
  onSelect,
}: {
  stop: Stop
  filterLines: Set<string>
  isTouch: boolean
  onSelect: (stop: Stop) => void
}) {
  const markerRef = useRef<LeafletCircleMarker | null>(null)

  // Auto-open popup на desktop
  useEffect(() => {
    if (isTouch) return
    const t = setTimeout(() => {
      markerRef.current?.openPopup()
    }, 700)
    return () => clearTimeout(t)
  }, [stop.number, isTouch])

  const color = getStopColor(stop.lines, filterLines)
  return (
    <CircleMarker
      ref={markerRef}
      center={[stop.lat, stop.lng]}
      radius={9}
      pathOptions={{
        fillColor: color,
        fillOpacity: 1,
        color: '#fff',
        weight: 3,
      }}
      eventHandlers={{
        click: () => {
          if (isTouch) {
            fetchETA(stop.number).catch(() => {})
            onSelect(stop)
          }
        },
      }}
    >
      {!isTouch && (
        <Popup>
          <StopPopupContent stop={stop} filterLines={filterLines} />
        </Popup>
      )}
    </CircleMarker>
  )
}

export function Map({
  stops,
  filterLines,
  theme,
  isTouch,
  focusStop,
  onSelectStop,
  onFocusHandled,
}: {
  stops: Stop[]
  filterLines: Set<string>
  theme: Theme
  isTouch: boolean
  focusStop: Stop | null
  onSelectStop: (stop: Stop) => void
  onFocusHandled: () => void
}) {
  const mapRef = useRef<LeafletMap | null>(null)

  /** Когато се focus-не stop който не е в visible списъка - все пак го показваме като extra marker. */
  const focusInVisible = focusStop
    ? stops.some((s) => s.number === focusStop.number && s.lat === focusStop.lat)
    : true

  return (
    <MapContainer
      center={PLOVDIV_CENTER}
      zoom={DEFAULT_ZOOM}
      className="map-root"
      zoomControl={!isTouch}
      attributionControl={false}
      ref={(m) => {
        mapRef.current = m
      }}
    >
      <TileLayer url={tileUrlForTheme(theme)} key={theme} />
      {stops.map((stop) => {
        const isFocused =
          !!focusStop &&
          focusStop.number === stop.number &&
          focusStop.lat === stop.lat
        return (
          <StopMarker
            key={`${stop.number}-${stop.lat}-${stop.lng}`}
            stop={stop}
            isTouch={isTouch}
            filterLines={filterLines}
            autoOpenPopup={isFocused}
            onSelect={onSelectStop}
          />
        )
      })}
      {focusStop && !focusInVisible && (
        <FocusMarker
          stop={focusStop}
          filterLines={filterLines}
          isTouch={isTouch}
          onSelect={onSelectStop}
        />
      )}
      {focusStop && (
        <MapFocusController
          focusStop={focusStop}
          isTouch={isTouch}
          onFocusHandled={onFocusHandled}
        />
      )}
    </MapContainer>
  )
}
