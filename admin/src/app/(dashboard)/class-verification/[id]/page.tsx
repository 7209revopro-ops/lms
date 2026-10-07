'use client'

/* ─────────────────────────────────────────────────────────────
   One class's verification: every booked student — phone, their CS from the
   commission portal, how the LMS saw them join — with Present / Absent for
   the mentor to confirm or correct and an optional note, then a short review
   of the class. Submit saves the marks and the review and verifies the class
   (POST /admin/class-verification/:id). Re-submitting edits it.
───────────────────────────────────────────────────────────── */
import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Star, Phone, UserCheck, UserX } from 'lucide-react'
import { useVerifyClass, useSubmitVerification, type VerifyStudent } from '@/lib/api/classVerification'
import { useToast } from '@/store/ui.store'
import Spinner from '@/components/ui/Spinner'

type Mark = { status: 'attended' | 'missed'; note: string }

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const muted = { color: 'rgba(255,255,255,0.45)' }
const box = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }

/* What the LMS saw, before the mentor's mark: joined (and how), or not. */
function joinedLabel(s: VerifyStudent): string {
  if (s.joinedAt) return `Joined ${new Date(s.joinedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${s.joinedVia === 'click' ? ' (link)' : s.joinedVia === 'livekit' ? ' (in-app)' : ''}`
  return 'No join recorded'
}

