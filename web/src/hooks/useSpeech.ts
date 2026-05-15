/**
 * Speech synthesis (bg-BG). Връща `speak(text)` функция или null ако API
 * не е достъпен. На client side rendering само (`typeof window`).
 *
 * Cancels-ва предишен utterance преди да каже нов — избягваме queue.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

export function useSpeech(enabled: boolean): { speak: (text: string) => void } {
  const synthRef = useRef<SpeechSynthesis | null>(null)
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    synthRef.current = window.speechSynthesis
    const pickVoice = () => {
      const voices = synthRef.current?.getVoices() ?? []
      // Prefer bg-BG → bg → first available
      const bg = voices.find((v) => v.lang === 'bg-BG') ?? voices.find((v) => v.lang.startsWith('bg'))
      setVoice(bg ?? voices[0] ?? null)
    }
    pickVoice()
    synthRef.current.addEventListener('voiceschanged', pickVoice)
    return () => {
      synthRef.current?.removeEventListener('voiceschanged', pickVoice)
    }
  }, [])

  return useMemo(
    () => ({
      speak: (text: string) => {
        if (!enabled || !synthRef.current) return
        try {
          synthRef.current.cancel()
          const u = new SpeechSynthesisUtterance(text)
          if (voice) u.voice = voice
          u.lang = 'bg-BG'
          u.rate = 1
          u.pitch = 1
          synthRef.current.speak(u)
        } catch {
          // Web Speech може да fail-не на secure contexts / unsupported
        }
      },
    }),
    [enabled, voice]
  )
}
