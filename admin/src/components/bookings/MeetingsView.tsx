'use client'
/* ─────────────────────────────────────────────────────────────
   The Bookings page's "Meetings" tab (2026-10-24): every 1:1 / group meeting
   booked with a mentor — from the commission portal or LMS admin's Mentor
   Calendar — with its participants and who booked it. Stat cards on top;
   clicking one shows just those meetings. A row opens the meeting in full.
   Shares the page's date range; an admin can pick one mentor.
───────────────────────────────────────────────────────────── */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CalendarClock, CalendarCheck2, Ban, CheckCircle2, Globe2, MapPin, Search, Users, Video, X, ChevronLeft, ChevronRight, ExternalLink, Clock,
} from 'lucide-react'
import { useMentorMeetings, type MeetingBucket, type MentorMeetingRow } from '@/lib/api/meetings'
import Spinner from '@/components/ui/Spinner'
import { useQueryState, setQueryParams } from '@/lib/useQueryState'

const CARDS: Array<{ key: MeetingBucket; label: string; icon: typeof CalendarClock; color: string }> = [
  { key: 'upcoming',  label: 'Upcoming',             icon: CalendarClock,  color: '#60A5FA' },
  { key: 'today',     label: 'Today',                icon: CalendarCheck2, color: '#34D399' },
  { key: 'portal',    label: 'Booked from portal',   icon: Globe2,         color: '#A78BFA' },
  { key: 'completed', label: 'Completed',            icon: CheckCircle2,   color: '#FBBF24' },
  { key: 'cancelled', label: 'Cancelled',            icon: Ban,            color: '#F87171' },
]
const KIND: Record<string, string> = { student: 'Student', client: 'Client', staff: 'Staff' }
const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  upcoming:  { label: 'Upcoming',  bg: 'rgba(96,165,250,0.14)', color: '#60A5FA' },
  live:      { label: 'Now',       bg: 'rgba(52,211,153,0.16)', color: '#34D399' },
  completed: { label: 'Done',      bg: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.55)' },
  cancelled: { label: 'Cancelled', bg: 'rgba(248,113,113,0.14)', color: '#F87171' },
}
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const muted = 'rgba(255,255,255,0.45)'

