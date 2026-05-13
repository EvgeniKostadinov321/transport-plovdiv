import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function UpdatePrompt() {
  const [showOffline, setShowOffline] = useState(false)
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      // Проверка за update на всеки час
      if (registration) {
        setInterval(() => {
          registration.update().catch(() => {})
        }, 60 * 60 * 1000)
      }
    },
  })

  useEffect(() => {
    if (offlineReady) {
      setShowOffline(true)
      const t = setTimeout(() => setShowOffline(false), 3000)
      return () => clearTimeout(t)
    }
  }, [offlineReady])

  const close = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  if (!needRefresh && !showOffline) return null

  return (
    <div className="update-prompt" role="status">
      {needRefresh ? (
        <>
          <div className="update-prompt__msg">
            Има нова версия. Презареди за да я ползваш.
          </div>
          <div className="update-prompt__actions">
            <button
              type="button"
              className="update-prompt__btn update-prompt__btn--primary"
              onClick={() => updateServiceWorker(true)}
            >
              Презареди
            </button>
            <button
              type="button"
              className="update-prompt__btn"
              onClick={close}
            >
              По-късно
            </button>
          </div>
        </>
      ) : (
        <div className="update-prompt__msg">Готово за offline ползване ✓</div>
      )}
    </div>
  )
}
