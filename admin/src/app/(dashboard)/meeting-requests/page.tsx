'use client'
import { CalendarClock, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useCurrentUser } from '@/lib/api/user'
import { csError, useCsMentor } from '@/lib/api/csMeetings'
import { useQueryState } from '@/lib/useQueryState'
import { MeetingRequestInbox, RequestMeetingDialog, muted } from '@/components/cs-meetings/MeetingRequestsUi'

/* Meeting Requests (the user, 2026-11-10: "do same as the commission portal also in the lms admin") — the CS Portal's
   page for a Senior, Junior or Sub-junior Mentor: every meeting they asked for and where it stands (Needs review,
   Scheduled, Held, Follow-up, Converted, Blocked, Rejected, Taken back…), and asking for a new one. The student's CS
   picks the time and approves it in the CS Portal. A Chief books student meetings on the Mentor Calendar instead.
   An admin (2026-11-10, "show in the sidebar the meeting done and meeting request"): the requests their own CS Portal
   account decides, read only — approved or rejected in the CS Portal. */
const READERS = ['instructor', 'super_admin', 'admin', 'sub_admin']

export default function MeetingRequestsPage() {
  const { data: user } = useCurrentUser()
  const reads = READERS.includes(String(user?.role))
  const me = useCsMentor(reads)
  const viewer = !!me.data?.viewer
  /* ?new=1 opens the form — the Mentor Calendar sends a mentor here to ask for a student meeting. */
  const [asking, setAsking] = useQueryState('new', false, { history: 'replace' })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'rgba(0,87,184,0.18)', color: '#60A5FA' }}><CalendarClock className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Meeting Requests</h1>
          <p className="max-w-3xl text-sm" style={muted}>
            {viewer
              ? 'Mentors’ requests for student meetings that your CS Portal account decides, and where each stands — read only here; approve or reject them in the CS Portal.'
              : 'Every student meeting you asked for and where it stands. The student’s CS picks the date and time and approves it in the CS Portal. Another mentor’s meeting with the student in the last 7 days blocks a new request.'}
          </p>
        </div>
      </div>
      {!user ? null
        : !reads ? <p className="text-sm" style={muted}>Meeting requests are for mentors and admins.</p>
        : me.isLoading ? <p className="flex items-center gap-2 text-sm" style={muted}><Loader2 size={14} className="animate-spin" />Loading…</p>
        : me.isError ? <p className="rounded-xl px-4 py-3 text-sm" style={{ color: '#FBBF24', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>{csError(me.error, 'The CS Portal could not be asked')}</p>
        : viewer ? <MeetingRequestInbox readOnly />
        : !me.data?.mentor ? <p className="text-sm" style={muted}>{me.data?.message || 'Your CS Portal account isn’t a mentor’s'} — meeting requests are for the CS Portal’s mentors and admins (by the same email).</p>
        : !me.data.asks ? <p className="text-sm" style={muted}>As a Chief Mentor you book student meetings straight away on the <Link href="/mentor-calendar" className="text-[#60A5FA] hover:underline">Mentor Calendar</Link> — no request needed.</p>
        : <MeetingRequestInbox onNew={() => setAsking(true)} />}
      {asking && me.data?.mentor && me.data.asks && <RequestMeetingDialog onClose={() => setAsking(false)} />}
    </div>
  )
}