export function MeetingsView({ dateFrom, dateTo, isInstructor, mentors }: {
  dateFrom: string; dateTo: string; isInstructor: boolean
  mentors: Array<{ id: string; name: string }>
}) {
  /* Filters in the address bar (lib/useQueryState.ts), m-prefixed so they never
     clash with the class-bookings keys the page writes (?status, ?q, ?page…). */
  const [bucket] = useQueryState<MeetingBucket>('mbucket', 'all')
  const [mentorId] = useQueryState('mentor', '')
  const [search] = useQueryState('mq', '', { history: 'replace' })
  const [page, setPage] = useQueryState('mpage', 1)
  /* The server is asked once typing pauses; the box itself is the URL value. */
  const [q, setQ] = useState(search.trim())
  const [open, setOpen] = useState<MentorMeetingRow | null>(null)
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t) }, [search])
  /* Every filter change goes back to page 1: bucket / mentor / search in their
     handlers (one history entry), a date change here — but not on mount, so a
     reload keeps ?mpage. */
  const pickBucket = (b: MeetingBucket) => setQueryParams({ mbucket: b === 'all' ? null : b, mpage: null })
  const dates = `${dateFrom}|${dateTo}`
  const lastDates = useRef(dates)
  useEffect(() => {
    if (lastDates.current === dates) return
    lastDates.current = dates
    setQueryParams({ mpage: null }, 'replace')
  }, [dates])

  const { data, isLoading, isError, isFetching } = useMentorMeetings({
    dateFrom, dateTo, bucket, search: q || undefined, page, per_page: 50,
    instructorId: isInstructor ? undefined : mentorId || undefined,
  })
  const stats = data?.stats
  const items = data?.items ?? []
  const pages = data?.meta?.total_pages ?? 1

  return (
    <div>
      {/* ── Stat cards: click one to see just those ── */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {CARDS.map(c => {
          const on = bucket === c.key
          const I = c.icon
          return (
            <motion.button key={c.key} type="button" whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
              onClick={() => pickBucket(on ? 'all' : c.key)} aria-pressed={on}
              className="rounded-2xl p-4 text-left transition-colors"
              style={{ background: on ? `${c.color}1f` : 'rgba(255,255,255,0.03)', border: `1px solid ${on ? `${c.color}66` : 'rgba(255,255,255,0.07)'}` }}>
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `${c.color}22` }}><I size={15} style={{ color: c.color }} /></span>
                {on && <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.color }}>Showing</span>}
              </div>
              <p className="mt-3 text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>{stats ? stats[c.key] : '—'}</p>
              <p className="text-xs" style={{ color: muted }}>{c.label}</p>
            </motion.button>
          )
        })}
      </div>

      {/* ── Filters ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: muted }} />
          <input value={search} onChange={e => setQueryParams({ mq: e.target.value, mpage: null }, 'replace')} placeholder="Search title, participant or who booked"
            className="w-72 max-w-full rounded-xl py-2 pl-8 pr-3 text-sm text-white outline-none placeholder:text-white/30"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }} />
        </div>
        {!isInstructor && (
          <select value={mentorId} onChange={e => setQueryParams({ mentor: e.target.value || null, mpage: null })} aria-label="Mentor"
            className="rounded-xl px-3 py-2 text-sm text-white outline-none" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', colorScheme: 'dark' }}>
            <option value="">All mentors</option>
            {mentors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        {bucket !== 'all' && (
          <button type="button" onClick={() => pickBucket('all')} className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}>
            <X size={12} />{CARDS.find(c => c.key === bucket)?.label} — show all
          </button>
        )}
        {isFetching && !isLoading && <Spinner size={14} variant="muted" />}
      </div>

      {/* ── The list ── */}
      <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
        {isLoading && <div className="flex justify-center py-16"><Spinner size={18} variant="muted" /></div>}
        {isError && <p className="px-6 py-14 text-center text-sm" style={{ color: '#F87171' }}>Could not load the meetings.</p>}
        {!isLoading && !isError && items.length === 0 && (
          <p className="px-6 py-14 text-center text-sm" style={{ color: muted }}>No meetings{bucket !== 'all' ? ` in "${CARDS.find(c => c.key === bucket)?.label}"` : ''} for these dates.</p>
        )}
        {items.map((m, i) => {
          const st = STATUS[m.status]!
          return (
            <button key={m.id} type="button" onClick={() => setOpen(m)}
              className="flex w-full flex-col gap-2 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03] sm:flex-row sm:items-center sm:gap-4"
              style={{ borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
              <div className="w-40 shrink-0">
                <p className="text-sm font-semibold text-white">{when(m.scheduledStart)}</p>
                <p className="text-[11px]" style={{ color: muted }}>{m.durationMins} min · {KIND[m.kind] ?? m.kind}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{m.title}</p>
                <p className="flex items-center gap-1.5 truncate text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>
                  <Users size={12} className="shrink-0" style={{ color: muted }} />
                  {m.attendees.map(a => a.name).join(', ')}
                </p>
                {!isInstructor && m.mentor && <p className="truncate text-[11px]" style={{ color: muted }}>with {m.mentor.name}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="rounded-lg px-2 py-0.5 text-[10px] font-semibold"
                  style={m.bookedVia === 'portal' ? { background: 'rgba(167,139,250,0.15)', color: '#A78BFA' } : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)' }}>
                  {m.bookedVia === 'portal' ? 'From portal' : 'LMS'}
                </span>
                <span className="max-w-[180px] truncate text-[11px]" style={{ color: muted }} title={m.bookedByEmail}>by {m.bookedByEmail}</span>
                <span className="rounded-lg px-2 py-0.5 text-[10px] font-semibold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
              </div>
            </button>
          )
        })}
      </div>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-xs" style={{ color: muted }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="flex h-8 w-8 items-center justify-center rounded-xl disabled:opacity-30" style={{ background: 'rgba(255,255,255,0.05)' }}><ChevronLeft size={14} /></button>
          Page {page} of {pages}
          <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="flex h-8 w-8 items-center justify-center rounded-xl disabled:opacity-30" style={{ background: 'rgba(255,255,255,0.05)' }}><ChevronRight size={14} /></button>
        </div>
      )}

      {/* ── One meeting in full ── */}
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(null)} />
            <motion.div role="dialog" aria-label={open.title} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-6 sm:rounded-3xl"
              style={{ background: '#13162A', border: '1px solid rgba(255,255,255,0.08)' }}>
              <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="absolute right-4 top-4 rounded-lg p-1.5 text-white/50 hover:bg-white/5"><X size={16} /></button>
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: muted }}>{KIND[open.kind] ?? open.kind} meeting</p>
              <h2 className="mt-1 pr-8 text-xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>{open.title}</h2>
              <div className="mt-4 space-y-2 text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                <p className="flex items-center gap-2"><Clock size={14} style={{ color: muted }} />{when(open.scheduledStart)} · {open.durationMins} min</p>
                {open.mentor && <p className="flex items-center gap-2"><Users size={14} style={{ color: muted }} />Mentor: <b className="text-white">{open.mentor.name}</b></p>}
                {open.isOnline
                  ? <p className="flex items-center gap-2"><Video size={14} style={{ color: muted }} />{open.meetingUrl
                      ? <a href={open.meetingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#60A5FA] hover:underline">Join the meeting <ExternalLink size={12} /></a>
                      : 'Online — no link yet'}</p>
                  : <p className="flex items-center gap-2"><MapPin size={14} style={{ color: muted }} />{open.location || 'In person'}</p>}
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-wide" style={{ color: muted }}>Participants ({open.attendees.length})</p>
              <ul className="mt-2 space-y-1.5">
                {open.attendees.map((a, k) => (
                  <li key={k} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <span className="font-semibold text-white">{a.name}</span>
                    {a.email && <a href={`mailto:${a.email}`} className="truncate text-xs text-[#60A5FA] hover:underline">{a.email}</a>}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs" style={{ color: muted }}>
                Booked by <b className="text-white/80">{open.bookedByEmail}</b> · {open.bookedVia === 'portal' ? 'from the commission portal' : 'in LMS admin'}
              </p>
              {open.notes && <p className="mt-3 whitespace-pre-wrap rounded-xl p-3 text-sm" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.75)' }}>{open.notes}</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
