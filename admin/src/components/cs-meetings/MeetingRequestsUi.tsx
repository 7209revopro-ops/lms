'use client'
/* ─────────────────────────────────────────────────────────────
   Meeting requests in the LMS admin (the user, 2026-11-10: "do same as the
   commission portal also in the lms admin") — the CS Portal's, for the
   mentor signed in here: a Senior, Junior or Sub-junior Mentor asks for a
   meeting with a student (any team's) — what it's for, how long, online or
   in person or left to the CS, and why; never the time. The student's CS
   picks the date and time and approves it in the CS Portal (it's booked then,
   with its emails), or rejects it. Another mentor's meeting with the student
   in the last 7 days blocks a new request. Here: the request form, the
   student's earlier meetings, a request opened with the 7-day check, and the
   inbox with a tab for where each stands (Converted among them).
───────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react'
import { CalendarClock, CalendarPlus, ChevronRight, Loader2, Search, ShieldAlert, X } from 'lucide-react'
import { useToast } from '@/store/ui.store'
import {
  csError, useAskForMeeting, useMeetingRequestReview, useMeetingStudents, useMyMeetingRequests, useStudentMeetingHistory, useTakeBackRequest,
  type Eligibility, type MeetingRequest, type MeetingStudent,
} from '@/lib/api/csMeetings'

export const MEETING_CATEGORIES: Array<[string, string]> = [['course_pitch', 'Course Pitch'], ['overview', 'Overview'], ['course_upgrade', 'Course Upgradation'], ['other', 'Other']]
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(MEETING_CATEGORIES)
/** The courses a Course Upgradation meeting is about (the CS Portal's course products). */
export const UPGRADE_COURSES = ['DWT', 'MSNR', 'DSLP', 'DSLP PRO', 'DQMP', 'DGMP']
export const categoryText = (category: string, course: string) => (category === 'course_upgrade' && course ? `Course Upgradation · ${course}` : CATEGORY_LABEL[category] || '')
export const STAGE_LABEL: Record<string, string> = { interested: 'Interested', follow_up: 'Follow-up', meeting_with: 'Meeting with mentor', revision: 'Revision', not_interested: 'Not interested' }
const STAGE_TONE: Record<string, [string, string]> = {
  interested: ['rgba(52,211,153,0.14)', '#34D399'], follow_up: ['rgba(251,191,36,0.14)', '#FBBF24'], meeting_with: ['rgba(129,140,248,0.16)', '#A5B4FC'],
  revision: ['rgba(56,189,248,0.14)', '#7DD3FC'], not_interested: ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0.6)'],
}
export function StageBadge({ stage, title }: { stage: string; title?: string }) {
  if (!stage) return null
  const [bg, color] = STAGE_TONE[stage] ?? STAGE_TONE['not_interested']!
  return <span title={title || undefined} className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: bg, color }}>{STAGE_LABEL[stage] ?? stage}</span>
}

/** Where a request stands (the CS Portal's viewsOf) — its tab and badge. */
export const VIEWS: Array<[string, string, string, string]> = [
  ['needs_review', 'Needs review', 'rgba(251,191,36,0.14)', '#FBBF24'],
  ['escalated', 'Escalated', 'rgba(251,146,60,0.15)', '#FB923C'],
  ['scheduled', 'Scheduled', 'rgba(96,165,250,0.14)', '#60A5FA'],
  ['held', 'Held', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.7)'],
  ['follow_up', 'Follow-up', 'rgba(167,139,250,0.15)', '#A78BFA'],
  ['converted', 'Converted', 'rgba(52,211,153,0.15)', '#34D399'],
  ['blocked', 'Blocked', 'rgba(248,113,113,0.14)', '#F87171'],
  ['rejected', 'Rejected', 'rgba(248,113,113,0.14)', '#F87171'],
  ['cancelled', 'Taken back', 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0.55)'],
  ['meeting_cancelled', 'Meeting cancelled', 'rgba(248,113,113,0.14)', '#F87171'],
]
const VIEW = Object.fromEntries(VIEWS.map(([k, l, bg, c]) => [k, { l, bg, c }]))
export function ViewBadge({ view }: { view: string }) {
  const v = VIEW[view] ?? { l: view, bg: 'rgba(255,255,255,0.07)', c: 'rgba(255,255,255,0.6)' }
  return <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: v.bg, color: v.c }}>{v.l}</span>
}
const STATUS_TEXT: Record<string, string> = { pending: 'Waiting for the CS', booking: 'Booking…', approved: 'Approved', rejected: 'Rejected', cancelled: 'Taken back', blocked: 'Blocked — 7-day rule' }

