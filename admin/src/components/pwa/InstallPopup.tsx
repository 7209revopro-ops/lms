'use client'
/* ─────────────────────────────────────────────────────────────
   "Install the app" popup (2026-10-18). Offered a few seconds after the
   dashboard opens, only where the browser can install it (or on an iPhone,
   with the Share → Add to Home Screen steps), never inside the installed app.
   "Not now" keeps it away for a week, on this device.
───────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { useInstallOffer, promptInstall } from '@/lib/pwaInstall'

const KEY = 'delta-admin-install-snooze'
const WEEK = 7 * 86_400_000
const snoozed = () => { try { return Number(localStorage.getItem(KEY) ?? 0) > Date.now() } catch { return false } }
const snooze = () => { try { localStorage.setItem(KEY, String(Date.now() + WEEK)) } catch { /* private mode */ } }

export function InstallPopup() {
  const offer = useInstallOffer()
  const [ready, setReady] = useState(false)
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    if (snoozed()) return
    const t = setTimeout(() => setReady(true), 4000)
    return () => clearTimeout(t)
  }, [])
  const open = ready && !closed && !!offer
  const later = () => { snooze(); setClosed(true) }

  return (
    <AnimatePresence>
      {open && (
        <motion.div role="dialog" aria-label="Install the Delta Admin app"
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-50 rounded-2xl p-4 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[360px]"
          style={{ background: '#13162A', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 70px rgba(0,0,0,0.55)' }}>
          <button onClick={later} aria-label="Close" className="absolute right-2.5 top-2.5 rounded-lg p-1.5 text-white/40 hover:bg-white/5 hover:text-white/70">
            <X size={15} />
          </button>
          <div className="flex items-start gap-3 pr-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">Install the Delta Admin app</p>
              <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Open it from your home screen or desktop in one tap, and get alerts when a student messages you.
              </p>
            </div>
          </div>
          {offer === 'ios' ? (
            <ol className="mt-3 space-y-1.5 rounded-xl p-3 text-xs" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.75)' }}>
              <li className="flex items-center gap-2"><Share size={13} className="shrink-0 text-[#60A5FA]" />Tap <b>Share</b> in Safari&apos;s toolbar</li>
              <li className="flex items-center gap-2"><SquarePlus size={13} className="shrink-0 text-[#60A5FA]" />Choose <b>Add to Home Screen</b></li>
            </ol>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={later} className="rounded-xl px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/5">Not now</button>
            {offer === 'prompt' && (
              <button onClick={() => { setClosed(true); void promptInstall() }}
                className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white"
                style={{ background: 'linear-gradient(135deg,#0057b8,#2F6BFF)' }}>
                <Download size={13} />Install
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
