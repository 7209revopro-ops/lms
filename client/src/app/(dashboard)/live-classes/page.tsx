'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Video, Radio, Calendar, Clock, Users,
  AlertCircle, Tv2, ExternalLink, BookOpen, ChevronRight,
  GraduationCap, X as XIcon, Phone, Search,
} from 'lucide-react'
import {
  useUpcomingLiveClasses, isLive, isUpcoming, isEnded, hasRecording,
  fmtCountdown, type LiveClass,
} from '@/lib/api/liveClasses'
import Spinner from '@/components/ui/Spinner'
import { AvatarImg } from '@/components/ui/AvatarImg'
import JoinMeetButton from '@/components/live-classes/JoinMeetButton'
import { useJoinClock } from '@/hooks/useJoinClock'
import { getJoinPhase } from '@/lib/joinWindow'
import { CLASS_LANGUAGES } from '@/lib/languages'

/* ── Helpers ─────────────────────────────────────────── */
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function fmtDate(iso: string) {
  const d   = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const tom = new Date(Date.now() + 86_400_000)
  if (d.toDateString() === tom.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtDuration(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate()
}
function firstDayOfMonth(y: number, m: number) {
  return new Date(y, m, 1).getDay() // 0=Sun
}

/* Gradient fallbacks by index */
const GRADIENTS = [
  '#0057b8',
  '#6366F1',
  '#0EA5E9',
  '#22C55E',
  '#F59E0B',
  '#EC4899',
]

type FilterKey = 'all' | 'live' | 'upcoming' | 'recordings'
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',        label: 'All' },
  { key: 'live',       label: 'Live Now' },
  { key: 'upcoming',   label: 'Upcoming' },
  { key: 'recordings', label: 'Recordings' },
]

/* ── Mini month calendar ─────────────────────────────── */
function MiniCalendar({
  classes, selectedDate, onSelect,
}: {
  classes:      LiveClass[]
  selectedDate: string | null
  onSelect:     (d: string | null) => void
}) {
  const today = new Date()
  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  /* Days that have sessions */
  const activeDays = useMemo(() => {
    const s = new Set<string>()
    classes.forEach(l => {
      const d = new Date(l.scheduledStart)
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        s.add(String(d.getDate()))
      }
    })
    return s
  }, [classes, viewYear, viewMonth])

  const dim    = daysInMonth(viewYear, viewMonth)
  const first  = firstDayOfMonth(viewYear, viewMonth)    // 0=Sun
  const offset = first === 0 ? 6 : first - 1             // shift to Mon-start

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const handleDay = (day: number) => {
    const d = new Date(viewYear, viewMonth, day).toDateString()
    onSelect(selectedDate === d ? null : d)
  }

  return (
    <div className="rounded-2xl p-4"
      style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
      {/* Month nav */}
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => {
            if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
            else setViewMonth(m => m - 1)
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bg-muted)]">
          <ChevronRight size={13} className="rotate-180" style={{ color: 'var(--color-text-muted)' }} />
        </button>
        <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>{monthLabel}</p>
        <button
          onClick={() => {
            if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
            else setViewMonth(m => m + 1)
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bg-muted)]">
          <ChevronRight size={13} style={{ color: 'var(--color-text-muted)' }} />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="mb-1 grid grid-cols-7 gap-0.5">
        {['M','T','W','T','F','S','S'].map((d, i) => (
          <div key={i} className="text-center text-[10px] font-bold" style={{ color: 'var(--color-text-muted)' }}>{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: offset }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: dim }).map((_, i) => {
          const day      = i + 1
          const isToday  = today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day
          const hasEvent = activeDays.has(String(day))
          const dateStr  = new Date(viewYear, viewMonth, day).toDateString()
          const isSel    = selectedDate === dateStr

          return (
            <button
              key={day}
              onClick={() => handleDay(day)}
              className="relative flex h-7 w-full flex-col items-center justify-center rounded-lg text-xs font-semibold transition-all"
              style={{
                background: isSel ? '#0057b8' : isToday ? 'rgba(0,87,184,0.10)' : 'transparent',
                color:      isSel ? '#fff'    : isToday ? '#0057b8' : 'var(--color-text-secondary)',
              }}>
              {day}
              {hasEvent && (
                <span
                  className="absolute bottom-0.5 h-1 w-1 rounded-full"
                  style={{ background: isSel ? 'rgba(255,255,255,0.7)' : '#0057b8' }}
                />
              )}
            </button>
          )
        })}
      </div>

      {selectedDate && (
        <button
          onClick={() => onSelect(null)}
          className="mt-3 w-full rounded-xl py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--color-bg-muted)]"
          style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
          Clear filter
        </button>
      )}
    </div>
  )
}

