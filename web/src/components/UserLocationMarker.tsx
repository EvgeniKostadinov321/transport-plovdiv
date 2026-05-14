import { useMemo } from 'react'
import L from 'leaflet'
import { Marker, Circle } from 'react-leaflet'
import type { GeoPosition } from '../types'

export function UserLocationMarker({ position }: { position: GeoPosition }) {
  // divIcon с CSS pulse animation - значително различен от stop markers (SVG circles)
  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'user-location-marker',
        html: `
          <div class="user-location-marker__pulse"></div>
          <div class="user-location-marker__dot"></div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    []
  )

  return (
    <>
      {/* Accuracy circle (semi-transparent) */}
      <Circle
        center={[position.lat, position.lng]}
        radius={position.accuracy}
        pathOptions={{
          fillColor: '#4285F4',
          fillOpacity: 0.08,
          color: '#4285F4',
          weight: 1,
          opacity: 0.25,
        }}
        interactive={false}
      />
      <Marker
        position={[position.lat, position.lng]}
        icon={icon}
        interactive={false}
        keyboard={false}
        // По-горен z-index от stop markers
        zIndexOffset={1000}
      />
    </>
  )
}
