/**
 * Decoder за Google's Encoded Polyline Algorithm Format.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 *
 * Това е форматът който livetransport.eu ползва в `trip.shape`.
 */
export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const factor = Math.pow(10, precision)
  const coords: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    result = 0
    shift = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    coords.push([lat / factor, lng / factor])
  }
  return coords
}