/* ── Hero card (Live Now) ────────────────────────────── */
function LiveHeroCard({ live, index, now }: { live: LiveClass; index: number; now: number }) {
  const thumb    = live.thumbnailUrl ?? live.course?.thumbnailUrl
  const gradient = GRADIENTS[index % GRADIENTS.length]!
  const isInt    = live.type === 'internal'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, type: 'spring', stiffness: 280, damping: 26 }}
      className="relative overflow-hidden rounded-3xl"
      style={{ aspectRatio: '16/7', minHeight: 180 }}>

      {/* Background */}
      {thumb ? (
        <img src={thumb} alt={live.title} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0" style={{ background: gradient }} />
      )}

      {/* Dark overlay */}
      <div className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.60)' }} />

      {/* LIVE badge */}
      <div className="absolute left-4 top-4">
        <motion.div
          animate={{ opacity: [1, 0.5, 1] }}
          transition={{ duration: 1.4, repeat: Infinity }}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white"
          style={{ background: 'var(--color-danger)', boxShadow: '0 2px 12px rgba(239,68,68,0.5)' }}>
          <span className="h-2 w-2 rounded-full bg-[var(--color-bg-surface)]" />LIVE NOW
        </motion.div>
      </div>

      {/* Viewer count */}
      {live.viewerCount > 0 && (
        <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}>
          <Users size={11} />{live.viewerCount.toLocaleString()} watching
        </div>
      )}

      {/* Bottom content */}
      <div className="absolute inset-x-0 bottom-0 p-5">
        {live.course && (
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold"
            style={{ color: 'rgba(255,255,255,0.65)' }}>
            <GraduationCap size={11} />{live.course.title}
          </p>
        )}
        <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          {live.title}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
            <Clock size={11} />{fmtTime(live.scheduledStart)} · {fmtDuration(live.durationMins)}
          </p>
          {live.instructor?.name && (
            <div className="flex items-center gap-1.5">
              <AvatarImg src={live.instructor.avatarUrl}
                className="h-5 w-5 rounded-full object-cover"
                fallback={(
                <div className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style={{ background: 'rgba(0,87,184,0.7)' }}>
                  {live.instructor.name[0]}
                </div>
              )} />
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>{live.instructor.name}</p>
            </div>
          )}
          {isInt ? (
            <Link href={`/live-classes/${live.id}/watch`}
              className="ml-auto flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition-all hover:brightness-110"
              style={{ background: 'var(--color-danger)', boxShadow: '0 4px 14px rgba(239,68,68,0.4)' }}>
              <Radio size={12} />Watch now
            </Link>
          ) : (
            /* External: 'live' begins 15 min early, the Meet link does not.
               Booked students get "Join opens at" until the start second,
               then the button; everyone else gets nothing here. */
            getJoinPhase(live, now) === 'hidden' ? (
              /* Nothing to join for this student (not booked, in-person, or
                 over) — but a LIVE NOW banner with no way to act on it is a
                 dead end, so the landing page is always one tap away. */
              <Link href={`/live-classes/${live.id}/watch`}
                className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold"
                style={{ background: 'rgba(255,255,255,0.14)', color: '#fff', border: '1px solid rgba(255,255,255,0.28)' }}>
                <ExternalLink size={11} />Details
              </Link>
            ) : (
              <JoinMeetButton
                sessionId={live.id} now={now} size="md"
                accent="var(--color-danger)" mutedColor="rgba(255,255,255,0.7)"
                isBooked={live.isBooked} joinOpensAt={live.joinOpensAt} joinClosesAt={live.joinClosesAt}
                type={live.type} isOnline={live.isOnline} status={live.status}
                className="ml-auto" />
            )
          )}
        </div>
      </div>
    </motion.div>
  )
}

