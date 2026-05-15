import { useEffect, useMemo, useRef } from 'react'
import L, { type Map as LeafletMap } from 'leaflet'
import { MapContainer, TileLayer, useMap, CircleMarker, Polyline, Popup } from 'react-leaflet'
import { DEFAULT_ZOOM, PLOVDIV_CENTER, tileUrlForTheme } from '../config'
import type {
  GeoPosition,
  LiveVehicle,
  RouteOption,
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
  followMode,
}: {
  position: GeoPosition | null
  recenterToken: number
  followMode: boolean
}) {
  const map = useMap()
  const centeredOnceRef = useRef(false)
  const lastTokenRef = useRef(recenterToken)

  useEffect(() => {
    if (!position) return
    // Three triggers за re-center:
    // 1) Първо позициониране след startup
    // 2) Manual click на location button (token change)
    // 3) Follow mode active (за navigation) — на всяка позиция
    const shouldRecenter =
      !centeredOnceRef.current ||
      recenterToken !== lastTokenRef.current ||
      followMode
    if (!shouldRecenter) return
    map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), 16), {
      duration: followMode ? 0.4 : 0.6,
    })
    centeredOnceRef.current = true
    lastTokenRef.current = recenterToken
  }, [position, map, recenterToken, followMode])
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

/**
 * Render-ва избран trip-plan маршрут върху картата:
 * - ride legs като дебели цветни линии (line color)
 * - walk legs като пунктирани сиви линии
 * - origin (green dot) + destination (red dot) markers
 * Auto-fit към bounds-а при mount/change.
 */
function PlannedRouteOverlay({ route }: { route: RouteOption }) {
  const map = useMap()

  const segments = useMemo(() => {
    const out: { coords: [number, number][]; color: string; dashed: boolean; line?: string }[] = []
    let originCoord: [number, number] | null = null
    let destCoord: [number, number] | null = null
    for (const leg of route.legs) {
      if (leg.type === 'walk') {
        const from = leg.fromCoord ?? null
        const to = leg.toCoord ?? null
        if (leg.kind === 'access' && from) originCoord = from
        if (leg.kind === 'egress' && to) destCoord = to
        // Walk leg between two known points
        const a = from
        const b = to
        if (a && b) {
          out.push({ coords: [a, b], color: '#9ca3af', dashed: true })
        }
      } else {
        const coords: [number, number][] = leg.stops.map((s) => [s.lat, s.lng])
        if (coords.length >= 2) {
          out.push({ coords, color: getLineColor(leg.line), dashed: false, line: leg.line })
        }
      }
    }
    return { out, originCoord, destCoord }
  }, [route])

  useEffect(() => {
    const bounds = L.latLngBounds([])
    for (const seg of segments.out) for (const c of seg.coords) bounds.extend(c)
    if (segments.originCoord) bounds.extend(segments.originCoord)
    if (segments.destCoord) bounds.extend(segments.destCoord)
    if (bounds.isValid()) {
      map.flyToBounds(bounds, { padding: [60, 60], duration: 0.6, maxZoom: 16 })
    }
  }, [segments, map])

  return (
    <>
      {segments.out.map((seg, i) => (
        <Polyline
          key={i}
          positions={seg.coords}
          pathOptions={{
            color: seg.color,
            weight: seg.dashed ? 4 : 6,
            opacity: seg.dashed ? 0.7 : 0.9,
            dashArray: seg.dashed ? '4, 8' : undefined,
            lineCap: 'round',
            lineJoin: 'round',
          }}
          interactive={false}
        />
      ))}
      {segments.originCoord && (
        <CircleMarker
          center={segments.originCoord}
          radius={9}
          pathOptions={{ fillColor: '#10b981', fillOpacity: 1, color: '#fff', weight: 3 }}
          interactive={false}
        />
      )}
      {segments.destCoord && (
        <CircleMarker
          center={segments.destCoord}
          radius={9}
          pathOptions={{ fillColor: '#ef4444', fillOpacity: 1, color: '#fff', weight: 3 }}
          interactive={false}
        />
      )}
    </>
  )
}

/**
 * Цветен dot за preview на from/to преди да е изчислен маршрут.
 * При autoFit пан-ва картата към тази точка (или прави bounds-fit ако имаме
 * двойка).
 */
function TripPreviewMarker({
  coord,
  color,
  autoFit,
  pairWith,
}: {
  coord: [number, number]
  color: string
  autoFit?: boolean
  pairWith?: [number, number] | null
}) {
  const map = useMap()
  // Извличаме примитивни стойности — dependency-ите ползват тях, не array
  // reference (App pass-ва нов array всеки render → би причинило fly спам).
  const lat = coord[0]
  const lng = coord[1]
  const pairLat = pairWith?.[0]
  const pairLng = pairWith?.[1]
  useEffect(() => {
    if (!autoFit) return
    if (pairLat !== undefined && pairLng !== undefined) {
      const bounds = L.latLngBounds([
        [lat, lng],
        [pairLat, pairLng],
      ])
      map.flyToBounds(bounds, { padding: [80, 80], duration: 0.6, maxZoom: 15 })
    } else {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { duration: 0.5 })
    }
  }, [lat, lng, pairLat, pairLng, autoFit, map])
  return (
    <CircleMarker
      center={[lat, lng]}
      radius={10}
      pathOptions={{ fillColor: color, fillOpacity: 1, color: '#fff', weight: 3 }}
      interactive={false}
    />
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
  followUser,
  favoriteSet,
  liveVehicles,
  routeGeometries,
  plannedRoute,
  tripPreviewFrom,
  tripPreviewTo,
  onSelectStop,
  onSelectVehicle,
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
  /** Когато е true, картата auto-pan-ва към user position при всяка update (navigation mode). */
  followUser: boolean
  favoriteSet: Set<number>
  liveVehicles: LiveVehicle[]
  /** За всяка избрана линия - polyline coords per direction. */
  routeGeometries: { line: string; routes: { coords: [number, number][] }[] }[]
  /** Текущо избран маршрут от trip planner-а — render-ва се отгоре. */
  plannedRoute: RouteOption | null
  /** Preview marker за from/to когато trip planner е отворен но route не е намерен. */
  tripPreviewFrom: [number, number] | null
  tripPreviewTo: [number, number] | null
  onSelectStop: (stop: Stop) => void
  onSelectVehicle: (vehicle: LiveVehicle) => void
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
              key={`${line}-${ri}`}
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
        followMode={followUser}
      />
      {liveVehicles.map((v) => (
        <BusMarker key={v.id} vehicle={v} onSelect={onSelectVehicle} />
      ))}
      {plannedRoute && <PlannedRouteOverlay route={plannedRoute} />}
      {!plannedRoute && tripPreviewFrom && (
        <TripPreviewMarker coord={tripPreviewFrom} color="#10b981" autoFit={!tripPreviewTo} />
      )}
      {!plannedRoute && tripPreviewTo && (
        <TripPreviewMarker
          coord={tripPreviewTo}
          color="#ef4444"
          autoFit
          pairWith={tripPreviewFrom}
        />
      )}
    </MapContainer>
  )
}
