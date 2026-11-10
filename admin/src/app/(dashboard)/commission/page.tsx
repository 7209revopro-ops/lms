'use client'
import { Coins, Loader2 } from 'lucide-react'
import { useCurrentUser } from '@/lib/api/user'
import { csError, useCsMentor } from '@/lib/api/csMeetings'
import { muted } from '@/components/cs-meetings/MeetingRequestsUi'
import { CommissionReportView } from '@/components/cs-meetings/CommissionReportUi'

/* Commission (the user, 2026-11-10: "the commission also they can see from the lms also same as the commission portal
   have") — the CS Portal's Commission report for the instructor signed in, by the same email: a Senior / Junior /
   Sub-junior Mentor their team's, a Chief their people's. An admin (not support): what their own CS Portal account
   may read there — everyone's, or a CS Manager their location's. Read only. */
const READERS = ['instructor', 'super_admin', 'admin', 'sub_admin']

export default function CommissionPage() {
  const { data: user } = useCurrentUser()
  const reads = READERS.includes(String(user?.role))
  const me = useCsMentor(reads)
  const allowed = !!(me.data?.mentor || me.data?.viewer)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'rgba(16,185,129,0.16)', color: '#34D399' }}><Coins className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Commission</h1>
          <p className="max-w-3xl text-sm" style={muted}>
            The CS Portal’s commission report — every commission credit in the period, by the person it is paid to: their own level and their pool shares, from bonuses and deposits. Read only.
          </p>
        </div>
      </div>
      {!user ? null
        : !reads ? <p className="text-sm" style={muted}>Commission is for mentors and admins.</p>
        : me.isLoading ? <p className="flex items-center gap-2 text-sm" style={muted}><Loader2 size={14} className="animate-spin" />Loading…</p>
        : me.isError ? <p className="rounded-xl px-4 py-3 text-sm" style={{ color: '#FBBF24', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>{csError(me.error, 'The CS Portal could not be asked')}</p>
        : !allowed ? <p className="text-sm" style={muted}>{me.data?.message || 'Your CS Portal account isn’t a mentor’s'} — the commission is for the CS Portal’s mentors and admins (by the same email).</p>
        : !me.data?.commission_report ? <p className="rounded-xl px-4 py-3 text-sm" style={{ color: '#FBBF24', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>This needs the CS Portal update (its API deploy).</p>
        : <CommissionReportView />}
    </div>
  )
}
