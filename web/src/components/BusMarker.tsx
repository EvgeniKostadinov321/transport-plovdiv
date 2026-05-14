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
export function BusMarker({
  vehicle,
  onSelect,
}: {
  vehicle: LiveVehicle
  onSelect: (vehicle: LiveVehicle) => void
}) {
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
              <span class="bus-marker__chevron" style="--rot: ${vehicle.bearing}deg;">
                <svg viewBox="0 0 12 8" fill="currentColor">
                  <path d="M6 0 L12 7 L6 5 L0 7 Z"/>
                </svg>
              </span>
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
  const plate = vehicle.id.includes('/') ? vehicle.id.split('/')[1] : vehicle.id

  return (
    <Marker
      position={[vehicle.lat, vehicle.lng]}
      icon={icon}
      keyboard={false}
      zIndexOffset={750}
      eventHandlers={{ click: () => onSelect(vehicle) }}
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
          <div style={{ color: '#888', fontSize: 10, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
            {plate}
          </div>
          <div style={{ color: '#888', fontSize: 10 }}>
            обновено преди {ageSec}s
          </div>
        </div>
      </Tooltip>
    </Marker>
  )
}
