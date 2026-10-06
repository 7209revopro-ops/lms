'use client'

import { Suspense, useDeferredValue, useEffect, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { useStaffConversations } from '@/lib/api/chat'
import { useCurrentUser } from '@/lib/api/user'
import { ChatPanel } from '@/components/chat/ChatPanel'
import Spinner from '@/components/ui/Spinner'

/* Typing asks the server once the typist pauses, not on every keystroke. */
function useSettled(value: string, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return useDeferredValue(v)
}

/* An instructor's inbox — only students who wrote to them (plan.md §11.2 C1). */
function Inbox() {
  const { data: me } = useCurrentUser()
  const isInstructor = me?.role === 'instructor'
  const [search, setSearch] = useState('')
  const list = useStaffConversations(isInstructor, useSettled(search))

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'rgba(0,87,184,0.18)', border: '1px solid rgba(0,87,184,0.4)' }}>
            <MessageCircle size={16} style={{ color: '#60A5FA' }} />
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Messages</h1>
        </div>
        <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Students of your programme who wrote to you. Reply here — they are notified.
        </p>
      </div>
      {me && !isInstructor ? (
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Messages are for instructors. Super admins can read every chat under Chats.</p>
      ) : (
        <ChatPanel mode="staff" list={list} search={search} onSearch={setSearch}
          emptyText="No messages yet. When a student writes to you, the conversation appears here." />
      )}
    </div>
  )
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Spinner size={18} variant="muted" /></div>}>
      <Inbox />
    </Suspense>
  )
}
