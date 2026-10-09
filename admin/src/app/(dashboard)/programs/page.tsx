'use client'

import { useMemo, useState } from 'react'
import { CalendarClock, Plus, Repeat, Square, UserMinus, UserPlus, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import Spinner from '@/components/ui/Spinner'
import { useCurrentUser } from '@/lib/api/user'
import { useMentorCalendar } from '@/lib/api/mentorCalendar'
import {
  usePrograms, useCreateProgram, useChangeProgramStudents, useRescheduleProgram, useStopProgram, useProgramStudentSearch,
  type Program, type ProgramPerson,
} from '@/lib/api/programs'

/* Programs (Tetra Commission's user, 2026-10-09): a live class that repeats weekly or monthly until an end date, for
   the students picked for it and nobody else. Each date becomes an ordinary class with a seat booked for every student,
   so reminders, the join button and attendance work as for any class. Instructors see and change their own; admins all. */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
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
          <p className="mt-0.5 flex items-center gap-1.5 text-xs opacity-70"><Repeat className="h-3.5 w-3.5" />{repeatText(p)} · {p.durationMins} min · until {p.endDate} · {p.isOnline ? 'online' : p.location}</p>
        </div>
        <div className="text-right text-xs opacity-80">
          <p>{p.mentor?.name ?? '—'}</p>
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
  const { data: cal } = useMentorCalendar(new Date().toISOString(), new Date(Date.now() + 864e5).toISOString())
  const create = useCreateProgram()
  const reschedule = useRescheduleProgram()
  const [f, setF] = useState({
    title: program?.title ?? '', description: program?.description ?? '', repeat: program?.repeat ?? 'weekly' as 'weekly' | 'monthly',
    weekdays: program?.weekdays ?? [] as number[], monthDay: program?.monthDay ?? '' as number | '',
    startDate: program?.startDate ?? today, endDate: program?.endDate ?? '', time: program?.time ?? '19:00', durationMins: program?.durationMins ?? 60,
    isOnline: program?.isOnline ?? true, location: program?.location ?? '', instructorId: program?.mentor?.id ?? '',
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
        const made = await create.mutateAsync({ title: f.title.trim(), description: f.description.trim(), ...sched, isOnline: f.isOnline, location: f.location.trim(), ...(f.instructorId ? { instructorId: f.instructorId } : {}), students: students.map(s => s.id) })
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
            <option value="">{isInstructor ? 'Mentor: me' : 'Pick the mentor…'}</option>
            {mentors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
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
        {!program && (
          <div>
            <p className="mb-1 text-xs opacity-80">Students — only they see it</p>
            <div className="mb-1 flex flex-wrap gap-1.5">
              {students.map(s => <span key={s.id} className="flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs">{s.name}<button type="button" onClick={() => setStudents(students.filter(x => x.id !== s.id))} aria-label={`Remove ${s.name}`}><X className="h-3 w-3" /></button></span>)}
            </div>
            <AddStudentsLocal onPick={s => setStudents(xs => xs.some(x => x.id === s.id) ? xs : [...xs, s])} />
          </div>
        )}
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Cancel</button>
          <button type="button" disabled={busy || f.title.trim().length < 3 || !f.endDate || (f.repeat === 'weekly' && !f.weekdays.length) || (!program && !students.length) || (!f.isOnline && f.location.trim().length < 2) || (!program && !isInstructor && !f.instructorId)} onClick={submit} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : program ? 'Save' : 'Create program'}</button>
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
