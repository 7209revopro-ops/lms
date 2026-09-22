'use client'

import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Video, Radio, Calendar, Clock, Users,
  AlertCircle, Tv2, ExternalLink, BookOpen, Star,
  ChevronRight, PlayCircle, CalendarDays, Pencil, Search, X, Plus,
  LayoutList, CalendarRange, ChevronLeft, GraduationCap,
  UserCheck, LayoutGrid, Building2, MapPin, UserPlus,
  ChevronDown, User, Globe,
} from 'lucide-react'
import { useAllLiveClasses, useCreateLiveClass, useMyMeetings, type LiveClass, type LiveClassType, type MentorMeeting } from '@/lib/api/liveClasses'
import { CLASS_LANGUAGES, withFlagAndNative } from '@/lib/languages'
import { datetimeLocalToISO, zoneOf, foreignZoneTag } from '@/lib/timezone'
import { useCourses } from '@/lib/api/courses'
import { useCourseOutline } from '@/lib/api/outline'
import { GuestCohortsField, cohortsProblem } from '@/components/live-classes/GuestCohortsField'
import type { GuestCohortInput } from '@/lib/api/liveClasses'
import { useOrgStore } from '@/store/org.store'
import { useUsers } from '@/lib/api/users'
import { useCurrentUser } from '@/lib/api/user'
import { EditLiveClassModal } from '@/components/live-classes/EditLiveClassModal'
import {
  useViewerAcademy, useAcademyView, academyViewOf,
  SharedAcademiesChip, GuestReadOnlyNote, seatBarColor, seatBreakdown,
} from '@/components/live-classes/CrossAcademy'
import { CreateOfflineClassModal } from '@/components/live-classes/CreateOfflineClassModal'
import { BookForStudentModal } from '@/components/live-classes/BookForStudentModal'
import { DarkSelect, DarkDateTimePicker, PillToggle } from '@/components/live-classes/FormWidgets'
import { Button, MotionButton } from '@/components/ui/button'
import Spinner from '@/components/ui/Spinner'
import { categoryScopeOf } from '@/lib/programScope'
import { AvatarImg } from '@/components/ui/AvatarImg'
import {
  IN_APP_RGB, MEET_RGB, ROOM_RGB, BROADCAST_RGB,
  LIVEKIT_MAX_SEATS, OPEN_SEATS_DEFAULT,
} from '@/lib/liveClassTheme'



