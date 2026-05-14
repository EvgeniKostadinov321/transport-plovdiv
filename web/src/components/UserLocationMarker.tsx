import { CircleMarker, Circle } from 'react-leaflet'
import type { GeoPosition } from '../types'

export function UserLocationMarker({ position }: { position: GeoPosition }) {
  return (
    <>
      {/* Accuracy circle (light shading) */}
      <Circle
        center={[position.lat, position.lng]}
        radius={position.accuracy}
        pathOptions={{
          fillColor: '#4285F4',
          fillOpacity: 0.1,
          color: '#4285F4',
          weight: 1,
          opacity: 0.3,
        }}
      />
      {/* Inner dot */}
      <CircleMarker
        center={[position.lat, position.lng]}
        radius={7}
        pathOptions={{
          fillColor: '#4285F4',
          fillOpacity: 1,
          color: '#ffffff',
          weight: 3,
        }}
        // Disable click handling so user can click stops behind/near
        interactive={false}
      />
    </>
  )
}
