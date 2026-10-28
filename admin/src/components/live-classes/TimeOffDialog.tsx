'use client'

import { useState } from 'react'
import { useMarkTimeOff, wallInZone, timeOffLabel, refusal, type AlreadyBooked } from '@/lib/api/mentorCalendar'

/* "Not available" for a mentor (2026-10-23): whole days, or from one time to another. From then on no portal books
   them inside it. What was already booked there is shown back — it stays; moving or cancelling it is up to whoever
   booked it. Used by the Mentor Calendar and the Availability page. */
export function TimeOffDialog({ mentorId, mentorName, tz, onClose }: {
  /** 'me' for the caller's own. */
  mentorId: string | 'me'
  mentorName: string
  tz: string
  onClose: () => void
}) {
  const mark = useMarkTimeOff()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  const [f, setF] = useState({ allDay: true, fromDate: today, toDate: today, fromTime: '14:00', toTime: '18:00', reason: '' })
  const [err, setErr] = useState('')
  const [booked, setBooked] = useState<AlreadyBooked[] | null>(null)
  const set = (k: keyof typeof f, v: unknown) => setF(x => ({ ...x, [k]: v }))

  const span = () => {
    if (f.allDay) {
      const end = new Date(`${f.toDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1)
      return { startsAt: wallInZone(f.fromDate, '00:00', tz), endsAt: wallInZone(end.toISOString().slice(0, 10), '00:00', tz) }
    }
    return { startsAt: wallInZone(f.fromDate, f.fromTime, tz), endsAt: wallInZone(f.toDate, f.toTime, tz) }
  }
  const { startsAt, endsAt } = span()
  const valid = !Number.isNaN(startsAt.getTime()) && !Number.isNaN(endsAt.getTime()) && endsAt > startsAt

  const submit = async () => {
    setErr('')
    try {
      const r = await mark.mutateAsync({ mentorId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), allDay: f.allDay, reason: f.reason.trim() })
      if (r.alreadyBooked?.length) setBooked(r.alreadyBooked)
      else onClose()
    } catch (e) { setErr(refusal(e, 'Could not save it')) }
  }

  const at = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const field = 'w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm outline-none [color-scheme:dark]'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-white/10 bg-[#0d1117] p-5" onClick={e => e.stopPropagation()}>
        {booked ? (
          <>
            <p className="text-lg font-semibold">Marked — {mentorName} can't be booked then</p>
            <p className="text-sm opacity-80">These were already booked inside it and still stand. Move or cancel them if they shouldn't:</p>
            <ul className="divide-y divide-white/5 rounded-lg border border-white/10 text-sm">
              {booked.map(b => (
                <li key={`${b.kind}-${b.id}`} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span>{b.title || (b.kind === 'class' ? 'Class' : 'Session')}<span className="ml-1.5 text-xs opacity-60">{b.kind === 'class' ? 'class' : 'session'}</span></span>
                  <span className="shrink-0 text-xs opacity-70">{at(b.startsAt)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end"><button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">Done</button></div>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">{mentorId === 'me' ? 'Mark yourself not available' : `Mark ${mentorName} not available`}</p>
            <p className="text-xs opacity-60">Nobody can book {mentorId === 'me' ? 'you' : 'them'} in this time — no class, programme or session, from the LMS, the CS Portal or the CRMs. Times {tz.replace('_', ' ')}.</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.allDay} onChange={e => set('allDay', e.target.checked)} />Whole day(s)</label>
            {f.allDay ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs opacity-70">From<input type="date" className={field} value={f.fromDate} min={today} onChange={e => { set('fromDate', e.target.value); if (e.target.value > f.toDate) set('toDate', e.target.value) }} /></label>
                <label className="text-xs opacity-70">To (included)<input type="date" className={field} value={f.toDate} min={f.fromDate} onChange={e => set('toDate', e.target.value)} /></label>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs opacity-70">From<input type="date" className={field} value={f.fromDate} min={today} onChange={e => { set('fromDate', e.target.value); if (e.target.value > f.toDate) set('toDate', e.target.value) }} /></label>
                <label className="text-xs opacity-70">at<input type="time" className={field} value={f.fromTime} onChange={e => set('fromTime', e.target.value)} /></label>
                <label className="text-xs opacity-70">To<input type="date" className={field} value={f.toDate} min={f.fromDate} onChange={e => set('toDate', e.target.value)} /></label>
                <label className="text-xs opacity-70">at<input type="time" className={field} value={f.toTime} onChange={e => set('toTime', e.target.value)} /></label>
              </div>
            )}
            <input className={field} maxLength={300} placeholder="Reason (optional) — only the mentor and admins see it" value={f.reason} onChange={e => set('reason', e.target.value)} />
            {valid ? <p className="text-xs opacity-70">Not available: {timeOffLabel({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), allDay: f.allDay }, tz)}</p>
              : <p className="text-xs text-rose-400">The end must be after the start.</p>}
            {err && <p className="text-sm text-rose-400">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Cancel</button>
              <button type="button" disabled={!valid || mark.isPending} onClick={submit} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{mark.isPending ? 'Saving…' : 'Mark not available'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