/* ── Contact Admin modal (2× attendance cap) ─────────── */
function ContactAdminModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.92 }}
        className="relative max-w-sm w-full rounded-3xl bg-[var(--color-bg-surface)] p-6 text-center"
        style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.15)' }}>
        <button onClick={onClose}
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bg-muted)]"
          style={{ color: 'var(--color-text-muted)' }}>
          <XIcon size={14} />
        </button>
        <div className="flex h-16 w-16 mx-auto mb-4 items-center justify-center rounded-3xl"
          style={{ background: 'rgba(0,87,184,0.08)', border: '1px solid rgba(0,87,184,0.20)' }}>
          <Phone size={26} style={{ color: 'var(--color-primary)' }} />
        </div>
        <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          Maximum Sessions Reached
        </h3>
        <p className="text-sm mb-5" style={{ color: 'var(--color-text-muted)' }}>
          You've attended this class twice. To attend additional sessions, please contact the admin team.
        </p>
        <button onClick={onClose}
          className="w-full rounded-2xl px-4 py-2.5 text-sm font-semibold text-white"
          style={{ background: 'var(--color-primary)' }}>
          Got it
        </button>
      </motion.div>
    </div>
  )
}


/* ── Immersive session card ──────────────────────────── */
function SessionCard({ live, index, now }: { live: LiveClass; now: number; index: number }) {
  const thumb    = live.thumbnailUrl ?? live.course?.thumbnailUrl
  const gradient = GRADIENTS[index % GRADIENTS.length]!
  const liveNow  = isLive(live)
  const upcoming = isUpcoming(live)
  const ended    = isEnded(live)
  const rec      = hasRecording(live)
  const isInt    = live.type === 'internal'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, type: 'spring', stiffness: 280, damping: 26 }}
      className="overflow-hidden rounded-2xl bg-[var(--color-bg-surface)]"
      style={{ border: '1px solid var(--color-border)', boxShadow: liveNow ? '0 0 0 2px rgba(239,68,68,0.25)' : 'none' }}>

      {/* Thumbnail strip */}
      <div className="relative overflow-hidden" style={{ height: 120 }}>
        {thumb ? (
          <img src={thumb} alt={live.course?.title ?? live.title}
            className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full" style={{ background: gradient }} />
        )}
        {/* Overlay */}
        <div className="absolute inset-0"
          style={{ background: 'rgba(0,0,0,0.40)' }} />

        {/* Status badge */}
        <div className="absolute left-3 top-3">
          {liveNow && (
            <motion.span
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-white"
              style={{ background: 'var(--color-danger)' }}>
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-bg-surface)]" />LIVE
            </motion.span>
          )}
          {upcoming && (
            <span className="rounded-lg px-2 py-1 text-[10px] font-bold text-white"
              style={{ background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(6px)' }}>
              {fmtDate(live.scheduledStart)}
            </span>
          )}
          {ended && rec && (
            <span className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold"
              style={{ background: 'rgba(34,197,94,0.90)', color: 'white' }}>
              <BookOpen size={9} />REC
            </span>
          )}
        </div>

        {/* Duration chip */}
        <div className="absolute bottom-2 right-3 rounded-lg px-2 py-0.5 text-[10px] font-bold text-white"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
          {fmtDuration(live.durationMins)}
        </div>
      </div>

      {/* Body */}
      <div className="p-3.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{
              background: isInt ? 'rgba(0,87,184,0.09)' : 'rgba(99,102,241,0.09)',
              color:      isInt ? '#0057b8' : '#6366F1',
            }}>
            {isInt ? 'In-App' : 'External'}
          </span>
          {liveNow && live.viewerCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: 'var(--color-danger)' }}>
              <Users size={9} />{live.viewerCount.toLocaleString()}
            </span>
          )}
        </div>

        <h3 className="line-clamp-2 text-sm font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
          {live.title}
        </h3>

        {live.course && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            <GraduationCap size={9} />{live.course.title}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            <Clock size={9} />{fmtTime(live.scheduledStart)}
            {upcoming && (
              <span className="ml-1 font-semibold" style={{ color: 'var(--color-primary)' }}>
                {fmtCountdown(live.scheduledStart, now)}
              </span>
            )}
          </p>

          {/* CTA — locked for non-enrolled users */}
          {live.isEnrolled === false ? (
            /* Not purchased — show lock + link to course */
            live.course?.slug ? (
              <Link href={`/courses/${live.course.slug}`}>
                <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[10px] font-bold"
                  style={{ background: 'rgba(99,102,241,0.09)', color: '#6366F1', border: '1px solid rgba(99,102,241,0.20)' }}>
                  <XIcon size={9} />Enroll
                </motion.button>
              </Link>
            ) : null
          ) : (
            <>
              {/* Internal — watch / recording */}
              {isInt && liveNow && (
                <Link href={`/live-classes/${live.id}/watch`}>
                  <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                    className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[10px] font-bold text-white"
                    style={{ background: 'var(--color-danger)' }}>
                    <Radio size={9} />Watch
                  </motion.button>
                </Link>
              )}
              {isInt && upcoming && (
                <Link href={`/live-classes/${live.id}/watch`}>
                  <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                    className="rounded-xl px-3 py-1.5 text-[10px] font-bold"
                    style={{ background: 'rgba(0,87,184,0.09)', color: 'var(--color-primary)', border: '1px solid rgba(0,87,184,0.20)' }}>
                    Details
                  </motion.button>
                </Link>
              )}
              {isInt && rec && (
                <Link href={`/live-classes/${live.id}/watch`}>
                  <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                    className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[10px] font-bold"
                    style={{ background: 'rgba(34,197,94,0.10)', color: 'var(--color-success)', border: '1px solid rgba(34,197,94,0.22)' }}>
                    <BookOpen size={9} />Watch
                  </motion.button>
                </Link>
              )}
              {/* External — the Meet button while a booked student's window is
                  open (fetched on the click, never held here); otherwise the
                  watch page, which shows the window and the booking state. */}
              {!isInt && (liveNow || upcoming) && (
                getJoinPhase(live, now) === 'open' ? (
                  <JoinMeetButton
                    sessionId={live.id} now={now} size="xs" showLines={false} accent="#EF4444"
                    isBooked={live.isBooked} joinOpensAt={live.joinOpensAt} joinClosesAt={live.joinClosesAt}
                    type={live.type} isOnline={live.isOnline} status={live.status} />
                ) : (
                  <Link href={`/live-classes/${live.id}/watch`}>
                    <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                      className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[10px] font-bold"
                      style={{ background: 'rgba(99,102,241,0.09)', color: '#6366F1', border: '1px solid rgba(99,102,241,0.20)' }}>
                      <ExternalLink size={9} />Details
                    </motion.button>
                  </Link>
                )
              )}
              {/* External ended — watch Google Drive recording in new tab */}
              {!isInt && rec && (
                <a href={live.recordingUrl!} target="_blank" rel="noopener noreferrer">
                  <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                    className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[10px] font-bold"
                    style={{ background: 'rgba(34,197,94,0.10)', color: 'var(--color-success)', border: '1px solid rgba(34,197,94,0.22)' }}>
                    <BookOpen size={9} />Watch
                  </motion.button>
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/* ── Page ─────────────────────────────────────────────── */
export default function LiveClassesPage() {
  const { data, isLoading, isError } = useUpcomingLiveClasses(50)
  /* Server-anchored clock: 1 s tick only while a booked Meet class is within
     two minutes of its join window opening/closing, 30 s otherwise. Drives
     both the countdown labels and the Join buttons. */
  const now = useJoinClock(data)
  const [filter,          setFilter]       = useState<FilterKey>('all')
  const [typeFilter,      setTypeFilter]   = useState<'all' | 'internal' | 'external'>('all')
  const [languageFilter,  setLanguageFilter] = useState('')
  const [search,          setSearch]       = useState('')
  const [selectedDate,    setSelectedDate] = useState<string | null>(null)
  const [showContactAdmin, setShowContactAdmin] = useState(false)

  const all = useMemo(() => (data ?? []).filter(l => l.status !== 'cancelled'), [data])

  const liveNow    = useMemo(() => all.filter(l => isLive(l)),   [all])
  const upcoming   = useMemo(() => all.filter(l => isUpcoming(l)), [all])
  const recordings = useMemo(() => all.filter(l => hasRecording(l)), [all])

  /* Apply filter + optional date + type + search */
  const filtered = useMemo(() => {
    let list: LiveClass[]
    switch (filter) {
      case 'live':       list = liveNow;    break
      case 'upcoming':   list = upcoming;   break
      case 'recordings': list = recordings; break
      default:           list = [...liveNow, ...upcoming, ...recordings]
    }
    if (selectedDate) {
      list = list.filter(l => new Date(l.scheduledStart).toDateString() === selectedDate)
    }
    if (typeFilter !== 'all') {
      list = list.filter(l => l.type === typeFilter)
    }
    if (languageFilter) list = list.filter(l => (l as any).language === languageFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.course?.title?.toLowerCase().includes(q),
      )
    }
    return list.sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
  }, [filter, liveNow, upcoming, recordings, selectedDate, typeFilter, languageFilter, search])

  const filterCounts: Record<FilterKey, number> = {
    all:        liveNow.length + upcoming.length + recordings.length,
    live:       liveNow.length,
    upcoming:   upcoming.length,
    recordings: recordings.length,
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Live Classes
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {upcoming.length > 0
              ? `${upcoming.length} upcoming · ${liveNow.length > 0 ? `${liveNow.length} live now` : 'none live'}`
              : 'Your enrolled sessions'}
            {' · times in your local time'}
          </p>
        </div>

        {liveNow.length > 0 && (
          <motion.div
            animate={{ opacity: [1, 0.55, 1] }}
            transition={{ duration: 1.6, repeat: Infinity }}
            className="flex items-center gap-2 rounded-2xl px-4 py-2"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--color-danger)' }} />
            <span className="text-sm font-bold" style={{ color: 'var(--color-danger)' }}>{liveNow.length} live now</span>
          </motion.div>
        )}
      </motion.div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-20 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          <Spinner size={16} />Loading your schedule…
        </div>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-16">
          <AlertCircle size={28} style={{ color: 'var(--color-danger)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Couldn't load live classes</p>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* Live Now hero strip */}
          <AnimatePresence>
            {liveNow.length > 0 && (
              <motion.div key="hero"
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                className="mb-6 space-y-3">
                {liveNow.map((l, i) => <LiveHeroCard key={l.id} live={l} index={i} now={now} />)}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-col gap-5 md:flex-row md:items-start">
            {/* ── Left: filters + cards ── */}
            <div className="flex-1 min-w-0">
              {/* Filter tabs */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {FILTERS.map(f => (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
                    style={filter === f.key
                      ? { background: 'var(--color-text-primary)', color: 'var(--color-text-inverse)' }
                      : { background: 'var(--color-bg-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                    {f.label}
                    {filterCounts[f.key] > 0 && (
                      <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold"
                        style={filter === f.key
                          ? { background: 'rgba(255,255,255,0.15)', color: '#fff' }
                          : { background: 'rgba(0,0,0,0.07)', color: 'var(--color-text-secondary)' }}>
                        {filterCounts[f.key]}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Search + type row */}
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                {/* Search */}
                <div className="relative w-full sm:flex-1 sm:min-w-[180px]">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search sessions…"
                    className="w-full rounded-xl py-2 pl-9 pr-8 text-sm outline-none transition-all"
                    style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                    onFocus={e => { e.currentTarget.style.border = '1px solid #0057b8'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.10)' }}
                    onBlur={e => { e.currentTarget.style.border = '1px solid var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
                  />
                  {search && (
                    <button onClick={() => setSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
                      style={{ color: 'var(--color-text-muted)' }}>
                      <XIcon size={12} />
                    </button>
                  )}
                </div>
                {/* Type toggle */}
                <div className="flex gap-1">
                  {([['all', 'All Types'], ['internal', 'In-App'], ['external', 'External']] as const).map(([val, label]) => (
                    <button key={val} onClick={() => setTypeFilter(val)}
                      className="rounded-xl px-3 py-2 text-xs font-semibold transition-all"
                      style={typeFilter === val
                        ? { background: 'var(--color-text-primary)', color: 'var(--color-text-inverse)' }
                        : { background: 'var(--color-bg-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Language filter */}
                <select
                  value={languageFilter}
                  onChange={e => setLanguageFilter(e.target.value)}
                  className="rounded-xl px-3 py-2 text-xs font-semibold outline-none transition-all"
                  style={{
                    background: languageFilter ? 'var(--color-text-primary)' : '#fff',
                    color: languageFilter ? '#fff' : 'var(--color-text-muted)',
                    border: languageFilter ? '1px solid var(--color-text-primary)' : '1px solid var(--color-border)',
                  }}>
                  <option value="">All Languages</option>
                  {/* From lib/languages. This filter offered Tamil while the
                      API rejected it and omitted Arabic and Urdu, which
                      classes are taught in - so it both promised what did not
                      exist and hid what did. */}
                  {CLASS_LANGUAGES.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              {/* Cards grid */}
              <AnimatePresence mode="wait">
                {filtered.length === 0 ? (
                  <motion.div key="empty"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-4 rounded-2xl py-16 text-center"
                    style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
                    <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
                      style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)' }}>
                      <Calendar size={24} style={{ color: '#6366F1' }} />
                    </div>
                    <div>
                      <p className="font-bold" style={{ color: 'var(--color-text-primary)' }}>No sessions found</p>
                      <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                        {selectedDate ? 'No sessions on this day' : 'Enroll in courses to see live classes here.'}
                      </p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="grid"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((l, i) => (
                      <SessionCard key={l.id} live={l} index={i} now={now} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Right: mini calendar ── */}
            <div className="w-full md:w-64 md:flex-shrink-0">
              <MiniCalendar
                classes={all}
                selectedDate={selectedDate}
                onSelect={setSelectedDate}
              />

              {/* Upcoming next 3 */}
              {upcoming.slice(0, 3).length > 0 && (
                <div className="mt-4 rounded-2xl p-4"
                  style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                    Next up
                  </p>
                  <div className="space-y-2.5">
                    {upcoming.slice(0, 3).map(l => (
                      <div key={l.id} className="flex items-start gap-2.5">
                        <div
                          className="mt-0.5 h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg"
                          style={{
                            background: l.thumbnailUrl ?? l.course?.thumbnailUrl
                              ? undefined
                              : GRADIENTS[0],
                          }}>
                          {(l.thumbnailUrl ?? l.course?.thumbnailUrl) && (
                            <img
                              src={l.thumbnailUrl ?? l.course?.thumbnailUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>{l.title}</p>
                          <p className="text-[10px]" style={{ color: 'var(--color-primary)' }}>
                            {fmtDate(l.scheduledStart)} · {fmtTime(l.scheduledStart)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Contact Admin modal */}
      <AnimatePresence>
        {showContactAdmin && (
          <ContactAdminModal onClose={() => setShowContactAdmin(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
