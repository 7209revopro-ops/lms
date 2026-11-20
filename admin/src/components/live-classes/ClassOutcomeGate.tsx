'use client'

import { useEffect, useState } from 'react'
import { Clock, ExternalLink, Star, Video } from 'lucide-react'
import { useCurrentUser } from '@/lib/api/user'
import { useToast } from '@/store/ui.store'
import { getActiveTimeZone, isoToDatetimeLocal, datetimeLocalToISO } from '@/lib/timezone'
import { usePendingClassOutcomes, useAnswerClassOutcome, type PendingClass } from '@/lib/api/classOutcomes'
import { markInstructorJoined } from '@/lib/api/liveClasses'
import { teaches } from '@/lib/teaching'

/* "Did the class end?" (the user, 2026-11-18: "after 30 min it will show a popup — ended or not, with review — it
   will never close"). For mentors, on every page: their classes 30 minutes after each starts, oldest first, one at
   a time — no close, no click-away. "Still going" puts it off until the timetable end (then every 15 minutes);
   "It ended" takes the end time and a short review, which ends the class and counts as its verification. Their
   class going on now (or next) stays one click away, so the pop-up never keeps them from it. */

const fieldCls = 'w-full rounded-xl px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/50'
const fieldStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', colorScheme: 'dark' } as React.CSSProperties

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>{label}</span>
      {children}
    </label>
  )
}

const hm = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
const dayOf = (iso: string, tz: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })

