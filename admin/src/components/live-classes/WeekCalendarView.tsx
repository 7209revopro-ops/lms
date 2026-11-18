'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, X, Pencil, ExternalLink, UserCheck, UserPlus, BookOpen,
  MapPin, Users, Clock, CalendarOff, Radio, Trash2,
} from 'lucide-react'
import { apiGet } from '@/lib/axios'
import { useMyMeetings, type LiveClass } from '@/lib/api/liveClasses'
import { useMeetingsBetween, type MentorMeetingRow } from '@/lib/api/meetings'
import { useCancelMeeting, wallInZone, timeOffLabel, refusal, type MentorCalendar, type MentorTimeOff } from '@/lib/api/mentorCalendar'
import { useQueryState } from '@/lib/useQueryState'
import { getActiveTimeZone } from '@/lib/timezone'
import { useViewerAcademy, academyViewOf } from '@/components/live-classes/CrossAcademy'
import { EditLiveClassModal } from '@/components/live-classes/EditLiveClassModal'
import { BookForStudentModal } from '@/components/live-classes/BookForStudentModal'
import { EditMeetingDialog } from '@/components/live-classes/EditMeetingDialog'
import { useToast } from '@/store/ui.store'

/* ── Week and day calendar (2026-11-18) ──────────────────────────────────────────────────────────────────────────
   The Live Classes page's hour-by-hour view, like Google Calendar: classes, and beside them everything else that
   takes a mentor's hour — sales / client meetings booked from the CRM, student meetings the CS Portal approved,
   staff meetings, time off. Each opens a panel with what it is and what can be done with it.

   One clock for the whole grid: the viewer's academy (Dubai or Bangalore). A class another academy hosts sits at
   the hour it is HERE, so two blocks side by side are side by side in time. The day shown is `?day=YYYY-MM-DD` on
   that clock; the week runs Monday to Sunday around it. */

export type CalendarMode = 'week' | 'day'

const DAY_MS = 864e5
const HOUR_PX = 48

const KINDS = {
  online:  { label: 'Online classes',          one: 'Online class',          color: '#3B82F6' },
  offline: { label: 'In-person classes',       one: 'In-person class',       color: '#10B981' },
  client:  { label: 'Sales / client meetings', one: 'Sales / client meeting', color: '#F59E0B' },
  student: { label: 'Student meetings',        one: 'Student meeting',       color: '#A78BFA' },
  staff:   { label: 'Staff meetings',          one: 'Staff meeting',         color: '#38BDF8' },
  off:     { label: 'Time off',                one: 'Time off',              color: '#94A3B8' },
} as const
type Kind = keyof typeof KINDS

type Source =
  | { type: 'class'; live: LiveClass }
  | { type: 'meeting'; m: MentorMeetingRow }
  | { type: 'off'; t: MentorTimeOff & { mentorName: string } }
interface CalEvent { key: string; kind: Kind; start: number; end: number; title: string; who: string; src: Source }

