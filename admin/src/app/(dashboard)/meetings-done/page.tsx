'use client'
import { CalendarCheck, Loader2 } from 'lucide-react'
import { useCurrentUser } from '@/lib/api/user'
import { csError, useCsMentor } from '@/lib/api/csMeetings'
import { useQueryState } from '@/lib/useQueryState'
import { muted } from '@/components/cs-meetings/MeetingRequestsUi'
import { MeetingCommissionTab, TeamMeetingsTab } from '@/components/cs-meetings/MeetingsDoneUi'

/* Meetings done (the user, 2026-11-10: "do same as the commission portal also in the lms admin") — the CS Portal's
   page for its mentors: a Senior, Junior or Sub-junior Mentor sees the Meeting commission tab only (the meetings that
   earned them commission); a Chief also their team's meetings, how each went, and Converted. Payment verification
   stays in the CS Portal. The days are Dubai days, this month unless changed. */

const dubaiToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10)
const DAY = /^\d{4}-\d{2}-\d{2}$/

export default function MeetingsDonePage() {
  const { data: user } = useCurrentUser()
  const isInstructor = user?.role === 'instructor'
  const me = useCsMentor(isInstructor)
  const today = dubaiToday()
  const [fromQ, setFrom] = useQueryState('from', '', { history: 'replace' })
  const [toQ, setTo] = useQueryState('to', '', { history: 'replace' })
  const [tabQ, setTab] = useQueryState('tab', '')
  const from = DAY.test(fromQ) ? fromQ : `${today.slice(0, 7)}-01`
  const to = DAY.test(toQ) ? toQ : today
  const tabs = (me.data?.meetings_done ?? ['commission']).map(k => [k, k === 'meetings' ? 'Meetings' : 'Meeting commission'] as const)
  const tab = tabs.some(([k]) => k === tabQ) ? tabQ : tabs[0]?.[0] ?? 'commission'
  const wrongWay = from > to
  const dateCls = 'rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm text-white outline-none'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'rgba(52,211,153,0.15)', color: '#34D399' }}><CalendarCheck className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Meetings Done</h1>
          <p className="text-sm" style={muted}>From the CS Portal — the meetings that earned commission{me.data?.meetings_done?.includes('meetings') ? ', and your team’s meetings with how each went' : ''}.</p>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-2 text-xs" style={muted}>
          <label className="flex items-center gap-1.5">From <input type="date" className={dateCls} value={from} max={today} onChange={e => setFrom(e.target.value)} style={{ colorScheme: 'dark' }} /></label>
          <label className="flex items-center gap-1.5">To <input type="date" className={dateCls} value={to} max={today} onChange={e => setTo(e.target.value)} style={{ colorScheme: 'dark' }} /></label>
        </div>
      </div>
      {!user ? null
        : !isInstructor ? <p className="text-sm" style={muted}>Meetings done is for mentors here — admins see it in the CS Portal.</p>
        : me.isLoading ? <p className="flex items-center gap-2 text-sm" style={muted}><Loader2 size={14} className="animate-spin" />Loading…</p>
        : me.isError ? <p className="rounded-xl px-4 py-3 text-sm" style={{ color: '#FBBF24', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>{csError(me.error, 'The CS Portal could not be asked')}</p>
        : !me.data?.mentor ? <p className="text-sm" style={muted}>{me.data?.message || 'Your CS Portal account isn’t a mentor’s'} — this page is for the CS Portal’s mentors.</p>
        : (
          <>
            {tabs.length > 1 && (
              <div role="tablist" className="inline-flex rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {tabs.map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium" style={tab === k ? { background: '#0057b8', color: '#fff' } : { color: 'rgba(255,255,255,0.7)' }}>{l}</button>
                ))}
              </div>
            )}
            {wrongWay ? <p className="text-sm text-rose-400">The From day is after the To day.</p>
              : tab === 'meetings' ? <TeamMeetingsTab days={{ from, to }} />
              : <MeetingCommissionTab days={{ from, to }} />}
          </>
        )}
    </div>
  )
}
