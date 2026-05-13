/**
 * Deterministic цветове за линии.
 * Same line → same color винаги (hash-based).
 */

// 12 distinct, accessible цвята — добра contrast value на бяла карта
const PALETTE = [
  '#e6194B', // червен
  '#3cb44b', // зелен
  '#f58231', // оранжев
  '#4363d8', // син
  '#911eb4', // лилав
  '#42d4f4', // циан
  '#f032e6', // магента
  '#9A6324', // кафяв
  '#800000', // тъмно червен
  '#469990', // teal
  '#808000', // маслинен
  '#000075', // navy
]

const FALLBACK = '#1a73e8' // default син

const colorCache = new Map<string, string>()

export function getLineColor(line: string): string {
  const cached = colorCache.get(line)
  if (cached) return cached
  let hash = 0
  for (let i = 0; i < line.length; i++) {
    hash = (hash << 5) - hash + line.charCodeAt(i)
    hash = hash & hash
  }
  const color = PALETTE[Math.abs(hash) % PALETTE.length] ?? FALLBACK
  colorCache.set(line, color)
  return color
}

/**
 * Връща primary color за набор от линии — взимаме на цвета на ПЪРВАТА (sorted) line.
 * Това гарантира, че спирка обслужвана от линии [18, 99] винаги има цвета на 18.
 */
export function getStopColor(lines: string[], filterLines: Set<string>): string {
  if (filterLines.size === 0) return FALLBACK // no filter → default син
  // Изважваме само линии които са в избрания filter
  const matching = lines.filter((l) => filterLines.has(l))
  if (matching.length === 0) return FALLBACK
  // Sorted numerically — детерминирано
  const sorted = matching.slice().sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  return getLineColor(sorted[0])
}
