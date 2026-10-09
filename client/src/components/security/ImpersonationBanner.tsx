'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, LogOut } from 'lucide-react'
import { api } from '@/lib/axios'
import type { CurrentUser, ImpersonationState } from '@/lib/api/user'

/* ─────────────────────────────────────────────────────
   ImpersonationBanner

   Deliberately not dismissable. The single largest risk in this feature is an
   admin forgetting whose account they are looking at, so the reminder has to
   outlast their patience with it.

   Mounted app-wide, which is why it must NOT fetch unconditionally: on a
   public page with no session, /auth/me answers 401 and the axios interceptor
   treats that as an expired session and bounces the visitor to /login. So the
   readable `lms_imp` flag cookie gates the query — no impersonation, no
   request, and ordinary visitors never notice this component exists.

   The flag carries no token. The httpOnly `lms_imp_at` cookie is the only
   thing that authenticates, so forging the flag buys a banner and nothing else.
───────────────────────────────────────────────────── */
function hasImpersonationFlag(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split('; ').some(c => c === 'lms_imp=1')
}

export function ImpersonationBanner() {
  /* Read after mount, never during render — the server has no document. */
  const [flagged, setFlagged] = useState(false)
  useEffect(() => { setFlagged(hasImpersonationFlag()) }, [])

  const { data } = useQuery({
    queryKey: ['impersonation', 'banner'],
    queryFn: async () => {
      const res = await api.get<{ data: { user: CurrentUser; impersonation?: ImpersonationState } }>('/auth/me')
      return res.data.data
    },
    enabled:   flagged,
    staleTime: 60_000,
    retry:     false,
  })

  const [exiting, setExiting] = useState(false)

  const imp = data?.impersonation
  if (!flagged || !imp) return null

  const exit = async () => {
    setExiting(true)
    try {
      await api.post('/auth/impersonation/exit')
    } catch {
      /* Exiting must work even if the call fails. Leaving the admin stuck
         inside the account would be the worse bug. */
    }
    /* Full reload, not a router push: every cached query belongs to the
       student and must not survive the switch back. */
    window.location.href = '/'
  }

  return (
    <div
      role="status"
      className="sticky top-0 z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-xs font-semibold"
      style={{ background: '#B45309', color: '#FFF7ED' }}>
      <span className="flex items-center gap-1.5">
        <Eye size={13} />
        Viewing as <strong>{data?.user?.name}</strong>
      </span>
      {imp.actorEmail && (
        <span style={{ opacity: 0.85 }}>· signed in as {imp.actorEmail}</span>
      )}
      {imp.readOnly === false
        ? <span style={{ opacity: 0.95 }}>· read &amp; write — changes you make are recorded as you</span>
        : <span style={{ opacity: 0.85 }}>· read-only</span>}
      <button
        onClick={exit}
        disabled={exiting}
        className="ml-1 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ background: 'rgba(0,0,0,0.25)', color: '#FFF7ED' }}>
        <LogOut size={12} />
        {exiting ? 'Exiting…' : 'Exit'}
      </button>
    </div>
  )
}
