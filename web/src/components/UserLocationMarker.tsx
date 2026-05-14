import { useMemo } from 'react'
import L from 'leaflet'
import { Marker, Circle } from 'react-leaflet'
import type { GeoPosition } from '../types'

export function UserLocationMarker({ position }: { position: GeoPosition }) {
  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'user-location-marker',
        html: `
          <div class="user-location-marker__pulse"></div>
          <div class="user-location-marker__badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="7" r="3.5"></circle>
              <path d="M5 22c0-4 3-7 7-7s7 3 7 7"></path>
            </svg>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
    []
  )

  return (
    <>
      {/* Accuracy circle - зелено за да съответства на маркера */}
      <Circle
        center={[position.lat, position.lng]}
        radius={position.accuracy}
        pathOptions={{
          fillColor: '#10b981',
          fillOpacity: 0.1,
          color: '#10b981',
          weight: 1.5,
          opacity: 0.4,
          dashArray: '4 6',
        }}
        interactive={false}
      />
      <Marker
        position={[position.lat, position.lng]}
        icon={icon}
        interactive={false}
        keyboard={false}
        zIndexOffset={1000}
      />
    </>
  )
}
