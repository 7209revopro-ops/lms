'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, DoorOpen, School } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import Spinner from '@/components/ui/Spinner'
import { usePods, type PodBookingRow, type PodMentor } from '@/lib/api/pods'

/* Pods (the user, 2026-10-18): the HRMS meeting pods online classes are given — pods 4 and 6–11 — and who has
   each through the day: classes (yours marked), and staff meetings booked in the HRMS. Online classes with no
   pod are listed under it. A Dubai day, 07:00–23:00.

   2026-10-19: the class rooms offline classes are given (Class Room 1, 2, Ball Room 1, Meeting Room 3) under the
   pods, and every mentor teaching online that day as the HRMS knows them — only office staff in Dubai get a pod,
   and a mentor the HRMS doesn't know, or knows by another email, stands out. */

const HRMS_LABEL: Record<PodMentor['hrms'], { text: string; tone: string }> = {
  office: { text: 'Office · Dubai', tone: 'text-emerald-400' },
  email_differs: { text: 'Office · email differs', tone: 'text-amber-300' },
  wfh: { text: 'Works from home', tone: 'text-rose-400' },
  not_dubai: { text: 'Not in Dubai', tone: 'text-rose-400' },
  left: { text: 'Left (HRMS)', tone: 'text-rose-400' },
  not_found: { text: 'Not in the HRMS', tone: 'text-rose-400' },
  excluded: { text: 'Excluded (no pod)', tone: 'opacity-60' },
  other_academy: { text: 'Other academy', tone: 'opacity-60' },
  unknown: { text: 'HRMS not reached', tone: 'opacity-60' },
}

const TZ = 'Asia/Dubai'
const FIRST_HOUR = 7, LAST_HOUR = 23
const SPAN_MS = (LAST_HOUR - FIRST_HOUR) * 3600_000
/** Midnight in Dubai (no summer time) of the Dubai day `offset` days from today. */
const dubaiMidnight = (offset: number) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  return new Date(new Date(`${today}T00:00:00+04:00`).getTime() + offset * 864e5)
}
const at = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })

