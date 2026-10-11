'use client'
/* ─────────────────────────────────────────────────────────────
   "While you were away" — 30 seconds into a visit, if the student has unread
   notifications, a sheet lists what they missed: new classes scheduled in
   their courses first, then everything else. At most once a day (per
   browser). "View schedule" opens the Schedule (which clears the new-class
   badge); "See all" opens the notifications drawer.
───────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { CalendarDays, Bell } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { NotificationRow } from '@/components/notifications/NotificationsSheet'
import { useNotifications, useMarkRead, NEW_CLASS_KIND, type Notification } from '@/lib/api/notifications'
import { useSheets } from '@/store/sheets.store'

const SHOWN_KEY = 'lms_missed_popup_day'
const DELAY_MS = 30_000
const today = () => new Date().toISOString().slice(0, 10)

export function MissedPopup() {
  const router = useRouter()
  const setNotificationsOpen = useSheets(s => s.setNotificationsOpen)
  const [due, setDue] = useState(false)
  const [open, setOpen] = useState(false)
  const { data } = useNotifications({ unread: true, per_page: 20 })
  const markRead = useMarkRead()

  useEffect(() => {
    let shown: string | null = null
    try { shown = localStorage.getItem(SHOWN_KEY) } catch { /* private mode */ }
    if (shown === today()) return
    const t = setTimeout(() => setDue(true), DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  const items = data?.items ?? []
  useEffect(() => {
    if (!due || open || items.length === 0) return
    setOpen(true)
    try { localStorage.setItem(SHOWN_KEY, today()) } catch { /* ignore */ }
  }, [due, open, items.length])

  const newClasses = items.filter(n => n.kind === NEW_CLASS_KIND)
  const others = items.filter(n => n.kind !== NEW_CLASS_KIND)
  const close = () => { setOpen(false); setDue(false) }
  const openOne = (n: Notification) => { if (!n.readAt) markRead.mutate(n.id); close(); if (n.link) router.push(n.link) }

  return (
    <AnimatePresence>
      {open && (
        <BottomSheet label="What you missed" onClose={close}>
          <div className="dm px-5 pb-2 pt-4 sm:pt-6">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>While you were away</p>
            <h3 className="mt-1 pr-8 text-[18px] font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
              {[newClasses.length ? `${newClasses.length} new class${newClasses.length > 1 ? 'es' : ''} scheduled` : null,
                others.length ? `${others.length} notification${others.length > 1 ? 's' : ''} you missed` : null].filter(Boolean).join(' · ')}
            </h3>
          </div>
          <div className="dm min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-2">
            {[...newClasses, ...others].slice(0, 6).map(n => <NotificationRow key={n.id} n={n} onOpen={openOne} />)}
          </div>
          <div className="dm grid grid-cols-2 gap-2 px-4 pb-4 pt-3">
            <button type="button" onClick={() => { close(); setNotificationsOpen(true) }}
              className="flex items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-bold"
              style={{ background: 'var(--color-bg-inset)', color: 'var(--color-text-primary)' }}>
              <Bell size={15} />See all
            </button>
            <button type="button" onClick={() => { close(); router.push('/class-bookings') }}
              className="flex items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-bold text-white"
              style={{ background: 'var(--color-primary)' }}>
              <CalendarDays size={15} />View schedule
            </button>
          </div>
        </BottomSheet>
      )}
    </AnimatePresence>
  )
}
