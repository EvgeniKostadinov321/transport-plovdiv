import { useEffect, useRef } from 'react'
import type { CircleMarker as LeafletCircleMarker } from 'leaflet'
import { CircleMarker, Popup } from 'react-leaflet'
import { fetchETA } from '../api'
import { getStopColor } from '../colors'
import type { Stop } from '../types'
import { StopPopupContent } from './StopPopupContent'

export function StopMarker({
  stop,
  isTouch,
  filterLines,
  autoOpenPopup,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: {
  stop: Stop
  isTouch: boolean
  filterLines: Set<string>
  autoOpenPopup?: boolean
  isFavorite?: boolean
  onSelect: (stop: Stop) => void
  onToggleFavorite?: (stopNumber: number) => void
}) {
  const prefetchTimer = useRef<number | null>(null)
  const markerRef = useRef<LeafletCircleMarker | null>(null)
  const color = getStopColor(stop.lines, filterLines)

  useEffect(() => {
    if (autoOpenPopup && !isTouch) {
      const t = setTimeout(() => {
        markerRef.current?.openPopup()
      }, 700)
      return () => clearTimeout(t)
    }
  }, [autoOpenPopup, isTouch, stop.number])

  const baseRadius = isTouch ? 9 : filterLines.size > 0 ? 6 : 5
  const baseWeight = isTouch ? 2 : filterLines.size > 0 ? 2 : 1
  const baseOpacity = isTouch ? 0.9 : filterLines.size > 0 ? 0.9 : 0.7

  return (
    <>
      {isFavorite && (
        <CircleMarker
          center={[stop.lat, stop.lng]}
          radius={baseRadius + 4}
          pathOptions={{
            fillOpacity: 0,
            color: '#f5b400',
            weight: 2.5,
          }}
          interactive={false}
        />
      )}
      {isTouch ? (
        <CircleMarker
          ref={markerRef}
          center={[stop.lat, stop.lng]}
          radius={baseRadius}
          pathOptions={{
            fillColor: color,
            fillOpacity: baseOpacity,
            color: '#fff',
            weight: baseWeight,
          }}
          eventHandlers={{
            click: () => {
              fetchETA(stop.number).catch(() => {})
              onSelect(stop)
            },
          }}
        />
      ) : (
        <CircleMarker
          ref={markerRef}
          center={[stop.lat, stop.lng]}
          radius={baseRadius}
          pathOptions={{
            fillColor: color,
            fillOpacity: baseOpacity,
            color: '#fff',
            weight: baseWeight,
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
            <StopPopupContent
              stop={stop}
              filterLines={filterLines}
              isFavorite={isFavorite}
              onToggleFavorite={onToggleFavorite}
            />
          </Popup>
        </CircleMarker>
      )}
    </>
  )
}
