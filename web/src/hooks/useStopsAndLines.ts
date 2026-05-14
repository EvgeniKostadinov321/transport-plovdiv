import { useEffect, useState } from 'react'
import { fetchStops, fetchLines } from '../api'
import type { Stop } from '../types'

export function useStopsAndLines(): { stops: Stop[]; allLines: string[] } {
  const [stops, setStops] = useState<Stop[]>([])
  const [allLines, setAllLines] = useState<string[]>([])

  useEffect(() => {
    fetchStops()
      .then(setStops)
      .catch(() => {})
    fetchLines()
      .then(setAllLines)
      .catch(() => {})
  }, [])

  return { stops, allLines }
}