export default function VerifyClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const toast = useToast()
  const { data: cls, isLoading, isError } = useVerifyClass(id)
  const submit = useSubmitVerification(id)
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [rating, setRating] = useState(0)
  const [topics, setTopics] = useState('')
  const [issues, setIssues] = useState('')

  /* Start from what is stored: the automatic Present/Absent (an unmarked seat
     counts as present if a join was recorded), and any earlier review. */
  useEffect(() => {
    if (!cls) return
    setMarks(Object.fromEntries(cls.students.map(s => [s.bookingId, {
      status: s.status === 'booked' ? (s.joinedAt ? 'attended' : 'missed') : s.status,
      note: s.note ?? '',
    }])))
    setRating(cls.review.rating ?? 0)
    setTopics(cls.review.topics ?? '')
    setIssues(cls.review.issues ?? '')
  }, [cls])

  if (isLoading) return <div className="flex justify-center py-24"><Spinner size={24} /></div>
  if (isError || !cls) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm" style={{ color: '#F87171' }}>Class not found, or not yours to verify.</p>
        <Link href="/class-verification" className="mt-3 inline-block text-sm font-semibold" style={{ color: '#A78BFA' }}>Back to Class Verification</Link>
      </div>
    )
  }

  const present = Object.values(marks).filter(m => m.status === 'attended').length
  const setMark = (bookingId: string, patch: Partial<Mark>) =>
    setMarks(m => ({ ...m, [bookingId]: { ...(m[bookingId] ?? { status: 'missed', note: '' }), ...patch } }))

  async function onSubmit() {
    if (!rating) { toast.error('Give the class a rating (1–5) first.'); return }
    try {
      const r = await submit.mutateAsync({
        marks: Object.entries(marks).map(([bookingId, m]) => ({ bookingId, status: m.status, ...(m.note.trim() ? { note: m.note.trim() } : {}) })),
        rating, topics: topics.trim(), issues: issues.trim(),
      })
      toast.success(`Attendance verified — ${r.marked} student${r.marked === 1 ? '' : 's'} saved`)
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      toast.error(msg ?? 'Could not save the verification.')
    }
  }

  return (
    <div className="space-y-5">
      <Link href="/class-verification" className="inline-flex items-center gap-1.5 text-sm" style={muted}>
        <ArrowLeft size={14} />Class Verification
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">{cls.title}</h1>
          <p className="mt-1 text-sm" style={muted}>
            {when(cls.scheduledStart)} · {cls.durationMins} min · {cls.course?.title ?? '—'} · {cls.isOnline ? 'Online' : `In person${cls.location ? ` — ${[cls.location, cls.room].filter(Boolean).join(' · ')}` : ''}`}
            {cls.mentor ? ` · ${cls.mentor.name}` : ''}
          </p>
        </div>
        <span className="rounded-full px-3 py-1 text-xs font-semibold"
          style={cls.status === 'verified'
            ? { background: 'rgba(74,222,128,0.12)', color: '#4ADE80' }
            : cls.status === 'overdue' ? { background: 'rgba(248,113,113,0.12)', color: '#F87171' } : { background: 'rgba(251,191,36,0.12)', color: '#FBBF24' }}>
          {cls.status === 'verified' ? `Verified${cls.verifiedBy ? ` by ${cls.verifiedBy}` : ''}${cls.verifiedAt ? ` · ${when(cls.verifiedAt)}` : ''}` : cls.status === 'overdue' ? 'Overdue' : 'Waiting for verification'}
        </span>
      </div>

      {!cls.ended && (
        <p className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(251,191,36,0.08)', color: '#FBBF24' }}>
          This class has not ended yet — attendance can be verified once it has.
        </p>
      )}

      <div className="overflow-hidden rounded-2xl" style={box}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-sm font-semibold text-white">Students ({cls.students.length})</p>
          <p className="text-xs" style={muted}><span style={{ color: '#4ADE80' }}>{present} present</span> · <span style={{ color: '#F87171' }}>{cls.students.length - present} absent</span></p>
        </div>
        {cls.students.length === 0 ? (
          <p className="py-10 text-center text-sm" style={muted}>Nobody was booked on this class.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide" style={muted}>
                  <th className="px-4 py-2.5 font-semibold">Student</th>
                  <th className="px-4 py-2.5 font-semibold">Phone</th>
                  <th className="px-4 py-2.5 font-semibold">CS (commission portal)</th>
                  <th className="px-4 py-2.5 font-semibold">LMS saw</th>
                  <th className="px-4 py-2.5 font-semibold">Attendance</th>
                  <th className="px-4 py-2.5 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {cls.students.map(s => {
                  const m = marks[s.bookingId] ?? { status: 'missed' as const, note: '' }
                  return (
                    <tr key={s.bookingId} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-white">{s.name}</p>
                        <p className="text-xs" style={muted}>{s.email ?? ''}{s.studentCode ? ` · ${s.studentCode}` : ''}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
                        {s.phone ? <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone size={11} />{s.phone}</a> : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
                        {s.cs ?? (s.csOpen ? 'No CS yet' : '—')}{s.team ? <span style={muted}> · {s.team}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: s.joinedAt ? '#34D399' : 'rgba(255,255,255,0.4)' }}>{joinedLabel(s)}</td>
                      <td className="px-4 py-2.5">
                        <div className="inline-flex overflow-hidden rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                          {(['attended', 'missed'] as const).map(v => {
                            const on = m.status === v
                            const Icon = v === 'attended' ? UserCheck : UserX
                            return (
                              <button key={v} type="button" disabled={!cls.ended} onClick={() => setMark(s.bookingId, { status: v })}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
                                style={{ background: on ? (v === 'attended' ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)') : 'transparent',
                                         color: on ? (v === 'attended' ? '#10B981' : '#EF4444') : 'rgba(255,255,255,0.45)' }}>
                                <Icon size={12} />{v === 'attended' ? 'Present' : 'Absent'}
                              </button>
                            )
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <input value={m.note} maxLength={500} disabled={!cls.ended} onChange={e => setMark(s.bookingId, { note: e.target.value })}
                          placeholder="Optional" className="w-44 rounded-lg px-2.5 py-1 text-xs text-white outline-none disabled:opacity-40"
                          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-4 rounded-2xl p-5" style={box}>
        <p className="text-sm font-semibold text-white">Class review</p>
        <div>
          <p className="mb-1.5 text-xs" style={muted}>How did the class go?</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" disabled={!cls.ended} onClick={() => setRating(n)} aria-label={`${n} of 5`} className="disabled:opacity-40">
                <Star size={24} fill={n <= rating ? '#F59E0B' : 'none'} style={{ color: n <= rating ? '#F59E0B' : 'rgba(255,255,255,0.25)' }} />
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs" style={muted}>Topics covered</span>
          <textarea value={topics} onChange={e => setTopics(e.target.value)} maxLength={2000} rows={2} disabled={!cls.ended}
            className="w-full rounded-xl px-3 py-2 text-sm text-white outline-none disabled:opacity-40" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs" style={muted}>Issues (optional)</span>
          <textarea value={issues} onChange={e => setIssues(e.target.value)} maxLength={2000} rows={2} disabled={!cls.ended} placeholder="Audio, connection, students who left early…"
            className="w-full rounded-xl px-3 py-2 text-sm text-white outline-none disabled:opacity-40" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }} />
        </label>
        <button type="button" onClick={() => { void onSubmit() }} disabled={!cls.ended || submit.isPending}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}>
          {submit.isPending ? <Spinner size={13} /> : <CheckCircle2 size={15} />}
          {cls.status === 'verified' ? 'Save changes' : 'Verify attendance'}
        </button>
      </div>
    </div>
  )
}
