import { useEffect, useRef } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import { MapContainer, TileLayer, useMap, CircleMarker, Polyline, Popup } from 'react-leaflet'
import { DEFAULT_ZOOM, PLOVDIV_CENTER, tileUrlForTheme } from '../config'
import type {
  GeoPosition,
  LiveVehicle,
  RouteGeometry,
  Stop,
  Theme,
} from '../types'
import { getLineColor, getStopColor, shadeColor } from '../colors'
import { BusMarker } from './BusMarker'
import { StopMarker } from './StopMarker'
import { StopPopupContent } from './StopPopupContent'
import { UserLocationMarker } from './UserLocationMarker'
import { fetchETA } from '../api'

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
  liveVehicles,
  routeGeometries,
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
  liveVehicles: LiveVehicle[]
  /** За всяка избрана линия - всичките й directions с polyline coords. */
  routeGeometries: { line: string; routes: RouteGeometry[] }[]
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
      {/* Route polylines - под спирките */}
      {routeGeometries.map(({ line, routes }) => {
        const base = getLineColor(line)
        return routes.map((route, ri) => {
          // ri=0 светъл нюанс (плътна линия); ri=1 тъмен нюанс (dashed);
          // ri>=2 (рядко: линии 9/18/93 имат алтернативни маршрути) → base color
          const color =
            ri === 0 ? shadeColor(base, 0.25) : ri === 1 ? shadeColor(base, -0.3) : base
          const dashArray = ri === 1 ? '10, 8' : undefined
          return (
            <Polyline
              key={`${line}-${route.osmId}-${ri}`}
              positions={route.coords}
              pathOptions={{
                color,
                weight: 4,
                opacity: 0.7,
                lineCap: 'round',
                lineJoin: 'round',
                dashArray,
              }}
              interactive={false}
            />
          )
        })
      })}
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
      {liveVehicles.map((v) => (
        <BusMarker key={v.id} vehicle={v} />
      ))}
    </MapContainer>
  )
}
