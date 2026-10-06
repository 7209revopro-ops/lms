'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useStaffConversations, useStaffUnread } from '@/lib/api/chat'
import { useCurrentUser } from '@/lib/api/user'
import { useUIStore } from '@/store/ui.store'

/* WhatsApp-style ping for an instructor (plan.md §11.6): when a student's
   message arrives anywhere but that very conversation, a toast says who and
   what, and clicking it opens the chat. The tab title carries the unread count
   — "(3) …" — so a backgrounded tab still shows there is something waiting.
   Mounted ONCE in the dashboard layout — the sidebar mounts twice (desktop +
   mobile drawer), so a notifier there would toast every message twice.
   Rides the inbox's and the badge's own 15 s polls; adds no request of its own. */
export function ChatNotifier() {
  const { data: me } = useCurrentUser()
  const isInstructor = me?.role === 'instructor'
  const { firstPage } = useStaffConversations(isInstructor)
  const { data: unread = 0 } = useStaffUnread(isInstructor)
  const pathname = usePathname()
  const push = useUIStore(s => s.pushToast)
  const seen = useRef<Map<string, string> | null>(null)

  useEffect(() => {
    if (!firstPage) return
    const now = new Map(firstPage.map(c => [c.id, c.lastMessageAt]))
    /* The first load is the baseline — never toast history. */
    if (seen.current) {
      const fresh = firstPage.filter(c =>
        c.lastSenderRole === 'student' && c.unread > 0 && seen.current!.get(c.id) !== c.lastMessageAt)
      /* On the Messages page the list itself shows it; the open thread marks it read. */
      if (fresh.length && !pathname.startsWith('/messages')) {
        const c = fresh[0]!
        push(fresh.length === 1
          ? { kind: 'info', title: `New message from ${c.student?.name ?? 'a student'}`, body: c.lastMessagePreview, href: `/messages?c=${c.id}` }
          : { kind: 'info', title: `${fresh.length} new conversations`, body: c.lastMessagePreview, href: '/messages' })
      }
    }
    seen.current = now
  }, [firstPage, pathname, push])

  useEffect(() => {
    if (!isInstructor) return
    const strip = (t: string) => t.replace(/^\(\d+\+?\) /, '')
    document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${strip(document.title)}` : strip(document.title)
  }, [unread, isInstructor, pathname])

  return null
}
