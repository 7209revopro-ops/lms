'use client'

import { Suspense, useDeferredValue, useEffect, useState } from 'react'
import { MessagesSquare, Eye } from 'lucide-react'
import { useOversightConversations, useOversightInstructors } from '@/lib/api/chat'
import { useCurrentUser } from '@/lib/api/user'
import { ChatPanel } from '@/components/chat/ChatPanel'
import Spinner from '@/components/ui/Spinner'

function useSettled(value: string, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return useDeferredValue(v)
}

/* Super admin, read-only: every student ↔ instructor chat, filtered by
   instructor; follows the org switcher (plan.md §11.2 C5). */
function Oversight() {
  const [instructorId, setInstructorId] = useState('')
  const [search, setSearch] = useState('')
  const { data: instructors } = useOversightInstructors()
  const list = useOversightConversations(instructorId, useSettled(search))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: 'rgba(250,204,21,0.12)', border: '1px solid rgba(250,204,21,0.3)' }}>
              <MessagesSquare size={16} style={{ color: '#FACC15' }} />
            </div>
            <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Chats</h1>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <Eye size={13} />Every student–instructor conversation. Read-only — viewing never marks anything read.
          </p>
        </div>
        <select value={instructorId} onChange={e => setInstructorId(e.target.value)} aria-label="Filter by instructor"
          className="max-w-full rounded-xl px-3 py-2 text-sm text-white outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', colorScheme: 'dark' }}>
          <option value="">All instructors</option>
          {(instructors ?? []).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>
      <ChatPanel mode="oversight" list={list} search={search} onSearch={setSearch}
        emptyText={instructorId ? 'This instructor has no conversations.' : 'No conversations yet.'} />
    </div>
  )
}

export default function ChatsPage() {
  const { data: me } = useCurrentUser()
  /* The route is reachable by URL; say so instead of a bare load error. */
  if (me && me.role !== 'super_admin') {
    return <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Chats are visible to super admins only.</p>
  }
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Spinner size={18} variant="muted" /></div>}>
      <Oversight />
    </Suspense>
  )
}
