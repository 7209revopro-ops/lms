'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useMeetingDetail, useUpdateMeeting } from '@/lib/api/meetings'
import { refusal } from '@/lib/api/mentorCalendar'
import { datetimeLocalToISO, isoToDatetimeLocal, getActiveTimeZone } from '@/lib/timezone'

/* Change a mentor meeting from the Live Classes calendar (2026-11-18): its title, time, length, and where it happens.
   Who is in it stays as booked — that is the Mentor Calendar's form. Saved through the same path the portals use,
   so the clash, time-off and staff checks are the server's, and a new time, title or place emails everyone in it. */
export function EditMeetingDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const tz = getActiveTimeZone()
  const { data: m, isLoading, error } = useMeetingDetail(id)
  const save = useUpdateMeeting()
  const [f, setF] = useState({ title: '', when: '', durationMins: 30, inPerson: false, meetingUrl: '', location: '', notes: '' })
  const [err, setErr] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }))

  useEffect(() => {
    if (!m) return
    setF({
      title: m.title, when: isoToDatetimeLocal(m.startsAt, tz), durationMins: m.durationMins,
      inPerson: m.inPerson, meetingUrl: m.meetingUrl, location: m.location, notes: m.notes,
    })
  }, [m, tz])

  const submit = async () => {
    setErr('')
    if (f.title.trim().length < 3) { setErr('Give it a title of at least three characters.'); return }
    if (!f.when) { setErr('Pick a date and time.'); return }
    if (!Number.isInteger(f.durationMins) || f.durationMins < 5 || f.durationMins > 600) { setErr('Length is 5 to 600 minutes.'); return }
    if (f.inPerson && !f.location.trim()) { setErr('Say where it happens.'); return }
    try {
      const r = await save.mutateAsync({
        id, title: f.title.trim(), scheduledStart: datetimeLocalToISO(f.when, tz), durationMins: f.durationMins,
        inPerson: f.inPerson,
        ...(f.inPerson ? { location: f.location.trim() } : { meetingUrl: f.meetingUrl.trim() }),
        notes: f.notes,
      })
      setDone(r.linkNote ?? (r.notified ? 'Saved. Everyone in it has been emailed the change.' : 'Saved.'))
    } catch (e) { setErr(refusal(e, 'Could not save it')) }
  }

  const field = 'w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none [color-scheme:dark] focus:border-white/25'
  const label = 'mb-1 block text-xs font-semibold text-white/50'
  const notFound = (error as { response?: { status?: number } } | null)?.response?.status === 404

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-white/10 bg-[#0d1117] p-5 text-white" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold">Edit meeting</p>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-white/50 hover:bg-white/10"><X size={16} /></button>
        </div>

        {isLoading && <p className="py-6 text-center text-sm text-white/40">Loading…</p>}
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {notFound ? 'Only the person who booked this meeting, or an admin, can change it.' : refusal(error, 'Could not load this meeting')}
          </p>
        )}

        {done ? (
          <>
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{done}</p>
            <div className="flex justify-end"><button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">Done</button></div>
          </>
        ) : m && (
          <>
            <p className="text-xs text-white/45">
              With {m.mentorName || m.mentorEmail}
              {m.attendees.length > 0 && <> · {m.attendees.map(a => a.name).join(', ')}</>}
            </p>
            <div>
              <label className={label} htmlFor="mt-title">Title</label>
              <input id="mt-title" className={field} value={f.title} onChange={e => set('title', e.target.value)} />
            </div>
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <div>
                <label className={label} htmlFor="mt-when">Starts ({(tz.split("/")[1] ?? tz).replace("_", " ")} time)</label>
                <input id="mt-when" type="datetime-local" className={field} value={f.when} onChange={e => set('when', e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="mt-len">Minutes</label>
                <input id="mt-len" type="number" min={5} max={600} step={5} className={field} value={f.durationMins}
                  onChange={e => set('durationMins', Number(e.target.value))} />
              </div>
            </div>
            <div className="flex gap-1 rounded-lg border border-white/10 p-1 text-xs font-semibold">
              {([[false, 'Online'], [true, 'In person']] as const).map(([v, l]) => (
                <button key={l} type="button" onClick={() => set('inPerson', v)}
                  className={`flex-1 rounded-md px-3 py-1.5 ${f.inPerson === v ? 'bg-white/10 text-white' : 'text-white/40'}`}>{l}</button>
              ))}
            </div>
            {f.inPerson ? (
              <div>
                <label className={label} htmlFor="mt-loc">Where</label>
                <input id="mt-loc" className={field} value={f.location} placeholder="Room 2, Al Barsha" onChange={e => set('location', e.target.value)} />
              </div>
            ) : (
              <div>
                <label className={label} htmlFor="mt-url">Meeting link</label>
                <input id="mt-url" className={field} value={f.meetingUrl} placeholder="https://meet.google.com/abc-defg-hij" onChange={e => set('meetingUrl', e.target.value)} />
              </div>
            )}
            <div>
              <label className={label} htmlFor="mt-notes">Notes</label>
              <textarea id="mt-notes" rows={2} className={field} value={f.notes} onChange={e => set('notes', e.target.value)} />
            </div>
            <p className="text-[11px] text-white/35">A new time, title or place emails the mentor and everyone in the meeting.</p>
            {err && <p className="text-sm text-red-400">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-white/60 hover:bg-white/5">Close</button>
              <button type="button" onClick={submit} disabled={save.isPending}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                {save.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