/* ── Instructor dropdown (dark theme) ───────────────────── */
function InstructorDropdown({ value, onChange, instructors }: {
  value: string
  onChange: (v: string) => void
  instructors: { id: string; name: string; avatarUrl?: string }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = !!value
  const selected = instructors.find(i => i.id === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 rounded-xl py-1.5 pl-2.5 pr-7 text-xs font-semibold outline-none cursor-pointer transition-all whitespace-nowrap"
        style={{
          background: active ? 'rgba(0,87,184,0.15)' : '#1e2035',
          border:     active ? '1px solid rgba(0,87,184,0.35)' : '1px solid rgba(255,255,255,0.10)',
          color:      active ? '#60a5fa' : 'rgba(255,255,255,0.65)',
        }}
      >
        {selected ? (
          <>
            <AvatarImg src={selected.avatarUrl}
              className="h-5 w-5 rounded-full object-cover flex-shrink-0 ring-1 ring-white/20"
              fallback={<div className="h-5 w-5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-white" style={{ background: '#0057b8' }}>
                  {selected.name[0]?.toUpperCase()}
                </div>} />
            <span className="max-w-[110px] truncate">{selected.name}</span>
          </>
        ) : (
          <span>All Instructors</span>
        )}
        <ChevronDown size={11} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-50" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full z-50 mt-1.5 min-w-[180px] overflow-hidden rounded-xl py-1"
            style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}
          >
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false) }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/[0.08]"
              style={{ color: !value ? '#60a5fa' : 'rgba(255,255,255,0.7)' }}
            >
              <div className="h-6 w-6 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <User size={11} style={{ color: 'rgba(255,255,255,0.4)' }} />
              </div>
              All Instructors
            </button>
            {instructors.map(i => (
              <button
                key={i.id}
                type="button"
                onClick={() => { onChange(i.id); setOpen(false) }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/[0.08]"
                style={{ color: value === i.id ? '#60a5fa' : 'rgba(255,255,255,0.7)' }}
              >
                <AvatarImg src={i.avatarUrl}
                  className="h-6 w-6 rounded-full object-cover flex-shrink-0 ring-1 ring-white/15"
                  fallback={<div className="h-6 w-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white" style={{ background: '#0057b8' }}>
                      {i.name[0]?.toUpperCase()}
                    </div>} />
                <span className="truncate">{i.name}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Course dropdown (dark theme) ───────────────────── */
function CourseDropdown({ value, onChange, courses }: {
  value: string
  onChange: (v: string) => void
  courses: { id: string; title: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const active = !!value
  const selected = courses.find(c => c.id === value)
  const filtered = query.trim()
    ? courses.filter(c => c.title.toLowerCase().includes(query.trim().toLowerCase()))
    : courses

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 rounded-xl py-1.5 pl-2.5 pr-7 text-xs font-semibold outline-none cursor-pointer transition-all whitespace-nowrap"
        style={{
          background: active ? 'rgba(0,87,184,0.15)' : '#1e2035',
          border:     active ? '1px solid rgba(0,87,184,0.35)' : '1px solid rgba(255,255,255,0.10)',
          color:      active ? '#60a5fa' : 'rgba(255,255,255,0.65)',
        }}
      >
        <BookOpen size={11} className="flex-shrink-0" style={{ opacity: 0.6 }} />
        <span className="max-w-[130px] truncate">
          {selected ? selected.title : 'All courses'}
        </span>
        <ChevronDown size={11} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-50" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl"
            style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 48px rgba(0,0,0,0.6)' }}
          >
            {/* Search — shown when there are more than 5 courses */}
            {courses.length > 5 && (
              <div className="p-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="relative">
                  <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(255,255,255,0.3)' }} />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search courses…"
                    className="w-full rounded-lg py-1.5 pl-7 pr-3 text-xs text-white outline-none placeholder:text-white/25"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
              </div>
            )}
            <div className="max-h-52 overflow-y-auto py-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
              {/* All courses option */}
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); setQuery('') }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/[0.06]"
                style={{ color: !value ? '#60a5fa' : 'rgba(255,255,255,0.7)' }}
              >
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <BookOpen size={10} style={{ color: 'rgba(255,255,255,0.4)' }} />
                </div>
                All courses
                {!value && <span className="ml-auto text-[10px]" style={{ color: '#60a5fa' }}>✓</span>}
              </button>
              {filtered.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onChange(c.id); setOpen(false); setQuery('') }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/[0.06]"
                  style={{ color: value === c.id ? '#60a5fa' : 'rgba(255,255,255,0.65)' }}
                >
                  <div
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
                    style={{ background: value === c.id ? '#0057b8' : 'rgba(255,255,255,0.07)' }}
                  >
                    {c.title.charAt(0).toUpperCase()}
                  </div>
                  <span className="flex-1 truncate text-left">{c.title}</span>
                  {value === c.id && <span className="ml-auto flex-shrink-0 text-[10px]" style={{ color: '#60a5fa' }}>✓</span>}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-4 text-center text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>No courses found</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Language dropdown (dark theme) ───────────────────
   Shared with course creation via lib/languages so the two can never drift. */
const LANG_OPTIONS = CLASS_LANGUAGES

function LanguageDropdown({ value, onChange }: {
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = !!value
  const selected = LANG_OPTIONS.find(l => l.value === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 rounded-xl py-1.5 pl-2.5 pr-7 text-xs font-semibold outline-none cursor-pointer transition-all whitespace-nowrap"
        style={{
          background: active ? 'rgba(0,87,184,0.15)' : '#1e2035',
          border:     active ? '1px solid rgba(0,87,184,0.35)' : '1px solid rgba(255,255,255,0.10)',
          color:      active ? '#60a5fa' : 'rgba(255,255,255,0.65)',
        }}
      >
        {selected
          ? <span className="text-sm leading-none">{selected.flag}</span>
          : <Globe size={11} className="flex-shrink-0 opacity-60" />
        }
        <span>{selected ? selected.label : 'All Languages'}</span>
        <ChevronDown size={11} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-50" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl py-1"
            style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 48px rgba(0,0,0,0.6)' }}
          >
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false) }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/[0.06]"
              style={{ color: !value ? '#60a5fa' : 'rgba(255,255,255,0.7)' }}
            >
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <Globe size={10} style={{ color: 'rgba(255,255,255,0.4)' }} />
              </div>
              All Languages
              {!value && <span className="ml-auto text-[10px]" style={{ color: '#60a5fa' }}>✓</span>}
            </button>
            {LANG_OPTIONS.map(lang => (
              <button
                key={lang.value}
                type="button"
                onClick={() => { onChange(lang.value); setOpen(false) }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/[0.06]"
                style={{ color: value === lang.value ? '#60a5fa' : 'rgba(255,255,255,0.65)' }}
              >
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-sm" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {lang.flag}
                </div>
                <span>{lang.label}</span>
                {value === lang.value && <span className="ml-auto text-[10px]" style={{ color: '#60a5fa' }}>✓</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Helpers ─────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────
   A CLASS IS SHOWN IN ITS OWN ACADEMY'S CLOCK.

   Everything else on this screen stays in the viewer's zone, deliberately.
   Only the rendered TIME of a class moves, never the day-grouping keys: the
   calendar cells, the day dividers and the month headings all stay in one zone
   so the grid remains one grid. Bucket per class instead and a Bangalore class
   at 01:00 IST files under the 19th while the Dubai class thirty minutes later
   files under the 18th, and the list reads backwards with nothing on screen to
   explain it.

   The tz argument is always zoneOf(...), never orgTimeZone(...): an unresolved
   academy must fall back to the viewer's zone, not to Dubai.
───────────────────────────────────────────────────────── */
function fmtDate(iso: string, tz?: string): string {
  const d = new Date(iso)
  const today    = new Date()
  const tomorrow = new Date(Date.now() + 86_400_000)
  if (d.toDateString() === today.toDateString())    return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(tz ? { timeZone: tz } : {}) })
}

function fmtTime(iso: string, tz?: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) })
}

function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function fmtCountdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'now'
  const s = Math.floor(diff / 1000)
  if (s < 3600) return `in ${Math.floor(s / 60)}m`
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`
  return `in ${Math.floor(s / 86400)}d`
}

const FILTERS = [
  { key: 'all',       label: 'All' },
  { key: 'live',      label: 'Live Now' },
  { key: 'scheduled', label: 'Upcoming' },
  { key: 'ended',     label: 'Ended' },
  { key: 'cancelled', label: 'Cancelled' },
] as const

type FilterKey = typeof FILTERS[number]['key']

/* ── Stats bar ───────────────────────────────────────── */
function StatsBar({ items }: { items: LiveClass[] }) {
  const liveNow   = items.filter(l => l.status === 'live').length
  const today     = items.filter(l => {
    const d = new Date(l.scheduledStart)
    return d.toDateString() === new Date().toDateString() && l.status === 'scheduled'
  }).length
  const totalViewers = items
    .filter(l => l.status === 'live')
    .reduce((s, l) => s + (l.viewerCount ?? 0), 0)

  const stats = [
    {
      label: 'Live now',
      value: liveNow,
      color: '#EF4444',
      bg:    'rgba(239,68,68,0.08)',
      border:'rgba(239,68,68,0.18)',
      pulse: liveNow > 0,
    },
    {
      label: 'Scheduled today',
      value: today,
      color: '#0057b8',
      bg:    'rgba(0,87,184,0.08)',
      border:'rgba(0,87,184,0.18)',
      pulse: false,
    },
    {
      label: 'Watching now',
      value: totalViewers,
      color: '#818CF8',
      bg:    'rgba(99,102,241,0.08)',
      border:'rgba(99,102,241,0.18)',
      pulse: false,
    },
    {
      label: 'Total sessions',
      value: items.length,
      color: 'rgba(255,255,255,0.6)',
      bg:    'rgba(255,255,255,0.04)',
      border:'rgba(255,255,255,0.08)',
      pulse: false,
    },
  ]

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map(s => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4"
          style={{ background: s.bg, border: `1px solid ${s.border}` }}>
          <div className="flex items-center gap-2">
            {s.pulse && (
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.4, repeat: Infinity }}
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ background: s.color }}
              />
            )}
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
          <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{s.label}</p>
        </motion.div>
      ))}
    </div>
  )
}

/* ── Table row ───────────────────────────────────────── */
function TableRow({ live, index, showInstructor }: { live: LiveClass; index: number; showInstructor: boolean }) {
  const router      = useRouter()
  const isLiveNow   = live.status === 'live'
  const isScheduled = live.status === 'scheduled'
  const isEnded     = live.status === 'ended'
  const isCancelled = live.status === 'cancelled'
  const isInternal   = live.type === 'internal'
  const isOffline    = (live as any).isOnline === false
  const canAdminBook = isOffline && live.status === 'scheduled' && new Date(live.scheduledStart) > new Date()

  /* Join button: external online class, 15 min before start → end */
  const now = Date.now()
  const startMs = new Date(live.scheduledStart).getTime()
  const endMs   = startMs + live.durationMins * 60 * 1000
  const meetUrl = (live as any).meetingUrl as string | undefined
  const canJoin = !isInternal && !isOffline && !!meetUrl &&
    (isLiveNow || isScheduled) &&
    (startMs - now) <= 15 * 60 * 1000 &&   // within 15 min window or already started
    now < endMs                              // not past end time
  const [editOpen, setEditOpen] = useState(false)
  const [bookOpen, setBookOpen] = useState(false)

  /* Whose room is this, and how much of it is actually THIS viewer's? A host
     with an exhausted floor and a guest academy reading the host's counter
     were both shown the same half-full green bar. */
  const { isHost, mine, hostLabel } = useAcademyView(live)

  const fillPct = live.sessionCapacity > 0 ? Math.min(100, (live.bookedCount / live.sessionCapacity) * 100) : 0
  const barColor = seatBarColor(fillPct, mine)

  const sectionTitle = typeof live.sectionId === 'object' ? live.sectionId?.title : undefined

  return (
    <>
      <tr
        className="transition-colors hover:bg-white/[0.03]"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>

        {/* Session */}
        <td className="px-4 py-3">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Status badge */}
              {isLiveNow && (
                <motion.span
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white"
                  style={{ background: '#EF4444' }}>
                  <span className="h-1 w-1 rounded-full bg-white" />LIVE
                </motion.span>
              )}
              {isEnded && (
                <span className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }}>
                  Ended
                </span>
              )}
              {isCancelled && (
                <span className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)' }}>
                  Cancelled
                </span>
              )}
              {isScheduled && (
                <span className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{ background: 'rgba(0,87,184,0.12)', color: '#0057b8' }}>
                  {fmtCountdown(live.scheduledStart)}
                </span>
              )}
              {/* Type / delivery badge */}
              {(live as any).isOnline === false ? (
                <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{ background: 'rgba(52,211,153,0.12)', color: '#34D399' }}>
                  <Building2 size={8} />Offline
                </span>
              ) : (
                <span className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{
                    background: isInternal ? 'rgba(0,87,184,0.10)' : 'rgba(99,102,241,0.10)',
                    color:      isInternal ? '#0057b8' : '#818CF8',
                  }}>
                  {isInternal ? 'In-App' : 'External'}
                </span>
              )}
              <SharedAcademiesChip live={live} />
            </div>
            <span className={`text-sm font-semibold text-white leading-tight max-w-[220px] truncate ${isCancelled ? 'line-through opacity-40' : ''}`}>
              {live.title}
            </span>
          </div>
        </td>

        {/* Course */}
        <td className="px-4 py-3 text-sm">
          {live.course
            ? <span className="flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                <BookOpen size={12} className="flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
                <span className="max-w-[160px] truncate">{live.course.title}</span>
              </span>
            : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
          }
        </td>

        {/* Module */}
        <td className="px-4 py-3 text-sm">
          {sectionTitle
            ? <span className="text-[11px] font-semibold" style={{ color: '#0057b8' }}>{sectionTitle}</span>
            : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
          }
        </td>

        {/* Instructor — conditional */}
        {showInstructor && (
          <td className="px-4 py-3 text-sm">
            <span className="flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
              <GraduationCap size={12} className="flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
              <span className="max-w-[120px] truncate">{live.instructor?.name ?? '—'}</span>
            </span>
          </td>
        )}

        {/* Date & Time */}
        <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.55)' }}>
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1">
              <Calendar size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
              {fmtDate(live.scheduledStart, zoneOf(live.organizationSlug))}
            </span>
            <span className="flex items-center gap-1 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              <Clock size={10} />
              {fmtTime(live.scheduledStart, zoneOf(live.organizationSlug))}{foreignZoneTag(live.organizationSlug) && <span style={{ color: '#FBBF24' }}> {foreignZoneTag(live.organizationSlug)}</span>} · {fmtDuration(live.durationMins)}
            </span>
          </div>
        </td>

        {/* Seats */}
        <td className="px-4 py-3 text-sm">
          {/* On a shared class the room total answers a question nobody is
              asking. What the admin needs first is how many seats THEIR OWN
              students can still take; the room stays, demoted. */}
          <div className="flex flex-col gap-1 min-w-[80px]" title={seatBreakdown(live)}>
            {mine !== null ? (
              <>
                <span className="text-xs font-semibold" style={{ color: mine <= 0 ? '#F87171' : 'rgba(255,255,255,0.75)' }}>
                  {mine} left for you
                </span>
                <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {live.bookedCount} / {live.sessionCapacity} in the room
                </span>
              </>
            ) : (
              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {live.bookedCount} / {live.sessionCapacity}
              </span>
            )}
            <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${fillPct}%`, background: barColor }}
              />
            </div>
          </div>
        </td>

        {/* Actions */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            {/* Attendance */}
            <Link
              href={`/live-classes/${live.id}/attendance`}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.4)' }}
              title="Attendance">
              <UserCheck size={13} />
            </Link>

            {/* Join Google Meet — external online, 15 min before → end */}
            {canJoin && (
              <a
                href={meetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg,#22C55E,#16A34A)', color: '#fff', textDecoration: 'none' }}
                title="Join Google Meet">
                <ExternalLink size={10} />
                Join
              </a>
            )}

            {/* OWNER ONLY, below. Managing a class stays with the academy that
                owns it — only seats are shared — so monitor, edit and
                book-for-student all funnel through callerMayManageSession and
                answer 404 across the wall. Offering them to a guest academy's
                admin promised something the server will always refuse. */}

            {/* Monitor / Go Live — internal + live or scheduled only */}
            {isHost && isInternal && (isLiveNow || isScheduled) && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => router.push(`/live-classes/${live.id}/monitor`)}
                className="h-7 w-7 rounded-lg"
                style={{ color: isLiveNow ? '#EF4444' : '#0057b8' }}
                title={isLiveNow ? 'Monitor' : 'Go Live'}>
                {isLiveNow ? <Radio size={13} /> : <PlayCircle size={13} />}
              </Button>
            )}

            {/* Edit */}
            {isHost && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setEditOpen(true)}
                className="h-7 w-7 rounded-lg"
                style={{ color: 'rgba(255,255,255,0.4)' }}
                title="Edit session">
                <Pencil size={12} />
              </Button>
            )}

            {!isHost && <GuestReadOnlyNote hostLabel={hostLabel} />}

            {/* Book for Student — offline scheduled classes only */}
            {isHost && canAdminBook && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setBookOpen(true)}
                className="h-7 w-7 rounded-lg"
                style={{ color: '#34D399' }}
                title="Book seat for student">
                <UserPlus size={13} />
              </Button>
            )}

            {/* Course link */}
            {live.course && (
              <Link
                href={`/courses/${typeof live.course === 'object' ? live.course.id : live.courseId}/edit`}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                style={{ color: 'rgba(255,255,255,0.25)' }}
                title="Open course">
                <ChevronRight size={13} />
              </Link>
            )}
          </div>

          <AnimatePresence>
            {editOpen && (
              <EditLiveClassModal
                live={live}
                onClose={() => setEditOpen(false)}
                onSuccess={() => setEditOpen(false)}
              />
            )}
            {bookOpen && (
              <BookForStudentModal
                live={live}
                onClose={() => setBookOpen(false)}
                onSuccess={() => setBookOpen(false)}
              />
            )}
          </AnimatePresence>
        </td>
      </tr>
    </>
  )
}

