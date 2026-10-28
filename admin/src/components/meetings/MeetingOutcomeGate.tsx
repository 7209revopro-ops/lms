'use client'

import { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { useCurrentUser } from '@/lib/api/user'
import { useToast } from '@/store/ui.store'
import Spinner from '@/components/ui/Spinner'
import { getActiveTimeZone } from '@/lib/timezone'
import {
  usePendingMeetingOutcomes, useMeetingOutcomeOptions, useSaveMeetingOutcome,
  type ClientProfile, type OutcomeInput, type OutcomeStage, type PendingMeeting,
} from '@/lib/api/meetingOutcomes'

/* After a student meeting is over, its mentor says how it went (the user, 2026-10-27: "a popup form … it closes only
   after it is filled"). On every page, for mentors: the meetings waiting, oldest first, one at a time — no close,
   no click-away; only Save takes one off. Two steps (2026-10-27): how it went, with the client's concern; then who
   the client is — started from what the last meeting with them said. The same meeting may be filled in CS Portal: the first counts, and
   this one then drops out (told so). */

const STAGE_LABEL: Record<OutcomeStage, string> = {
  interested: 'Interested',
  follow_up: 'Follow-up',
  meeting_with: 'Meeting with a mentor',
  revision: 'Revision',
  not_interested: 'Not interested',
}
const FOLLOW_UP_LABEL: Record<string, string> = { cse_follow_up: 'CSE follow-up', revision_needed: 'Revision needed' }
const EXPERIENCE_LABEL: Record<string, string> = { fresher: 'Fresher', beginner: 'Beginner', expert: 'Expert' }
const LOSS_WAY_LABEL: Record<string, string> = { scammed: 'Scammed by someone', self_trading: 'Self trading', money_management: 'Given for money management' }

const fieldCls = 'w-full rounded-xl px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500/50'
const fieldStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', colorScheme: 'dark' } as React.CSSProperties

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>{label}</span>
      {children}
    </label>
  )
}

const when = (m: PendingMeeting) => {
  const tz = getActiveTimeZone()
  const d = new Date(m.startsAt)
  return `${d.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}–${new Date(m.endsAt).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}`
}

const empty: OutcomeInput = { stage: '' as OutcomeStage, remark: '', concern: '' }
const emptyProfile: ClientProfile = { experience: '', years: '', hadLosses: null, lossAmount: '', lossCurrency: 'AED', lossHow: [], country: '', familyInDubai: null, occupation: '' }

const pill = (on: boolean): React.CSSProperties => on
  ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(129,140,248,0.7)', color: '#fff' }
  : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }

/** One choice of a few, as buttons. */
function Pills<T extends string | boolean>({ value, options, onPick }: { value: T | null | ''; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" onClick={() => onPick(v)} className="rounded-xl px-3 py-2 text-sm font-semibold transition-colors" style={pill(value === v)}>{label}</button>
      ))}
    </div>
  )
}

