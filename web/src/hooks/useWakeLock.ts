/**
 * Screen wake lock — пречи на екрана да заспи докато navigation е активен.
 * Auto-re-acquires при visibility change (browser releases lock при tab blur).
 */
import { useEffect } from 'react'

type WakeLockSentinel = {
  release: () => Promise<void>
  released: boolean
  addEventListener: (type: 'release', listener: () => void) => void
}

interface WakeLockApi {
  request: (type: 'screen') => Promise<WakeLockSentinel>
}

export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined') return
    const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock
    if (!api) return

    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async () => {
      try {
        const s = await api.request('screen')
        if (cancelled) {
          await s.release().catch(() => {})
          return
        }
        sentinel = s
      } catch {
        // User denied / hardware unsupported — silently skip
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) {
        void acquire()
      }
    }

    void acquire()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibility)
      if (sentinel && !sentinel.released) {
        void sentinel.release().catch(() => {})
      }
    }
  }, [enabled])
}
