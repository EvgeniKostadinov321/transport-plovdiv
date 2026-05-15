import { useEffect, useRef, useState } from 'react'
import { geocode } from '../api'
import type { GeocodeResult } from '../types'

const DEBOUNCE_MS = 300

export interface LocationValue {
  label: string
  lat: number
  lng: number
  /** Дали е автоматично от GPS. UI може да го показва различно. */
  fromGeo?: boolean
}

export function LocationInput({
  placeholder,
  value,
  onChange,
  onUseGeo,
  hasGeo,
}: {
  placeholder: string
  value: LocationValue | null
  onChange: (v: LocationValue | null) => void
  onUseGeo?: () => void
  hasGeo?: boolean
}) {
  const [text, setText] = useState(value?.label ?? '')
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<number | null>(null)

  // При отваряне на suggestions — измервам колко място има отдолу. Ако
  // suggestion list-ът не пасва → отварям нагоре. Това решава "list излиза
  // извън bottom-sheet" на mobile.
  useEffect(() => {
    if (!open) return
    const inputEl = inputRef.current
    if (!inputEl) return
    const rect = inputEl.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    // ~240px = max-height на suggestion list-а
    if (spaceBelow < 240 && spaceAbove > spaceBelow) {
      setDropUp(true)
    } else {
      setDropUp(false)
    }
  }, [open, suggestions.length])

  // Sync external value changes (e.g. set from GPS)
  useEffect(() => {
    if (value?.label !== text) {
      setText(value?.label ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.label])

  // Click outside → close suggestions
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleTextChange = (next: string) => {
    setText(next)
    if (!next.trim()) {
      setSuggestions([])
      onChange(null)
      return
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    setLoading(true)
    debounceRef.current = window.setTimeout(async () => {
      const results = await geocode(next)
      setSuggestions(results)
      setOpen(true)
      setLoading(false)
    }, DEBOUNCE_MS)
  }

  const pick = (r: GeocodeResult) => {
    setText(r.label)
    setOpen(false)
    onChange({ label: r.label, lat: r.lat, lng: r.lng })
  }

  return (
    <div className="loc-input" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className="loc-input__field"
        placeholder={placeholder}
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
      />
      {onUseGeo && hasGeo && !value?.fromGeo && (
        <button
          type="button"
          className="loc-input__geo"
          onClick={onUseGeo}
          aria-label="Използвай моята локация"
          title="Моята локация"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
        </button>
      )}
      {open && (suggestions.length > 0 || loading) && (
        <ul
          className={
            dropUp
              ? 'loc-input__suggestions loc-input__suggestions--up'
              : 'loc-input__suggestions'
          }
        >
          {loading && <li className="loc-input__loading">Търсене…</li>}
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                className="loc-input__suggestion"
                onClick={() => pick(s)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
