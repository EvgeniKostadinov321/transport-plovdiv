/**
 * Haversine formula - разстояние между две GPS точки в метри.
 */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000 // Радиус на Земята в метри
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Human-readable formatting на разстояние.
 */
export function formatDistance(meters: number): string {
  if (meters < 100) return `${Math.round(meters)} м`
  if (meters < 1000) return `${Math.round(meters / 10) * 10} м`
  return `${(meters / 1000).toFixed(1)} км`
}
