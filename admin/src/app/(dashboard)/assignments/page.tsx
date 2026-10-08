'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ClipboardList, CheckCircle2, XCircle, Clock, AlertTriangle, FileText,
  Image as ImageIcon, Search, User, BookOpen, Layers, Calendar, RotateCcw,
  Timer, Hourglass, Users, GraduationCap,
} from 'lucide-react'
import {
  useReviewQueue, useReviewAssignment, useReviewStats,
  type ReviewAssignment, type ClassAssignmentStatus,
  type InstructorPerformance, type ReviewStats,
} from '@/lib/api/classAssignments'
import { useCurrentUser } from '@/lib/api/user'
import { useToast } from '@/store/ui.store'
import { CsTag } from '@/components/ui/CsTag'

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
function fmtDateTime(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/* Hours are the API's unit because a submission judged in 20 minutes and one
   left for three weeks have to share a scale. Reading them back out in the
   unit a person would actually say. */
function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—'
  if (h < 1)  return `${Math.max(1, Math.round(h * 60))}m`
  if (h < 48) return `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

const STATUS: Record<ClassAssignmentStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  pending:  { label: 'Awaiting review', color: '#B45309', bg: 'rgba(245,158,11,0.10)', Icon: Clock },
  approved: { label: 'Approved',        color: '#059669', bg: 'rgba(16,185,129,0.10)', Icon: CheckCircle2 },
  rejected: { label: 'Sent back',       color: '#DC2626', bg: 'rgba(239,68,68,0.10)',  Icon: AlertTriangle },
}

/* ── The dashboard ───────────────────────────────────
   Four counts and two timings. The counts answer "how much is outstanding";
   the timings answer "how long has a student been waiting for it", which is
   the thing a queue length alone never tells you — ten submissions reviewed
   within the hour is a healthy screen, three left for a week is not, and the
   number 3 looks better than the number 10. */
function StatCards({ stats, loading }: { stats?: ReviewStats; loading: boolean }) {
  const t = stats?.totals
  const r = stats?.responsiveness

  const cards: {
    label: string; value: string; hint?: string
    Icon: React.ElementType; color: string; bg: string; alarm?: boolean
  }[] = [
    {
      label: 'Total submissions', value: loading ? '—' : String(t?.total ?? 0),
      Icon: ClipboardList, color: '#0057b8', bg: 'rgba(0,87,184,0.10)',
    },
    {
      label: 'Awaiting review', value: loading ? '—' : String(t?.pending ?? 0),
      hint: r?.oldestPendingHours ? `oldest waiting ${fmtHours(r.oldestPendingHours)}` : undefined,
      Icon: Clock, color: '#B45309', bg: 'rgba(245,158,11,0.10)',
      /* Two working days with no answer is the one thing worth colouring. */
      alarm: (r?.pendingOver48h ?? 0) > 0,
    },
    {
      label: 'Approved', value: loading ? '—' : String(t?.approved ?? 0),
      Icon: CheckCircle2, color: '#059669', bg: 'rgba(16,185,129,0.10)',
    },
    {
      label: 'Sent back', value: loading ? '—' : String(t?.rejected ?? 0),
      Icon: AlertTriangle, color: '#DC2626', bg: 'rgba(239,68,68,0.10)',
    },
    {
      label: 'Typical response', value: loading ? '—' : fmtHours(r?.medianResponseHours),
      /* Said out loud, because a reader will otherwise assume an average and
         wonder why one forgotten submission did not move it. */
      hint: 'median, not average',
      Icon: Timer, color: '#6D28D9', bg: 'rgba(109,40,217,0.10)',
    },
    {
      label: 'Waiting over 48h', value: loading ? '—' : String(r?.pendingOver48h ?? 0),
      Icon: Hourglass,
      color: (r?.pendingOver48h ?? 0) > 0 ? '#DC2626' : '#6B7280',
      bg:    (r?.pendingOver48h ?? 0) > 0 ? 'rgba(239,68,68,0.10)' : 'rgba(107,114,128,0.08)',
      alarm: (r?.pendingOver48h ?? 0) > 0,
    },
  ]

  return (
    <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map(c => (
        <div key={c.label} className="rounded-2xl bg-white p-3"
          style={{ border: `1px solid ${c.alarm ? 'rgba(239,68,68,0.28)' : '#E4E7ED'}` }}>
          <div className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: c.bg }}>
            <c.Icon size={13} style={{ color: c.color }} />
          </div>
          <p className="text-lg font-bold leading-tight" style={{ color: '#0D0F1A' }}>{c.value}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#6B7280' }}>{c.label}</p>
          {c.hint && (
            <p className="mt-0.5 text-[10px]" style={{ color: '#9CA3AF' }}>{c.hint}</p>
          )}
        </div>
      ))}
    </div>
  )
}

/* ── Per instructor ──────────────────────────────────
   Clicking a row filters the whole screen to that instructor — the cards and
   the queue both, because a dashboard that disagrees with the list under it
   is worse than no dashboard. The API applies the same filter to each. */
function InstructorPanel({ rows, selected, onSelect, loading }: {
  rows:     InstructorPerformance[]
  selected: string
  onSelect: (id: string) => void
  loading:  boolean
}) {
  const [open, setOpen] = useState(false)
  if (loading || rows.length === 0) return null

  const chosen = rows.find(r => r.id === selected)

  return (
    <div className="mb-4 rounded-2xl bg-white" style={{ border: '1px solid #E4E7ED' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <Users size={14} style={{ color: '#0057b8' }} />
        <span className="text-xs font-bold" style={{ color: '#0D0F1A' }}>
          By instructor
        </span>
        <span className="text-[11px]" style={{ color: '#6B7280' }}>
          {chosen ? `filtered to ${chosen.name}` : `${rows.length} with submissions`}
        </span>
        {chosen && (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); onSelect('') }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onSelect('') } }}
            className="ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: 'rgba(0,87,184,0.10)', color: '#0057b8', cursor: 'pointer' }}>
            Clear
          </span>
        )}
        <span className="ml-auto text-[11px]" style={{ color: '#9CA3AF' }}>{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="overflow-x-auto border-t" style={{ borderColor: '#E4E7ED' }}>
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr>
                {['Instructor', 'Total', 'Awaiting', 'Approved', 'Sent back', 'Approval', 'Typical response', 'Oldest waiting']
                  .map(h => (
                    <th key={h} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide"
                      style={{ color: '#9CA3AF' }}>{h}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const isOn = r.id === selected
                return (
                  <tr key={r.id}
                    onClick={() => onSelect(isOn ? '' : r.id)}
                    className="cursor-pointer transition-colors hover:bg-black/[0.02]"
                    style={{ borderTop: '1px solid #F1F3F7', background: isOn ? 'rgba(0,87,184,0.05)' : undefined }}>
                    <td className="px-3 py-2.5">
                      <p className="text-xs font-semibold" style={{ color: '#0D0F1A' }}>{r.name}</p>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{r.email}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#0D0F1A' }}>{r.total}</td>
                    <td className="px-3 py-2.5 text-xs font-semibold"
                      style={{ color: r.pending > 0 ? '#B45309' : '#9CA3AF' }}>{r.pending}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#059669' }}>{r.approved}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#DC2626' }}>{r.rejected}</td>
                    {/* An em dash, not 0% — this instructor has judged nothing
                        yet, which is not the same as approving nothing. */}
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#0D0F1A' }}>
                      {r.approvalRate === null ? '—' : `${r.approvalRate}%`}
                    </td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#0D0F1A' }}>
                      {fmtHours(r.medianResponseHours)}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-semibold"
                      style={{ color: (r.oldestPendingHours ?? 0) > 48 ? '#DC2626' : '#6B7280' }}>
                      {fmtHours(r.oldestPendingHours)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ── One submission ──────────────────────────────────── */
function ReviewCard({ a }: { a: ReviewAssignment }) {
  const review = useReviewAssignment()
  const toast  = useToast()
  const [rejecting, setRejecting] = useState(false)
  const [reason,    setReason]    = useState('')

  const { label, color, bg, Icon } = STATUS[a.status]
  const open = a.status === 'pending'

  const decide = async (decision: 'approved' | 'rejected') => {
    /* The API refuses a reasonless rejection with 400; catching it here just
       saves the round trip and keeps the cursor in the box. */
    if (decision === 'rejected' && !reason.trim()) {
      toast.error('Give a reason', 'The student needs to know what to change.')
      return
    }
    try {
      await review.mutateAsync({ id: a.id, decision, reason: decision === 'rejected' ? reason.trim() : undefined })
      toast.success(decision === 'approved' ? 'Approved' : 'Sent back to the student')
      setRejecting(false); setReason('')
    } catch (e: any) {
      const c = e?.response?.data?.error?.code
      if (c === 'ALREADY_REVIEWED') toast.error('Already reviewed', 'Someone else got here first — refresh.')
      else toast.error('Could not save', e?.response?.data?.error?.message ?? 'Please try again.')
    }
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
      className="rounded-2xl bg-white p-4" style={{ border: '1px solid #E4E7ED' }}>

      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: bg }}>
          <Icon size={15} style={{ color }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: bg, color }}>{label}</span>
            {a.attempt > 1 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: 'rgba(99,102,241,0.10)', color: '#4F46E5' }}>
                <RotateCcw size={9} />Revision · attempt {a.attempt}
              </span>
            )}
          </div>
          <p className="truncate text-sm font-bold" style={{ color: '#0D0F1A' }}>{a.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: '#6B7280' }}>
            <span className="flex items-center gap-1"><User size={10} />{a.studentId?.name ?? 'Student'}</span>
            <CsTag cs={a.studentId?.tetraCs} />
            <span className="flex items-center gap-1"><Calendar size={10} />{a.liveClassId?.title ?? 'Class'}</span>
            {a.instructorId?.name && (
              <span className="flex items-center gap-1 font-semibold" style={{ color: '#0057b8' }} title="Mentor who teaches this class">
                <GraduationCap size={11} />Mentor: {a.instructorId.name}
              </span>
            )}
            {a.courseId?.title && <span className="flex items-center gap-1"><BookOpen size={10} />{a.courseId.title}</span>}
            {a.sectionId?.title && <span className="flex items-center gap-1"><Layers size={10} />{a.sectionId.title}</span>}
            <span>Sent {fmtDateTime(a.submittedAt)}</span>
          </div>
        </div>
      </div>

      {a.note && (
        <p className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: '#F4F5F8', color: '#4B5563' }}>{a.note}</p>
      )}

      {a.files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {a.files.map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-blue-50"
              style={{ background: '#F4F5F8', border: '1px solid #E4E7ED', color: '#374151' }}>
              {f.mimeType === 'application/pdf'
                ? <FileText size={11} style={{ color: '#DC2626' }} />
                : <ImageIcon size={11} style={{ color: '#0057b8' }} />}
              <span className="max-w-[180px] truncate">{f.name}</span>
              <span style={{ color: '#9CA3AF' }}>{fmtSize(f.sizeBytes)}</span>
            </a>
          ))}
        </div>
      )}

      {/* What was said last time, while judging a revision. */}
      {a.reviews.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-semibold" style={{ color: '#6B7280' }}>
            Earlier decisions ({a.reviews.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {a.reviews.map((r, i) => (
              <li key={i} className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: '#F4F5F8', color: '#4B5563' }}>
                <span className="font-semibold">Attempt {r.attempt}: {r.status}</span>
                {r.reason && <> — {r.reason}</>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {open ? (
        <div className="mt-4">
          <AnimatePresence initial={false}>
            {rejecting && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden">
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={2000} autoFocus
                  placeholder="What should the student change? They receive this word for word."
                  className="mb-2 w-full resize-none rounded-xl px-3 py-2.5 text-xs outline-none"
                  style={{ border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.04)', color: '#0D0F1A' }} />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void decide('approved')} disabled={review.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              style={{ background: '#059669' }}>
              <CheckCircle2 size={13} />Approve
            </button>

            {!rejecting ? (
              <button type="button" onClick={() => setRejecting(true)} disabled={review.isPending}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-50"
                style={{ border: '1px solid rgba(239,68,68,0.30)', color: '#DC2626' }}>
                <XCircle size={13} />Send back
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void decide('rejected')} disabled={review.isPending}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: '#DC2626' }}>
                  <XCircle size={13} />Send back with this reason
                </button>
                <button type="button" onClick={() => { setRejecting(false); setReason('') }}
                  className="rounded-xl px-4 py-2 text-xs font-semibold"
                  style={{ border: '1px solid #E4E7ED', color: '#6B7280' }}>Cancel</button>
              </>
            )}
          </div>
        </div>
      ) : a.status === 'rejected' && a.lastReason ? (
        <div className="mt-3 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: '#DC2626' }}>
            Sent back — waiting on the student
          </p>
          <p className="text-xs" style={{ color: '#7F1D1D' }}>{a.lastReason}</p>
        </div>
      ) : (
        <p className="mt-3 text-[11px]" style={{ color: '#9CA3AF' }}>Reviewed {fmtDateTime(a.reviewedAt)}</p>
      )}
    </motion.div>
  )
}

/* ── Page ────────────────────────────────────────────── */
export default function AdminAssignmentsPage() {
  const [tab,          setTab]          = useState<'all' | ClassAssignmentStatus>('pending')
  const [search,       setSearch]       = useState('')
  const [instructorId, setInstructorId] = useState<string>('')

  /* The dashboard is its own request, not a count of `data`. The queue is
     capped at 200 and filtered by the tab above, so counting it would report
     "3 awaiting review" while meaning "3 on this page of this tab" — a figure
     that changes when you click a tab and is wrong the moment the backlog is
     real. The API counts every row in this caller's reach. */
  const stats = useReviewStats(instructorId || undefined)
  const { data, isLoading, isError, error } = useReviewQueue(tab, instructorId || undefined)

  /* The mentor dropdown lists EVERY mentor, so it reads the unfiltered figures:
     the filtered stats above shrink to the one mentor picked, which would leave
     no way to switch to another without clearing first. With no mentor picked
     this is the same query as `stats` — one request, from the cache. */
  const allStats = useReviewStats()
  const mentors = useMemo(
    () => [...(allStats.data?.instructors ?? [])].sort((x, y) => x.name.localeCompare(y.name)),
    [allStats.data],
  )
  /* An instructor only ever sees their own submissions — nothing to choose. */
  const { data: me } = useCurrentUser()
  const showMentorFilter = me?.role !== 'instructor' && mentors.length > 0

  const list = useMemo(() => {
    const rows = data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(a =>
      a.title.toLowerCase().includes(q) ||
      (a.studentId?.name ?? '').toLowerCase().includes(q) ||
      (a.studentId?.email ?? '').toLowerCase().includes(q) ||
      (a.instructorId?.name ?? '').toLowerCase().includes(q) ||
      (a.liveClassId?.title ?? '').toLowerCase().includes(q) ||
      (a.courseId?.title ?? '').toLowerCase().includes(q),
    )
  }, [data, search])

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-bold" style={{ color: '#0D0F1A' }}>
          <ClipboardList size={20} style={{ color: '#0057b8' }} />Assignments
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: '#6B7280' }}>
          Work students sent after a live class. Approve it, or send it back with a reason.
        </p>
      </div>

      <StatCards stats={stats.data} loading={stats.isLoading} />

      <InstructorPanel
        rows={stats.data?.instructors ?? []}
        selected={instructorId}
        onSelect={setInstructorId}
        loading={stats.isLoading}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([
          ['pending',  'Awaiting review'],
          ['rejected', 'Sent back'],
          ['approved', 'Approved'],
          ['all',      'All'],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key as typeof tab)}
            className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors"
            style={tab === key
              ? { background: '#0057b8', color: '#fff' }
              : { background: '#fff', color: '#6B7280', border: '1px solid #E4E7ED' }}>
            {label}
          </button>
        ))}

        {/* Mentor filter — the same filter as the "By instructor" panel above,
            so picking here or clicking a row there keeps both in step. */}
        {showMentorFilter && (
          <div className="relative ml-auto">
            <GraduationCap size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: instructorId ? '#0057b8' : '#9CA3AF' }} />
            <select value={instructorId} onChange={e => setInstructorId(e.target.value)}
              aria-label="Filter by mentor"
              className="max-w-[220px] cursor-pointer appearance-none rounded-xl py-2 pl-8 pr-7 text-xs font-semibold outline-none"
              style={instructorId
                ? { border: '1px solid #0057b8', background: 'rgba(0,87,184,0.06)', color: '#0057b8' }
                : { border: '1px solid #E4E7ED', background: '#fff', color: '#4B5563' }}>
              <option value="">All mentors</option>
              {mentors.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.pending > 0 ? ` · ${m.pending} waiting` : ''}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px]" style={{ color: '#9CA3AF' }}>▼</span>
          </div>
        )}

        <div className={`relative ${showMentorFilter ? '' : 'ml-auto '}min-w-[200px] flex-1 sm:max-w-xs`}>
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#9CA3AF' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student, mentor, class or title…"
            className="w-full rounded-xl py-2 pl-8 pr-3 text-xs outline-none"
            style={{ border: '1px solid #E4E7ED', background: '#fff', color: '#0D0F1A' }} />
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl bg-white p-10 text-center text-sm" style={{ border: '1px solid #E4E7ED', color: '#6B7280' }}>
          Loading…
        </div>
      ) : isError ? (
        <div className="rounded-2xl p-6 text-center"
          style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.20)' }}>
          <AlertTriangle size={20} style={{ color: '#DC2626' }} className="mx-auto mb-2" />
          <p className="text-sm font-semibold" style={{ color: '#DC2626' }}>Could not load the queue</p>
          <p className="mt-1 text-xs" style={{ color: '#7F1D1D' }}>
            {(error as any)?.response?.data?.error?.message ?? 'Please try again.'}
          </p>
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center" style={{ border: '1px solid #E4E7ED' }}>
          <ClipboardList size={22} style={{ color: '#9CA3AF' }} className="mx-auto mb-2" />
          <p className="text-sm font-semibold" style={{ color: '#0D0F1A' }}>
            {search ? 'Nothing matches that search' : tab === 'pending' ? 'Nothing waiting on you' : 'Nothing here'}
          </p>
          <p className="mt-1 text-xs" style={{ color: '#6B7280' }}>
            {search ? 'Try a different term.' : 'Submissions appear here as students send them.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence mode="popLayout">
            {list.map(a => <ReviewCard key={a.id} a={a} />)}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
