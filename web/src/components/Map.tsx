import { useEffect, useRef } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import { MapContainer, TileLayer, useMap, CircleMarker, Popup } from 'react-leaflet'
import { DEFAULT_ZOOM, PLOVDIV_CENTER, tileUrlForTheme } from '../config'
import type { GeoPosition, Stop, Theme } from '../types'
import { StopMarker } from './StopMarker'
import { StopPopupContent } from './StopPopupContent'
import { UserLocationMarker } from './UserLocationMarker'
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
 * Първо location fix → center map. След това не пипаме.
 * recenterToken се сменя когато user натиска location button → forced flyTo.
 */
function UserLocationCentering({
  position,
  recenterToken,
}: {
  position: GeoPosition | null
  recenterToken: number
}) {
  const map = useMap()
  const centeredOnceRef = useRef(false)
  const lastTokenRef = useRef(recenterToken)

  useEffect(() => {
    if (!position) return
    const shouldRecenter =
      !centeredOnceRef.current || recenterToken !== lastTokenRef.current
    if (!shouldRecenter) return
    map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), 15), {
      duration: 0.6,
    })
    centeredOnceRef.current = true
    lastTokenRef.current = recenterToken
  }, [position, map, recenterToken])
  return null
}

/**
 * Ad-hoc marker за focused stop (от search) - винаги се показва дори когато
 * филтърът би го скрил.
 */
function FocusMarker({
  stop,
  filterLines,
  isTouch,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: {
  stop: Stop
  filterLines: Set<string>
  isTouch: boolean
  isFavorite: boolean
  onSelect: (stop: Stop) => void
  onToggleFavorite: (stopNumber: number) => void
}) {
  const color = getStopColor(stop.lines, filterLines)
  return (
    <>
      {isFavorite && (
        <CircleMarker
          center={[stop.lat, stop.lng]}
          radius={13}
          pathOptions={{
            fillOpacity: 0,
            color: '#f5b400',
            weight: 3,
          }}
          interactive={false}
        />
      )}
      <CircleMarker
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
            <StopPopupContent
              stop={stop}
              filterLines={filterLines}
              isFavorite={isFavorite}
              onToggleFavorite={onToggleFavorite}
            />
          </Popup>
        )}
      </CircleMarker>
    </>
  )
}

export function Map({
  stops,
  filterLines,
  theme,
  isTouch,
  focusStop,
  userPosition,
  userRecenterToken,
  favoriteSet,
  onSelectStop,
  onFocusHandled,
  onToggleFavorite,
}: {
  stops: Stop[]
  filterLines: Set<string>
  theme: Theme
  isTouch: boolean
  focusStop: Stop | null
  userPosition: GeoPosition | null
  userRecenterToken: number
  favoriteSet: Set<number>
  onSelectStop: (stop: Stop) => void
  onFocusHandled: () => void
  onToggleFavorite: (stopNumber: number) => void
}) {
  const mapRef = useRef<LeafletMap | null>(null)

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
            isFavorite={favoriteSet.has(stop.number)}
            onSelect={onSelectStop}
            onToggleFavorite={onToggleFavorite}
          />
        )
      })}
      {focusStop && !focusInVisible && (
        <FocusMarker
          stop={focusStop}
          filterLines={filterLines}
          isTouch={isTouch}
          isFavorite={favoriteSet.has(focusStop.number)}
          onSelect={onSelectStop}
          onToggleFavorite={onToggleFavorite}
        />
      )}
      {focusStop && (
        <MapFocusController
          focusStop={focusStop}
          isTouch={isTouch}
          onFocusHandled={onFocusHandled}
        />
      )}
      {userPosition && <UserLocationMarker position={userPosition} />}
      <UserLocationCentering
        position={userPosition}
        recenterToken={userRecenterToken}
      />
    </MapContainer>
  )
}