/* ── Calendar view ───────────────────────────────────── */
function CalendarView({ items, meetings = [], onSlotClick }: {
  items: LiveClass[]
  /* Booked from the Root portal and not classes: nobody enrols and no cohort is
     told. Carried separately rather than folded into `items` because they are
     genuinely a different thing — pretending otherwise would mean inventing
     LiveClass fields nothing would fill honestly. */
  meetings?: MentorMeeting[]
  onSlotClick: (date: Date) => void
}) {
  const todayRef = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  const [monthDate, setMonthDate] = useState<Date>(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d
  })
  const [editLive, setEditLive] = useState<LiveClass | null>(null)
  /* Resolved ONCE for the whole grid rather than per chip — the hook reads the
     viewer's academy, and a month can hold a hundred chips. */
  const calendarViewer = useViewerAcademy()
  /* The day whose full session list is open. A month cell can only show a few
     chips before it stops being a calendar, so everything past the cap lives
     here rather than being unreachable — which is what "+N more" used to be:
     plain text, no handler, no way in. */
  const [dayPanel, setDayPanel] = useState<Date | null>(null)

  const year  = monthDate.getFullYear()
  const month = monthDate.getMonth()

  /* Sunday-anchored grid start (matches reference design) */
  const gridStart = useMemo(() => {
    const first = new Date(year, month, 1)
    const dow   = first.getDay() // 0 = Sun
    const d     = new Date(first)
    d.setDate(first.getDate() - dow)
    return d
  }, [year, month])

  /* Always 42 cells = 6 rows × 7 cols so layout never shifts */
  const calDays = useMemo(() =>
    Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d
    })
  , [gridStart])

  /* Split into weeks for row-based rendering */
  const weeks = useMemo(() =>
    Array.from({ length: 6 }, (_, wi) => calDays.slice(wi * 7, wi * 7 + 7))
  , [calDays])

  const prevMonth = () => { const d = new Date(monthDate); d.setMonth(month - 1); setMonthDate(d) }
  const nextMonth = () => { const d = new Date(monthDate); d.setMonth(month + 1); setMonthDate(d) }
  const goToday   = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setMonthDate(d) }

  /* Built from the same `year`/`month` integers the grid is, NOT by formatting
     a Date. toLocaleDateString renders in the timezone Intl resolves, while
     getMonth() — which gridStart and every cell come from — renders in the
     runtime's local zone. When those two disagree the label and the grid
     disagree with them: a browser resolving Asia/Dubai (+04:00) while Date
     runs in IST (+05:30) turns local midnight on Aug 1 into Jul 31 22:30, so
     the header read "July 2026" above a grid of August. Deriving the label
     from the integers removes the timezone from the question entirely. */
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  const monthLabel = `${MONTH_NAMES[month]} ${year}`
  const DAY_ABBRS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MAX_CHIPS  = 3

  /* Sorted by start time. Without this the three chips a cell shows were
     whichever three happened to come first out of the API — so the 9am class
     could be hidden behind the 6pm one, and "+2 more" gave no clue what was
     missing. */
  const getSessionsForDay = (day: Date) =>
    items
      .filter(l => new Date(l.scheduledStart).toDateString() === day.toDateString())
      .sort((a, b) => +new Date(a.scheduledStart) - +new Date(b.scheduledStart))

  const getMeetingsForDay = (day: Date) =>
    meetings
      .filter(m => new Date(m.startsAt).toDateString() === day.toDateString())
      .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))

  const chipColor = (live: LiveClass) => {
    const isOffline = (live as any).isOnline === false
    if (live.status === 'live')      return { bg: 'rgba(239,68,68,0.18)',   color: '#EF4444',                border: 'rgba(239,68,68,0.30)' }
    if (live.status === 'scheduled') {
      if (isOffline) return { bg: 'rgba(16,185,129,0.15)', color: '#10B981', border: 'rgba(16,185,129,0.28)' }
      return { bg: 'rgba(0,87,184,0.15)', color: '#0057b8', border: 'rgba(0,87,184,0.28)' }
    }
    if (live.status === 'ended')     return { bg: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)', border: 'rgba(255,255,255,0.08)' }
    /* cancelled */                  return { bg: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.20)', border: 'rgba(255,255,255,0.06)' }
  }

  const BORDER = '1px solid rgba(255,255,255,0.07)'

  return (
    <div>
      {/* Month navigation */}
      <div className="mb-5 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={prevMonth}
          className="h-8 w-8 rounded-xl"
          style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.10)', background: 'transparent' }}>
          <ChevronLeft size={14} />
        </Button>
        <span className="min-w-[150px] text-center text-base font-bold text-white">{monthLabel}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={nextMonth}
          className="h-8 w-8 rounded-xl"
          style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.10)', background: 'transparent' }}>
          <ChevronRight size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={goToday}
          className="rounded-xl px-4 py-1.5 text-xs font-semibold"
          style={{ color: 'rgba(255,255,255,0.50)', border: '1px solid rgba(255,255,255,0.10)', background: 'transparent' }}>
          Today
        </Button>
      </div>

      {/* Calendar table */}
      <div className="overflow-hidden rounded-2xl" style={{ border: BORDER }}>

        {/* Day-of-week header row */}
        <div className="grid grid-cols-7" style={{ background: 'rgba(255,255,255,0.025)', borderBottom: BORDER }}>
          {DAY_ABBRS.map((d, i) => (
            <div
              key={d}
              className="py-3 text-center text-[11px] font-bold uppercase tracking-widest"
              style={{
                color: 'rgba(255,255,255,0.32)',
                borderRight: i < 6 ? BORDER : 'none',
              }}>
              {d}
            </div>
          ))}
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => (
          <div
            key={wi}
            className="grid grid-cols-7"
            style={{ borderBottom: wi < 5 ? BORDER : 'none' }}>
            {week.map((day, di) => {
              const isCurrentMonth = day.getMonth() === month
              const isToday        = day.toDateString() === todayRef.toDateString()
              const sessions       = getSessionsForDay(day)
              const dayMeetings    = getMeetingsForDay(day)
              const overflow       = sessions.length - MAX_CHIPS

              return (
                <div
                  key={di}
                  onClick={() => onSlotClick(day)}
                  className="cursor-pointer transition-colors hover:bg-white/[0.025]"
                  style={{
                    borderRight: di < 6 ? BORDER : 'none',
                    minHeight: 128,
                    background: isToday ? 'rgba(0,87,184,0.05)' : 'transparent',
                  }}>

                  {/* Day number — top-left, orange circle for today.
                      Doubles as a way into the full day list once the day has
                      anything on it, so a busy day is reachable from the
                      obvious place as well as from "+N more". */}
                  <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold leading-none"
                      style={isToday
                        ? { background: '#0057b8', color: '#fff' }
                        : { color: isCurrentMonth ? 'rgba(255,255,255,0.60)' : 'rgba(255,255,255,0.16)' }}>
                      {day.getDate()}
                    </span>
                    {sessions.length > 0 && (
                      <button
                        type="button"
                        title={`View all ${sessions.length} ${sessions.length === 1 ? 'class' : 'classes'}`}
                        onClick={e => { e.stopPropagation(); setDayPanel(day) }}
                        className="rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none transition-colors hover:bg-white/10"
                        style={{ color: 'rgba(255,255,255,0.35)' }}>
                        {sessions.length}
                      </button>
                    )}
                  </div>

                  {/* Session chips */}
                  <div className="px-1.5 pb-2 space-y-0.5" onClick={e => e.stopPropagation()}>
                    {sessions.slice(0, MAX_CHIPS).map(s => {
                      const c = chipColor(s)
                      return (
                        /* OWNERSHIP DECIDES WHETHER THIS CHIP OPENS.
                           Every chip opened the Edit modal, including a class
                           the OTHER academy hosts — and Edit, Delete and Repeat
                           all answer 404 to a guest academy, so the month view
                           was the one screen that still offered three routes to
                           an error. The list and card views on this same page
                           already gate on isHost. A guest's chip stays visible
                           and readable, because seeing the other academy's
                           session is the point of sharing; it simply does not
                           pretend to be editable. */
                        <Button
                          key={s.id}
                          variant="ghost"
                          size="sm"
                          disabled={!academyViewOf(s, calendarViewer).isHost}
                          onClick={() => setEditLive(s)}
                          title={academyViewOf(s, calendarViewer).isHost
                            ? undefined
                            : `Shared by ${academyViewOf(s, calendarViewer).hostLabel} — only they can change it`}
                          className="w-full text-left rounded-md px-2 py-1 h-auto hover:brightness-125 disabled:cursor-default disabled:opacity-100 disabled:hover:brightness-100"
                          style={{ background: c.bg, border: `1px solid ${c.border}` }}>
                          <p className="truncate text-[10px] font-semibold leading-tight" style={{ color: c.color }}>
                            {fmtTime(s.scheduledStart, zoneOf(s.organizationSlug))} · {s.title}
                          </p>
                        </Button>
                      )
                    })}
                    {/* Meetings booked from the Root portal. Violet, the same
                        colour that calendar uses, so somebody looking at both
                        screens is not asked to learn two vocabularies for one
                        hour. Labelled by who rather than by what: on a month
                        cell "Rahul Menon" says whether it can move and "Intro
                        call" does not. */}
                    {dayMeetings.map(mt => (
                      <div
                        key={mt.id}
                        title={`${mt.title} · with ${mt.attendees.map(a => a.name).join(', ')} · ${mt.durationMins} min · booked by ${mt.bookedByEmail}`}
                        className="w-full rounded-md px-2 py-1"
                        style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.30)' }}>
                        <p className="truncate text-[10px] font-semibold leading-tight" style={{ color: '#A78BFA' }}>
                          {fmtTime(mt.startsAt, undefined)} · {mt.attendees.map(a => a.name).join(', ') || mt.title}
                        </p>
                      </div>
                    ))}

                    {overflow > 0 && (
                      <button
                        type="button"
                        onClick={() => setDayPanel(day)}
                        className="w-full rounded-md px-2 py-1 text-left text-[10px] font-semibold transition-colors hover:bg-white/10"
                        style={{ color: 'rgba(255,255,255,0.45)' }}>
                        +{overflow} more
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <AnimatePresence>
        {dayPanel && (
          <DaySessionsModal
            day={dayPanel}
            sessions={getSessionsForDay(dayPanel)}
            chipColor={chipColor}
            onEdit={s => { setDayPanel(null); setEditLive(s) }}
            onAdd={() => { const d = dayPanel; setDayPanel(null); onSlotClick(d) }}
            onClose={() => setDayPanel(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editLive && (
          <EditLiveClassModal
            live={editLive}
            onClose={() => setEditLive(null)}
            onSuccess={() => setEditLive(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── All sessions on one day ─────────────────────────────
   A month cell can show three chips before it stops looking like a calendar,
   so this is where the rest live: every session for the day, in time order,
   each one editable. That last part is what was missing — "+N more" was plain
   text with no handler, so a seventh class on a day could not be opened at all.

   The list scrolls here rather than inside the cell, because a ~70px scroll
   region within a grid cell is awkward on a trackpad and worse on touch. It
   also has room for the time, instructor and status a chip has to truncate. */
function DaySessionsModal({
  day, sessions, chipColor, onEdit, onAdd, onClose,
}: {
  day:       Date
  sessions:  LiveClass[]
  chipColor: (l: LiveClass) => { bg: string; color: string; border: string }
  onEdit:    (l: LiveClass) => void
  onAdd:     () => void
  onClose:   () => void
}) {
  /* Escape closes, matching the other modals on this screen. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const heading = day.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        onClick={e => e.stopPropagation()}
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl"
        style={{ background: '#0F121C', border: '1px solid rgba(255,255,255,0.10)', maxHeight: '80vh' }}>

        <div className="flex items-start justify-between gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">{heading}</p>
            <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
              {sessions.length} {sessions.length === 1 ? 'class' : 'classes'} scheduled
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}
            className="h-7 w-7 flex-shrink-0 rounded-lg"
            style={{ color: 'rgba(255,255,255,0.45)' }}>
            <X size={15} />
          </Button>
        </div>

        {/* The scroll lives here, so any number of classes stays reachable. */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {sessions.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Nothing scheduled on this day.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {sessions.map(s => {
                const c = chipColor(s)
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onEdit(s)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
                      style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                      <span className="w-14 flex-shrink-0 text-xs font-bold" style={{ color: c.color }}>
                        {fmtTime(s.scheduledStart, zoneOf(s.organizationSlug))}{foreignZoneTag(s.organizationSlug) && <span style={{ color: '#FBBF24' }}> {foreignZoneTag(s.organizationSlug)}</span>}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">{s.title}</span>
                        <span className="mt-0.5 block truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.40)' }}>
                          {s.instructor?.name ?? 'No instructor'}
                          {s.course?.title ? ` · ${s.course.title}` : ''}
                          {` · ${s.durationMins} min`}
                        </span>
                      </span>
                      <span className="flex-shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold capitalize"
                        style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
                        {s.status}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <Button variant="ghost" size="sm" onClick={onAdd}
            className="w-full rounded-xl py-2 text-xs font-bold"
            style={{ background: 'rgba(0,87,184,0.15)', color: '#4d94ff', border: '1px solid rgba(0,87,184,0.30)' }}>
            + Add a class on this day
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ── Quick create modal ──────────────────────────────── */
function QuickCreateModal({ onClose, onSuccess, categoryProgram }: { onClose: () => void; onSuccess: () => void; categoryProgram?: string }) {
  const createMutation = useCreateLiveClass()
  const { data: coursesData,     isLoading: loadingCourses }     = useCourses({ per_page: 200, ...(categoryProgram ? { program: categoryProgram } : {}) })
  const { data: instructorsData, isLoading: loadingInstructors } = useUsers('instructor', { per_page: 200 })
  const courses     = coursesData?.docs     ?? []
  const allInstructors = instructorsData?.docs ?? []

  const [courseId,        setCourseId]        = useState(courses[0]?.id ?? '')
  const [title,           setTitle]           = useState('')
  const [start,           setStart]           = useState('')
  const [durationMins,    setDurationMins]    = useState(60)
  /* Google Meet is the house default, so the form opens on it.

     The seat count has to move with it. Seats are mode-dependent by an order
     of magnitude — an interactive LiveKit room is capped at LIVEKIT_MAX_SEATS
     by the meeting platform, while a Meet class opens at OPEN_SEATS_DEFAULT —
     and seatsFor() only refills the field when a mode is CLICKED. Leaving the
     old default here would open every new Meet session at 30 seats, silently,
     for anyone who never touched the type buttons. */
  const [sessionCapacity, setSessionCapacity] = useState<number | ''>(seatsFor(DEFAULT_TYPE, DEFAULT_PROVIDER))
  const [type,            setType]            = useState<LiveClassType>(DEFAULT_TYPE)
  /* Which in-app engine backs an internal class. Mux is a one-way broadcast
     that scales to hundreds; LiveKit is an interactive room capped at
     LIVEKIT_MAX_SEATS by the meeting platform. */
  const [provider,        setProvider]        = useState<'mux' | 'livekit'>(DEFAULT_PROVIDER)
  const chooseType = (t: LiveClassType) => {
    setType(t); setSessionCapacity(seatsFor(t, provider))
  }
  const chooseProvider = (p: 'mux' | 'livekit') => {
    setProvider(p); setSessionCapacity(seatsFor(type, p))
  }

  /* Only an interactive room is capped; broadcast and Google Meet are not. */
  const overCapacity =
    type === 'internal' && provider === 'livekit'
    && sessionCapacity !== '' && Number(sessionCapacity) > LIVEKIT_MAX_SEATS
  const [sectionId,       setSectionId]       = useState('')
  const [instructorId,    setInstructorId]    = useState('')
  const [language,        setLanguage]        = useState('English')
  const [error,           setError]           = useState<string | null>(null)

  /* Cross-academy sharing. The modal has no `me` of its own — the page's is a
     sibling scope — so it reads the caller here. */
  const { data: me } = useCurrentUser()
  const isSuper = me?.role === 'super_admin'
  const activeOrgId = useOrgStore((st: { activeOrgId: string | null }) => st.activeOrgId)
  const [cohorts,  setCohorts]  = useState<GuestCohortInput[]>([])
  const [overflow, setOverflow] = useState(0)

  const { data: outline } = useCourseOutline(courseId)
  const sections = outline?.sections ?? []

  /* THE HOST ACADEMY is the one the server will stamp on the class, and that
     is the org switcher when it is set — not the chosen course's academy. A
     super admin switched to Bangalore creating a class from a Dubai course
     gets a Bangalore class, so excluding Dubai from the guest list would be
     the wrong exclusion. Falls back to the course's academy when the switcher
     is off ("All Orgs"), which is what the server falls back to as well. */
  const hostOrgId = activeOrgId
    ?? (courses.find(c => c.id === courseId) as { organizationId?: string } | undefined)?.organizationId

  /* ONLY INSTRUCTORS THIS CLASS'S ACADEMY CAN ACTUALLY USE.
     A super admin's instructor list is unscoped — the Users endpoint returns
     both academies' staff when the caller has no academy of their own — while
     the class is stamped with whichever academy the org switcher is pointing
     at. So the dropdown offered every instructor in the organisation and the
     save answered 404 INSTRUCTOR_NOT_FOUND for half of them, naming nothing
     the admin could act on.

     This is #assertInstructorUsable's rule, client-side and in the same order:
     compare academies only when BOTH are known (a legacy account with no
     organizationId stays usable — tenancy rule 3b), and a LENT instructor is
     always usable, because being schedulable by the other academy is the whole
     point of lending them.

     It must sit AFTER hostOrgId is fully resolved, including the fallback to
     the selected course's academy above — that fallback is what makes the
     filter mean anything while the switcher is on "All Orgs", which is the
     persisted default. */
  const instructors = allInstructors.filter(i => {
    if (!hostOrgId || !i.organizationId) return true
    if (String(i.organizationId) === String(hostOrgId)) return true
    return i.sharedAcrossOrgs === true
  })

  const handleCourseChange = (id: string) => { setCourseId(id); setSectionId('') }

  const base   = 'w-full rounded-xl px-3 py-2 text-sm text-white outline-none placeholder:text-white/30'
  const iStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' } as const

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    /* An empty "Add an academy" row reaches zod as organizationId: '' and comes
       back as "String must contain at least 1 character(s)" with the field path
       stripped — a sentence about a string, for a problem about an academy. */
    if (isSuper) {
      const problem = cohortsProblem(cohorts, !!sectionId)
      if (problem) { setError(problem); return }
    }
    try {
      await createMutation.mutateAsync({
        courseId,
        title:           title.trim(),
        scheduledStart:  datetimeLocalToISO(start),
        durationMins,
        sessionCapacity: sessionCapacity !== '' ? sessionCapacity : undefined,
        /* Only meaningful for an in-app class; the API defaults it to 'mux'. */
        ...(type === 'internal' ? { provider } : {}),
        type,
        sectionId:       sectionId || undefined,
        instructorId:    instructorId || undefined,
        language,
        /* Omitted entirely unless there is something to send. The server
           refuses a NON-EMPTY list from anyone who is not a super admin, so
           an empty array would be harmless — but sending nothing keeps an
           ordinary class on the exact request shape it had before. */
        ...(isSuper && cohorts.length
          ? { guestCohorts: cohorts, overflowSeats: overflow }
          : {}),
      })
      onSuccess()
    } catch (err: any) {
      /* details FIRST. validate() always fills `message` with the generic
         'Request validation failed', and ?? only falls through on null — so
         the field-level reason was unreachable and every rejected field read
         as the same unhelpful sentence. */
      const e = err?.response?.data?.error
      setError(e?.details?.[0]?.message ?? e?.message ?? 'Could not create session.')
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl overflow-y-auto"
        style={{ background: '#161829', border: '1px solid rgba(255,255,255,0.10)', maxHeight: '90vh' }}>

        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            New Session
          </h2>
          <button onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Course */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Course</label>
            <DarkSelect
              value={courseId}
              onChange={handleCourseChange}
              options={courses.map(c => ({ value: c.id, label: c.title }))}
              placeholder="Select a course…"
              loading={loadingCourses}
              loadingText="Loading courses…"
            />
          </div>

          {/* Type */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Type</label>
            {/* In-app first: it is what the platform actually runs. Green is
                now its colour — Google Meet moves to amber, because two
                controls in one row must not read as the same signal. */}
            <div className="flex gap-2">
              <PillToggle active={type === 'internal'} onClick={() => chooseType('internal')} rgb={IN_APP_RGB}>
                <Radio size={11} />In-App Stream
              </PillToggle>
              <PillToggle active={type === 'external'} onClick={() => chooseType('external')} rgb={MEET_RGB}>
                <Video size={11} />Google Meet
              </PillToggle>
            </div>
            {type === 'external' && (
              <p className="mt-1.5 flex items-center gap-1 text-[10px]" style={{ color: `rgba(${MEET_RGB},0.7)` }}>
                <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ background: `rgb(${MEET_RGB})` }} />
                Google Meet link will be auto-generated
              </p>
            )}

            {/* Engine picker — only meaningful for an in-app class. Broadcast
                scales to hundreds one-way; an interactive room lets students
                speak but the meeting platform caps it. */}
            {type === 'internal' && (
              <div className="mt-2">
                <div className="flex gap-2">
                  <PillToggle small active={provider === 'livekit'} onClick={() => chooseProvider('livekit')} rgb={ROOM_RGB}>
                    Interactive room
                  </PillToggle>
                  <PillToggle small active={provider === 'mux'} onClick={() => chooseProvider('mux')} rgb={BROADCAST_RGB}>
                    Broadcast
                  </PillToggle>
                </div>
                <p className="mt-1.5 text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  {provider === 'mux'
                    ? 'One-way stream. Students watch; no seat limit.'
                    : `Two-way room — students can speak and share. Up to ${LIVEKIT_MAX_SEATS} seats.`}
                </p>
              </div>
            )}
          </div>

          {/* Title */}
          <input value={title} onChange={e => setTitle(e.target.value)} required minLength={3} maxLength={255}
            placeholder="Session title…"
            className={base} style={iStyle} />

          {/* Start + Duration + Max seats.
              Full-width start time below `sm` — same reason as the offline
              modal: a third of this modal at 375px cannot show a picked date
              and its time together. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>Start time</label>
              <DarkDateTimePicker value={start} onChange={setStart} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>Duration (mins)</label>
              <input type="number" min={5} max={600} step={5} value={durationMins}
                onChange={e => setDurationMins(Number(e.target.value))}
                className={base} style={iStyle} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>Max seats</label>
              <input type="number" min={1} max={10000} step={1}
                value={sessionCapacity}
                onChange={e => setSessionCapacity(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder={String(seatsFor(type, provider))}
                className={base} style={iStyle} />
            </div>
          </div>

          {/* Caught here as well as server-side: the API refuses it either way,
              but an admin should learn the limit while choosing the number, not
              after submitting the form. */}
          {overCapacity && (
            <p className="-mt-1 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: '#FCA5A5' }}>
              <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ background: '#FCA5A5' }} />
              An interactive room holds {LIVEKIT_MAX_SEATS} seats. Reduce the count, or switch to Broadcast for a larger session.
            </p>
          )}

          {/* Module */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Module (optional)</label>
            <DarkSelect
              value={sectionId}
              onChange={setSectionId}
              options={sections.map(s => ({ value: s.id, label: s.title }))}
              placeholder="No specific module"
            />
          </div>

          {/* Instructor */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Instructor</label>
            <DarkSelect
              value={instructorId}
              onChange={setInstructorId}
              options={instructors.map(i => ({ value: i.id, label: i.name }))}
              placeholder="Default (current user)"
              loading={loadingInstructors}
              loadingText="Loading…"
            />
          </div>

          {/* Language */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Language</label>
            <DarkSelect
              value={language}
              onChange={setLanguage}
              /* One list, from lib/languages — this dropdown and the filter on
                 the same page used to hold two different hardcoded sets. */
              options={CLASS_LANGUAGES.map(l => ({ value: l.value, label: withFlagAndNative(l) }))}
            />
          </div>

          {isSuper && (
            <GuestCohortsField
              value={cohorts}
              onChange={setCohorts}
              hostOrgId={hostOrgId}
              hostGated={!!sectionId}
              overflowSeats={overflow}
              onOverflowChange={setOverflow}
              /* A blank seat count is "not decided yet", not zero. Passing 0
                 made the panel shout that every floor over-allocates a room
                 the form would happily submit — the server defaults it. */
              sessionCapacity={sessionCapacity === '' ? OPEN_SEATS_DEFAULT : Number(sessionCapacity)}
            />
          )}

          {error && (
            <p className="flex items-center gap-1.5 text-xs" style={{ color: '#F87171' }}>
              <AlertCircle size={11} />{error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.5)' }}>
              Cancel
            </button>
            <button type="submit" disabled={createMutation.isPending}
              className="flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-bold disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)', color: '#fff' }}>
              {createMutation.isPending
                ? <><Spinner size={14} />Creating…</>
                : 'Create session'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

/* ── Grid calendar view ──────────────────────────────── */
function GridCalendarView({ items, onEditClick }: { items: LiveClass[]; onEditClick: (live: LiveClass) => void }) {
  const router = useRouter()
  const [editLive, setEditLive] = useState<LiveClass | null>(null)
  /* Resolved ONCE for the whole grid. The cards are rendered from a map, not
     from a component, so a hook per card would change hook order whenever the
     list length changes — academyViewOf() is the pure half for exactly this. */
  const viewer = useViewerAcademy()

  const sorted = useMemo(() =>
    [...items].sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
  , [items])

  const groups = useMemo(() => {
    const map = new Map<string, LiveClass[]>()
    for (const item of sorted) {
      const key = new Date(item.scheduledStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return Array.from(map.entries()).map(([label, list]) => ({ label, list }))
  }, [sorted])

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl"
          style={{ background: 'rgba(0,87,184,0.08)', border: '1px solid rgba(0,87,184,0.15)' }}>
          <Video size={26} style={{ color: '#0057b8' }} />
        </div>
        <p className="text-base font-bold text-white">No sessions found</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {groups.map(({ label, list }) => (
        <div key={label}>
          {/* Month group header */}
          <div className="mb-4 flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#0057b8' }}>{label}</span>
            <div className="h-px flex-1" style={{ background: 'rgba(0,87,184,0.15)' }} />
            <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.25)' }}>
              {list.length} {list.length === 1 ? 'session' : 'sessions'}
            </span>
          </div>

          {/* Session cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map(live => {
              const isLive      = live.status === 'live'
              const isScheduled = live.status === 'scheduled'
              const isEnded     = live.status === 'ended'
              const isCancelled = live.status === 'cancelled'
              const isInternal  = live.type === 'internal'
              const { isHost, mine, hostLabel } = academyViewOf(live, viewer)
              const fillPct     = live.sessionCapacity > 0 ? Math.min(100, (live.bookedCount / live.sessionCapacity) * 100) : 0
              const barColor    = seatBarColor(fillPct, mine)

              const accentColor  = isLive ? '#EF4444' : isScheduled ? '#0057b8' : 'rgba(255,255,255,0.18)'
              const cardBg       = isLive ? 'rgba(239,68,68,0.06)' : isScheduled ? 'rgba(0,87,184,0.05)' : 'rgba(255,255,255,0.025)'
              const cardBorder   = isLive ? 'rgba(239,68,68,0.22)' : isScheduled ? 'rgba(0,87,184,0.18)' : 'rgba(255,255,255,0.07)'

              return (
                <motion.div
                  key={live.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: isCancelled ? 0.45 : 1, y: 0 }}
                  className="flex flex-col overflow-hidden rounded-2xl"
                  style={{ background: cardBg, border: `1px solid ${cardBorder}` }}>

                  {/* Top colour stripe */}
                  <div className="h-[3px] w-full" style={{ background: accentColor }} />

                  {/* Body */}
                  <div className="flex flex-1 flex-col gap-2.5 p-4">
                    {/* Badges */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isLive && (
                        <motion.span
                          animate={{ opacity: [1, 0.5, 1] }}
                          transition={{ duration: 1.4, repeat: Infinity }}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white"
                          style={{ background: '#EF4444' }}>
                          <span className="h-1 w-1 rounded-full bg-white" />LIVE
                        </motion.span>
                      )}
                      {isScheduled && (
                        <span className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
                          style={{ background: 'rgba(0,87,184,0.15)', color: '#0057b8' }}>
                          {fmtCountdown(live.scheduledStart)}
                        </span>
                      )}
                      {isEnded && (
                        <span className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest"
                          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }}>
                          Ended
                        </span>
                      )}
                      {isCancelled && (
                        <span className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest"
                          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)' }}>
                          Cancelled
                        </span>
                      )}
                      {(live as any).isOnline === false ? (
                        <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
                          style={{ background: 'rgba(52,211,153,0.12)', color: '#34D399' }}>
                          <Building2 size={8} />Offline
                        </span>
                      ) : (
                        <span className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
                          style={{
                            background: isInternal ? 'rgba(0,87,184,0.10)' : 'rgba(99,102,241,0.10)',
                            color:      isInternal ? '#0057b8' : '#818CF8',
                          }}>
                          {isInternal ? 'In-App' : 'External'}
                        </span>
                      )}
                      <SharedAcademiesChip live={live} />
                    </div>

                    {/* Title */}
                    <h3 className={`text-sm font-bold leading-snug text-white ${isCancelled ? 'line-through opacity-40' : ''}`}>
                      {live.title}
                    </h3>

                    {/* Course */}
                    {live.course && (
                      <p className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        <BookOpen size={11} className="flex-shrink-0" style={{ color: 'rgba(255,255,255,0.25)' }} />
                        <span className="truncate">{typeof live.course === 'object' ? live.course.title : ''}</span>
                      </p>
                    )}
                    {/* Offline location */}
                    {(live as any).isOnline === false && (live as any).location && (
                      <p className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(52,211,153,0.75)' }}>
                        <MapPin size={10} className="flex-shrink-0" />
                        <span className="truncate">{(live as any).location}{(live as any).room ? ` · ${(live as any).room}` : ''}</span>
                      </p>
                    )}

                    {/* Date · time · duration */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
                      <span className="flex items-center gap-1">
                        <Calendar size={10} />{fmtDate(live.scheduledStart, zoneOf(live.organizationSlug))}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={10} />{fmtTime(live.scheduledStart, zoneOf(live.organizationSlug))}{foreignZoneTag(live.organizationSlug) && <span style={{ color: '#FBBF24' }}> {foreignZoneTag(live.organizationSlug)}</span>}
                      </span>
                      <span style={{ color: 'rgba(255,255,255,0.25)' }}>{fmtDuration(live.durationMins)}</span>
                    </div>

                    {/* Seats progress — on a shared class the viewer's OWN pool
                        leads and the room total follows, because "15 / 30" is a
                        true figure about a room their students may already be
                        locked out of. */}
                    <div className="space-y-1" title={seatBreakdown(live)}>
                      <div className="flex items-center justify-between text-[10px]" style={{ color: 'rgba(255,255,255,0.32)' }}>
                        <span>Seats</span>
                        {mine !== null
                          ? <span className="font-semibold" style={{ color: mine <= 0 ? '#F87171' : 'rgba(255,255,255,0.7)' }}>
                              {mine} left for you
                            </span>
                          : <span>{live.bookedCount} / {live.sessionCapacity}</span>}
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${fillPct}%`, background: barColor }} />
                      </div>
                      {mine !== null && (
                        <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                          {live.bookedCount} / {live.sessionCapacity} in the room
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Footer actions */}
                  <div className="flex items-center justify-between px-4 py-2.5"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center gap-1">
                      <Link href={`/live-classes/${live.id}/attendance`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                        style={{ color: 'rgba(255,255,255,0.4)' }} title="Attendance">
                        <UserCheck size={13} />
                      </Link>
                      {/* Owner only — see the note in the table row. */}
                      {isHost && isInternal && (isLive || isScheduled) && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => router.push(`/live-classes/${live.id}/monitor`)}
                          className="h-7 w-7 rounded-lg"
                          style={{ color: isLive ? '#EF4444' : '#0057b8' }}
                          title={isLive ? 'Monitor' : 'Go Live'}>
                          {isLive ? <Radio size={13} /> : <PlayCircle size={13} />}
                        </Button>
                      )}
                      {isHost ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditLive(live)}
                          className="h-7 w-7 rounded-lg"
                          style={{ color: 'rgba(255,255,255,0.4)' }}
                          title="Edit">
                          <Pencil size={12} />
                        </Button>
                      ) : (
                        <GuestReadOnlyNote hostLabel={hostLabel} />
                      )}
                    </div>
                    {live.course && (
                      <Link
                        href={`/courses/${typeof live.course === 'object' ? live.course.id : live.courseId}/edit`}
                        className="flex items-center gap-0.5 text-[10px] font-semibold transition-opacity hover:opacity-70"
                        style={{ color: 'rgba(255,255,255,0.25)' }}>
                        Course <ChevronRight size={10} />
                      </Link>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      ))}

      <AnimatePresence>
        {editLive && (
          <EditLiveClassModal
            live={editLive}
            onClose={() => setEditLive(null)}
            onSuccess={() => setEditLive(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Page ────────────────────────────────────────────── */
/* WHAT A NEW SESSION OPENS ON.

   In-app, because that is what this academy runs most of the time and the
   old default quietly made Google Meet the norm: the type buttons are two
   equal pills, so anyone who did not touch them got Meet.

   Seats have to move with it, and this is the trap the comment below the
   state warns about — seatsFor only refills the field when a mode is
   CLICKED, so a default type that disagrees with the default seat count is
   silently wrong for everyone who never touches the buttons. LiveKit is an
   interactive room capped at LIVEKIT_MAX_SEATS; opening it at
   OPEN_SEATS_DEFAULT would offer 500 seats in a room that holds 30. Both
   defaults and the rule that ties them now sit together, above the
   component, so the initialiser can use the same function the buttons do. */
const DEFAULT_TYPE: LiveClassType = 'internal'
const DEFAULT_PROVIDER: 'mux' | 'livekit' = 'livekit'

/* Seats follow the mode, because the sensible number differs by an order of
   magnitude. Refilled only when a mode is CLICKED — never on re-render — so a
   hand-typed count survives everything except deliberately switching mode. */
const seatsFor = (t: LiveClassType, p: 'mux' | 'livekit') =>
  t === 'internal' && p === 'livekit' ? LIVEKIT_MAX_SEATS : OPEN_SEATS_DEFAULT

export default function LiveClassesPage() {
  const [activeFilter,   setActiveFilter]   = useState<FilterKey>('all')
  const [typeFilter,     setTypeFilter]     = useState<'all' | 'internal' | 'external'>('all')
  const [deliveryFilter, setDeliveryFilter] = useState<'all' | 'online' | 'offline'>('all')
  const [courseFilter,      setCourseFilter]      = useState('')
  const [languageFilter,    setLanguageFilter]    = useState('')
  const [instructorFilter,  setInstructorFilter]  = useState('')
  const [search,         setSearch]         = useState('')
  const [createOpen,         setCreateOpen]         = useState(false)
  const [offlineCreateOpen,  setOfflineCreateOpen]  = useState(false)
  const [view,               setView]               = useState<'table' | 'month' | 'grid'>('table')

  const { data: me } = useCurrentUser()
  const isInstructor = me?.role === 'instructor'

  /* Time booked with this person from the Root portal — a staff catch-up, one
     student, an outside client. Not classes, but the same hours: a calendar
     showing only classes would say they were free when they are not. */
  const { data: myMeetings = [] } = useMyMeetings(me?.id)

  const { data: rawItems = [], isLoading, isError } = useAllLiveClasses(activeFilter)
  const { data: coursesData } = useCourses({ per_page: 200 })
  const courses = coursesData?.docs ?? []
  /* Pre-fetch instructors so they're in TanStack cache before the modal mounts */
  const { data: instructorsData } = useUsers('instructor', { per_page: 200 })
  const instructors = instructorsData?.docs ?? []

  /* For stats bar, always use the full unfiltered list */
  const { data: allItems = [] } = useAllLiveClasses('all')

  /* Apply type + course + search + instructor + delivery filters client-side */
  const items = useMemo(() => {
    let list = rawItems
    if (typeFilter !== 'all') list = list.filter(l => l.type === typeFilter)
    if (deliveryFilter === 'online')  list = list.filter(l => (l as any).isOnline !== false)
    if (deliveryFilter === 'offline') list = list.filter(l => (l as any).isOnline === false)
    if (courseFilter) {
      /* A SHARED CLASS BELONGS TO BOTH COURSES.
         `course` is the HOST academy's, and a guest academy reaches the class
         through its OWN course named in guestCohorts[].courseId. Matching only
         the host's meant a Bangalore admin filtering by their own course lost
         the very class that course is the door to — the filter hid the feature.
         The course dropdown lists the caller's own courses, so without the
         second clause no cohort course could ever be selected usefully. */
      list = list.filter(l => {
        const cId = typeof l.course === 'object' ? l.course?.id : l.courseId
        if (cId === courseFilter) return true
        return (l.guestCohorts ?? []).some(c => String(c.courseId) === courseFilter)
      })
    }
    if (languageFilter) list = list.filter(l => (l as any).language === languageFilter)
    if (instructorFilter) {
      list = list.filter(l => {
        const instrId = typeof l.instructor === 'object' ? (l.instructor as any)?.id : l.instructorId
        return instrId === instructorFilter
      })
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(l =>
        l.title.toLowerCase().includes(q) ||
        (typeof l.course === 'object' && l.course?.title?.toLowerCase().includes(q))
      )
    }
    if (isInstructor && me?.id) {
      list = list.filter(l => {
        const instrId = typeof l.instructor === 'object' ? l.instructor?.id : l.instructorId
        return instrId === me.id
      })
    }
    return list
  }, [rawItems, typeFilter, deliveryFilter, courseFilter, languageFilter, instructorFilter, search, isInstructor, me?.id])

  /* Offline stats for the dashboard panel */
  const offlineStats = useMemo(() => {
    const offline = allItems.filter(l => (l as any).isOnline === false)
    const todayStr = new Date().toDateString()
    const upcoming = offline.filter(l => l.status === 'scheduled' && new Date(l.scheduledStart).toDateString() !== todayStr && new Date(l.scheduledStart) > new Date())
    const todayClasses = offline.filter(l => new Date(l.scheduledStart).toDateString() === todayStr)
    const totalSeats = offline.filter(l => l.status === 'scheduled').reduce((s, l) => s + Math.max(0, l.sessionCapacity - l.bookedCount), 0)
    return { total: offline.length, today: todayClasses.length, upcoming: upcoming.length, availableSeats: totalSeats }
  }, [allItems])

  /* Group by date */
  const grouped = useMemo(() => {
    const map = new Map<string, LiveClass[]>()
    for (const item of items) {
      const key = new Date(item.scheduledStart).toDateString()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return Array.from(map.entries())
      .map(([key, list]) => ({ key, label: fmtDate(list[0]!.scheduledStart), list }))
  }, [items])

  const liveNowCount = allItems.filter(l => l.status === 'live').length

  /* Open the quick-create modal pre-filled with a date when user clicks an empty calendar slot */
  const handleCalendarSlotClick = (_date: Date) => {
    setCreateOpen(true)
  }

  /* Table column count depends on showInstructor */
  const colSpan = isInstructor ? 6 : 7

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="mb-3">
        <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(0,87,184,0.12)', border: '1px solid rgba(0,87,184,0.22)' }}>
          <Video size={20} style={{ color: '#0057b8' }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            {isInstructor ? 'My Live Classes' : 'Live Classes'}
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {isInstructor ? 'Your scheduled sessions' : 'All sessions across every course'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Add Offline Class */}
          <MotionButton
            variant="ghost"
            onClick={() => setOfflineCreateOpen(true)}
            whileHover={{ y: -1, boxShadow: '0 6px 20px rgba(52,211,153,0.20)' }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold"
            style={{ background: 'rgba(52,211,153,0.10)', color: '#34D399', border: '1px solid rgba(52,211,153,0.22)' }}>
            <Building2 size={14} />Offline Class
          </MotionButton>

          {/* New online session */}
          <MotionButton
            variant="default"
            onClick={() => setCreateOpen(true)}
            whileHover={{ y: -1, boxShadow: '0 6px 20px rgba(0,87,184,0.28)' }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold">
            <Plus size={14} />New Session
          </MotionButton>

          {/* View toggle */}
          <div className="flex items-center overflow-hidden rounded-xl"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            {([
              { key: 'table', icon: <LayoutList size={13} />,   label: 'Table'  },
              { key: 'month', icon: <CalendarRange size={13} />, label: 'Month'  },
              { key: 'grid',  icon: <LayoutGrid size={13} />,    label: 'Grid'   },
            ] as const).map(v => (
              <Button
                key={v.key}
                variant="ghost"
                size="sm"
                onClick={() => setView(v.key)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-none"
                style={view === v.key
                  ? { background: 'rgba(255,255,255,0.10)', color: 'white' }
                  : { background: 'transparent', color: 'rgba(255,255,255,0.40)' }}>
                {v.icon}{v.label}
              </Button>
            ))}
          </div>

          {/* Live now badge */}
          {liveNowCount > 0 && (
            <motion.div
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.6, repeat: Infinity }}
              className="flex items-center gap-2 rounded-2xl px-4 py-2"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#EF4444' }} />
              <span className="text-sm font-bold" style={{ color: '#EF4444' }}>
                {liveNowCount} live now
              </span>
            </motion.div>
          )}
        </div>
        </div>

        {/* Delivery mode selector — under heading */}
        <div className="mt-4 flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-2xl p-1"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            {([
              { k: 'all' as const,     label: 'All Sessions', icon: <LayoutGrid size={11} /> },
              { k: 'online' as const,  label: 'Online',        icon: <Radio size={11} /> },
              { k: 'offline' as const, label: 'In-Person',     icon: <Building2 size={11} /> },
            ]).map(({ k, label, icon }) => (
              <button key={k} onClick={() => setDeliveryFilter(k)}
                className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-[11px] font-semibold transition-all"
                style={deliveryFilter === k
                  ? k === 'offline'
                    ? { background: 'rgba(16,185,129,0.18)', color: '#10B981' }
                    : k === 'online'
                    ? { background: 'rgba(0,87,184,0.18)', color: '#0057b8' }
                    : { background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.85)' }
                  : { background: 'transparent', color: 'rgba(255,255,255,0.30)' }}>
                {icon}<span>{label}</span>
              </button>
            ))}
          </div>
          {deliveryFilter !== 'all' && (
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
              {deliveryFilter === 'online' ? 'Showing virtual sessions only' : 'Showing classroom sessions only'}
            </span>
          )}
        </div>
      </motion.div>

      {/* Stats — hidden when In-Person mode is active (offline dashboard replaces it) */}
      {deliveryFilter !== 'offline' && <StatsBar items={allItems} />}

      {/* Offline dashboard — shown when delivery filter = offline */}
      <AnimatePresence>
        {deliveryFilter === 'offline' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Total Sessions',    value: offlineStats.total,          color: 'rgba(255,255,255,0.6)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', pulse: false },
              { label: "Today's Classes",   value: offlineStats.today,          color: '#0057b8', bg: 'rgba(0,87,184,0.08)',  border: 'rgba(0,87,184,0.18)',  pulse: false },
              { label: 'Upcoming Sessions', value: offlineStats.upcoming,       color: '#818CF8', bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.18)', pulse: false },
              { label: 'Available Seats',   value: offlineStats.availableSeats, color: '#EF4444', bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.18)',  pulse: offlineStats.availableSeats > 0 },
            ].map((s, i) => (
              <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-2xl p-4"
                style={{ background: s.bg, border: `1px solid ${s.border}` }}>
                <div className="flex items-center gap-2">
                  {s.pulse && (
                    <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
                      className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: s.color }} />
                  )}
                  <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                </div>
                <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{s.label}</p>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter row */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* Status tabs */}
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(f => (
            <Button
              key={f.key}
              variant="ghost"
              size="sm"
              onClick={() => setActiveFilter(f.key)}
              className="rounded-xl px-3.5 py-1.5 text-xs font-semibold"
              style={activeFilter === f.key
                ? { background: 'rgba(0,87,184,0.18)', color: '#0057b8', border: '1px solid rgba(0,87,184,0.30)' }
                : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.07)' }}>
              {f.label}
              {f.key === 'live' && liveNowCount > 0 && (
                <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
                  className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style={{ background: '#EF4444' }}>
                  {liveNowCount}
                </motion.span>
              )}
            </Button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Course filter */}
        {courses.length > 0 && (
          <CourseDropdown
            value={courseFilter}
            onChange={setCourseFilter}
            courses={courses.map(c => ({ id: c.id, title: c.title }))}
          />
        )}

        {/* Instructor filter */}
        {instructors.length > 0 && !isInstructor && (
          <InstructorDropdown
            value={instructorFilter}
            onChange={setInstructorFilter}
            instructors={instructors.map(i => ({ id: i.id, name: i.name, avatarUrl: i.avatarUrl }))}
          />
        )}

        {/* Type filter */}
        <div className="flex gap-1">
          {([['all','All'],['internal','In-App'],['external','External']] as const).map(([k, label]) => (
            <Button key={k} variant="ghost" size="sm" onClick={() => setTypeFilter(k)}
              className="rounded-lg px-2.5 py-1 text-[11px] font-semibold"
              style={typeFilter === k
                ? k === 'internal'
                  ? { background: 'rgba(0,87,184,0.15)', color: '#0057b8', border: '1px solid rgba(0,87,184,0.25)' }
                  : k === 'external'
                  ? { background: 'rgba(99,102,241,0.15)', color: '#818CF8', border: '1px solid rgba(99,102,241,0.25)' }
                  : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.65)', border: '1px solid rgba(255,255,255,0.12)' }
                : { background: 'transparent', color: 'rgba(255,255,255,0.30)', border: '1px solid rgba(255,255,255,0.06)' }}>
              {k === 'internal' && <Tv2 className="mr-1 inline-block" size={9} />}
              {k === 'external' && <ExternalLink className="mr-1 inline-block" size={9} />}
              {label}
            </Button>
          ))}
        </div>

        {/* Language filter */}
        <LanguageDropdown value={languageFilter} onChange={setLanguageFilter} />
      </div>

      {/* Search bar */}
      <div className="relative mb-5">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'rgba(255,255,255,0.3)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search sessions or courses…"
          className="w-full rounded-xl py-2 pl-9 pr-8 text-sm text-white outline-none placeholder:text-white/25"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
        />
        {search && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-auto p-0 hover:opacity-70"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={13} />
          </Button>
        )}
      </div>

      {/* Monthly calendar view */}
      {view === 'month' && (
        <CalendarView items={items} meetings={myMeetings} onSlotClick={handleCalendarSlotClick} />
      )}

      {/* Grid calendar view */}
      {view === 'grid' && (
        <GridCalendarView items={items} onEditClick={() => {}} />
      )}

      {/* Table view */}
      {view === 'table' && (
        <>
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-20 text-sm"
              style={{ color: 'rgba(255,255,255,0.3)' }}>
              <Spinner size={16} />Loading sessions…
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertCircle size={28} style={{ color: '#EF4444' }} />
              <p className="text-sm font-semibold text-white">Couldn&apos;t load live classes</p>
            </div>
          )}

          {!isLoading && !isError && items.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-4 py-20 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl"
                style={{ background: 'rgba(0,87,184,0.08)', border: '1px solid rgba(0,87,184,0.15)' }}>
                <Video size={26} style={{ color: '#0057b8' }} />
              </div>
              <div>
                <p className="text-base font-bold text-white">No sessions found</p>
                <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {activeFilter === 'all'
                    ? 'Create a live class inside any course to get started.'
                    : activeFilter === 'live'      ? 'No streams are live right now.'
                    : activeFilter === 'scheduled' ? 'No upcoming sessions scheduled.'
                    : activeFilter === 'ended'     ? 'No ended sessions yet.'
                    : activeFilter === 'cancelled' ? 'No cancelled sessions.'
                    : 'No sessions found.'}
                </p>
              </div>
            </motion.div>
          )}

          {!isLoading && !isError && grouped.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.30)' }}>Session</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.30)' }}>Course</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.30)' }}>Module</th>
                        {!isInstructor && (
                          <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.30)' }}>Instructor</th>
                        )}
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.30)' }}>Date & Time</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.30)' }}>Seats</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.30)' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped.map(group => (
                        <React.Fragment key={group.key}>
                          {/* Date divider row */}
                          <tr>
                            <td colSpan={colSpan} style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                              <div className="flex items-center gap-2 px-4 py-2">
                                <Calendar size={11} style={{ color: 'rgba(255,255,255,0.35)' }} />
                                <span className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.40)' }}>
                                  {group.label}
                                </span>
                                <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
                                  · {group.list.length} {group.list.length === 1 ? 'session' : 'sessions'}
                                </span>
                              </div>
                            </td>
                          </tr>
                          {/* Session rows */}
                          {group.list.map((live, i) => (
                            <TableRow
                              key={live.id}
                              live={live}
                              index={i}
                              showInstructor={!isInstructor}
                            />
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </>
      )}

      {/* Quick create modal (online) */}
      <AnimatePresence>
        {createOpen && (
          <QuickCreateModal
            onClose={() => setCreateOpen(false)}
            onSuccess={() => setCreateOpen(false)}
            categoryProgram={categoryScopeOf(me)}
          />
        )}
      </AnimatePresence>

      {/* Offline class create modal */}
      <AnimatePresence>
        {offlineCreateOpen && (
          <CreateOfflineClassModal
            onClose={() => setOfflineCreateOpen(false)}
            onSuccess={() => setOfflineCreateOpen(false)}
            categoryProgram={categoryScopeOf(me)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
