import { useMemo } from 'react'
import L from 'leaflet'
import { Marker, Tooltip } from 'react-leaflet'
import { getLineColor, shadeColor } from '../colors'
import type { LiveVehicle } from '../types'

/**
 * Bus marker - кръгъл pin с bus icon отгоре, line number отдолу, и
 * външна стрелка показваща bearing (посоката на движение).
 *
 * `bearing` се прилага САМО към arrow-а, не към целия marker — иначе текстът
 * също ще се ротира и ще е нечетим.
 */
export function BusMarker({ vehicle }: { vehicle: LiveVehicle }) {
  const lineColor = vehicle.line ? getLineColor(vehicle.line) : '#6b7280'
  const darkShade = shadeColor(lineColor, -0.35)

  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'bus-marker',
        html: `
          <div class="bus-marker__wrap">
            <span class="bus-marker__arrow" style="--rot: ${vehicle.bearing}deg; --bus-color: ${lineColor};"></span>
            <div class="bus-marker__pin" style="--bus-color: ${lineColor}; --bus-color-dark: ${darkShade};">
              <svg class="bus-marker__bus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 6v6"/><path d="M16 6v6"/>
                <path d="M2 12h19.6"/>
                <path d="M18 18h2a1 1 0 0 0 1-1v-6.65a1 1 0 0 0-.22-.628L19 7c-.5-.5-1-1-2-1H4a2 2 0 0 0-2 2v9c0 .553.447 1 1 1h2"/>
                <circle cx="7" cy="18" r="2"/>
                <path d="M9 18h5"/>
                <circle cx="16" cy="18" r="2"/>
              </svg>
              <span class="bus-marker__num">${vehicle.line ?? '·'}</span>
            </div>
          </div>
        `,
        iconSize: [40, 52],
        iconAnchor: [20, 26],
      }),
    [lineColor, darkShade, vehicle.line, vehicle.bearing]
  )

  const ageSec = Math.max(0, Math.floor((Date.now() - vehicle.lastUpdated) / 1000))

  return (
    <Marker
      position={[vehicle.lat, vehicle.lng]}
      icon={icon}
      keyboard={false}
      zIndexOffset={750}
    >
      <Tooltip direction="top" offset={[0, -22]}>
        <div style={{ fontSize: 12, lineHeight: 1.4 }}>
          <div>
            <strong>Линия {vehicle.line ?? '—'}</strong>
            {' '}
            <span style={{ color: '#aaa' }}>· {vehicle.speed} km/h</span>
          </div>
          {vehicle.destination && (
            <div style={{ color: '#aaa', fontSize: 11 }}>
              → {vehicle.destination}
            </div>
          )}
          <div style={{ color: '#888', fontSize: 10, marginTop: 4 }}>
            обновено преди {ageSec}s
          </div>
        </div>
      </Tooltip>
    </Marker>
  )
}