export default function PodsPage() {
  const [offset, setOffset] = useState(0)
  const day = useMemo(() => dubaiMidnight(offset), [offset])
  const from = new Date(day.getTime()).toISOString()
  const to = new Date(day.getTime() + 864e5).toISOString()
  const { data, isLoading, error } = usePods(from, to)
  const axisStart = day.getTime() + FIRST_HOUR * 3600_000
  const now = Date.now()
  const today = offset === 0

  const byPod = useMemo(() => {
    const m = new Map<string, PodBookingRow[]>()
    for (const b of data?.bookings ?? []) m.set(b.podId, [...(m.get(b.podId) ?? []), b])
    return m
  }, [data])
  const podRows = (data?.pods ?? []).filter(p => p.kind !== 'room')
  const roomRows = (data?.pods ?? []).filter(p => p.kind === 'room')
  const freeNow = today ? podRows.filter(p => !(byPod.get(p.id) ?? []).some(b => new Date(b.start).getTime() <= now && new Date(b.end).getTime() > now)) : []
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - axisStart) / SPAN_MS) * 100))

  return (
    <div className="space-y-6">
      <PageHeader title="Pods" subtitle="The HRMS pods online classes are given, and the rooms offline classes are given — who has each, through the day. Times Dubai." />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOffset(o => o - 1)} className="rounded-lg border border-white/10 p-2 hover:bg-white/5" aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" onClick={() => setOffset(0)} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5">
          <CalendarDays className="h-4 w-4" />{today ? 'Today' : day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })}
        </button>
        <button type="button" onClick={() => setOffset(o => o + 1)} className="rounded-lg border border-white/10 p-2 hover:bg-white/5" aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
        {today && data?.configured && data.pods.length > 0 && (
          <span className="text-sm opacity-70">
            {freeNow.length ? <>Free now: <span className="font-medium text-emerald-400">{freeNow.map(p => p.name).join(', ')}</span></> : <span className="text-rose-400">Every pod is in use now</span>}
          </span>
        )}
      </div>

      {isLoading && <div className="flex justify-center py-12"><Spinner /></div>}
      {error && <p className="text-sm text-rose-400">{(error as Error).message || 'The pods did not load'}</p>}
      {data && !data.configured && <p className="rounded-xl border border-white/10 p-4 text-sm opacity-70">Pods are not set up on this server yet (the HRMS link).</p>}
      {data?.configured && !data.pods.length && <p className="rounded-xl border border-white/10 p-4 text-sm opacity-70">The HRMS has none of the pods (Pod 4, Pod 6–11) as active meeting rooms.</p>}

      {!!data?.pods.length && (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <div className="min-w-[860px] p-3">
            <div className="relative ml-28 h-5 text-[10px] opacity-50">
              {Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => (
                <span key={i} className="absolute -translate-x-1/2" style={{ left: `${(i / (LAST_HOUR - FIRST_HOUR)) * 100}%` }}>{String(FIRST_HOUR + i).padStart(2, '0')}:00</span>
              ))}
            </div>
            {[podRows, roomRows].map((list, i) => list.length > 0 && (
              <div key={i}>
                {i === 1 && <p className="mt-3 border-t border-white/10 pt-2 text-[11px] font-semibold uppercase tracking-widest opacity-50">Rooms for offline classes</p>}
            {list.map(p => (
              <div key={p.id} className="flex items-center border-t border-white/5 py-1.5">
                <span className="flex w-28 shrink-0 items-center gap-1 text-xs font-medium">{p.kind === 'room' ? <School className="h-3.5 w-3.5 opacity-60" /> : <DoorOpen className="h-3.5 w-3.5 opacity-60" />}{p.name}</span>
                <div className="relative h-10 flex-1 rounded bg-white/[0.03]">
                  {today && now > axisStart && now < axisStart + SPAN_MS && <span className="absolute inset-y-0 w-px bg-rose-400/70" style={{ left: `${pct(now)}%` }} />}
                  {(byPod.get(p.id) ?? []).map(b => {
                    const left = pct(new Date(b.start).getTime()), right = pct(new Date(b.end).getTime())
                    const tone = b.mine ? 'bg-blue-600/70 text-white' : b.classId ? 'bg-violet-500/25 text-violet-200' : 'bg-white/10 text-white/70'
                    return (
                      <div key={b.id} className={`absolute inset-y-0.5 overflow-hidden rounded px-1.5 py-0.5 text-[10px] leading-tight ${tone}`}
                        style={{ left: `${left}%`, width: `${Math.max(0.8, right - left)}%` }}
                        title={`${at(b.start)}–${at(b.end)} · ${b.title}${b.holder ? ` · ${b.holder}` : ''}`}>
                        <span className="block truncate font-medium">{b.title.replace(/^Class: /, '')}</span>
                        <span className="block truncate opacity-75">{at(b.start)}–{at(b.end)}{b.holder ? ` · ${b.holder.replace(/^LMS class · /, '')}` : ''}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
              </div>
            ))}
            <div className="mt-3 flex flex-wrap gap-3 text-[11px] opacity-70">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-blue-600/70" />Your classes</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-violet-500/25" />Other classes</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-white/10" />Staff meetings (HRMS)</span>
            </div>
          </div>
        </div>
      )}

      {!!data?.waiting.length && (
        <div className="rounded-2xl border border-rose-500/20 p-4">
          <p className="mb-2 text-sm font-semibold text-rose-300">Classes with no pod or room</p>
          <ul className="space-y-1 text-sm">
            {data.waiting.map(w => (
              <li key={w.classId} className={w.mine ? 'text-blue-300' : 'opacity-80'}>
                {at(w.start)} · {w.title}{w.mentor ? ` · ${w.mentor}` : ''} — {w.state === 'no_room' ? (w.kind === 'room' ? (w.note || 'every room is booked then') : 'every pod is booked then') : 'waiting for the HRMS'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!data?.mentors?.length && (
        <div className="overflow-x-auto rounded-2xl border border-white/10 p-4">
          <p className="mb-1 text-sm font-semibold">Mentors teaching online this day — as the HRMS knows them</p>
          <p className="mb-3 text-xs opacity-60">Only office staff in Dubai get a pod. A mentor the HRMS doesn&apos;t know, or knows by another email, is worth checking.</p>
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-widest opacity-50">
              <th className="py-1 pr-3 font-medium">Mentor</th><th className="py-1 pr-3 font-medium">Classes</th><th className="py-1 pr-3 font-medium">HRMS</th><th className="py-1 pr-3 font-medium">Pod</th>
            </tr></thead>
            <tbody>
              {data.mentors.map(m => {
                const l = HRMS_LABEL[m.hrms]
                return (
                  <tr key={m.id} className="border-t border-white/5 align-top">
                    <td className="py-1.5 pr-3"><span className="font-medium">{m.name || m.email}</span><span className="block text-[11px] opacity-50">{m.email}</span></td>
                    <td className="py-1.5 pr-3 tabular-nums">{m.classes}</td>
                    <td className="py-1.5 pr-3">
                      <span className={l.tone}>{l.text}</span>
                      {(m.hrmsName || m.designation) && <span className="block text-[11px] opacity-50">{[m.hrmsName, m.designation].filter(Boolean).join(' · ')}</span>}
                      {m.hrms === 'email_differs' && m.hrmsEmail && <span className="block text-[11px] text-amber-300/80">HRMS email: {m.hrmsEmail}</span>}
                    </td>
                    <td className="py-1.5 pr-3">{m.getsPod ? <span className="text-emerald-400">Gets one</span> : <span className="opacity-70">No — {m.reason}</span>}</td>
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
