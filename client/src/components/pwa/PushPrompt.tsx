'use client'
/* ─────────────────────────────────────────────────────────────
   "Turn on notifications" (2026-10-21) — asks once, with a reason, before the
   browser's own prompt (which a browser may hide for good if it is fired
   unasked). "Not now" waits a week. Not shown while the install popup is
   still offering itself — one card at a time — nor on an iPhone outside the
   installed app, where push cannot work (the install popup says how).
   Already allowed: registers this device quietly (syncPush).
───────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BellRing, X } from 'lucide-react'
import { enablePush, pushState, syncPush } from '@/lib/push'
import { useInstallOffer } from '@/lib/pwaInstall'
import { useCurrentUser } from '@/lib/api/user'

const KEY = 'delta-push-snooze'
const WEEK = 7 * 86_400_000
const snoozed = (k: string) => { try { return Number(localStorage.getItem(k) ?? 0) > Date.now() } catch { return false } }

export function PushPrompt() {
  const { data: me } = useCurrentUser()
  const installOffer = useInstallOffer()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const student = me?.role === 'student' && !me?.impersonation

  useEffect(() => {
    if (!student) return
    let alive = true
    void syncPush()
    const t = setTimeout(async () => {
      const state = await pushState().catch(() => 'unsupported' as const)
      /* The install card goes first when it is still on offer. */
      const installWaiting = !!installOffer && !snoozed('delta-install-snooze')
      if (alive && state === 'off' && !snoozed(KEY) && !installWaiting) setShow(true)
    }, 6000)
    return () => { alive = false; clearTimeout(t) }
  }, [student, installOffer])

  const later = () => { try { localStorage.setItem(KEY, String(Date.now() + WEEK)) } catch { /* private mode */ } setShow(false) }
  const turnOn = async () => {
    setBusy(true)
    try { await enablePush() } catch { /* the browser said no, or push is not set up — the bell still works */ }
    setBusy(false); setShow(false)
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div role="dialog" aria-label="Turn on notifications"
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="fixed inset-x-3 bottom-[calc(86px+env(safe-area-inset-bottom))] z-50 rounded-2xl p-4 sm:inset-x-auto sm:right-6 sm:w-[360px] lg:bottom-6"
          style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', boxShadow: '0 24px 70px rgba(0,0,0,0.25)' }}>
          <button onClick={later} aria-label="Close" className="absolute right-2.5 top-2.5 rounded-lg p-1.5" style={{ color: 'var(--color-text-muted)' }}><X size={15} /></button>
          <div className="flex items-start gap-3 pr-6">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(0,87,184,0.1)', color: '#0057b8' }}><BellRing size={20} /></span>
            <div className="min-w-0">
              <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Turn on notifications</p>
              <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                Class reminders (30 min, 5 min, 1 min), today&apos;s schedule, new classes and messages — straight to your phone, even when the app is closed.
              </p>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={later} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Not now</button>
            <button onClick={() => void turnOn()} disabled={busy}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#0057b8,#2F6BFF)' }}>
              {busy ? 'Turning on…' : 'Turn on'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
