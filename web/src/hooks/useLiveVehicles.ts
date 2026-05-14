import { useEffect, useRef, useState } from 'react'
import { API_URL } from '../config'
import type { LiveVehicle } from '../types'

/** SSE се счита за "stale" ако последното message е по-старо от това. */
const STALE_THRESHOLD_MS = 30_000

export type LiveStatus = 'connecting' | 'live' | 'stale'

interface LiveData {
  vehicles: LiveVehicle[]
  status: LiveStatus
}

/**
 * Connect-ва се към `/api/vehicles/stream` (SSE) и поддържа Map на всички
 * live vehicles. Backend-ът push-ва snapshot (full) + update (delta) + remove
 * събития.
 *
 * Връща { vehicles (филтриран list), status }.
 */
export function useLiveVehicles(selectedLines: string[]): LiveData {
  const [vehiclesById, setVehiclesById] = useState<Map<string, LiveVehicle>>(
    () => new Map()
  )
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const lastMessageRef = useRef<number>(0)

  useEffect(() => {
    const es = new EventSource(`${API_URL}/api/vehicles/stream`)

    const markFresh = () => {
      lastMessageRef.current = Date.now()
      setStatus('live')
    }

    es.addEventListener('snapshot', (e) => {
      const list = JSON.parse(e.data) as LiveVehicle[]
      setVehiclesById(new Map(list.map((v) => [v.id, v])))
      markFresh()
    })

    es.addEventListener('update', (e) => {
      const list = JSON.parse(e.data) as LiveVehicle[]
      setVehiclesById((prev) => {
        const next = new Map(prev)
        for (const v of list) next.set(v.id, v)
        return next
      })
      markFresh()
    })

    es.addEventListener('remove', (e) => {
      const list = JSON.parse(e.data) as LiveVehicle[]
      setVehiclesById((prev) => {
        const next = new Map(prev)
        for (const v of list) next.delete(v.id)
        return next
      })
      markFresh()
    })

    es.onerror = () => {
      // EventSource се reconnect-ва автоматично; не сменяме статус тук —
      // staleness watcher по-долу ще го направи при липсваща активност.
    }

    // Watcher — проверява всеки 5s дали идват updates
    const interval = window.setInterval(() => {
      if (!lastMessageRef.current) return
      const age = Date.now() - lastMessageRef.current
      if (age > STALE_THRESHOLD_MS) {
        setStatus('stale')
      }
    }, 5000)

    return () => {
      es.close()
      window.clearInterval(interval)
    }
  }, [])

  // Без филтър — всички автобуси които са на активна линия.
  // С филтър — само избраните линии.
  const result: LiveVehicle[] = []
  if (selectedLines.length === 0) {
    for (const v of vehiclesById.values()) {
      if (v.line !== null) result.push(v)
    }
  } else {
    const set = new Set(selectedLines)
    for (const v of vehiclesById.values()) {
      if (v.line !== null && set.has(v.line)) result.push(v)
    }
  }
  return { vehicles: result, status }
}
