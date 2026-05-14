import { useCallback, useEffect, useRef, useState } from 'react'
import type { GeoPosition } from '../types'

export type GeoStatus = 'idle' | 'requesting' | 'tracking' | 'denied' | 'error'

interface UseGeolocationResult {
  position: GeoPosition | null
  status: GeoStatus
  error: string | null
  /** Toggle on/off geolocation tracking. */
  toggle: () => void
  /** Active = в момента tracking-ваме. */
  active: boolean
}

export function useGeolocation(): UseGeolocationResult {
  const [position, setPosition] = useState<GeoPosition | null>(null)
  const [status, setStatus] = useState<GeoStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const watcherRef = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (watcherRef.current != null) {
      navigator.geolocation.clearWatch(watcherRef.current)
      watcherRef.current = null
    }
    setStatus('idle')
    setPosition(null)
  }, [])

  const start = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Геолокацията не се поддържа от браузъра')
      setStatus('error')
      return
    }
    setStatus('requesting')
    setError(null)

    watcherRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        })
        setStatus('tracking')
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied')
          setError('Достъп до локацията е отказан')
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setStatus('error')
          setError('Локацията не може да бъде определена')
        } else if (err.code === err.TIMEOUT) {
          setStatus('error')
          setError('Времето за определяне на локацията изтече')
        } else {
          setStatus('error')
          setError(err.message)
        }
      },
      {
        enableHighAccuracy: false,
        maximumAge: 10_000,
        timeout: 15_000,
      }
    )
  }, [])

  const toggle = useCallback(() => {
    if (status === 'idle' || status === 'denied' || status === 'error') {
      start()
    } else {
      stop()
    }
  }, [status, start, stop])

  // Cleanup при unmount
  useEffect(() => {
    return () => {
      if (watcherRef.current != null) {
        navigator.geolocation.clearWatch(watcherRef.current)
      }
    }
  }, [])

  const active = status === 'tracking' || status === 'requesting'

  return { position, status, error, toggle, active }
}