/* ── Days as YYYY-MM-DD on the academy's calendar ───────────────────────────────────────────── */
const todayKey = (tz: string) => new Date().toLocaleDateString('en-CA', { timeZone: tz })
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
const mondayOf = (key: string) => addDays(key, -((new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7))
const okKey = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(Date.parse(`${k}T00:00:00Z`))

/** The span the page asks the server for while this view is open: the week around `dayKey`, a day of slack each side. */
export function weekWindow(dayKey: string, tz = getActiveTimeZone()): { from: string; to: string } {
  const monday = mondayOf(okKey(dayKey) ? dayKey : todayKey(tz))
  return {
    from: wallInZone(addDays(monday, -1), '00:00', tz).toISOString(),
    to:   wallInZone(addDays(monday, 8), '00:00', tz).toISOString(),
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const parts = (key: string) => { const d = new Date(`${key}T00:00:00Z`); return { dow: d.getUTCDay(), day: d.getUTCDate(), mon: d.getUTCMonth(), year: d.getUTCFullYear() } }
const hourLabel = (h: number) => (h === 0 || h === 24 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`)

function rangeLabel(days: string[]): string {
  const a = parts(days[0]!), b = parts(days[days.length - 1]!)
  if (days.length === 1) return `${WEEKDAYS[a.dow]} ${a.day} ${MONTHS[a.mon]} ${a.year}`
  if (a.mon === b.mon) return `${a.day} – ${b.day} ${MONTHS[b.mon]} ${b.year}`
  if (a.year === b.year) return `${a.day} ${MONTHS[a.mon]} – ${b.day} ${MONTHS[b.mon]} ${b.year}`
  return `${a.day} ${MONTHS[a.mon]} ${a.year} – ${b.day} ${MONTHS[b.mon]} ${b.year}`
}

/* Who may read what, as the sidebar decides it (AdminSidebar canView) — so a role without Bookings is not sent to a
   403 every minute. No custom role: the base role decides, and the server answers for itself. */
interface Viewer { id: string; email: string; role: string; permissions?: { resource: string; read: boolean; list: boolean }[] }
const mayList = (me: Viewer | undefined, resource: string) => {
  if (!me) return false
  if (me.role === 'super_admin' || !me.permissions) return true
  const row = me.permissions.find(p => p.resource === resource)
  return !!row && (row.list || row.read)
}

export function WeekCalendarView({ items, mode, onMode, mentorFilter, search, me }: {
  /** The page's classes, already narrowed by its filters. */
  items: LiveClass[]
  mode: CalendarMode
  onMode: (m: CalendarMode) => void
  /** The page's instructor filter (a user id) — applied to meetings and time off too. */
  mentorFilter: string
  search: string
  me: Viewer | undefined
}) {
  const tz = getActiveTimeZone()
  const isInstructor = me?.role === 'instructor'
  const [dayParam, setDayParam] = useQueryState('day', '')
  const dayKey = okKey(dayParam) ? dayParam : todayKey(tz)
  const days = useMemo(() => {
    if (mode === 'day') return [dayKey]
    const monday = mondayOf(dayKey)
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  }, [mode, dayKey])
  const win = useMemo(() => weekWindow(dayKey, tz), [dayKey, tz])
  const go = (n: number) => setDayParam(addDays(dayKey, n * (mode === 'day' ? 1 : 7)))
  const goToday = () => setDayParam('')

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t) }, [])

  /* ── What else takes the hour ──────────────────────────────────────────────────────── */
  const canMeetings = mayList(me, 'bookings')
  const canTimeOff = mayList(me, 'mentor-calendar')
  const meetingsQ = useMeetingsBetween(win.from, win.to, { enabled: canMeetings })
  /* A mentor's list above is the meetings they host; a staff meeting somebody else booked them into comes from here. */
  const { data: mine = [] } = useMyMeetings(isInstructor ? me?.id : undefined)
  const timeOffQ = useQuery({
    queryKey: ['admin', 'mentor-calendar', win.from, win.to],
    queryFn: () => apiGet<MentorCalendar>(`/admin/mentor-calendar?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}`),
    enabled: canTimeOff,
    staleTime: 30_000,
    retry: false,
  })

  const [hidden, setHidden] = useState<Set<Kind>>(() => new Set())
  const toggle = (k: Kind) => setHidden(h => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const events = useMemo<CalEvent[]>(() => {
    const out: CalEvent[] = []
    const q = search.trim().toLowerCase()
    const matches = (...s: (string | null | undefined)[]) => !q || s.some(x => x?.toLowerCase().includes(q))

    for (const live of items) {
      const start = Date.parse(live.scheduledStart)
      out.push({
        key: `c-${live.id}`, kind: live.isOnline === false ? 'offline' : 'online',
        start, end: start + (live.durationMins || 60) * 60_000,
        title: live.title, who: live.instructor?.name ?? '', src: { type: 'class', live },
      })
    }

    const meetings = new Map<string, MentorMeetingRow>()
    for (const m of meetingsQ.data ?? []) meetings.set(m.id, m)
    for (const m of mine) {
      if (meetings.has(m.id)) continue
      meetings.set(m.id, {
        id: m.id, title: m.title, kind: m.kind, scheduledStart: m.startsAt, durationMins: m.durationMins, mentor: null,
        attendees: m.attendees.map(a => ({ name: a.name, email: a.email || null })), bookedByEmail: m.bookedByEmail,
        bookedVia: 'lms', isOnline: true, meetingUrl: m.meetingUrl || null, location: null, notes: m.notes || null, status: 'upcoming',
      })
    }
    for (const m of meetings.values()) {
      if (mentorFilter && m.mentor && m.mentor.id !== mentorFilter) continue
      if (!matches(m.title, m.mentor?.name, ...m.attendees.map(a => a.name))) continue
      const start = Date.parse(m.scheduledStart)
      out.push({
        key: `m-${m.id}`, kind: m.kind, start, end: start + (m.durationMins || 30) * 60_000,
        title: m.title, who: m.mentor?.name ?? '', src: { type: 'meeting', m },
      })
    }

    const seen = new Set<string>()
    for (const mentor of timeOffQ.data?.mentors ?? []) {
      for (const t of mentor.timeOff ?? []) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        if (isInstructor && t.mentorId !== me?.id) continue
        if (mentorFilter && t.mentorId !== mentorFilter) continue
        if (!matches(mentor.name, t.reason)) continue
        out.push({
          key: `o-${t.id}`, kind: 'off', start: Date.parse(t.startsAt), end: Date.parse(t.endsAt),
          title: `${mentor.name} — time off`, who: mentor.name, src: { type: 'off', t: { ...t, mentorName: mentor.name } },
        })
      }
    }
    return out.filter(e => !hidden.has(e.kind))
  }, [items, meetingsQ.data, mine, timeOffQ.data, mentorFilter, search, hidden, isInstructor, me?.id])

  /* ── Placing each block on its day ─────────────────────────────────────────────────── */
  const dayStarts = useMemo(() => days.map(d => wallInZone(d, '00:00', tz).getTime()), [days, tz])
  type Placed = CalEvent & { top: number; bottom: number; col: number; cols: number; cutStart: boolean; cutEnd: boolean }
  const { perDay, allDay, h0, h1 } = useMemo(() => {
    const perDay: Placed[][] = days.map(() => [])
    const allDay: CalEvent[][] = days.map(() => [])
    let lo = 8 * 60, hi = 21 * 60
    days.forEach((_, i) => {
      const ds = dayStarts[i]!, de = ds + DAY_MS
      for (const e of events) {
        if (e.start >= de || e.end <= ds) continue
        /* Time off that covers the whole day reads as a strip on top, not a column-high block. */
        if (e.kind === 'off' && e.start <= ds && e.end >= de) { allDay[i]!.push(e); continue }
        const top = Math.max(0, (e.start - ds) / 60_000), bottom = Math.min(1440, (e.end - ds) / 60_000)
        if (e.kind !== 'off') { lo = Math.min(lo, top); hi = Math.max(hi, bottom) }
        perDay[i]!.push({ ...e, top, bottom, col: 0, cols: 1, cutStart: e.start < ds, cutEnd: e.end > de })
      }
      /* Side by side when they overlap: a cluster runs while blocks keep overlapping; each takes the first free column. */
      const list = perDay[i]!.sort((a, b) => a.top - b.top || b.bottom - a.bottom)
      let cluster: Placed[] = [], colEnds: number[] = [], clusterEnd = -1
      const close = () => { for (const p of cluster) p.cols = colEnds.length; cluster = []; colEnds = [] }
      for (const p of list) {
        if (p.top >= clusterEnd) close()
        let c = colEnds.findIndex(end => end <= p.top)
        if (c < 0) { c = colEnds.length; colEnds.push(p.bottom) } else colEnds[c] = p.bottom
        p.col = c; cluster.push(p); clusterEnd = Math.max(clusterEnd, p.bottom)
      }
      close()
    })
    return { perDay, allDay, h0: Math.floor(lo / 60), h1: Math.min(24, Math.ceil(hi / 60)) }
  }, [days, dayStarts, events])

  const [selected, setSelected] = useState<CalEvent | null>(null)
  /* The open panel follows a refetch — a saved edit shows its new time without closing and reopening. */
  const current = selected ? (events.find(e => e.key === selected.key) ?? selected) : null

  const today = todayKey(tz)
  const anyAllDay = allDay.some(a => a.length > 0)
  const gridCols = `56px repeat(${days.length}, minmax(0, 1fr))`
  const BORDER = '1px solid rgba(255,255,255,0.07)'

  return (
    <div>
      {/* Navigation */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => go(-1)} aria-label={mode === 'day' ? 'Previous day' : 'Previous week'}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-white/50 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
          <ChevronLeft size={14} />
        </button>
        <button type="button" onClick={() => go(1)} aria-label={mode === 'day' ? 'Next day' : 'Next week'}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-white/50 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
          <ChevronRight size={14} />
        </button>
        <button type="button" onClick={goToday}
          className="rounded-xl px-4 py-1.5 text-xs font-semibold text-white/50 hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
          Today
        </button>
        <span className="ml-1 text-base font-bold text-white">{rangeLabel(days)}</span>
        <span className="text-[11px] text-white/30">{tz.split('/')[1]?.replace('_', ' ')} time</span>
        <div className="flex-1" />
        {(meetingsQ.isFetching || timeOffQ.isFetching) && <span className="text-[11px] text-white/30">Updating…</span>}
      </div>

      {/* Kinds — each shows or hides its blocks */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(Object.keys(KINDS) as Kind[]).map(k => {
          const unavailable = (k === 'off' && !canTimeOff) || ((k === 'client' || k === 'student' || k === 'staff') && !canMeetings && !isInstructor)
          if (unavailable) return null
          const off = hidden.has(k)
          return (
            <button key={k} type="button" onClick={() => toggle(k)} aria-pressed={!off}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-opacity"
              style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.7)', opacity: off ? 0.35 : 1, textDecoration: off ? 'line-through' : 'none' }}>
              <span className="h-2 w-2 rounded-full" style={{ background: KINDS[k].color }} />{KINDS[k].label}
            </button>
          )
        })}
        {meetingsQ.isError && <span className="self-center text-[11px] text-amber-400/80">Meetings couldn&apos;t be loaded — classes only.</span>}
      </div>

      <div className="overflow-x-auto rounded-2xl" style={{ border: BORDER }}>
        <div className={mode === 'week' ? 'min-w-[860px]' : ''}>
          {/* Day headings — a click opens that day */}
          <div className="grid" style={{ gridTemplateColumns: gridCols, background: 'rgba(255,255,255,0.025)', borderBottom: BORDER }}>
            <div />
            {days.map(d => {
              const p = parts(d), isToday = d === today
              return (
                <button key={d} type="button" onClick={() => { setDayParam(d); onMode('day') }}
                  className="flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-bold uppercase tracking-wider hover:bg-white/[0.03]"
                  style={{ color: isToday ? '#fff' : 'rgba(255,255,255,0.40)', borderLeft: BORDER }}
                  title={mode === 'week' ? 'Open this day' : undefined}>
                  {WEEKDAYS[p.dow]}
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs"
                    style={isToday ? { background: '#0057b8', color: '#fff' } : { color: 'rgba(255,255,255,0.65)' }}>{p.day}</span>
                </button>
              )
            })}
          </div>

          {/* Whole-day time off */}
          {anyAllDay && (
            <div className="grid" style={{ gridTemplateColumns: gridCols, borderBottom: BORDER }}>
              <div className="py-1 pr-2 text-right text-[10px] text-white/30">All day</div>
              {allDay.map((list, i) => (
                <div key={days[i]} className="space-y-0.5 p-0.5" style={{ borderLeft: BORDER }}>
                  {list.map(e => (
                    <button key={e.key} type="button" onClick={() => setSelected(e)}
                      className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-semibold"
                      style={{ background: 'repeating-linear-gradient(135deg, rgba(148,163,184,0.18) 0 6px, transparent 6px 12px)', color: '#CBD5E1', borderLeft: `3px solid ${KINDS.off.color}` }}>
                      {e.who} — off
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Hours */}
          <div className="grid" style={{ gridTemplateColumns: gridCols }}>
            <div className="relative" style={{ height: (h1 - h0) * HOUR_PX }}>
              {Array.from({ length: h1 - h0 }, (_, i) => (
                <div key={i} className="absolute right-2 -translate-y-1/2 text-[10px] text-white/30" style={{ top: i * HOUR_PX }}>
                  {i === 0 ? '' : hourLabel(h0 + i)}
                </div>
              ))}
            </div>
            {days.map((d, i) => {
              const ds = dayStarts[i]!
              const nowMin = (now - ds) / 60_000
              return (
                <div key={d} className="relative" style={{
                  height: (h1 - h0) * HOUR_PX, borderLeft: BORDER,
                  background: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, rgba(255,255,255,0.05) ${HOUR_PX - 1}px, rgba(255,255,255,0.05) ${HOUR_PX}px)${d === today ? ', rgba(0,87,184,0.04)' : ''}`,
                }}>
                  {nowMin >= h0 * 60 && nowMin <= h1 * 60 && (
                    <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top: (nowMin / 60 - h0) * HOUR_PX }}>
                      <div className="relative h-0.5 bg-red-500"><span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-red-500" /></div>
                    </div>
                  )}
                  {perDay[i]!.map(p => {
                    const top = Math.max(0, (p.top / 60 - h0) * HOUR_PX)
                    const bottom = Math.min((h1 - h0) * HOUR_PX, (p.bottom / 60 - h0) * HOUR_PX)
                    const height = Math.max(18, bottom - top - 2)
                    return (
                      <Block key={p.key} e={p} top={top} height={height} col={p.col} cols={p.cols} tz={tz}
                        active={current?.key === p.key} onClick={() => setSelected(p)} />
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {current && <DetailPanel e={current} tz={tz} me={me} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}

/* ── One block on the grid ─────────────────────────────────────────────────────────────────── */
function Block({ e, top, height, col, cols, tz, active, onClick }: {
  e: CalEvent; top: number; height: number; col: number; cols: number; tz: string; active: boolean; onClick: () => void
}) {
  const color = KINDS[e.kind].color
  const live = e.src.type === 'class' ? e.src.live : null
  const isLive = live?.status === 'live'
  const faded = live?.status === 'ended' || (e.src.type === 'meeting' && e.src.m.status === 'completed')
  const cancelled = live?.status === 'cancelled'
  const time = new Date(e.start).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  const hatch = e.kind === 'off'
  return (
    <button type="button" onClick={onClick}
      title={`${time} · ${e.title}${e.who ? ` · ${e.who}` : ''}`}
      className="absolute z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-left transition-[filter] hover:brightness-125"
      style={{
        top, height,
        left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`,
        background: hatch ? `repeating-linear-gradient(135deg, ${color}2e 0 6px, transparent 6px 12px)` : `${color}29`,
        borderLeft: `3px solid ${color}`,
        outline: active ? '2px solid rgba(255,255,255,0.7)' : isLive ? '1.5px solid #EF4444' : 'none',
        opacity: cancelled ? 0.4 : faded ? 0.6 : 1,
      }}>
      <p className={`truncate text-[11px] font-semibold leading-tight text-white ${cancelled ? 'line-through' : ''}`}>
        {isLive && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" />}
        {e.title}
      </p>
      {height >= 32 && (
        <p className="truncate text-[10px] leading-tight" style={{ color: 'rgba(255,255,255,0.6)' }}>
          {time}{e.who ? ` · ${e.who}` : ''}
        </p>
      )}
    </button>
  )
}

/* ── What a block is, and what can be done with it ─────────────────────────────────────────── */
function DetailPanel({ e, tz, me, onClose }: { e: CalEvent; tz: string; me: Viewer | undefined; onClose: () => void }) {
  const viewer = useViewerAcademy()
  const toast = useToast()
  const qc = useQueryClient()
  const cancelMeeting = useCancelMeeting()
  const [editClass, setEditClass] = useState(false)
  const [bookClass, setBookClass] = useState(false)
  const [editMeeting, setEditMeeting] = useState(false)

  const when = (() => {
    const day = new Date(e.start).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })
    const t = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    return `${day} · ${t(e.start)} – ${t(e.end)}`
  })()
  const color = KINDS[e.kind].color
  const row = (icon: React.ReactNode, children: React.ReactNode) => (
    <div className="flex items-start gap-2.5 text-sm text-white/75"><span className="mt-0.5 text-white/35">{icon}</span><div className="min-w-0 flex-1 break-words">{children}</div></div>
  )
  const action = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10'
  const actionStyle = { border: '1px solid rgba(255,255,255,0.12)' }

  let body: React.ReactNode = null
  let actions: React.ReactNode = null

  if (e.src.type === 'class') {
    const live = e.src.live
    const { isHost, hostLabel } = academyViewOf(live, viewer)
    const meetUrl = live.meetingUrl
    const ended = live.status === 'ended', cancelled = live.status === 'cancelled'
    const future = Date.parse(live.scheduledStart) > Date.now()
    body = (
      <>
        {row(<Clock size={14} />, when)}
        {row(<Users size={14} />, <>{live.instructor?.name ?? 'No mentor'} · {live.bookedCount}/{live.sessionCapacity} booked</>)}
        {live.course && row(<BookOpen size={14} />, <>{live.course.title}{live.section?.title ? ` · ${live.section.title}` : ''}</>)}
        {live.isOnline === false
          ? row(<MapPin size={14} />, [live.location, live.room].filter(Boolean).join(' · ') || 'In person')
          : meetUrl && row(<ExternalLink size={14} />, <a href={meetUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{meetUrl.replace(/^https?:\/\//, '')}</a>)}
        {cancelled && live.cancelReason && row(<X size={14} />, <>Cancelled: {live.cancelReason}</>)}
        {!isHost && <p className="text-xs text-white/40">Shared by {hostLabel} — only they can change it.</p>}
      </>
    )
    actions = (
      <>
        {isHost && <button type="button" className={action} style={actionStyle} onClick={() => setEditClass(true)}><Pencil size={12} />Edit class</button>}
        {meetUrl && live.isOnline !== false && !ended && !cancelled && (
          <a href={meetUrl} target="_blank" rel="noopener noreferrer" className={action} style={actionStyle}><ExternalLink size={12} />Open Meet</a>
        )}
        <Link href={`/live-classes/${live.id}/attendance`} className={action} style={actionStyle}><UserCheck size={12} />Attendance</Link>
        {isHost && live.status === 'scheduled' && future && (
          <button type="button" className={action} style={actionStyle} onClick={() => setBookClass(true)}><UserPlus size={12} />Book a student</button>
        )}
        {isHost && live.type === 'internal' && (live.status === 'live' || live.status === 'scheduled') && (
          <Link href={`/live-classes/${live.id}/monitor`} className={action} style={actionStyle}><Radio size={12} />{live.status === 'live' ? 'Monitor' : 'Go live'}</Link>
        )}
        {ended && live.recordingUrl && (
          <a href={live.recordingUrl} target="_blank" rel="noopener noreferrer" className={action} style={actionStyle}><BookOpen size={12} />Recording</a>
        )}
      </>
    )
  } else if (e.src.type === 'meeting') {
    const m = e.src.m
    const mayChange = me?.role !== 'instructor' || m.bookedByEmail?.toLowerCase() === me.email?.toLowerCase()
    const over = m.status === 'completed'
    body = (
      <>
        {row(<Clock size={14} />, when)}
        {row(<Users size={14} />, <>{m.mentor?.name ? `${m.mentor.name} with ` : 'With '}{m.attendees.map(a => a.name).join(', ') || '—'}</>)}
        {m.isOnline
          ? m.meetingUrl && row(<ExternalLink size={14} />, <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{m.meetingUrl.replace(/^https?:\/\//, '')}</a>)
          : row(<MapPin size={14} />, m.location || 'In person')}
        {m.notes && row(<Pencil size={14} />, <span className="whitespace-pre-wrap">{m.notes}</span>)}
        <p className="text-xs text-white/40">Booked by {m.bookedByEmail}{m.bookedVia === 'portal' ? ' from the CS Portal / CRM' : ' in the LMS'}</p>
      </>
    )
    actions = (
      <>
        {mayChange && !over && <button type="button" className={action} style={actionStyle} onClick={() => setEditMeeting(true)}><Pencil size={12} />Edit meeting</button>}
        {m.isOnline && m.meetingUrl && !over && (
          <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer" className={action} style={actionStyle}><ExternalLink size={12} />Open Meet</a>
        )}
        {mayChange && !over && (
          <button type="button" className={`${action} text-red-300`} style={{ border: '1px solid rgba(239,68,68,0.3)' }} disabled={cancelMeeting.isPending}
            onClick={async () => {
              if (!window.confirm(`Cancel "${m.title}"? Everyone in it is emailed.`)) return
              try {
                await cancelMeeting.mutateAsync(m.id)
                qc.invalidateQueries({ queryKey: ['admin', 'meetings'] })
                qc.invalidateQueries({ queryKey: ['mentor-meetings'] })
                toast.success('Meeting cancelled')
                onClose()
              } catch (err) { toast.error(refusal(err, 'Could not cancel it')) }
            }}>
            <Trash2 size={12} />Cancel meeting
          </button>
        )}
      </>
    )
  } else {
    const t = e.src.t
    body = (
      <>
        {row(<CalendarOff size={14} />, timeOffLabel(t, tz))}
        {row(<Users size={14} />, t.mentorName)}
        {t.reason && row(<Pencil size={14} />, t.reason)}
        <p className="text-xs text-white/40">Marked by {t.createdByName || 'someone'}. Nothing can be booked with them in it.</p>
      </>
    )
    actions = <Link href="/mentor-calendar" className={action} style={actionStyle}><CalendarOff size={12} />Change in Mentor Calendar</Link>
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <aside className="fixed bottom-4 right-4 top-20 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-2xl p-5 text-white"
        style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div className="mb-3 flex items-start gap-2">
          <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${color}29`, color }}>
            {KINDS[e.kind].one}
          </span>
          {e.src.type === 'class' && e.src.live.status !== 'scheduled' && (
            <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize"
              style={{ background: 'rgba(255,255,255,0.06)', color: e.src.live.status === 'live' ? '#EF4444' : 'rgba(255,255,255,0.55)' }}>{e.src.live.status}</span>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-white/50 hover:bg-white/10"><X size={16} /></button>
        </div>
        <h3 className="mb-3 text-base font-bold leading-snug">{e.title}</h3>
        <div className="space-y-2">{body}</div>
        <div className="mt-4 flex flex-wrap gap-2">{actions}</div>
      </aside>

      <AnimatePresence>
        {editClass && e.src.type === 'class' && (
          <EditLiveClassModal live={e.src.live} onClose={() => setEditClass(false)} onSuccess={() => setEditClass(false)} />
        )}
        {bookClass && e.src.type === 'class' && (
          <BookForStudentModal live={e.src.live} onClose={() => setBookClass(false)} onSuccess={() => setBookClass(false)} />
        )}
      </AnimatePresence>
      {editMeeting && e.src.type === 'meeting' && <EditMeetingDialog id={e.src.m.id} onClose={() => setEditMeeting(false)} />}
    </>
  )
}