/** Online, in person (where), or left to the CS to confirm with the student. */
export const modeText = (r: Pick<MeetingRequest, 'mode' | 'in_person' | 'location'>, withPlace = true) =>
  r.mode === 'cs' ? 'CS to confirm online or in person' : r.in_person ? (withPlace && r.location ? `in person — ${r.location}` : 'in person') : 'online'
/** The CS Portal works in Dubai time. */
export const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' }) : '—')

export const muted = { color: 'rgba(255,255,255,0.45)' }
export const field = 'w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25'
const panel = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }

function Modal({ onClose, children, label }: { onClose: () => void; children: React.ReactNode; label: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label={label} className="relative max-h-[92dvh] w-full max-w-lg space-y-3 overflow-y-auto rounded-t-2xl border border-white/10 bg-[#0d1117] p-5 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-lg p-1.5 text-white/50 hover:bg-white/5"><X size={16} /></button>
        {children}
      </div>
    </div>
  )
}
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-3 py-1 text-sm"><span style={muted}>{label}</span><span className="text-right font-medium text-white">{children}</span></div>
)

/** A student's earlier meetings — held (with how it went) and asked for. */
export function StudentMeetingHistory({ studentId }: { studentId: string | null }) {
  const q = useStudentMeetingHistory(studentId)
  if (!studentId) return null
  const list = q.data?.meetings ?? []
  return (
    <div className="rounded-xl p-3" style={panel}>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={muted}>Previous meetings</p>
      {q.isLoading ? <p className="text-xs" style={muted}>Loading…</p>
        : q.isError ? <p className="text-xs text-rose-400">{csError(q.error, 'Could not load them')}</p>
        : !list.length ? <p className="text-xs" style={muted}>No meetings with this student yet.</p>
        : (
          <ul className="max-h-40 space-y-1.5 overflow-auto text-xs">
            {list.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium text-white/85">{when(m.at)}</span>
                <span className="text-white/65">{m.mentor || 'A mentor'}</span>
                {categoryText(m.category, m.course) && <span className="rounded px-1.5 text-[11px]" style={{ background: 'rgba(167,139,250,0.14)', color: '#C4B5FD' }}>{categoryText(m.category, m.course)}</span>}
                {m.kind === 'held' ? (m.outcome ? <StageBadge stage={m.outcome} /> : <span className="rounded px-1.5 text-[11px]" style={{ background: 'rgba(52,211,153,0.14)', color: '#34D399' }}>held</span>)
                  : <span className="rounded px-1.5 text-[11px]" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.65)' }}>{STATUS_TEXT[m.status ?? ''] ?? m.status}</span>}
                {(m.remark || m.reason) && <span className="w-full" style={muted}>{m.remark || m.reason}</span>}
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

/** Any team's student — name, code, email or phone (the CS Portal's students). */
function StudentPicker({ value, onPick }: { value: MeetingStudent | null; onPick: (s: MeetingStudent | null) => void }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t) }, [q])
  const res = useMeetingStudents(value ? '' : debounced)
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2">
        <div className="min-w-0 text-sm">
          <span className="font-semibold text-white">{value.name}</span>
          <span className="ml-1.5 text-xs" style={muted}>{[value.code, value.cs_name && `CS ${value.cs_name}`].filter(Boolean).join(' · ')}</span>
        </div>
        <button type="button" onClick={() => { onPick(null); setQ('') }} title="Pick another student" className="rounded p-1 text-white/50 hover:bg-white/5"><X size={14} /></button>
      </div>
    )
  }
  const list = res.data?.students ?? []
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={muted} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search any student — name, code, email or phone" className={`${field} pl-8`} autoFocus />
      </div>
      {debounced.length >= 2 && (
        <ul className="max-h-48 overflow-auto rounded-lg border border-white/10 text-sm">
          {res.isLoading ? <li className="px-3 py-2" style={muted}>Searching…</li>
            : res.isError ? <li className="px-3 py-2 text-rose-400">{csError(res.error, 'Could not search')}</li>
            : !list.length ? <li className="px-3 py-2" style={muted}>No student found.</li>
            : list.map(s => (
              <li key={s.id}>
                <button type="button" className="w-full px-3 py-2 text-left hover:bg-white/5" onClick={() => onPick(s)}>
                  <span className="font-semibold text-white">{s.name}</span>
                  <span className="ml-1.5 text-xs" style={muted}>{[s.code, s.cs_name && `CS ${s.cs_name}`].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

/** The mentor asks for a meeting with a student — the CS picks the time. */
export function RequestMeetingDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const send = useAskForMeeting()
  const [student, setStudent] = useState<MeetingStudent | null>(null)
  const [f, setF] = useState({ category: '', course: '', durationMins: '30', mode: 'online', location: '', notes: '' })
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }))
  const ready = !!student && !!f.category && (f.category !== 'course_upgrade' || !!f.course) && Number(f.durationMins) >= 15 && Number(f.durationMins) <= 180
    && (f.mode !== 'offline' || f.location.trim().length >= 2) && f.notes.trim().length >= 3
  const submit = async () => {
    if (!student) return
    setErr('')
    try {
      const d = await send.mutateAsync({
        studentId: student.id, category: f.category, course: f.category === 'course_upgrade' ? f.course : '', durationMins: Number(f.durationMins),
        mode: f.mode, location: f.mode === 'offline' ? f.location.trim() : '', notes: f.notes.trim(),
      })
      if (d?.blocked) toast.error('Blocked by the 7-day rule', d.message)
      else toast.success('Request sent', `${student.cs_name ? `${student.cs_name} (the CS)` : 'The CS'} picks the time — it shows here when it's booked.`)
      onClose()
    } catch (e) { setErr(csError(e, 'The request could not be sent')) }
  }
  return (
    <Modal onClose={onClose} label="Request a meeting">
      <div>
        <p className="flex items-center gap-2 text-lg font-semibold text-white"><CalendarPlus size={18} />Request a meeting</p>
        <p className="text-sm" style={muted}>The student's CS picks the date and time and approves it in the CS Portal — it's booked then, and shows here.</p>
      </div>
      <div className="space-y-1.5"><p className="text-xs font-semibold" style={muted}>Student *</p><StudentPicker value={student} onPick={setStudent} /></div>
      {student && <StudentMeetingHistory studentId={student.id} />}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs" style={muted}>What is it for *
          <select className={field} value={f.category} onChange={e => set('category', e.target.value)} style={{ colorScheme: 'dark' }}>
            <option value="">Pick…</option>{MEETING_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {f.category === 'course_upgrade' && (
          <label className="space-y-1 text-xs" style={muted}>Which course *
            <select className={field} value={f.course} onChange={e => set('course', e.target.value)} style={{ colorScheme: 'dark' }}>
              <option value="">Pick…</option>{UPGRADE_COURSES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        <label className="space-y-1 text-xs" style={muted}>Minutes
          <input type="number" min={15} max={180} step={15} className={field} value={f.durationMins} onChange={e => set('durationMins', e.target.value)} />
        </label>
        <label className={`space-y-1 text-xs ${f.category === 'course_upgrade' ? '' : 'sm:col-span-2'}`} style={muted}>Online or offline
          <select className={field} value={f.mode} onChange={e => set('mode', e.target.value)} style={{ colorScheme: 'dark' }}>
            <option value="online">Online — Google Meet</option>
            <option value="offline">Offline — in person</option>
            <option value="cs">Let the CS confirm with the student</option>
          </select>
        </label>
        {f.mode === 'offline' && (
          <label className="space-y-1 text-xs sm:col-span-2" style={muted}>Where *
            <input className={field} value={f.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Dubai office, room 2" />
          </label>
        )}
        <label className="space-y-1 text-xs sm:col-span-2" style={muted}>Reason for the meeting request *
          <textarea rows={3} className={field} value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Why you want to meet the student — the CS sees it" />
        </label>
      </div>
      {err && <p className="text-sm text-rose-400">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/80">Cancel</button>
        <button type="button" disabled={!ready || send.isPending} onClick={submit} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {send.isPending && <Loader2 size={14} className="animate-spin" />}Send request
        </button>
      </div>
    </Modal>
  )
}

/** The automatic 7-day check, worked out now. */
function EligibilityBox({ e }: { e?: Eligibility }) {
  if (!e) return null
  const tone = e.blocked ? { background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.3)' } : { background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.25)' }
  return (
    <div className="rounded-xl p-3" style={tone}>
      <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-white"><ShieldAlert size={15} style={{ color: e.blocked ? '#F87171' : '#34D399' }} />Automatic eligibility review</p>
      <Row label="Last meeting">{e.last ? `${e.last.days_ago === 0 ? 'today' : `${e.last.days_ago} day${e.last.days_ago === 1 ? '' : 's'} ago`} · ${e.last.mentor}` : 'none'}</Row>
      <Row label="7-day rule"><span style={{ color: e.blocked ? '#F87171' : '#34D399' }}>{e.blocked ? 'Blocked' : 'OK'}</span></Row>
      <Row label="Booked ahead">{e.upcoming?.length ? e.upcoming.map(u => `${when(u.at)} · ${u.mentor}`).join(', ') : 'No'}</Row>
      <p className="mt-1 text-xs" style={muted}>{e.message}{e.lms_checked === false ? ' (The LMS could not be asked — meetings booked there may be missing.)' : ''}</p>
    </div>
  )
}

/** A request of theirs opened: who, what, their reason, the 7-day check, where it stands; take back one still waiting. */
export function RequestReviewDialog({ request: initial, onClose }: { request: MeetingRequest; onClose: () => void }) {
  const toast = useToast()
  const rev = useMeetingRequestReview(initial.id)
  const takeBack = useTakeBackRequest()
  const r = rev.data?.request ?? initial
  const back = async () => {
    try { await takeBack.mutateAsync(r.id); toast.success('Taken back'); onClose() } catch (e) { toast.error("Couldn't take it back", csError(e)) }
  }
  return (
    <Modal onClose={onClose} label="Meeting request">
      <div className="pr-8">
        <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-white"><CalendarClock size={18} />Meeting request <ViewBadge view={r.view || (r.status === 'pending' ? 'needs_review' : r.status)} /></p>
        <p className="text-sm" style={muted}>{r.number} · asked {when(r.requested_at)}</p>
      </div>
      <div className="rounded-xl px-3 py-2" style={panel}>
        <Row label="Student">{r.student.name}{r.student.code ? ` · ${r.student.code}` : ''}</Row>
        <Row label="Their CS">{r.student.cs_name || '—'}</Row>
        <Row label="For">{categoryText(r.category, r.course) || '—'}</Row>
        <Row label="Length · where">{r.duration_mins} min · {modeText(r)}</Row>
        {r.notes && <div className="mt-1 border-t border-white/10 pt-2"><p className="text-xs" style={muted}>Your reason</p><p className="whitespace-pre-wrap text-sm text-white/90">{r.notes}</p></div>}
      </div>
      {rev.isLoading ? <p className="text-xs" style={muted}>Checking the 7-day rule…</p> : rev.isError ? <p className="text-xs text-rose-400">{csError(rev.error)}</p> : <EligibilityBox e={rev.data?.eligibility} />}
      {r.escalated && ['pending', 'blocked'].includes(r.status) && <p className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(251,146,60,0.1)', color: '#FDBA74' }}>With the CS Managers — escalated by {r.escalated.by_name} · {when(r.escalated.at)}{r.escalated.note ? ` — ${r.escalated.note}` : ''}</p>}
      {r.status === 'blocked' && r.blocked?.reason && <p className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(248,113,113,0.1)', color: '#FCA5A5' }}>Blocked when asked: {r.blocked.reason}</p>}
      {r.status === 'approved' && <p className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(52,211,153,0.1)', color: '#6EE7B7' }}>Booked for {when(r.scheduled_start)} (Dubai){r.decided_by_name ? ` by ${r.decided_by_name}` : ''}.{r.override_reason ? ` Approved anyway by ${r.override_by_name}: ${r.override_reason}` : ''}</p>}
      {r.status === 'rejected' && <p className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(248,113,113,0.1)', color: '#FCA5A5' }}>Rejected{r.decided_by_name ? ` by ${r.decided_by_name}` : ''}: {r.reason}</p>}
      <StudentMeetingHistory studentId={r.student.id} />
      <div className="flex justify-end gap-2">
        {r.status === 'pending' && <button type="button" disabled={takeBack.isPending} onClick={back} className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm text-rose-300 disabled:opacity-50">Take back</button>}
        <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/80">Close</button>
      </div>
    </Modal>
  )
}

/** Their requests: search, a tab per where each stands with its count, a card each that opens it. */
export function MeetingRequestInbox({ onNew }: { onNew: () => void }) {
  const res = useMyMeetingRequests()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('all')
  const [opened, setOpened] = useState<MeetingRequest | null>(null)
  const all = res.data?.requests ?? []
  const counts = res.data?.counts ?? {}
  const needle = q.trim().toLowerCase()
  const list = all.filter(r => (tab === 'all' || r.view === tab)
    && (!needle || [r.student.name, r.student.code, r.number, r.student.cs_name, categoryText(r.category, r.course)].some(v => String(v || '').toLowerCase().includes(needle))))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={muted} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search student, request or CS" className={`${field} rounded-full pl-8`} />
        </div>
        <button type="button" onClick={onNew} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white"><CalendarPlus size={15} />Request a meeting</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {[['all', 'All'] as [string, string], ...VIEWS.map(([k, l]) => [k, l] as [string, string])].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
            className="rounded-full px-3 py-1 text-sm font-medium transition-colors"
            style={tab === k ? { background: '#0057b8', color: '#fff', border: '1px solid #0057b8' } : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.09)' }}>
            {l}{counts[k] ? <span className="ml-1.5 text-xs opacity-70">{counts[k]}</span> : null}
          </button>
        ))}
      </div>
      {res.isLoading ? <p className="flex items-center gap-2 text-sm" style={muted}><Loader2 size={14} className="animate-spin" />Loading…</p>
        : res.isError ? <p className="rounded-xl px-4 py-3 text-sm" style={{ color: '#FBBF24', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>{csError(res.error, 'Could not load the requests')}</p>
        : !list.length ? <p className="rounded-xl px-4 py-8 text-center text-sm" style={{ ...panel, ...muted }}>{all.length ? 'Nothing here.' : 'No meeting requests yet.'}</p>
        : (
          <div className="grid gap-3 md:grid-cols-2">
            {list.map(r => (
              <button key={r.id} type="button" onClick={() => setOpened(r)}
                className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/[0.04]" style={panel}>
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-white">{r.student.name}</span><ViewBadge view={r.view} /></div>
                  <p className="text-xs" style={muted}>{[r.number, r.student.code, r.student.cs_name && `CS ${r.student.cs_name}`].filter(Boolean).join(' · ')}</p>
                  <p className="text-xs text-white/70">{categoryText(r.category, r.course)} · {r.duration_mins} min · {modeText(r, false)}{r.scheduled_start ? ` · ${when(r.scheduled_start)}` : ''}</p>
                </div>
                <ChevronRight size={16} className="shrink-0" style={muted} />
              </button>
            ))}
          </div>
        )}
      {opened && <RequestReviewDialog request={opened} onClose={() => setOpened(null)} />}
    </div>
  )
}
