'use client'

import { useMemo, useState } from 'react'
import { CalendarClock, Plus, Repeat, Square, UserMinus, UserPlus, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import Spinner from '@/components/ui/Spinner'
import { useCurrentUser } from '@/lib/api/user'
import { useMentorCalendar } from '@/lib/api/mentorCalendar'
import {
  usePrograms, useCreateProgram, useChangeProgramStudents, useRescheduleProgram, useStopProgram, useProgramStudentSearch,
  useProgramAudiences, fetchProgramGroup,
  type Program, type ProgramPerson,
} from '@/lib/api/programs'

/* Programs (Tetra Commission's user, 2026-10-09): a live class that repeats weekly or monthly until an end date, for
   the students picked for it and nobody else. Each date becomes an ordinary class with a seat booked for every student,
   so reminders, the join button and attendance work as for any class. Instructors see and change their own; admins all. */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/* One class holds 500 seats; a program's classes keep ten spare (program.service.ts MAX_PROGRAM_STUDENTS). */
const MAX_STUDENTS = 490
const TZ = 'Asia/Dubai'
const field = 'w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm outline-none'
const errText = (e: unknown) => (e as any)?.response?.data?.error?.message || (e as Error)?.message || 'Something went wrong'
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const repeatText = (p: Pick<Program, 'repeat' | 'weekdays' | 'monthDay' | 'time' | 'startDate'>) =>
  p.repeat === 'weekly'
    ? `Every ${p.weekdays.map(d => DAYS[d]).join(', ')} at ${p.time}`
    : `Monthly on day ${p.monthDay ?? Number(p.startDate.slice(8))} at ${p.time}`

export default function ProgramsPage() {
  const { data, isLoading, error } = usePrograms()
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [showStopped, setShowStopped] = useState(false)
  const list = (data ?? []).filter(p => showStopped || p.status === 'active')

  return (
    <div className="space-y-6">
      <PageHeader title="Programs" subtitle="A class that repeats weekly or monthly for the students you pick — only they see it and get its reminders." />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"><Plus className="h-4 w-4" />New program</button>
        <label className="ml-auto flex items-center gap-2 text-sm opacity-80"><input type="checkbox" checked={showStopped} onChange={e => setShowStopped(e.target.checked)} />Show stopped</label>
      </div>
      {isLoading && <div className="flex justify-center py-12"><Spinner /></div>}
      {error && <p className="text-sm text-rose-400">{errText(error)}</p>}
      {list.map(p => <ProgramCard key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />)}
      {!isLoading && !list.length && <p className="text-sm opacity-60">No programs yet.</p>}
      {creating && <ProgramDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function ProgramCard({ p, open, onToggle }: { p: Program; open: boolean; onToggle: () => void }) {
  const stop = useStopProgram()
  const change = useChangeProgramStudents()
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState('')
  const upcoming = p.classes.filter(c => c.status === 'scheduled' && new Date(c.startsAt).getTime() > Date.now())
  const remove = async (s: ProgramPerson) => {
    if (!confirm(`Take ${s.name} off "${p.title}"? Their seats on the classes still to come are freed.`)) return
    try { setErr(''); await change.mutateAsync({ id: p.id, remove: [s.id] }) } catch (e) { setErr(errText(e)) }
  }
  return (
    <div className="rounded-2xl border border-white/10 p-4">
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-start justify-between gap-2 text-left">
        <div>
          <p className="font-semibold">{p.title}{p.status === 'stopped' && <span className="ml-2 rounded bg-white/10 px-1.5 text-xs">stopped</span>}{p.source === 'portal' && <span className="ml-2 text-xs opacity-60">from the portal{p.createdByName ? ` · ${p.createdByName}` : ''}</span>}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs opacity-70"><Repeat className="h-3.5 w-3.5" />{repeatText(p)} · {p.durationMins} min · until {p.endDate} · {p.isOnline ? (p.meetingMode === 'app' ? 'in-app stream' : p.meetingMode === 'link' ? 'own Meet link' : 'Google Meet') : p.location}</p>
        </div>
        <div className="text-right text-xs opacity-80">
          <p>{p.mentor?.name ?? '—'}{p.coMentors?.length ? <span className="opacity-70"> + {p.coMentors.map(m => m.name).join(', ')}</span> : null}</p>
          <p>{p.students.length} student{p.students.length === 1 ? '' : 's'} · {upcoming.length} to come</p>
          {p.nextClassAt && <p className="flex items-center justify-end gap-1"><CalendarClock className="h-3.5 w-3.5" />{when(p.nextClassAt)}</p>}
        </div>
      </button>
      {open && (
        <div className="mt-4 space-y-4 border-t border-white/5 pt-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase opacity-60">Students</p>
            <div className="flex flex-wrap gap-2">
              {p.students.map(s => (
                <span key={s.id} className="flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs" title={s.email}>{s.name}
                  {p.status === 'active' && <button type="button" onClick={() => void remove(s)} aria-label={`Take ${s.name} off`} className="opacity-60 hover:opacity-100"><UserMinus className="h-3 w-3" /></button>}
                </span>
              ))}
            </div>
            {p.status === 'active' && <AddStudents onAdd={async ids => { try { setErr(''); await change.mutateAsync({ id: p.id, add: ids }) } catch (e) { setErr(errText(e)) } }} exclude={p.students.map(s => s.id)} />}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase opacity-60">Classes</p>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {p.classes.map(c => <span key={c.id} className={`rounded px-1.5 py-0.5 ${c.status === 'cancelled' ? 'bg-white/5 line-through opacity-40' : new Date(c.startsAt).getTime() < Date.now() ? 'bg-white/5 opacity-60' : 'bg-blue-500/10 text-blue-300'}`}>{when(c.startsAt)}</span>)}
            </div>
          </div>
          {err && <p className="text-sm text-rose-400">{err}</p>}
          {p.status === 'active' && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:bg-white/5">Change time or dates</button>
              <button type="button" disabled={stop.isPending} onClick={async () => { if (confirm(`Stop "${p.title}"? Every class still to come is cancelled; past ones stay.`)) { try { setErr(''); await stop.mutateAsync(p.id) } catch (e) { setErr(errText(e)) } } }} className="flex items-center gap-1 rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10"><Square className="h-3 w-3" />Stop program</button>
            </div>
          )}
        </div>
      )}
      {editing && <ProgramDialog program={p} onClose={() => setEditing(false)} />}
    </div>
  )
}

function AddStudents({ onAdd, exclude }: { onAdd: (ids: string[]) => Promise<void> | void; exclude: string[] }) {
  const [q, setQ] = useState('')
  const { data, isFetching } = useProgramStudentSearch(q)
  const hits = (data ?? []).filter(s => !exclude.includes(s.id))
  return (
    <div className="mt-2">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Add a student — name or email…" className={field} />
      {q.trim().length >= 2 && (
        <div className="mt-1 max-h-48 overflow-auto rounded-lg border border-white/10">
          {isFetching && <p className="px-3 py-2 text-xs opacity-60">Searching…</p>}
          {!isFetching && !hits.length && <p className="px-3 py-2 text-xs opacity-60">No student found</p>}
          {hits.map(s => (
            <button key={s.id} type="button" onClick={async () => { await onAdd([s.id]); setQ('') }} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5">
              <span>{s.name} <span className="text-xs opacity-60">{s.email}</span></span><UserPlus className="h-3.5 w-3.5 opacity-70" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ProgramDialog({ program, onClose }: { program?: Program; onClose: () => void }) {
  const { data: me } = useCurrentUser()
  const isInstructor = (me as any)?.role === 'instructor'
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  /* Fixed once: a range built from "now" on every render is a new query key every render, so the list
     was refetched forever and never shown. Only the mentors are read from it. */
  const [range] = useState(() => [new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()] as const)
  const { data: cal, isLoading: mentorsLoading } = useMentorCalendar(range[0], range[1])
  const create = useCreateProgram()
  const reschedule = useRescheduleProgram()
  const [f, setF] = useState({
    title: program?.title ?? '', description: program?.description ?? '', repeat: program?.repeat ?? 'weekly' as 'weekly' | 'monthly',
    weekdays: program?.weekdays ?? [] as number[], monthDay: program?.monthDay ?? '' as number | '',
    startDate: program?.startDate ?? today, endDate: program?.endDate ?? '', time: program?.time ?? '19:00', durationMins: program?.durationMins ?? 60,
    isOnline: program?.isOnline ?? true, location: program?.location ?? '', instructorId: program?.mentor?.id ?? '',
    coMentorIds: [] as string[], meetingMode: 'auto' as 'auto' | 'link' | 'app', meetingUrl: '',
  })
  const [students, setStudents] = useState<ProgramPerson[]>([])
  const [err, setErr] = useState('')
  const set = (k: string, v: unknown) => setF(x => ({ ...x, [k]: v }))
  const mentors = useMemo(() => cal?.mentors ?? [], [cal])
  const busy = create.isPending || reschedule.isPending
  const submit = async () => {
    setErr('')
    const sched = { repeat: f.repeat, weekdays: f.repeat === 'weekly' ? f.weekdays : [], monthDay: f.repeat === 'monthly' && f.monthDay !== '' ? Number(f.monthDay) : null, startDate: f.startDate, endDate: f.endDate, time: f.time, durationMins: Number(f.durationMins) }
    try {
      if (program) {
        await reschedule.mutateAsync({ id: program.id, title: f.title.trim(), description: f.description.trim(), isOnline: f.isOnline, location: f.location.trim(), ...sched })
      } else {
        const made = await create.mutateAsync({
          title: f.title.trim(), description: f.description.trim(), ...sched, isOnline: f.isOnline, location: f.location.trim(),
          ...(f.instructorId ? { instructorId: f.instructorId } : {}), students: students.map(s => s.id),
          ...(f.coMentorIds.length ? { coInstructorIds: f.coMentorIds.filter(id => id !== f.instructorId) } : {}),
          ...(f.isOnline ? { meetingMode: f.meetingMode, ...(f.meetingMode === 'link' ? { meetingUrl: f.meetingUrl.trim() } : {}) } : {}),
        })
        if (made.missing?.length) alert(`Not added — not students on the LMS: ${made.missing.join(', ')}`)
      }
      onClose()
    } catch (e) { setErr(errText(e)) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg space-y-3 overflow-auto rounded-2xl border border-white/10 bg-[#0d1117] p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><p className="text-lg font-semibold">{program ? 'Change program' : 'New program'}</p><button type="button" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button></div>
        {program && <p className="text-xs text-amber-300/90">The classes still to come are cancelled and made again with the new settings; the students are told as for any moved class.</p>}
        <input className={field} placeholder="Title — e.g. Weekly trade review" value={f.title} onChange={e => set('title', e.target.value)} />
        <textarea className={field} rows={2} placeholder="What it is (optional)" value={f.description} onChange={e => set('description', e.target.value)} />
        {!program && (
          <select className={field} value={f.instructorId} onChange={e => set('instructorId', e.target.value)}>
            <option value="">{mentorsLoading ? 'Loading mentors…' : isInstructor ? 'Mentor: me' : 'Pick the mentor…'}</option>
            {mentors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        {!program && (
          <div>
            <p className="mb-1 text-xs opacity-80">Co-mentors (optional) — Meet co-hosts on every class, see it in their schedule, get the 10-minute WhatsApp</p>
            <div className="mb-1 flex flex-wrap gap-1.5">
              {f.coMentorIds.map(id => {
                const m = mentors.find(x => x.id === id)
                return <span key={id} className="flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs">{m?.name ?? id}<button type="button" onClick={() => set('coMentorIds', f.coMentorIds.filter(x => x !== id))} aria-label={`Remove ${m?.name ?? 'co-mentor'}`}><X className="h-3 w-3" /></button></span>
              })}
            </div>
            <select className={field} value="" onChange={e => { const v = e.target.value; if (v && !f.coMentorIds.includes(v)) set('coMentorIds', [...f.coMentorIds, v]) }}>
              <option value="">{mentorsLoading ? 'Loading mentors…' : 'Add a co-mentor…'}</option>
              {mentors.filter(m => m.id !== f.instructorId && !f.coMentorIds.includes(m.id)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-2">
          {(['weekly', 'monthly'] as const).map(r => <button key={r} type="button" onClick={() => set('repeat', r)} className={`flex-1 rounded-lg px-3 py-2 text-sm ${f.repeat === r ? 'bg-blue-600 text-white' : 'border border-white/10'}`}>{r === 'weekly' ? 'Weekly' : 'Monthly'}</button>)}
        </div>
        {f.repeat === 'weekly' ? (
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => <button key={d} type="button" onClick={() => set('weekdays', f.weekdays.includes(i) ? f.weekdays.filter(x => x !== i) : [...f.weekdays, i].sort())} className={`rounded-lg px-2.5 py-1.5 text-xs ${f.weekdays.includes(i) ? 'bg-blue-600 text-white' : 'border border-white/10'}`}>{d}</button>)}
          </div>
        ) : (
          <label className="block text-xs opacity-80">Day of the month (a shorter month takes its last day)
            <input type="number" min={1} max={31} className={`${field} mt-1`} placeholder={`${Number(f.startDate.slice(8)) || 1}`} value={f.monthDay} onChange={e => set('monthDay', e.target.value === '' ? '' : Number(e.target.value))} />
          </label>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs opacity-80">From<input type="date" className={`${field} mt-1`} value={f.startDate} onChange={e => set('startDate', e.target.value)} /></label>
          <label className="text-xs opacity-80">Until<input type="date" className={`${field} mt-1`} value={f.endDate} onChange={e => set('endDate', e.target.value)} /></label>
          <label className="text-xs opacity-80">Time (Dubai)<input type="time" className={`${field} mt-1`} value={f.time} onChange={e => set('time', e.target.value)} /></label>
          <label className="text-xs opacity-80">Length<select className={`${field} mt-1`} value={f.durationMins} onChange={e => set('durationMins', Number(e.target.value))}>{[30, 45, 60, 90, 120].map(n => <option key={n} value={n}>{n} min</option>)}</select></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!f.isOnline} onChange={e => set('isOnline', !e.target.checked)} />In person (no Meet link)</label>
        {!f.isOnline && <input className={field} placeholder="Where — room or office" value={f.location} onChange={e => set('location', e.target.value)} />}
        {!program && f.isOnline && (
          <div className="space-y-2">
            <p className="text-xs opacity-80">How it meets</p>
            <div className="grid grid-cols-3 gap-2">
              {([['auto', 'Google Meet', 'A room made for each class'], ['link', 'Paste a Meet link', 'Your own link, every class'], ['app', 'In-app stream', 'Live in the LMS']] as const).map(([v, label, hint]) => (
                <button key={v} type="button" onClick={() => set('meetingMode', v)}
                  className={`rounded-lg px-2 py-2 text-left text-xs ${f.meetingMode === v ? 'bg-blue-600 text-white' : 'border border-white/10'}`}>
                  <span className="block text-sm font-medium">{label}</span><span className="opacity-75">{hint}</span>
                </button>
              ))}
            </div>
            {f.meetingMode === 'link' && <input className={field} placeholder="https://meet.google.com/abc-defg-hij" value={f.meetingUrl} onChange={e => set('meetingUrl', e.target.value)} />}
            {f.meetingMode === 'link' && f.coMentorIds.length > 0 && <p className="text-[11px] text-amber-300/90">With your own link, co-mentors are not made co-hosts automatically — add them in Meet yourself.</p>}
          </div>
        )}
        {!program && <PickStudents students={students} setStudents={setStudents} />}
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Cancel</button>
          <button type="button" disabled={busy || f.title.trim().length < 3 || !f.endDate || (f.repeat === 'weekly' && !f.weekdays.length) || (!program && (!students.length || students.length > MAX_STUDENTS)) || (!f.isOnline && f.location.trim().length < 2) || (!program && f.isOnline && f.meetingMode === 'link' && !/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(f.meetingUrl.trim())) || (!program && !isInstructor && !f.instructorId)} onClick={submit} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : program ? 'Save' : 'Create program'}</button>
        </div>
      </div>
    </div>
  )
}

function AddStudentsLocal({ onPick }: { onPick: (s: ProgramPerson) => void }) {
  const [q, setQ] = useState('')
  const { data, isFetching } = useProgramStudentSearch(q)
  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a student — name or email…" className={field} />
      {q.trim().length >= 2 && (
        <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-white/10">
          {isFetching && <p className="px-3 py-2 text-xs opacity-60">Searching…</p>}
          {!isFetching && !(data ?? []).length && <p className="px-3 py-2 text-xs opacity-60">No student found</p>}
          {(data ?? []).map(s => <button key={s.id} type="button" onClick={() => { onPick(s); setQ('') }} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5"><span>{s.name} <span className="text-xs opacity-60">{s.email}</span></span><UserPlus className="h-3.5 w-3.5 opacity-70" /></button>)}
        </div>
      )}
    </div>
  )
}

/* Who the program is for — the commission portal's way of grouping students (each student's team and CS, kept on
   the LMS from Tetra Commission), everyone, or one by one. A group adds its students to the list; anyone can still
   be taken off before the program is made. */
function PickStudents({ students, setStudents }: { students: ProgramPerson[]; setStudents: (f: (xs: ProgramPerson[]) => ProgramPerson[]) => void }) {
  const { data: aud } = useProgramAudiences()
  const [loading, setLoading] = useState('')
  const [err, setErr] = useState('')
  const [showAll, setShowAll] = useState(false)
  const addMany = (list: ProgramPerson[]) => setStudents(xs => {
    const have = new Set(xs.map(x => x.id))
    return [...xs, ...list.filter(s => !have.has(s.id))]
  })
  const pick = async (label: string, g: { team?: string; cs?: string; all?: boolean }) => {
    setErr(''); setLoading(label)
    try { addMany(await fetchProgramGroup(g)) } catch (e) { setErr(errText(e)) } finally { setLoading('') }
  }
  const csByTeam = useMemo(() => {
    const m = new Map<string, { name: string; team: string; count: number }[]>()
    for (const c of aud?.cs ?? []) m.set(c.team || 'No team', [...(m.get(c.team || 'No team') ?? []), c])
    return [...m.entries()]
  }, [aud])
  const shown = showAll ? students : students.slice(0, 24)
  const over = students.length > MAX_STUDENTS
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs opacity-80">Students — only they see it</p>
        {students.length > 0 && <button type="button" onClick={() => setStudents(() => [])} className="text-xs opacity-60 hover:opacity-100">Clear all</button>}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <select className={field} value="" disabled={!!loading} onChange={e => { const t = e.target.value; if (t) void pick(t, { team: t }) }}>
          <option value="">{loading && !loading.startsWith('cs:') && loading !== 'all' ? 'Adding…' : 'Add a whole team…'}</option>
          {(aud?.teams ?? []).map(t => <option key={t.team} value={t.team}>{t.team} — {t.count}</option>)}
        </select>
        <select className={field} value="" disabled={!!loading} onChange={e => { const v = e.target.value; if (!v) return; const [team, name] = JSON.parse(v); void pick(`cs:${name}`, { cs: name, ...(team ? { team } : {}) }) }}>
          <option value="">{loading.startsWith('cs:') ? 'Adding…' : "Add a CS's students…"}</option>
          {csByTeam.map(([team, list]) => (
            <optgroup key={team} label={team}>
              {list.map(c => <option key={`${team}|${c.name}`} value={JSON.stringify([c.team, c.name])}>{c.name} — {c.count}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <button type="button" disabled={!!loading || !aud?.total} onClick={() => void pick('all', { all: true })}
        className="w-full rounded-lg border border-white/10 px-3 py-2 text-left text-sm hover:bg-white/5 disabled:opacity-50">
        {loading === 'all' ? 'Adding…' : `Add all students${aud ? ` — ${aud.total}` : ''}`}
        {aud && aud.total > MAX_STUDENTS && <span className="ml-1 text-xs text-amber-300/90">(more than a program can hold — {MAX_STUDENTS})</span>}
      </button>
      <AddStudentsLocal onPick={s => addMany([s])} />
      {students.length > 0 && (
        <div>
          <p className={`mb-1 text-xs ${over ? 'text-rose-400' : 'opacity-70'}`}>
            {students.length} student{students.length === 1 ? '' : 's'}{over ? ` — a program can have at most ${MAX_STUDENTS}; take some off or pick a team or CS` : ''}
          </p>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
            {shown.map(s => <span key={s.id} className="flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs" title={s.email}>{s.name}<button type="button" onClick={() => setStudents(xs => xs.filter(x => x.id !== s.id))} aria-label={`Remove ${s.name}`}><X className="h-3 w-3" /></button></span>)}
            {students.length > shown.length && <button type="button" onClick={() => setShowAll(true)} className="rounded-full px-2.5 py-1 text-xs text-blue-300">+{students.length - shown.length} more</button>}
          </div>
          <p className="mt-1 text-[11px] opacity-60">When you create it, each student is told in the app, by email and on WhatsApp, with the days and time.</p>
        </div>
      )}
      {err && <p className="text-xs text-rose-400">{err}</p>}
    </div>
  )
}
