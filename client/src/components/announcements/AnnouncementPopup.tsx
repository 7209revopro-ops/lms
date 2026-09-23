'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Megaphone } from 'lucide-react'
import { useActiveAnnouncements, type Announcement } from '@/lib/api/announcements'
import { ANNOUNCEMENT_DISMISS_PREFIX } from '@/lib/announcementDismiss'

function isDismissed(id: string): boolean {
  if (typeof window === 'undefined') return true
  try { return sessionStorage.getItem(ANNOUNCEMENT_DISMISS_PREFIX + id) === '1' }
  catch { return false }   // private-window / storage blocked — fail open, show it
}

function markDismissed(id: string): void {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(ANNOUNCEMENT_DISMISS_PREFIX + id, '1') } catch { /* storage blocked — nothing to persist */ }
}

/* ─────────────────────────────────────────────────────
   AnnouncementPopup

   Mounted once, app-wide (dashboard layout), same spot as InstallPrompt.
   "Is this announcement live right now" is entirely the server's answer —
   useActiveAnnouncements already filters to the caller's academy and the
   current instant, so this component's only job is deciding which of
   POSSIBLY SEVERAL active announcements to show, and in what order: one at
   a time, oldest-start-date first, each dismissed for the rest of this
   session before the next one appears.
───────────────────────────────────────────────────── */
export function AnnouncementPopup() {
  const { data: announcements } = useActiveAnnouncements()
  const [queue, setQueue] = useState<Announcement[]>([])

  useEffect(() => {
    if (!announcements) return
    setQueue(announcements.filter(a => !isDismissed(a.id)))
  }, [announcements])

  const current = queue[0]

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && current) dismiss() }
    if (current) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  const dismiss = () => {
    if (!current) return
    markDismissed(current.id)
    setQueue(q => q.slice(1))
  }

  return (
    /* Two keyed direct children, not one fragment — AnimatePresence tracks
       direct children by key, and a fragment is a single unkeyed child, so
       an exit animation on what it wraps would never run. Same shape as
       TermsModal.tsx, for the same reason. */
    <AnimatePresence>
      {current && (
        <motion.div
          key="announcement-backdrop"
          className="fixed inset-0 z-[80]"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={dismiss}
        />
      )}
      {current && (
        <motion.div
          key="announcement-modal"
          className="fixed inset-0 z-[81] flex items-center justify-center p-4"
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        >
          <div
            className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl"
            style={{ background: 'var(--color-bg-surface)', boxShadow: '0 24px 80px rgba(0,0,0,0.28)', maxHeight: '88vh' }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={dismiss}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-black/10"
              style={{ background: current.mediaUrl ? 'rgba(0,0,0,0.35)' : 'transparent', color: current.mediaUrl ? '#fff' : 'var(--color-text-muted)' }}
              aria-label="Close"
            >
              <X size={16} />
            </button>

            {current.mediaUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.mediaUrl} alt="" className="h-44 w-full flex-shrink-0 object-cover sm:h-56" />
            )}

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {!current.mediaUrl && (
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ background: 'rgba(0,87,184,0.08)' }}>
                  <Megaphone size={18} style={{ color: 'var(--color-primary)' }} />
                </div>
              )}
              <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {current.title}
              </h2>
              {/* whitespace-pre-line, not dangerouslySetInnerHTML — the admin
                  form is a plain textarea, so there is no markup to render,
                  only line breaks worth keeping. */}
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                {current.description}
              </p>
            </div>

            <div className="flex-shrink-0 px-6 pb-5">
              <button
                onClick={dismiss}
                className="w-full rounded-xl py-2.5 text-sm font-bold text-white transition-all hover:opacity-90"
                style={{ background: 'var(--color-primary)', boxShadow: '0 4px 14px rgba(0,87,184,0.3)' }}
              >
                Got it
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
