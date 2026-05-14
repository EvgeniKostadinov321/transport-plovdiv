import { useMemo } from 'react'
import L from 'leaflet'
import { Marker, Tooltip } from 'react-leaflet'
import { getLineColor } from '../colors'
import { cleanText } from '../api'
import type { BusPosition } from '../types'

/**
 * Bus marker - icon на автобус с цвят на линията + dark badge с номера.
 * Изглежда различно от spirka markers (които са flat circles).
 */
export function BusMarker({ bus }: { bus: BusPosition }) {
  const lineColor = getLineColor(bus.line)

  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'bus-marker',
        html: `
          <div class="bus-marker__shell" style="--bus-color: ${lineColor};">
            <span class="bus-marker__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 17V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10"/>
                <path d="M4 14h16"/>
                <circle cx="7" cy="18" r="1.5"/>
                <circle cx="17" cy="18" r="1.5"/>
                <line x1="9" y1="8" x2="9" y2="11"/>
                <line x1="15" y1="8" x2="15" y2="11"/>
              </svg>
            </span>
            <span class="bus-marker__label">${bus.line}</span>
          </div>
        `,
        iconSize: [58, 30],
        iconAnchor: [29, 15],
      }),
    [lineColor, bus.line]
  )

  return (
    <Marker
      position={[bus.lat, bus.lng]}
      icon={icon}
      keyboard={false}
      zIndexOffset={750}
    >
      <Tooltip direction="top" offset={[0, -12]}>
        <div style={{ fontSize: 12, lineHeight: 1.4 }}>
          <div>
            <strong>Линия {bus.line}</strong>
          </div>
          <div style={{ color: '#aaa', fontSize: 11 }}>
            {cleanText(bus.direction)}
          </div>
          <div style={{ marginTop: 4 }}>
            След <strong>{bus.minutesToNext} мин</strong>:{' '}
            <strong>#{bus.toStopNumber}</strong> {cleanText(bus.toStopName)}
          </div>
        </div>
      </Tooltip>
    </Marker>
  )
}
