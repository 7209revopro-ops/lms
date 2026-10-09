'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import Spinner from '@/components/ui/Spinner'
import { useCurrentUser } from '@/lib/api/user'
import { useMentorCalendar, useBookMeeting, useCancelMeeting, useMentorClass, type CalendarMentor } from '@/lib/api/mentorCalendar'

/* Mentor Calendar (Tetra Commission's user, 2026-10-08): every mentor's week — the hours they set as free,
   their classes and the sessions booked with them — for instructors as well as admins, and a session booked
   with any mentor from here. The LMS checks clashes and sends the emails, as from the portals; an instructor
   cancels only what they booked. Sessions can be searched by title (a booked session by who is on it too) and
   classes narrowed to a course and its module (2026-10-09); booked sessions have no course, so they stay. */

const DAY_MS = 864e5
const weekStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }

export default function MentorCalendarPage() {
  const { data: me } = useCurrentUser()
  const myEmail = String((me as any)?.email ?? '').toLowerCase()
  const [offset, setOffset] = useState(0)
  const [onlyMe, setOnlyMe] = useState(false)
  const [query, setQuery] = useState('')
  const [booking, setBooking] = useState<CalendarMentor | null>(null)
  const [infoFor, setInfoFor] = useState<string | null>(null)   // the class whose Info is open
  const [find, setFind] = useState('')          // a session's title, its course or module, or who a booked one is with
  const [course, setCourse] = useState('')      // courseId
  const [mod, setMod] = useState('')      // moduleId, within the course
  const start = useMemo(() => { const s = weekStart(new Date()); s.setDate(s.getDate() + offset * 7); return s }, [offset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS)), [start])
  const { data, isLoading, error } = useMentorCalendar(new Date(start.getTime() - DAY_MS).toISOString(), new Date(start.getTime() + 8 * DAY_MS).toISOString())
  const cancel = useCancelMeeting()
  const tz = data?.timezone || 'Asia/Dubai'
  const dayKey = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: tz })
  const at = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz })

  const mentors = useMemo(() => {
    const all = data?.mentors ?? []
    const mine = all.filter(m => m.email.toLowerCase() === myEmail)
    if (onlyMe) return mine
    const q = query.trim().toLowerCase()
    const rest = all.filter(m => m.email.toLowerCase() !== myEmail && (!q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)))
    return [...mine, ...rest]
  }, [data, myEmail, onlyMe, query])

  // The courses and modules of this week's classes, for the two filters.
  const { courses, modules } = useMemo(() => {
    const cs = new Map<string, string>(), ms = new Map<string, string>()
    for (const m of data?.mentors ?? []) for (const c of m.classes) {
      if (c.courseId) cs.set(c.courseId, c.course || 'Course')
      if (c.courseId === course && c.moduleId) ms.set(c.moduleId, c.module || 'Module')
    }
    const sorted = (m: Map<string, string>) => [...m].sort((a, b) => a[1].localeCompare(b[1]))
    return { courses: sorted(cs), modules: sorted(ms) }
  }, [data, course])
  const needle = find.trim().toLowerCase()
  const filtering = !!(needle || course)
  const has = (...vs: (string | null | undefined)[]) => vs.some(v => String(v ?? '').toLowerCase().includes(needle))
  const classShown = (c: CalendarMentor['classes'][number]) =>
    (!course || c.courseId === course) && (!mod || c.moduleId === mod) && (!needle || (c.mine && has(c.title, c.course, c.module)))
  // Booked sessions belong to no course: the course and module leave them be, the search does not.
  const meetingShown = (v: CalendarMentor['meetings'][number]) => !needle || has(v.title, ...v.attendeeNames)
  const shownMentors = filtering
    ? mentors.filter(m => m.classes.some(c => c.status !== 'cancelled' && classShown(c)) || m.meetings.some(meetingShown))
    : mentors

  return (
    <div className="space-y-6">
      <PageHeader title="Mentor Calendar" subtitle={`Every mentor's free hours, classes and booked sessions — book a session with anyone. Times ${tz.replace('_', ' ')}.`} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOffset(o => o - 1)} className="rounded-lg border border-white/10 p-2 hover:bg-white/5" aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" onClick={() => setOffset(0)} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5"><CalendarDays className="h-4 w-4" />{offset === 0 ? 'This week' : days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</button>
        <button type="button" onClick={() => setOffset(o => o + 1)} className="rounded-lg border border-white/10 p-2 hover:bg-white/5" aria-label="Next week"><ChevronRight className="h-4 w-4" /></button>
        <button type="button" onClick={() => setOnlyMe(v => !v)} className={`rounded-lg px-3 py-2 text-sm ${onlyMe ? 'bg-blue-600 text-white' : 'border border-white/10 hover:bg-white/5'}`}>{onlyMe ? 'Only me — show everyone' : 'Only me'}</button>
        {!onlyMe && <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a mentor…" className="min-w-[200px] flex-1 rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm outline-none" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={find} onChange={e => setFind(e.target.value)} placeholder="Search sessions — title, course, module, who it's with…" className="min-w-[240px] flex-1 rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm outline-none" />
        <select value={course} onChange={e => { setCourse(e.target.value); setMod('') }} className="rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm" aria-label="Course">
          <option value="">All courses</option>
          {courses.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
        <select value={mod} onChange={e => setMod(e.target.value)} disabled={!course || !modules.length} className="rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm disabled:opacity-40" aria-label="Module">
          <option value="">{course && !modules.length ? 'No modules' : 'All modules'}</option>
          {modules.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
        {filtering && <button type="button" onClick={() => { setFind(''); setCourse(''); setMod('') }} className="rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5">Clear</button>}
      </div>

      {isLoading && <div className="flex justify-center py-12"><Spinner /></div>}
      {error && <p className="text-sm text-rose-400">{(error as Error).message || 'The calendar did not load'}</p>}

      {shownMentors.map(m => (
        <div key={m.id} className="rounded-2xl border border-white/10 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{m.name}{m.email.toLowerCase() === myEmail && <span className="ml-2 text-xs text-blue-400">you</span>}{m.shared && <span className="ml-2 text-xs opacity-60">lent</span>}</p>
            <button type="button" onClick={() => setBooking(m)} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"><Plus className="h-3.5 w-3.5" />Book a session</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-7">
            {days.map(d => {
              const key = dayKey(d)
              const slots = m.slots.filter(s => s.dayOfWeek === d.getDay())
              const classes = m.classes.filter(c => dayKey(c.startsAt) === key && c.status !== 'cancelled' && classShown(c))
              const meetings = m.meetings.filter(v => dayKey(v.startsAt) === key && meetingShown(v))
              return (
                <div key={key} className="min-h-[72px] rounded-lg border border-white/5 p-2 text-[11px]">
                  <p className="mb-1 font-medium opacity-70">{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</p>
                  {slots.map((s, i) => <p key={i} className="mb-1 rounded bg-emerald-500/10 px-1 text-emerald-400">{s.startTime}–{s.endTime}</p>)}
                  {classes.map(c => (
                    <button type="button" key={c.id} disabled={!c.mine} onClick={() => setInfoFor(c.id)}
                      className="mb-1 block w-full rounded bg-blue-500/10 px-1 text-left text-blue-300 enabled:hover:bg-blue-500/20"
                      title={c.mine ? `${c.booked}/${c.capacity} booked — click for its Info` : 'Another academy'}>
                      {at(c.startsAt)} {c.mine ? (c.title || 'Class') : 'Booked elsewhere'}{c.mine && c.course && <span className="block opacity-60">{c.course}{c.module ? ` · ${c.module}` : ''}</span>}
                    </button>
                  ))}
                  {meetings.map(v => (
                    <p key={v.id} className="mb-1 flex items-start justify-between gap-1 rounded bg-violet-500/10 px-1 text-violet-300" title={`${v.title} · ${v.attendeeNames.join(', ')}${v.inPerson ? ` · in person, ${v.location}` : ''}`}>
                      <span>{at(v.startsAt)} {v.title}</span>
                      {(v.bookedByEmail.toLowerCase() === myEmail || (me as any)?.role !== 'instructor') && (
                        <button type="button" disabled={cancel.isPending} onClick={() => { if (confirm(`Cancel "${v.title}"? Everyone on it is emailed.`)) cancel.mutate(v.id) }} aria-label="Cancel this session" className="opacity-60 hover:opacity-100"><X className="h-3 w-3" /></button>
                      )}
                    </p>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {!isLoading && !shownMentors.length && <p className="text-sm opacity-60">{filtering ? 'Nothing this week matches — clear the search or filters.' : 'No mentors to show.'}</p>}
      {booking && <BookDialog mentor={booking} tz={tz} onClose={() => setBooking(null)} />}
      {infoFor && <ClassInfoDialog id={infoFor} tz={tz} onClose={() => setInfoFor(null)} />}
    </div>
  )
}

/* A class's Info: its students (booked, cancelled, joined, reviewed) and a timeline from booking to the reviews. */
const EVENT_TEXT: Record<string, (e: { who: string }) => string> = {
  booked: e => `${e.who} booked`, cancelled: e => `${e.who} cancelled`, started: () => 'Class started',
  mentor_joined: e => `${e.who || 'The mentor'} (mentor) joined`, joined: e => `${e.who} joined`, ended: () => 'Class ended',
  review: e => `${e.who} sent a review`,
}
const STATUS_CLS: Record<string, string> = { attended: 'text-emerald-400', missed: 'text-rose-400', cancelled: 'opacity-50', booked: 'text-sky-300' }
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n))

function ClassInfoDialog({ id, tz, onClose }: { id: string; tz: string; onClose: () => void }) {
  const { data: c, isLoading, error } = useMentorClass(id)
  const at = (iso: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }) : '')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-[#0d1117] p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">{c?.title || 'Class'}</p>
            {c && <p className="text-xs opacity-60">{[c.courseTitle, c.instructorName && `with ${c.instructorName}`, at(c.startsAt), `${c.booked}/${c.capacity} booked`].filter(Boolean).join(' · ')}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="opacity-60 hover:opacity-100"><X className="h-4 w-4" /></button>
        </div>
        {isLoading && <div className="flex justify-center py-6"><Spinner /></div>}
        {error && <p className="text-sm text-rose-400">{(error as Error).message || 'The class did not load'}</p>}
        {c && (
          <>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide opacity-60">Students ({c.students?.length ?? 0})</p>
              {!c.students?.length ? <p className="text-sm opacity-60">Nobody has booked this class.</p> : (
                <ul className="divide-y divide-white/5 rounded-lg border border-white/10 text-sm">
                  {c.students.map((s, i) => (
                    <li key={i} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2"><span className="font-medium">{s.name}</span><span className={`text-xs capitalize ${STATUS_CLS[s.status] ?? ''}`}>{s.status}</span></div>
                      <p className="text-xs opacity-60">{[s.bookedAt && `Booked ${at(s.bookedAt)}`, s.cancelledAt && `cancelled ${at(s.cancelledAt)}`, s.joinedAt && `joined ${at(s.joinedAt)}`].filter(Boolean).join(' · ')}</p>
                      {s.review && <p className="mt-1 text-xs text-amber-300">{stars(s.review.rating)}{s.review.comment ? <span className="ml-1.5 text-white/80">“{s.review.comment}”</span> : null}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide opacity-60">Timeline</p>
              {!c.timeline?.length ? <p className="text-sm opacity-60">Nothing has happened yet.</p> : (
                <ol className="space-y-1.5 text-sm">
                  {c.timeline.map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-28 shrink-0 text-xs leading-5 opacity-60">{at(e.at)}</span>
                      <span>{(EVENT_TEXT[e.kind] ?? (() => e.kind))(e)}{e.kind === 'review' && e.rating ? <span className="ml-1.5 text-amber-300">{stars(e.rating)}{e.comment ? <span className="ml-1 text-white/70">“{e.comment}”</span> : null}</span> : null}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function BookDialog({ mentor, tz, onClose }: { mentor: CalendarMentor; tz: string; onClose: () => void }) {
  const book = useBookMeeting()
  const [f, setF] = useState({ date: new Date().toLocaleDateString('en-CA', { timeZone: tz }), time: '10:00', durationMins: 30, title: '', kind: 'staff' as 'staff' | 'student' | 'client', name: '', email: '', inPerson: false, location: '', notes: '' })
  const [err, setErr] = useState('')
  const set = (k: string, v: unknown) => setF(x => ({ ...x, [k]: v }))
  const submit = async () => {
    setErr('')
    // The time is the academy's (tz): turn it into an instant.
    const asUtc = new Date(`${f.date}T${f.time}:00Z`)
    const there = new Date(asUtc.toLocaleString('en-US', { timeZone: tz }))
    const startsAt = new Date(asUtc.getTime() + (asUtc.getTime() - there.getTime()))
    try {
      await book.mutateAsync({ mentorEmail: mentor.email, title: f.title.trim(), kind: f.kind, scheduledStart: startsAt.toISOString(), durationMins: Number(f.durationMins), attendees: [{ name: f.name.trim(), email: f.email.trim() }], inPerson: f.inPerson, location: f.location.trim(), notes: f.notes.trim() })
      onClose()
    } catch (e) { setErr((e as Error)?.message || 'Could not book it') }
  }
  const field = 'w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm outline-none'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-white/10 bg-[#0d1117] p-5" onClick={e => e.stopPropagation()}>
        <p className="text-lg font-semibold">Book a session with {mentor.name}</p>
        <input className={field} placeholder="Title — intro call, review…" value={f.title} onChange={e => set('title', e.target.value)} />
        <div className="grid grid-cols-3 gap-2">
          <input type="date" className={field} value={f.date} onChange={e => set('date', e.target.value)} />
          <input type="time" className={field} value={f.time} onChange={e => set('time', e.target.value)} />
          <select className={field} value={f.durationMins} onChange={e => set('durationMins', Number(e.target.value))}>{[15, 30, 45, 60, 90].map(n => <option key={n} value={n}>{n} min</option>)}</select>
        </div>
        <select className={field} value={f.kind} onChange={e => set('kind', e.target.value)}><option value="staff">With staff</option><option value="student">With a student</option><option value="client">With a client</option></select>
        <div className="grid grid-cols-2 gap-2">
          <input className={field} placeholder="Their name" value={f.name} onChange={e => set('name', e.target.value)} />
          <input className={field} placeholder="Their email" value={f.email} onChange={e => set('email', e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.inPerson} onChange={e => set('inPerson', e.target.checked)} />In person (no Meet link)</label>
        {f.inPerson && <input className={field} placeholder="Where — room or office" value={f.location} onChange={e => set('location', e.target.value)} />}
        <textarea className={field} rows={2} placeholder="Notes (optional)" value={f.notes} onChange={e => set('notes', e.target.value)} />
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Cancel</button>
          <button type="button" disabled={book.isPending || f.title.trim().length < 3 || !f.name.trim() || (f.inPerson && f.location.trim().length < 2)} onClick={submit} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{book.isPending ? 'Booking…' : 'Book — they are emailed'}</button>
        </div>
      </div>
    </div>
  )
}