export function MeetingOutcomeGate() {
  const { data: me } = useCurrentUser()
  const isMentor = me?.role === 'instructor'
  const pending = usePendingMeetingOutcomes(isMentor)
  const meetings = pending.data ?? []
  const options = useMeetingOutcomeOptions(isMentor && meetings.length > 0)
  const save = useSaveMeetingOutcome()
  const toast = useToast()

  const meeting = meetings[0]
  const [form, setForm] = useState<OutcomeInput>(empty)
  const [profile, setProfile] = useState<ClientProfile>(emptyProfile)
  const [step, setStep] = useState<1 | 2>(1)
  const [problem, setProblem] = useState('')
  // A fresh form for each meeting — the second step from the last answers about this client, if any.
  useEffect(() => {
    setForm(empty); setStep(1); setProblem('')
    setProfile(meeting?.lastProfile ? { ...emptyProfile, ...meeting.lastProfile, years: meeting.lastProfile.years ?? '', lossAmount: meeting.lastProfile.lossAmount ?? '', lossCurrency: meeting.lastProfile.lossCurrency || 'AED' } : emptyProfile)
  }, [meeting?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const course = useMemo(() => options.data?.courses.find((c) => c.id === form.courseId), [options.data, form.courseId])
  const set = (patch: Partial<OutcomeInput>) => { setForm((f) => ({ ...f, ...patch })); setProblem('') }
  const setP = (patch: Partial<ClientProfile>) => { setProfile((p) => ({ ...p, ...patch })); setProblem('') }

  if (!isMentor || !meeting) return null

  const missing = (): string => {
    if (!form.stage) return 'Pick where the client stands'
    if (form.stage === 'interested' && (!form.courseId || !form.paymentDate || !form.paymentMode)) return 'Pick the course, the payment date and how they will pay'
    if (form.stage === 'follow_up' && (!form.followUpKind || !form.followUpDate)) return 'Pick the follow-up and its date'
    if (form.stage === 'meeting_with' && !form.withMentorEmail) return 'Pick the mentor they will meet'
    if (form.stage === 'revision' && !form.courseId) return 'Pick the course to revise'
    if (form.stage === 'not_interested' && !form.reason) return 'Pick why they are not interested'
    if (!form.concern.trim()) return 'Write the client\'s concern'
    if (!form.remark.trim()) return 'Write a remark'
    return ''
  }
  const missingProfile = (): string => {
    const p = profile
    if (!p.experience) return 'Pick their trading experience'
    if (p.experience !== 'fresher' && (p.years === '' || p.years === null || Number(p.years) < 0)) return 'Type how many years they have traded'
    if (p.hadLosses === null) return 'Say whether they have had losses'
    if (p.hadLosses && !(Number(p.lossAmount) > 0)) return 'Type how much they lost'
    if (p.hadLosses && !p.lossHow.length) return 'Pick how it was lost'
    if (!p.country.trim()) return 'Type their country of residence'
    if (p.familyInDubai === null) return 'Say whether their family is in Dubai'
    if (!p.occupation.trim()) return 'Type their occupation or business'
    return ''
  }

  const submit = async () => {
    const why = missing()
    if (why) { setStep(1); setProblem(why); return }
    if (step === 1) { setStep(2); return }
    const whyP = missingProfile()
    if (whyP) { setProblem(whyP); return }
    const p = profile
    const sent: ClientProfile = {
      ...p,
      years: p.experience === 'fresher' ? null : Number(p.years),
      lossAmount: p.hadLosses ? Number(p.lossAmount) : null,
      lossHow: p.hadLosses ? p.lossHow : [],
      lossCurrency: p.hadLosses ? p.lossCurrency : '',
    }
    try {
      await save.mutateAsync({ id: meeting.id, ...form, profile: sent })
      toast.success('Outcome saved', meeting.title)
    } catch (err: any) {
      const status = err?.response?.status
      const msg = err?.response?.data?.error?.message ?? 'Could not save'
      // Filled already (CS Portal) or no longer this mentor's: it drops out on the refetch.
      if (status === 409 || status === 404) toast.info('Already taken care of', msg)
      else setProblem(msg)
    }
  }

  const stages = (options.data?.stages ?? Object.keys(STAGE_LABEL)) as OutcomeStage[]

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      role="dialog" aria-modal="true" aria-labelledby="meeting-outcome-title">
      <div className="relative max-h-[92dvh] w-full max-w-[520px] overflow-y-auto rounded-3xl p-6"
        style={{ background: '#13162A', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 32px 80px rgba(0,0,0,0.6)' }}>
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.3)' }}>
            <ClipboardCheck size={20} style={{ color: '#818CF8' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#818CF8' }}>Step {step} of 2</p>
            <h2 id="meeting-outcome-title" className="text-lg font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>{step === 1 ? 'How did the meeting go?' : 'About the client'}</h2>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {meeting.title} · {when(meeting)}
            </p>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              With {meeting.attendees.map((a) => a.name).join(', ') || '—'}
            </p>
          </div>
          {meetings.length > 1 && (
            <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'rgba(245,158,11,0.15)', color: '#FBBF24' }}>
              1 of {meetings.length}
            </span>
          )}
        </div>

        {options.isLoading ? (
          <div className="flex justify-center py-10"><Spinner size={20} /></div>
        ) : step === 2 ? (
          <div className="space-y-3">
            {meeting.lastProfile && <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Filled from the last meeting with them — change what is new.</p>}
            <Field label="Trading experience">
              <Pills value={profile.experience} options={(options.data?.experience ?? ['fresher', 'beginner', 'expert']).map((e) => [e, EXPERIENCE_LABEL[e] ?? e] as [ClientProfile['experience'], string])}
                onPick={(v) => setP({ experience: v })} />
            </Field>
            {profile.experience && profile.experience !== 'fresher' && (
              <Field label="Years trading">
                <input type="number" min={0} max={60} step="0.5" inputMode="decimal" className={fieldCls} style={fieldStyle} value={profile.years ?? ''} onChange={(e) => setP({ years: e.target.value })} placeholder="e.g. 2" />
              </Field>
            )}
            <Field label="Have they had losses?">
              <Pills value={profile.hadLosses} options={[[true, 'Yes'], [false, 'No']]} onPick={(v) => setP({ hadLosses: v })} />
            </Field>
            {profile.hadLosses && (
              <>
                <div className="grid grid-cols-[1fr_110px] gap-3">
                  <Field label="How much was lost">
                    <input type="number" min={0} inputMode="decimal" className={fieldCls} style={fieldStyle} value={profile.lossAmount ?? ''} onChange={(e) => setP({ lossAmount: e.target.value })} placeholder="Amount" />
                  </Field>
                  <Field label="Currency">
                    <select className={fieldCls} style={fieldStyle} value={profile.lossCurrency} onChange={(e) => setP({ lossCurrency: e.target.value })}>
                      {(options.data?.lossCurrencies ?? ['AED', 'USD', 'INR']).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="How it was lost (any that apply)">
                  <div className="flex flex-wrap gap-2">
                    {(options.data?.lossWays ?? Object.keys(LOSS_WAY_LABEL)).map((w) => {
                      const on = profile.lossHow.includes(w)
                      return (
                        <button key={w} type="button" className="rounded-xl px-3 py-2 text-sm font-semibold transition-colors" style={pill(on)}
                          onClick={() => setP({ lossHow: on ? profile.lossHow.filter((x) => x !== w) : [...profile.lossHow, w] })}>
                          {LOSS_WAY_LABEL[w] ?? w}
                        </button>
                      )
                    })}
                  </div>
                </Field>
              </>
            )}
            <Field label="Country of residence">
              <input className={fieldCls} style={fieldStyle} maxLength={80} value={profile.country} onChange={(e) => setP({ country: e.target.value })} placeholder="e.g. UAE" />
            </Field>
            <Field label="Family in Dubai?">
              <Pills value={profile.familyInDubai} options={[[true, 'Yes'], [false, 'No']]} onPick={(v) => setP({ familyInDubai: v })} />
            </Field>
            <Field label="Occupation / business">
              <input className={fieldCls} style={fieldStyle} maxLength={200} value={profile.occupation} onChange={(e) => setP({ occupation: e.target.value })} placeholder="e.g. Engineer, runs a restaurant" />
            </Field>

            {problem && <p className="text-sm" style={{ color: '#F87171' }}>{problem}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => { setStep(1); setProblem('') }} disabled={save.isPending}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold transition-colors hover:bg-white/[0.08]"
                style={{ color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}>
                Back
              </button>
              <button type="button" onClick={submit} disabled={save.isPending}
                className="flex flex-[2] items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: '#6366F1' }}>
                {save.isPending ? <><Spinner size={14} />Saving…</> : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Where the client stands">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {stages.map((s) => (
                  <button key={s} type="button" onClick={() => set({ ...empty, remark: form.remark, concern: form.concern, stage: s })}
                    className="rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors"
                    style={pill(form.stage === s)}>
                    {STAGE_LABEL[s] ?? s}
                  </button>
                ))}
              </div>
            </Field>

            {(form.stage === 'interested' || form.stage === 'revision') && (
              <Field label={form.stage === 'interested' ? 'Which course' : 'Course to revise'}>
                <select className={fieldCls} style={fieldStyle} value={form.courseId ?? ''} onChange={(e) => set({ courseId: e.target.value, moduleId: '' })}>
                  <option value="">Pick a course…</option>
                  {options.data?.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </Field>
            )}

            {form.stage === 'interested' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Payment date">
                  <input type="date" className={fieldCls} style={fieldStyle} value={form.paymentDate ?? ''} onChange={(e) => set({ paymentDate: e.target.value })} />
                </Field>
                <Field label="Payment mode">
                  <select className={fieldCls} style={fieldStyle} value={form.paymentMode ?? ''} onChange={(e) => set({ paymentMode: e.target.value })}>
                    <option value="">Pick…</option>
                    {options.data?.paymentModes.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
              </div>
            )}

            {form.stage === 'follow_up' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Follow-up">
                  <select className={fieldCls} style={fieldStyle} value={form.followUpKind ?? ''} onChange={(e) => set({ followUpKind: e.target.value })}>
                    <option value="">Pick…</option>
                    {options.data?.followUpKinds.map((k) => <option key={k} value={k}>{FOLLOW_UP_LABEL[k] ?? k}</option>)}
                  </select>
                </Field>
                <Field label="Follow-up date">
                  <input type="date" className={fieldCls} style={fieldStyle} value={form.followUpDate ?? ''} onChange={(e) => set({ followUpDate: e.target.value })} />
                </Field>
              </div>
            )}

            {form.stage === 'revision' && (
              <Field label="Module (optional)">
                <select className={fieldCls} style={fieldStyle} value={form.moduleId ?? ''} onChange={(e) => set({ moduleId: e.target.value })} disabled={!course}>
                  <option value="">{course ? 'Any / not sure' : 'Pick the course first'}</option>
                  {course?.modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </Field>
            )}

            {(form.stage === 'meeting_with' || form.stage === 'revision') && (
              <Field label={form.stage === 'meeting_with' ? 'Which mentor' : 'Preferred mentor (optional)'}>
                <select className={fieldCls} style={fieldStyle} value={form.withMentorEmail ?? ''} onChange={(e) => set({ withMentorEmail: e.target.value })}>
                  <option value="">{form.stage === 'meeting_with' ? 'Pick a mentor…' : 'No preference'}</option>
                  {options.data?.mentors.map((m) => <option key={m.email} value={m.email}>{m.name}</option>)}
                </select>
              </Field>
            )}

            {form.stage === 'not_interested' && (
              <Field label="Why">
                <select className={fieldCls} style={fieldStyle} value={form.reason ?? ''} onChange={(e) => set({ reason: e.target.value })}>
                  <option value="">Pick…</option>
                  {options.data?.notInterestedReasons.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
            )}

            <Field label="Concern">
              <textarea rows={2} maxLength={2000} className={fieldCls} style={fieldStyle} value={form.concern}
                onChange={(e) => set({ concern: e.target.value })} placeholder="What is holding the client back" />
            </Field>

            <Field label="Remark">
              <textarea rows={3} maxLength={2000} className={fieldCls} style={fieldStyle} value={form.remark}
                onChange={(e) => set({ remark: e.target.value })} placeholder="What the client said, what happens next" />
            </Field>

            {problem && <p className="text-sm" style={{ color: '#F87171' }}>{problem}</p>}

            <button type="button" onClick={submit} disabled={save.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: '#6366F1' }}>
              Next — about the client
            </button>
            <p className="text-center text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              This stays open until it is filled. It goes to the student&apos;s CS in CS Portal.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
