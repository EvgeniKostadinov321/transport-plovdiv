import { useRef } from 'react'
import { CircleMarker, Popup } from 'react-leaflet'
import { fetchETA } from '../api'
import { getStopColor } from '../colors'
import type { Stop } from '../types'
import { StopPopupContent } from './StopPopupContent'

export function StopMarker({
  stop,
  isTouch,
  filterLines,
  onSelect,
}: {
  stop: Stop
  isTouch: boolean
  filterLines: Set<string>
  onSelect: (stop: Stop) => void
}) {
  const prefetchTimer = useRef<number | null>(null)
  const color = getStopColor(stop.lines, filterLines)

  // На desktop: hover prefetch + popup. На mobile: tap → bottom sheet (no popup)
  if (isTouch) {
    return (
      <CircleMarker
        center={[stop.lat, stop.lng]}
        radius={9}
        pathOptions={{
          fillColor: color,
          fillOpacity: 0.9,
          color: '#fff',
          weight: 2,
        }}
        eventHandlers={{
          click: () => {
            fetchETA(stop.number).catch(() => {})
            onSelect(stop)
          },
        }}
      />
    )
  }

  return (
    <CircleMarker
      center={[stop.lat, stop.lng]}
      radius={filterLines.size > 0 ? 6 : 5}
      pathOptions={{
        fillColor: color,
        fillOpacity: filterLines.size > 0 ? 0.9 : 0.7,
        color: '#fff',
        weight: filterLines.size > 0 ? 2 : 1,
      }}
      eventHandlers={{
        mouseover: () => {
          if (prefetchTimer.current) window.clearTimeout(prefetchTimer.current)
          prefetchTimer.current = window.setTimeout(() => {
            fetchETA(stop.number).catch(() => {})
          }, 150)
        },
        mouseout: () => {
          if (prefetchTimer.current) {
            window.clearTimeout(prefetchTimer.current)
            prefetchTimer.current = null
          }
        },
      }}
    >
      <Popup>
        <StopPopupContent stop={stop} filterLines={filterLines} />
      </Popup>
    </CircleMarker>
  )
}
