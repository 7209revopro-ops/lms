'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, X, Sparkles } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISSED_KEY = 'lms_pwa_dismissed_at'
/* Don't bug the user again for this many days after a dismiss. */
const SNOOZE_DAYS = 14

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible,  setVisible]  = useState(false)

  useEffect(() => {
    /* Skip entirely if already running as installed PWA */
    if (typeof window === 'undefined') return
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as { standalone?: boolean }).standalone === true
    if (standalone) return

    /* Check snooze */
    const dismissedAtRaw = localStorage.getItem(DISMISSED_KEY)
    if (dismissedAtRaw) {
      const dismissedAt = Number(dismissedAtRaw)
      const ageDays = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24)
      if (ageDays < SNOOZE_DAYS) return
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      /* Surface after a short delay so it doesn't feel pushy. */
      setTimeout(() => setVisible(true), 6_000)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const onInstall = async () => {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    setDeferred(null)
    setVisible(false)
    if (outcome === 'dismissed') {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()))
    }
  }

  const onDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()))
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && deferred && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 280, damping: 26 }}
          /* left-6 with no right offset let shrink-to-fit take the whole 351px
             remaining, so this sat flush against the right edge and covered the
             activity-panel button entirely. Pin both edges on a phone. */
          className="fixed bottom-6 left-4 right-4 z-50 overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] sm:left-6 sm:right-auto sm:max-w-sm"
          style={{ border: '1px solid var(--color-border)', boxShadow: '0 16px 40px rgba(13,15,26,0.15)' }}>
          <div className="flex items-start gap-3 p-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'rgba(0,87,184,0.10)', border: '1px solid rgba(0,87,184,0.25)' }}>
              <Sparkles size={16} style={{ color: 'var(--color-primary)' }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                Install LearnOS
              </p>
              <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                Add it to your home screen for a faster, full-screen learning experience.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={onInstall}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white transition-all hover:opacity-90"
                  style={{ background: 'var(--color-primary)' }}>
                  <Download size={11} />Install
                </button>
                <button onClick={onDismiss}
                  className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--color-bg-muted)]"
                  style={{ color: 'var(--color-text-muted)' }}>
                  Not now
                </button>
              </div>
            </div>
            <button onClick={onDismiss}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bg-muted)]"
              style={{ color: 'var(--color-text-muted)' }}>
              <X size={12} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
