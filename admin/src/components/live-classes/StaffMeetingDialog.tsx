'use client'

import { useMemo, useState } from 'react'
import { Search, Users } from 'lucide-react'
import { useBookMeeting, useMentorCalendar, wallInZone, refusal, type CalendarMentor } from '@/lib/api/mentorCalendar'

/* A staff meeting with several mentors in it, from the Mentor Calendar's "Staff meeting" button (the user, 2026-11-14:
   "in the LMS also a separate button") — as in the CS Portal. A Chief Mentor or an admin, with any mentor of either
   academy (2026-11-24: "show every mentor including Bangalore and Dubai" — `team` null; a Chief had their own team
   only before; the server checks it again). Each mentor ticked shows Free, or Busy with what and when, at the time
   chosen; "Find free time" lists every start between two times when everybody ticked is free — on the day, or the
   seven on screen. The calendar behind lists this academy's mentors only, so the same days are asked for again with
   both academies'. The LMS refuses it over anybody busy, by name, books one meeting that shows on each of their
   calendars, and emails each. */

const SLOT = 30
const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
const toMins = (v: string) => { const [h, m] = v.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
const lower = (v: unknown) => String(v ?? '').trim().toLowerCase()
const DAY_MS = 864e5
const inBangalore = (m: CalendarMentor) => /bangal|banglo|bengal/i.test(String(m.academy?.name ?? ''))
type Busy = { from: number; to: number; kind: 'class' | 'meeting' | 'off'; what: string }

export function StaffMeetingDialog({ mentors, team, myEmail, days, tz, onClose }: {
  mentors: CalendarMentor[]; team: string[] | null; myEmail: string; days: Date[]; tz: string; onClose: () => void
}) {
  const book = useBookMeeting()
  const keyOf = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: tz })
  const dayKeys = useMemo(() => days.map(keyOf), [days, tz])   // eslint-disable-line react-hooks/exhaustive-deps
  /* Both academies' mentors for the same days as the calendar behind (it asks from the day before to a day after);
     until they come — or from a server that gives this academy's only — the ones on screen. */
  const start = days[0] ?? new Date()
  const everyone = useMentorCalendar(new Date(start.getTime() - DAY_MS).toISOString(), new Date(start.getTime() + 8 * DAY_MS).toISOString(), { allAcademies: true })
  const all = everyone.data?.mentors ?? mentors
  const bothAcademies = all.some(m => m.academy && inBangalore(m))
  /** The mentors this person may put in it — everybody (a `team` list, if ever given, holds): Dubai's, then Bangalore's, each by name. */
  const invitable = useMemo(() => {
    const t = team === null ? null : new Set(team.map(lower))
    return all.filter(m => !t || t.has(lower(m.email)))
      .sort((a, b) => Number(inBangalore(a)) - Number(inBangalore(b)) || String(a.name).localeCompare(String(b.name)))
  }, [all, team])
  const academyTag = (m: CalendarMentor) => bothAcademies && m.academy ? (inBangalore(m) ? 'Bangalore' : 'Dubai') : ''
  const [ownerEmail, setOwnerEmail] = useState(() => lower((invitable.find(m => lower(m.email) === myEmail) ?? invitable[0])?.email))
  const owner = invitable.find(m => lower(m.email) === ownerEmail) ?? invitable[0]
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())
  const [f, setF] = useState({ title: '', day: dayKeys[0] ?? keyOf(new Date()), time: '10:00', durationMins: 30, inPerson: false, location: '', notes: '', guestName: '', guestEmail: '' })
  const [finder, setFinder] = useState<{ scope: 'day' | 'week'; from: string; to: string } | null>(null)
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f, v: unknown) => setF(x => ({ ...x, [k]: v }))

  /** Everybody in it: its own mentor, then whoever is ticked. */
  const people = useMemo(() => owner ? [owner, ...invitable.filter(m => lower(m.email) !== lower(owner.email) && ticked.has(lower(m.email)))] : [], [owner, invitable, ticked])

  /** What is in one mentor's diary on a day, in the zone's minutes: classes, meetings and staff meetings, time off. */
  const busyOn = (m: CalendarMentor, day: string): Busy[] => {
    const start = wallInZone(day, '00:00', tz).getTime(), end = start + 1440 * 60_000
    const part = (a: number, b: number) => { const x = Math.max(a, start), y = Math.min(b, end); return y > x ? { from: Math.round((x - start) / 60_000), to: Math.round((y - start) / 60_000) } : null }
    const out: Busy[] = []
    for (const c of m.classes) {
      if (c.status === 'cancelled') continue
      const s = new Date(c.startsAt).getTime(), p = part(s, s + (c.durationMins || 0) * 60_000)
      if (p) out.push({ ...p, kind: 'class', what: c.mine ? (c.title || 'a class') : 'another academy' })
    }
    for (const v of m.meetings) {
      const s = new Date(v.startsAt).getTime(), p = part(s, s + (v.durationMins || 0) * 60_000)
      if (p) out.push({ ...p, kind: 'meeting', what: v.title })
    }
    for (const t of m.timeOff ?? []) {
      const p = part(new Date(t.startsAt).getTime(), new Date(t.endsAt).getTime())
      if (p) out.push({ ...p, kind: 'off', what: 'Not available' })
    }
    return out
  }
  const duration = Number(f.durationMins) || SLOT
  const diaries = useMemo(() => people.map(p => ({ p, busy: busyOn(p, f.day) })), [people, f.day, tz])   // eslint-disable-line react-hooks/exhaustive-deps
  const at = toMins(f.time)
  const clashOf = (m: CalendarMentor) => diaries.find(d => d.p.id === m.id)?.busy.find(b => at < b.to && b.from < at + duration) ?? null
  const clashes = diaries.map(d => ({ p: d.p, b: d.busy.find(b => at < b.to && b.from < at + duration) })).filter(x => x.b)

  const times = useMemo(() => Array.from({ length: 48 }, (_, i) => {
    const m = i * SLOT
    const who = diaries.filter(d => d.busy.some(b => m < b.to && b.from < m + duration)).map(d => d.p.name)
    return { value: hhmm(m), label: who.length ? `${hhmm(m)} · ${who[0]} busy${who.length > 1 ? ` +${who.length - 1}` : ''}` : hhmm(m) }
  }), [diaries, duration])

  const found = useMemo(() => {
    if (!finder) return []
    const lo = toMins(finder.from), hi = toMins(finder.to), now = Date.now()
    return (finder.scope === 'week' ? dayKeys : [f.day]).map(day => {
      const ds = people.map(p => ({ p, busy: busyOn(p, day) }))
      const free: string[] = []
      for (let m = Math.ceil(lo / SLOT) * SLOT; m + duration <= hi; m += SLOT) {
        if (wallInZone(day, hhmm(m), tz).getTime() <= now) continue
        if (!ds.some(({ busy }) => busy.some(b => m < b.to && b.from < m + duration))) free.push(hhmm(m))
      }
      const blocked = ds.flatMap(({ p, busy }) => busy.filter(b => b.from < hi && lo < b.to).map(b => ({ ...b, who: p.name }))).sort((a, b) => a.from - b.from)
      return { day, free, blocked }
    })
  }, [finder, people, f.day, dayKeys, duration, tz])   // eslint-disable-line react-hooks/exhaustive-deps

  const dayLabel = (day: string) => wallInZone(day, '12:00', tz).toLocaleDateString(undefined, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'short' })
  const ready = !!owner && people.length >= 2 && f.title.trim().length >= 3 && clashes.length === 0 && !(f.inPerson && f.location.trim().length < 2)
  const submit = async () => {
    if (!owner) return
    setErr('')
    try {
      await book.mutateAsync({
        mentorEmail: owner.email, title: f.title.trim(), kind: 'staff', scheduledStart: wallInZone(f.day, f.time, tz).toISOString(), durationMins: duration,
        attendees: f.guestName.trim() ? [{ name: f.guestName.trim(), email: f.guestEmail.trim() }] : [],
        staffEmails: people.slice(1).map(p => lower(p.email)), inPerson: f.inPerson, location: f.location.trim(), notes: f.notes.trim(),
        allAcademies: true,
      })
      onClose()
    } catch (e) { setErr(refusal(e, 'Could not book it')) }
  }

  const field = 'w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm outline-none'
  const label = 'mb-1 block text-xs text-white/60'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-[#0d1117] p-5" onClick={e => e.stopPropagation()} data-testid="staff-meeting-dialog">
        <p className="flex items-center gap-2 text-lg font-semibold"><Users className="h-5 w-5 text-blue-400" />Book a staff meeting</p>
        {!owner ? (
          <p className="text-sm text-white/60">There is no mentor you can book a staff meeting for.</p>
        ) : <>
          <input className={field} placeholder="Title — weekly team meeting…" value={f.title} onChange={e => set('title', e.target.value)} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="col-span-2"><span className={label}>Day</span>
              <select className={field} value={f.day} onChange={e => set('day', e.target.value)}>
                {dayKeys.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}
              </select>
            </label>
            <label><span className={label}>Start</span>
              <select className={field} value={f.time} onChange={e => set('time', e.target.value)}>
                {times.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label><span className={label}>Length</span>
              <select className={field} value={f.durationMins} onChange={e => set('durationMins', Number(e.target.value))}>{[15, 30, 45, 60, 90].map(n => <option key={n} value={n}>{n} min</option>)}</select>
            </label>
          </div>
          {invitable.length > 1 && (
            <label className="block"><span className={label}>In the name of</span>
              <select className={field} value={lower(owner.email)} onChange={e => {
                const was = lower(owner.email)
                setTicked(prev => { const n = new Set(prev); n.delete(e.target.value); n.add(was); return n })
                setOwnerEmail(e.target.value)
              }}>
                {invitable.map(m => <option key={m.id} value={lower(m.email)}>{m.name}{academyTag(m) ? ` · ${academyTag(m)}` : ''}</option>)}
              </select>
            </label>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Mentors in the meeting <span className="text-white/40">({people.length})</span></span>
            <span className="flex gap-2 text-xs">
              <button type="button" className="text-blue-400 hover:underline" onClick={() => setTicked(new Set(invitable.map(m => lower(m.email))))}>Select all</button>
              <button type="button" className="text-white/60 hover:underline" onClick={() => setTicked(new Set())}>Clear</button>
            </span>
          </div>
          <ul className="max-h-56 divide-y divide-white/5 overflow-y-auto rounded-lg border border-white/10" data-testid="staff-meeting-team">
            {[owner, ...invitable.filter(m => m.id !== owner.id)].map((m, i) => {
              const own = i === 0, on = own || ticked.has(lower(m.email)), clash = on ? clashOf(m) : null
              return (
                <li key={m.id}>
                  <label className={`flex items-center gap-2 px-3 py-1.5 text-sm ${own ? '' : 'cursor-pointer'}`}>
                    <input type="checkbox" className="h-4 w-4" checked={on} disabled={own}
                      onChange={() => setTicked(prev => { const n = new Set(prev); const k = lower(m.email); if (n.has(k)) n.delete(k); else n.add(k); return n })} />
                    <span className="min-w-0 flex-1 truncate">{m.name}{own && <span className="text-xs text-white/40"> · the meeting is in their name</span>}</span>
                    {academyTag(m) && <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${inBangalore(m) ? 'border-amber-500/30 text-amber-300' : 'border-sky-500/30 text-sky-300'}`}>{academyTag(m)}</span>}
                    {on && (clash
                      ? <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${clash.kind === 'off' ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300'}`}>
                          {clash.kind === 'off' ? 'Not available' : `Busy · ${clash.kind}: ${clash.what}`} · {hhmm(clash.from)}–{hhmm(Math.min(clash.to, 1440))}
                        </span>
                      : <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-300">Free</span>)}
                  </label>
                </li>
              )
            })}
          </ul>
          {clashes.length > 0 && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300" data-testid="staff-meeting-busy">
              {clashes.length} of the {people.length} {clashes.length === 1 ? 'is' : 'are'} busy at {f.time}: {clashes.map(x => x.p.name).join(', ')}. Untick them, or pick another time.
            </p>
          )}
          {people.length < 2 && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">Tick at least one more mentor for a staff meeting.</p>}

          {/* Find free time: every start between two times when everybody ticked is free. */}
          <div className="space-y-2 rounded-lg border border-white/10 p-3">
            <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
              <label className="col-span-2 sm:col-span-1"><span className={label}>Look in</span>
                <select className={field} value={finder?.scope ?? 'day'} onChange={e => setFinder(x => ({ from: '09:00', to: '18:00', ...(x ?? {}), scope: e.target.value as 'day' | 'week' }))}>
                  <option value="day">This day</option><option value="week">The 7 days on screen</option>
                </select>
              </label>
              <label><span className={label}>Between</span><input type="time" step={1800} className={field} value={finder?.from ?? '09:00'} onChange={e => setFinder(x => ({ scope: 'day', to: '18:00', ...(x ?? {}), from: e.target.value }))} /></label>
              <label><span className={label}>And</span><input type="time" step={1800} className={field} value={finder?.to ?? '18:00'} onChange={e => setFinder(x => ({ scope: 'day', from: '09:00', ...(x ?? {}), to: e.target.value }))} /></label>
              <button type="button" onClick={() => setFinder(x => (x ? null : { scope: 'day', from: '09:00', to: '18:00' }))}
                className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5 sm:col-span-1">
                <Search className="h-3.5 w-3.5" />{finder ? 'Hide free time' : 'Find free time'}
              </button>
            </div>
            {finder && (
              <div className="space-y-2" data-testid="staff-meeting-free">
                {found.every(d => d.free.length === 0) && (
                  <p className="text-sm text-white/60">No time between {finder.from} and {finder.to} when all {people.length} are free for {duration} minutes. Widen the times, look in the 7 days, or untick somebody.</p>
                )}
                {found.filter(d => d.free.length > 0 || finder.scope === 'day').map(d => (
                  <div key={d.day} className="space-y-1">
                    {finder.scope === 'week' && <p className="text-xs font-semibold text-white/70">{dayLabel(d.day)}</p>}
                    <div className="flex flex-wrap gap-1.5">
                      {d.free.map(t => (
                        <button key={t} type="button" onClick={() => setF(x => ({ ...x, day: d.day, time: t }))}
                          className={`rounded-md border px-2 py-1 text-xs tabular-nums ${d.day === f.day && t === f.time ? 'border-blue-400 bg-blue-500/20 text-blue-200' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'}`}>{t}</button>
                      ))}
                    </div>
                    {finder.scope === 'day' && d.blocked.length > 0 && (
                      <ul className="space-y-0.5 text-xs text-white/60">
                        {d.blocked.map((b, i) => <li key={i}><span className="tabular-nums">{hhmm(b.from)}–{hhmm(Math.min(b.to, 1440))}</span> · <span className="font-medium text-white/80">{b.who}</span> · {b.kind === 'off' ? 'not available' : `${b.kind}: ${b.what}`}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input className={field} placeholder="Anybody else — name (optional)" value={f.guestName} onChange={e => set('guestName', e.target.value)} />
            <input className={field} placeholder="Their email" value={f.guestEmail} onChange={e => set('guestEmail', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.inPerson} onChange={e => set('inPerson', e.target.checked)} />In person (no Meet link)</label>
          {f.inPerson && <input className={field} placeholder="Where — room or office" value={f.location} onChange={e => set('location', e.target.value)} />}
          <textarea className={field} rows={2} placeholder="Notes (optional) — goes in the emails" value={f.notes} onChange={e => set('notes', e.target.value)} />
          {err && <p className="text-sm text-rose-400">{err}</p>}
        </>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Cancel</button>
          {owner && (
            <button type="button" disabled={!ready || book.isPending} onClick={submit} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {book.isPending ? 'Booking…' : `Book for ${people.length} — they are emailed`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
