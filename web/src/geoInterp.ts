/** Linear interpolation между две GPS точки. */
export function interpolatePoint(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  t: number
): { lat: number; lng: number } {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  }
}
