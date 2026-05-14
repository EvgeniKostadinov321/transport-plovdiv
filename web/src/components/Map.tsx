import { MapContainer, TileLayer } from 'react-leaflet'
import { DEFAULT_ZOOM, PLOVDIV_CENTER, tileUrlForTheme } from '../config'
import type { Stop, Theme } from '../types'
import { StopMarker } from './StopMarker'

export function Map({
  stops,
  filterLines,
  theme,
  isTouch,
  onSelectStop,
}: {
  stops: Stop[]
  filterLines: Set<string>
  theme: Theme
  isTouch: boolean
  onSelectStop: (stop: Stop) => void
}) {
  return (
    <MapContainer
      center={PLOVDIV_CENTER}
      zoom={DEFAULT_ZOOM}
      className="map-root"
      zoomControl={!isTouch}
      attributionControl={false}
    >
      <TileLayer url={tileUrlForTheme(theme)} key={theme} />
      {stops.map((stop) => (
        <StopMarker
          key={`${stop.number}-${stop.lat}-${stop.lng}`}
          stop={stop}
          isTouch={isTouch}
          filterLines={filterLines}
          onSelect={onSelectStop}
        />
      ))}
    </MapContainer>
  )
}
