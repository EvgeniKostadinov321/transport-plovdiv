import { useEffect, useState } from 'react'
import { API_URL } from '../config'
import type { LiveVehicle } from '../types'

/**
 * Connect-ва се към `/api/vehicles/stream` (SSE) и поддържа Map на всички
 * live vehicles. Backend-ът push-ва snapshot (full) + update (delta) + remove
 * събития.
 *
 * Връща филтриран list — само vehicle-и с `line` set (т.е. в активен service)
 * и опционално отговарящи на `selectedLines`.
 */
export function useLiveVehicles(selectedLines: string[]): LiveVehicle[] {
  const [vehiclesById, setVehiclesById] = useState<Map<string, LiveVehicle>>(
    () => new Map()
  )

  useEffect(() => {
    const es = new EventSource(`${API_URL}/api/vehicles/stream`)

    es.addEventListener('snapshot', (e) => {
      const list = JSON.parse(e.data) as LiveVehicle[]
      setVehiclesById(new Map(list.map((v) => [v.id, v])))
    })

    es.addEventListener('update', (e) => {
      const list = JSON.parse(e.data) as LiveVehicle[]
      setVehiclesById((prev) => {
        const next = new Map(prev)
        for (const v of list) next.set(v.id, v)
        return next
      })
    })

    es.addEventListener('remove', (e) => {
      const list = JSON.parse(e.data) as LiveVehicle[]
      setVehiclesById((prev) => {
        const next = new Map(prev)
        for (const v of list) next.delete(v.id)
        return next
      })
    })

    es.onerror = () => {
      // EventSource се reconnect-ва автоматично; нищо за правене тук
    }

    return () => es.close()
  }, [])

  const all = [...vehiclesById.values()]
  if (selectedLines.length === 0) {
    // Без филтър — показваме само автобуси които са на линия
    return all.filter((v) => v.line !== null)
  }
  const set = new Set(selectedLines)
  return all.filter((v) => v.line !== null && set.has(v.line))
}
