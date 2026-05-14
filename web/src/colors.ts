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
 * Осветлява/затъмнява hex цвят с given amount (-1..1).
 * Positive amount → светъл, negative → тъмен.
 */
export function shadeColor(hex: string, amount: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) return hex
  const num = parseInt(m[1], 16)
  let r = (num >> 16) & 0xff
  let g = (num >> 8) & 0xff
  let b = num & 0xff
  if (amount > 0) {
    r = Math.round(r + (255 - r) * amount)
    g = Math.round(g + (255 - g) * amount)
    b = Math.round(b + (255 - b) * amount)
  } else {
    const f = 1 + amount // amount е negative → 1 + (-0.3) = 0.7
    r = Math.round(r * f)
    g = Math.round(g * f)
    b = Math.round(b * f)
  }
  const toHex = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
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
