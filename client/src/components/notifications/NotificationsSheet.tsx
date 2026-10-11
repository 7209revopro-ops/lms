'use client'
/* The notifications drawer — the Notifications tab of the bottom bar on
   phones and tablets (the laptop header keeps its bell dropdown). Tapping a
   notification marks it read and opens its link. */
import { AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { Bell, CalendarPlus, CheckCheck, Sparkles, BookOpen, Trophy, Star, Info } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useNotifications, useMarkRead, useMarkAllRead, type Notification } from '@/lib/api/notifications'
import { useSheets } from '@/store/sheets.store'

export const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d < 7 ? `${d} d ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export const kindIcon = (k: Notification['kind']) =>
  k === 'live-class-scheduled' ? CalendarPlus : k === 'achievement' ? Trophy : k === 'review-posted' ? Star
    : k === 'course-complete' || k === 'lesson-complete' ? Sparkles : k === 'enrollment' ? BookOpen : Info

export function NotificationRow({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }) {
  const Icon = kindIcon(n.kind)
  const unread = !n.readAt
  const newClass = n.kind === 'live-class-scheduled'
  return (
    <button type="button" onClick={() => onOpen(n)}
      className="flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-hover)]"
      style={{ background: unread ? 'var(--color-primary-light)' : 'transparent' }}>
      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
        style={{ background: newClass ? 'rgba(245,158,11,0.14)' : 'rgba(0,87,184,0.10)', color: newClass ? '#B45309' : '#0057b8' }}>
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className="flex-1 text-[13px] font-semibold leading-snug" style={{ color: 'var(--color-text-primary)' }}>{n.title}</span>
          {unread && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: 'var(--color-primary)' }} aria-label="Unread" />}
        </span>
        {n.body && <span className="mt-0.5 block text-[12px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>{n.body}</span>}
        <span className="mt-1 block text-[10.5px]" style={{ color: 'var(--color-text-muted)' }}>{ago(n.createdAt)}</span>
      </span>
    </button>
  )
}

export function NotificationsSheet() {
  const { notificationsOpen, setNotificationsOpen } = useSheets()
  const router = useRouter()
  const { data, isLoading } = useNotifications({ per_page: 30 })
  const markRead = useMarkRead()
  const markAll = useMarkAllRead()
  const items = data?.items ?? []
  const unread = data?.unreadCount ?? 0
  const open = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id)
    setNotificationsOpen(false)
    if (n.link) router.push(n.link)
  }
  return (
    <AnimatePresence>
      {notificationsOpen && (
        <BottomSheet label="Notifications" onClose={() => setNotificationsOpen(false)}>
          <div className="dm flex items-center justify-between gap-3 px-5 pb-3 pt-4 sm:pt-5">
            <div>
              <h3 className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>Notifications</h3>
              <p className="text-[11.5px]" style={{ color: 'var(--color-text-muted)' }}>{unread ? `${unread} unread` : 'You are all caught up'}</p>
            </div>
            {unread > 0 && (
              <button type="button" onClick={() => markAll.mutate()} className="mr-8 flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold"
                style={{ background: 'var(--color-bg-inset)', color: 'var(--color-primary)' }}>
                <CheckCheck size={12} />Mark all read
              </button>
            )}
          </div>
          <div className="dm min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 pb-4">
            {isLoading ? (
              <p className="py-10 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Bell size={26} style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No notifications yet</p>
              </div>
            ) : items.map(n => <NotificationRow key={n.id} n={n} onOpen={open} />)}
          </div>
        </BottomSheet>
      )}
    </AnimatePresence>
  )
}
