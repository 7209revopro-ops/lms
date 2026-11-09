'use client'
import { useState } from 'react'
import { ArrowLeft, Eye, Gauge, Loader2 } from 'lucide-react'
import { useCurrentUser } from '@/lib/api/user'
import { kpiError, useMentorKpis, useMyKpis, useTeamKpis } from '@/lib/api/mentorKpis'
import { KpiNotice, MentorMonthView, TeamTable, dubaiMonth, kpiMonths, monthLabel, when } from '@/components/mentor-kpis/MentorKpiViews'

/* Mentor KPIs (the user, 2026-11-09: "show the KPI points in the LMS admin too"). Worked out in Root, shown here view
   only: an instructor their own month (My KPIs, no ranking); an admin or sub-admin their academy's mentors, a super
   admin every mentor (Mentor KPIs) — each opens to every KPI. A frozen month's figure can be sent for a correction; a
   root admin decides in Root. Observation only — not used for salary, commission, bonuses or penalties. */

const TEAM_ROLES = ['super_admin', 'admin', 'sub_admin']
const muted = { color: 'rgba(255,255,255,0.45)' }

function Loading() {
  return <p className="flex items-center gap-2 text-sm" style={muted}><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>
}
function Failed({ error }: { error: unknown }) {
  return <p className="rounded-xl px-4 py-3 text-sm" style={{ color: '#F87171', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)' }}>{kpiError(error)}</p>
}

export default function MentorKpisPage() {
  const { data: user } = useCurrentUser()
  const role = user?.role ?? ''
  const isMentor = role === 'instructor'
  const isTeam = TEAM_ROLES.includes(role)
  const [month, setMonth] = useState(dubaiMonth())
  const [view, setView] = useState<string | null>(null)
  const own = useMyKpis(month, isMentor && !view)
  const team = useTeamKpis(month, isTeam && !view)
  const one = useMentorKpis(view, month)
  const observation = (view ? one.data : own.data ?? team.data)?.observationUntil

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'rgba(0,87,184,0.18)', color: '#60A5FA' }}><Gauge className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>{isMentor ? 'My KPIs' : 'Mentor KPIs'}</h1>
          <p className="text-sm" style={muted}>Planned, approved and worked out in Root — shown here.</p>
        </div>
        <div className="flex-1" />
        <select value={month} onChange={e => setMonth(e.target.value)} aria-label="Month" className="h-9 rounded-lg px-3 text-sm"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}>
          {kpiMonths().map(m => <option key={m} value={m} style={{ color: '#000' }}>{monthLabel(m)}</option>)}
        </select>
      </div>
      <div className="flex items-start gap-2 rounded-xl px-3 py-2 text-sm" style={{ color: '#FBBF24', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
        <Eye className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Observation mode{observation ? ` until ${when(observation)}` : ''}: not used for salary, commission, bonuses or penalties. Anything wrong in a finished month can be sent for a correction.</span>
      </div>

      {view ? (
        <>
          <button type="button" onClick={() => setView(null)} className="inline-flex items-center gap-1 text-sm hover:text-white" style={muted}><ArrowLeft className="h-4 w-4" />All mentors</button>
          {one.isLoading ? <Loading /> : one.isError ? <Failed error={one.error} /> : one.data?.closed || one.data?.missing ? <KpiNotice data={one.data} /> : one.data ? <MentorMonthView data={one.data} month={month} /> : null}
        </>
      ) : isMentor ? (
        own.isLoading ? <Loading /> : own.isError ? <Failed error={own.error} /> : own.data?.closed || own.data?.missing ? <KpiNotice data={own.data} /> : own.data ? <MentorMonthView data={own.data} month={month} /> : null
      ) : isTeam ? (
        team.isLoading ? <Loading /> : team.isError ? <Failed error={team.error} /> : team.data?.closed || team.data?.missing ? <KpiNotice data={team.data} /> : team.data ? <TeamTable data={team.data} onOpen={setView} /> : null
      ) : user ? (
        <p className="text-sm" style={muted}>Mentor KPIs are for instructors and admins.</p>
      ) : null}
    </div>
  )
}
