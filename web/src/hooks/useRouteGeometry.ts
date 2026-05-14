import { useEffect, useState } from 'react'
import { fetchRouteGeometry } from '../api'
import type { RouteGeometryData } from '../types'

/**
 * Зарежда route geometry еднократно при първото обръщение към избрана линия.
 * Файлът е ~1.8MB - lazy loading е важно.
 */
export function useRouteGeometry(enabled: boolean): RouteGeometryData | null {
  const [data, setData] = useState<RouteGeometryData | null>(null)

  useEffect(() => {
    if (!enabled || data) return
    fetchRouteGeometry()
      .then(setData)
      .catch(() => {})
  }, [enabled, data])

  return data
}
