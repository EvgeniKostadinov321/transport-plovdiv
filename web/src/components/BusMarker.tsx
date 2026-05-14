import { useMemo } from 'react'
import L from 'leaflet'
import { Marker, Tooltip } from 'react-leaflet'
import { getLineColor } from '../colors'
import { cleanText } from '../api'
import type { BusPosition } from '../types'

/**
 * Bus marker - SVG автобус с цвета на линията.
 * Smooth CSS transition при update на позицията (30s polling interval).
 */
export function BusMarker({ bus }: { bus: BusPosition }) {
  const color = getLineColor(bus.line)
  const lineLabel = bus.line

  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'bus-marker',
        html: `
          <div class="bus-marker__shell" style="--bus-color: ${color};">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 17V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10"/>
              <path d="M4 14h16"/>
              <path d="M8 19a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
              <path d="M19 19a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
              <rect x="7" y="7" width="4" height="4" rx="0.5"/>
              <rect x="13" y="7" width="4" height="4" rx="0.5"/>
            </svg>
            <span class="bus-marker__label">${lineLabel}</span>
          </div>
        `,
        iconSize: [56, 30],
        iconAnchor: [28, 15],
      }),
    [color, lineLabel]
  )

  return (
    <Marker
      position={[bus.lat, bus.lng]}
      icon={icon}
      keyboard={false}
      zIndexOffset={500}
    >
      <Tooltip direction="top" offset={[0, -10]}>
        <div style={{ fontSize: 12 }}>
          <div>
            <strong>Линия {bus.line}</strong> → {cleanText(bus.direction)}
          </div>
          <div style={{ color: '#666', marginTop: 2 }}>
            След {bus.minutesToNext} мин на:{' '}
            <strong>#{bus.toStopNumber}</strong> {cleanText(bus.toStopName)}
          </div>
        </div>
      </Tooltip>
    </Marker>
  )
}
