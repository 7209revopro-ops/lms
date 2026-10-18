'use client'
/* A mentor's reply while the student is not looking at the app (another tab,
   minimised, the installed app in the background): the browser's own alert,
   once they turned message alerts on (the Messages page offers it). Mounted
   once, in the dashboard layout. The bell notification arrives as before. */
import { useEffect, useRef } from 'react'
import { useChatConversations } from '@/lib/api/chat'
import { useCurrentUser } from '@/lib/api/user'
import { showDesktopAlert, useDesktopAlerts } from '@/lib/desktopAlerts'

export function ChatAlerts() {
  const { data: me } = useCurrentUser()
  const { on } = useDesktopAlerts()
  const enabled = on && me?.role === 'student' && !me?.impersonation
  const { data: convs } = useChatConversations({ background: true, enabled })
  const seen = useRef<Map<string, string> | null>(null)

  useEffect(() => {
    if (!convs) return
    const now = new Map(convs.map(c => [c.id, c.lastMessageAt]))
    /* The first load is the baseline — never alert history. */
    if (seen.current) {
      const fresh = convs.filter(c => c.lastSenderRole === 'instructor' && c.unread > 0 && seen.current!.get(c.id) !== c.lastMessageAt)
      const c = fresh[0]
      if (c) void showDesktopAlert(
        fresh.length === 1 ? `New message from ${c.instructor?.name ?? 'your instructor'}` : `${fresh.length} new messages`,
        c.lastMessagePreview, fresh.length === 1 ? `/messages?c=${c.id}` : '/messages')
    }
    seen.current = now
  }, [convs])

  return null
}