export function ClassOutcomeGate() {
  const { data: me } = useCurrentUser()
  const isMentor = teaches(me)
  const pending = usePendingClassOutcomes(isMentor)
  const classes = pending.data?.classes ?? []
  const nextClass = pending.data?.next ?? null
  const answer = useAnswerClassOutcome()
  const toast = useToast()
  const tz = getActiveTimeZone()

  const cls: PendingClass | undefined = classes[0]
  const [step, setStep] = useState<'ask' | 'review'>('ask')
  const [form, setForm] = useState({ endedAt: '', rating: 0, topics: '', issues: '', summary: '' })
  const [problem, setProblem] = useState('')

  /* A fresh form for each class: the end time starts at the timetable end, or now if that is still ahead. */
  useEffect(() => {
    if (!cls) return
    const end = Math.min(Date.parse(cls.endsAt), Date.now())
    setForm({ endedAt: isoToDatetimeLocal(new Date(end).toISOString(), tz), rating: 0, topics: '', issues: '', summary: '' })
    setStep(cls.endedAt ? 'review' : 'ask')
    setProblem('')
  }, [cls?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isMentor || !cls) return null

  const set = (patch: Partial<typeof form>) => { setForm(f => ({ ...f, ...patch })); setProblem('') }

  const send = async (body: Parameters<typeof answer.mutateAsync>[0]) => {
    try {
      const r = await answer.mutateAsync(body)
      if (r.stillRunning) toast.info('We will ask again later', r.askAgainAt ? `Around ${hm(r.askAgainAt, tz)}` : undefined)
      else toast.success('Class review saved', cls.title)
    } catch (err: any) {
      const status = err?.response?.status
      const msg = err?.response?.data?.error?.message ?? 'Could not save'
      // Answered elsewhere, verified on the Class Verification page, or cancelled meanwhile: it drops out on the refetch.
      if (status === 409 || status === 404) toast.info('Already taken care of', msg)
      else setProblem(msg)
    }
  }

  const submitReview = () => {
    if (!form.rating) { setProblem('Give the class a rating'); return }
    if (form.topics.trim().length < 3) { setProblem('Write what was covered'); return }
    let endedAt: string | undefined
    if (!cls.endedAt) {
      if (!form.endedAt) { setProblem('Say when it ended'); return }
      endedAt = datetimeLocalToISO(form.endedAt, tz)
      if (Date.parse(endedAt) < Date.parse(cls.startsAt)) { setProblem('It cannot end before it started'); return }
      if (Date.parse(endedAt) > Date.now() + 60_000) { setProblem('That time is still ahead'); return }
    }
    void send({ id: cls.id, rating: form.rating, topics: form.topics.trim(), issues: form.issues.trim(), summary: form.summary.trim(), ...(endedAt ? { endedAt } : {}) })
  }

  const where = cls.isOnline ? 'Online' : (cls.location || 'In person')

  return (
    <div className="fixed inset-0 z-[61] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      role="dialog" aria-modal="true" aria-labelledby="class-outcome-title">
      <div className="relative max-h-[92dvh] w-full max-w-[500px] overflow-y-auto rounded-3xl p-6"
        style={{ background: '#13162A', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 32px 80px rgba(0,0,0,0.6)' }}>
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'rgba(0,87,184,0.16)', border: '1px solid rgba(0,87,184,0.35)' }}>
            <Video size={20} style={{ color: '#60A5FA' }} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="class-outcome-title" className="text-lg font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              {step === 'ask' ? 'Has this class ended?' : 'How did the class go?'}
            </h2>
            <p className="text-sm font-semibold text-white/80">{cls.title}</p>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {dayOf(cls.startsAt, tz)} · {hm(cls.startsAt, tz)}–{hm(cls.endsAt, tz)} · {where} · {cls.booked} booked
            </p>
            {(cls.course || cls.module) && <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{[cls.course, cls.module].filter(Boolean).join(' · ')}</p>}
          </div>
          {classes.length > 1 && (
            <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'rgba(245,158,11,0.15)', color: '#FBBF24' }}>
              1 of {classes.length}
            </span>
          )}
        </div>

        {step === 'ask' ? (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
              {cls.pastEnd
                ? `It was due to end at ${hm(cls.endsAt, tz)}.`
                : `It started at ${hm(cls.startsAt, tz)} and is due to end at ${hm(cls.endsAt, tz)}.`}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={answer.isPending} onClick={() => void send({ id: cls.id, stillRunning: true })}
                className="rounded-xl px-4 py-3 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 disabled:opacity-60"
                style={{ border: '1px solid rgba(255,255,255,0.14)' }}>
                <Clock size={14} className="mr-1.5 inline -translate-y-px" />Still going
              </button>
              <button type="button" onClick={() => setStep('review')}
                className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500">
                Yes, it ended
              </button>
            </div>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {cls.pastEnd ? '"Still going" asks again in 15 minutes.' : `"Still going" asks again at ${hm(cls.endsAt, tz)}.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {cls.endedAt ? (
              <p className="rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(16,185,129,0.1)', color: '#6EE7B7' }}>
                Google Meet shows it ended at {hm(cls.endedAt, tz)}.
              </p>
            ) : (
              <Field label={`When did it end? (${(tz.split('/')[1] ?? tz).replace('_', ' ')} time)`}>
                <input type="datetime-local" className={fieldCls} style={fieldStyle} value={form.endedAt} onChange={e => set({ endedAt: e.target.value })} />
              </Field>
            )}
            <Field label="How did it go?">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} type="button" onClick={() => set({ rating: n })} aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    className="rounded-lg p-1.5 transition-colors hover:bg-white/5">
                    <Star size={22} fill={n <= form.rating ? '#FBBF24' : 'transparent'} style={{ color: n <= form.rating ? '#FBBF24' : 'rgba(255,255,255,0.3)' }} />
                  </button>
                ))}
              </div>
            </Field>
            <Field label="What was covered">
              <textarea rows={2} className={fieldCls} style={fieldStyle} value={form.topics} onChange={e => set({ topics: e.target.value })} placeholder="Pivot tables, slicers, the practice file" />
            </Field>
            <Field label="Any issues (optional)">
              <textarea rows={2} className={fieldCls} style={fieldStyle} value={form.issues} onChange={e => set({ issues: e.target.value })} placeholder="Audio dropped for 5 minutes" />
            </Field>
            <Field label="Summary (optional)">
              <textarea rows={2} className={fieldCls} style={fieldStyle} value={form.summary} onChange={e => set({ summary: e.target.value })} />
            </Field>
            <div className="flex items-center justify-between gap-2 pt-1">
              {!cls.endedAt ? (
                <button type="button" onClick={() => { setStep('ask'); setProblem('') }} className="rounded-xl px-3 py-2 text-sm text-white/55 hover:bg-white/5">Back</button>
              ) : <span />}
              <button type="button" disabled={answer.isPending} onClick={submitReview}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-60">
                {answer.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {problem && <p className="mt-3 text-sm text-red-400">{problem}</p>}

        {nextClass && (
          <div className="mt-5 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="min-w-0 flex-1 truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {Date.parse(nextClass.startsAt) <= Date.now() ? 'On now' : `Next at ${hm(nextClass.startsAt, tz)}`}: <span className="text-white/85">{nextClass.title}</span>
            </span>
            {nextClass.meetingUrl && (
              <a href={nextClass.meetingUrl} target="_blank" rel="noopener noreferrer" onClick={() => markInstructorJoined(nextClass.id)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 font-semibold text-white" style={{ background: '#16A34A' }}>
                <ExternalLink size={11} />Join
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
