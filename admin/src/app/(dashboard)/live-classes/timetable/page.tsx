'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Calendar, Clock, Users,
  Plus, X, Radio, Tv2, ExternalLink,
  AlertCircle, CalendarDays, Monitor, Pencil, Video,
  Building2, MapPin,
} from 'lucide-react'
import { useAllLiveClasses, useCreateLiveClass, type LiveClass, type LiveClassType } from '@/lib/api/liveClasses'
import { useCourses } from '@/lib/api/courses'
import { useCourseOutline } from '@/lib/api/outline'
import { useUsers } from '@/lib/api/users'
import { useCurrentUser } from '@/lib/api/user'
import { datetimeLocalToISO, zoneOf, foreignZoneTag } from '@/lib/timezone'
import { EditLiveClassModal } from '@/components/live-classes/EditLiveClassModal'
/* CROSS-ACADEMY: this page offered Edit and Go Live on every row, including a
   class the OTHER academy hosts and merely shares with this one. Both routes
   answer 404 to a guest academy — ownership decides who may move, start or
   cancel a session — so the buttons were two clicks to an error with no clue
   why. The list and card views on the sibling page already gate on isHost and
   show the guest a line naming the owner instead; this is the same rule and
   the same components, so the three screens finally say one thing. */
import { useAcademyView, SharedAcademiesChip, GuestReadOnlyNote } from '@/components/live-classes/CrossAcademy'
import { CreateOfflineClassModal } from '@/components/live-classes/CreateOfflineClassModal'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/Spinner'
import { IN_APP_RGB, MEET_RGB } from '@/lib/liveClassTheme'
import { categoryScopeOf } from '@/lib/programScope'
import { CLASS_LANGUAGES, withFlagAndNative } from '@/lib/languages'

/* ── Helpers ─────────────────────────────────────────── */
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
}

function isoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function statusColor(s: LiveClass['status']): { bg: string; border: string; text: string; dot: string } {
  switch (s) {
    case 'live':      return { bg: 'rgba(239,68,68,0.13)',   border: 'rgba(239,68,68,0.40)',   text: '#EF4444',               dot: '#EF4444' }
    case 'ended':     return { bg: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.30)',   text: '#22C55E',               dot: '#22C55E' }
    case 'cancelled': return { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)', text: 'rgba(255,255,255,0.35)', dot: 'rgba(255,255,255,0.3)' }
    default:          return { bg: 'rgba(0,87,184,0.12)',  border: 'rgba(0,87,184,0.35)',  text: '#0057b8',               dot: '#0057b8' }
  }
}

/* ── Slot draft ──────────────────────────────────────── */
interface SlotDraft {
  dayIndex: number   // always 0 in monthly view (weekDays is a 1-element array)
  dateISO:  string   // YYYY-MM-DDTHH:MM local
}

/* ── Event detail popover ──────────────────────────── */
function EventPopover({
  live, onClose, onEdit,
}: {
  live:    LiveClass
  onClose: () => void
  onEdit:  (l: LiveClass) => void
}) {
  const router = useRouter()
  const colors = statusColor(live.status)
  const start  = new Date(live.scheduledStart)
  /* Ownership, not visibility: a guest academy SEES this class and cannot move
     it. Resolved here so the buttons below and the chip above agree. */
  const { isHost, hostLabel } = useAcademyView(live)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 4 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-5 shadow-2xl"
        style={{ background: '#161829', border: '1px solid rgba(255,255,255,0.10)' }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: colors.dot }} />
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
              style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}>
              {live.status}
            </span>
            {(live as any).isOnline === false ? (
              <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: 'rgba(52,211,153,0.12)', color: '#34D399' }}>
                <Building2 size={9} />Offline
              </span>
            ) : (
              <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: 'rgba(0,87,184,0.12)', color: '#0057b8' }}>
                {live.type === 'internal' ? 'In-App' : 'External'}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="rounded-lg !text-white/40 hover:!bg-white/10"
          >
            <X size={14} />
          </Button>
        </div>

        <h3 className="text-base font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          {live.title}
        </h3>
        {live.course && (
          <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {live.course.title}
          </p>
        )}

        <div className="mt-3 space-y-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
          <p className="flex items-center gap-2">
            <Calendar size={11} style={{ color: '#818CF8' }} />
            {start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: zoneOf(live.organizationSlug) })}
          </p>
          <p className="flex items-center gap-2">
            <Clock size={11} style={{ color: '#818CF8' }} />
            {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zoneOf(live.organizationSlug) })}{foreignZoneTag(live.organizationSlug) && ' ' + foreignZoneTag(live.organizationSlug)} · {live.durationMins}m
          </p>
          {live.viewerCount > 0 && (
            <p className="flex items-center gap-2">
              <Users size={11} style={{ color: '#818CF8' }} />{live.viewerCount.toLocaleString()} viewers
            </p>
          )}
          {(live as any).isOnline === false && (live as any).location && (
            <p className="flex items-center gap-2" style={{ color: '#34D399' }}>
              <MapPin size={11} style={{ color: '#34D399' }} />
              {(live as any).location}{(live as any).room ? ` · ${(live as any).room}` : ''}
            </p>
          )}
        </div>

        <SharedAcademiesChip live={live} />

        <div className="mt-4 flex flex-wrap gap-2">
          {isHost && live.type === 'internal' && (live.status === 'scheduled' || live.status === 'live') && (
            <Button
              variant={live.status === 'live' ? 'destructive' : 'default'}
              size="sm"
              onClick={() => { router.push(`/live-classes/${live.id}/monitor`); onClose() }}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold"
            >
              {live.status === 'live' ? <Radio size={11} /> : <Monitor size={11} />}
              {live.status === 'live' ? 'Monitor' : 'Go Live'}
            </Button>
          )}
          {isHost ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { onEdit(live); onClose() }}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold !border-white/[0.12] !text-white/65 hover:!bg-white/10"
            >
              <Pencil size={11} />Edit
            </Button>
          ) : (
            <GuestReadOnlyNote hostLabel={hostLabel} />
          )}
          {live.course?.id && (
            <Link
              href={`/courses/${live.course.id}/edit`}
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <ExternalLink size={11} />Course
            </Link>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ── Quick create modal ────────────────────────────── */
function QuickCreateModal({
  draft, weekDays, onClose, onSuccess, categoryProgram,
}: {
  draft:            SlotDraft
  weekDays:         Date[]
  onClose:          () => void
  onSuccess:        () => void
  categoryProgram?: string
}) {
  const { data: coursesData, isLoading: cLoading } = useCourses({ per_page: 200, ...(categoryProgram ? { program: categoryProgram } : {}) })
  const { data: instructorsData } = useUsers('instructor', { per_page: 200 })
  const createMutation = useCreateLiveClass()

  const courses     = coursesData?.docs     ?? []
  const instructors = instructorsData?.docs ?? []

  const [courseId,        setCourseId]        = useState('')
  const [sectionId,       setSectionId]       = useState('')
  const [title,           setTitle]           = useState('')
  const [start,           setStart]           = useState(draft.dateISO)
  const [durationMins,    setDurationMins]    = useState(60)
  const [sessionCapacity, setSessionCapacity] = useState<number | ''>(500)
  /* In-app by default, matching the New Session modal. No provider choice on
     this form, so internal means Mux (the backend's own default) — a
     broadcast that scales, so the 500 above stays right and only the type
     moves. */
  const [type,            setType]            = useState<LiveClassType>('internal')
  const [instructorId,    setInstructorId]    = useState('')
  const [language,        setLanguage]        = useState('English')
  const [error,           setError]           = useState<string | null>(null)

  const { data: outline } = useCourseOutline(courseId)
  const sections = outline?.sections ?? []
  const base     = 'w-full rounded-xl px-3 py-2 text-sm text-white outline-none placeholder:text-white/30'
  /* colorScheme: 'dark' — without it the native datetime-local's picker
     glyph renders as a near-black icon on a near-black field, and its
     dropdown calendar opens as a white sheet inside the dark modal. */
  const iStyle   = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', colorScheme: 'dark' } as const
  const selStyle = { background: '#1e2035', border: '1px solid rgba(255,255,255,0.12)', color: 'white', colorScheme: 'dark' } as const

  const handle = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!courseId) { setError('Select a course'); return }
    if (!title.trim()) { setError('Enter a title'); return }
    setError(null)
    try {
      await createMutation.mutateAsync({
        courseId,
        title:           title.trim(),
        scheduledStart:  datetimeLocalToISO(start),
        durationMins,
        sessionCapacity: sessionCapacity !== '' ? sessionCapacity : undefined,
        type,
        sectionId:       sectionId || undefined,
        instructorId:    instructorId || undefined,
        language,
      })
      onSuccess()
    } catch (err: any) {
      setError(
        err?.response?.data?.error?.message
        ?? err?.response?.data?.error?.details?.[0]?.message
        ?? 'Failed to schedule session.',
      )
    }
  }

  const day      = weekDays[draft.dayIndex]
  const dayLabel = day
    ? day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : ''

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md overflow-y-auto rounded-2xl p-6 shadow-2xl"
        style={{ background: '#161829', border: '1px solid rgba(255,255,255,0.10)', maxHeight: '90vh' }}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Schedule Session
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{dayLabel}</p>
          </div>
          <button onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handle} className="space-y-3">
          {/* Course */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Course</label>
            {cLoading ? (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
                style={{ ...iStyle, color: 'rgba(255,255,255,0.4)' }}>
                <Spinner size={11} />Loading courses…
              </div>
            ) : (
              <select value={courseId}
                onChange={e => { setCourseId(e.target.value); setSectionId('') }}
                required className={`${base} cursor-pointer`} style={selStyle}>
                <option value="">Select a course…</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
          </div>

          {/* Module */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Module (optional)</label>
            <select value={sectionId} onChange={e => setSectionId(e.target.value)}
              className={`${base} cursor-pointer`} style={selStyle}>
              <option value="">No specific module</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Session title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              required minLength={3} maxLength={255} placeholder="e.g. Week 3 Q&A"
              className={base} style={iStyle} />
          </div>

          {/* Start · Duration · Seats */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>Start time</label>
              <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)}
                required className={base} style={iStyle} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>Duration (mins)</label>
              <input type="number" min={5} max={600} step={5}
                value={durationMins} onChange={e => setDurationMins(Number(e.target.value))}
                className={base} style={iStyle} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}>Max seats</label>
              <input type="number" min={1} max={10000} step={1}
                value={sessionCapacity}
                onChange={e => setSessionCapacity(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="1000" className={base} style={iStyle} />
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Type</label>
            <div className="flex gap-2">
              {/* Same accents as the New Session modal — green is in-app,
                  amber is the external link. This form has no engine picker,
                  so its order and default are deliberately left alone. */}
              <button type="button" onClick={() => setType('external')}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all"
                style={type === 'external'
                  ? { background: `rgba(${MEET_RGB},0.18)`, color: `rgb(${MEET_RGB})`, border: `1px solid rgba(${MEET_RGB},0.35)` }
                  : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <Video size={11} />Google Meet
              </button>
              <button type="button" onClick={() => setType('internal')}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all"
                style={type === 'internal'
                  ? { background: `rgba(${IN_APP_RGB},0.18)`, color: `rgb(${IN_APP_RGB})`, border: `1px solid rgba(${IN_APP_RGB},0.35)` }
                  : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <Radio size={11} />In-App Stream
              </button>
            </div>
            {type === 'external' && (
              <p className="mt-1.5 flex items-center gap-1 text-[10px]" style={{ color: `rgba(${MEET_RGB},0.7)` }}>
                <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ background: `rgb(${MEET_RGB})` }} />
                Google Meet link will be auto-generated
              </p>
            )}
          </div>

          {/* Instructor */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Instructor</label>
            <select value={instructorId} onChange={e => setInstructorId(e.target.value)}
              className={`${base} cursor-pointer`} style={selStyle}>
              <option value="">Default (you)</option>
              {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>

          {/* Language */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Language</label>
            <select value={language} onChange={e => setLanguage(e.target.value)}
              className={base} style={selStyle}>
              {CLASS_LANGUAGES.map(l => (
                <option key={l.value} value={l.value}>{withFlagAndNative(l)}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-xs" style={{ color: '#F87171' }}>
              <AlertCircle size={11} />{error}
            </p>
          )}

          <button type="submit" disabled={createMutation.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-60 transition-all hover:brightness-110"
            style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)' }}>
            {createMutation.isPending
              ? <><Spinner size={14} />Scheduling…</>
              : <><Plus size={14} />Schedule Session</>}
          </button>
        </form>
      </motion.div>
    </motion.div>
  )
}

/* ── Page ─────────────────────────────────────────── */
export default function TimetablePage() {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  const [monthDate,  setMonthDate]  = useState<Date>(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d
  })
  const [selected,          setSelected]          = useState<LiveClass | null>(null)
  const [draft,             setDraft]             = useState<SlotDraft | null>(null)
  const [draftDay,          setDraftDay]          = useState<Date | null>(null)
  const [editTarget,        setEditTarget]        = useState<LiveClass | null>(null)
  const [offlineCreateOpen, setOfflineCreateOpen] = useState(false)
  const [offlinePrefill,    setOfflinePrefill]    = useState<string | undefined>(undefined)

  const { data: me } = useCurrentUser()
  const categoryProgram = categoryScopeOf(me)

  const year  = monthDate.getFullYear()
  const month = monthDate.getMonth()

  /* Sunday-anchored grid start */
  const gridStart = useMemo(() => {
    const first = new Date(year, month, 1)
    const dow   = first.getDay()                 // 0 = Sun
    const d     = new Date(first)
    d.setDate(first.getDate() - dow)
    return d
  }, [year, month])

  /* 42 cells = 6 weeks, layout never shifts */
  const calDays = useMemo(() =>
    Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d
    })
  , [gridStart])

  const weeks = useMemo(() =>
    Array.from({ length: 6 }, (_, wi) => calDays.slice(wi * 7, wi * 7 + 7))
  , [calDays])

  const { data: allClasses, isLoading } = useAllLiveClasses('all')

  const getSessionsForDay = (day: Date) =>
    (allClasses ?? []).filter(l => sameDay(new Date(l.scheduledStart), day))

  const liveNowCount = (allClasses ?? []).filter(l => l.status === 'live').length

  /* Same integers the grid is built from, not a formatted Date — see the note
     in ../page.tsx. Formatting renders in the zone Intl resolves while
     getMonth() uses the runtime's local zone, and when those differ the header
     names a different month than the cells below it. */
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  const monthLabel    = `${MONTH_NAMES[month]} ${year}`
  const isThisMonth   = monthDate.getFullYear() === today.getFullYear() && monthDate.getMonth() === today.getMonth()

  const DAY_ABBRS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MAX_CHIPS = 3
  const BORDER    = '1px solid rgba(255,255,255,0.07)'

  const chipStyle = (status: LiveClass['status']) => {
    const c = statusColor(status)
    return { bg: c.bg, color: c.text, border: c.border }
  }

  const handleDayClick = (day: Date) => {
    const d = new Date(day); d.setHours(9, 0, 0, 0)
    setDraftDay(day)
    setDraft({ dayIndex: 0, dateISO: isoLocal(d) })
    setSelected(null)
    setEditTarget(null)
  }

  const prevMonth = () => setMonthDate(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n })
  const nextMonth = () => setMonthDate(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n })
  const goToToday = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setMonthDate(d) }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>

      {/* ── Top bar ── */}
      <div className="mb-4 flex flex-shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.25)' }}>
            <CalendarDays size={16} style={{ color: '#0057b8' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Live Timetable
            </h1>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{monthLabel}</p>
          </div>
          {liveNowCount > 0 && (
            <motion.div
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-white"
              style={{ background: 'rgba(239,68,68,0.20)', border: '1px solid rgba(239,68,68,0.35)' }}>
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />{liveNowCount} live
            </motion.div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Month navigation */}
          <div className="flex items-center overflow-hidden rounded-xl"
            style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={prevMonth}
              className="flex h-8 w-8 items-center justify-center !text-white/60 hover:!bg-white/10 rounded-none"
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={goToToday}
              className="h-8 px-3 text-xs font-semibold hover:!bg-white/10 rounded-none"
              style={{ color: isThisMonth ? '#0057b8' : 'rgba(255,255,255,0.6)' }}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={nextMonth}
              className="flex h-8 w-8 items-center justify-center !text-white/60 hover:!bg-white/10 rounded-none"
            >
              <ChevronRight size={14} />
            </Button>
          </div>

          <Link href="/live-classes"
            className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.10)' }}>
            <CalendarDays size={12} />Overview
          </Link>

          {/* Add Offline Class */}
          <button
            onClick={() => { setOfflinePrefill(undefined); setOfflineCreateOpen(true) }}
            className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-all hover:opacity-90"
            style={{ background: 'rgba(52,211,153,0.12)', color: '#34D399', border: '1px solid rgba(52,211,153,0.25)' }}>
            <Building2 size={12} />Offline Class
          </button>
        </div>
      </div>

      {/* ── Monthly Grid ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-2xl"
        style={{ border: BORDER, background: '#0D0F1A' }}>

        {/* Day-of-week header (sticky) */}
        <div className="sticky top-0 z-10 grid grid-cols-7 flex-shrink-0"
          style={{ background: '#0D0F1A', borderBottom: BORDER }}>
          {DAY_ABBRS.map((d, i) => (
            <div key={d}
              className="py-3 text-center text-[11px] font-bold uppercase tracking-widest"
              style={{
                color:       'rgba(255,255,255,0.30)',
                borderRight: i < 6 ? BORDER : 'none',
              }}>
              {d}
            </div>
          ))}
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7"
            style={{ borderBottom: wi < 5 ? BORDER : 'none' }}>
            {week.map((day, di) => {
              const inMonth  = day.getMonth() === month
              const isToday  = sameDay(day, today)
              const sessions = getSessionsForDay(day)
              const overflow = sessions.length - MAX_CHIPS

              return (
                <div
                  key={di}
                  onClick={() => handleDayClick(day)}
                  className="cursor-pointer transition-colors hover:bg-white/[0.02]"
                  style={{
                    borderRight: di < 6 ? BORDER : 'none',
                    minHeight:   120,
                    background:  isToday ? 'rgba(0,87,184,0.04)' : 'transparent',
                    opacity:     inMonth ? 1 : 0.30,
                  }}>

                  {/* Day number */}
                  <div className="px-3 pt-2.5 pb-1.5">
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold leading-none"
                      style={isToday
                        ? { background: '#0057b8', color: '#fff' }
                        : { color: inMonth ? 'rgba(255,255,255,0.60)' : 'rgba(255,255,255,0.20)' }}>
                      {day.getDate()}
                    </span>
                  </div>

                  {/* Session chips */}
                  <div className="space-y-0.5 px-1.5 pb-2" onClick={e => e.stopPropagation()}>
                    {isLoading && inMonth && (
                      <div className="h-5 animate-pulse rounded-md"
                        style={{ background: 'rgba(255,255,255,0.04)' }} />
                    )}
                    {!isLoading && sessions.slice(0, MAX_CHIPS).map(s => {
                      const isOffline = (s as any).isOnline === false
                      const c = isOffline
                        ? { bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.25)', color: '#34D399' }
                        : chipStyle(s.status)
                      return (
                        <Button
                          key={s.id}
                          variant="ghost"
                          onClick={() => { setSelected(s); setDraft(null); setEditTarget(null) }}
                          className="w-full text-left rounded-md px-2 py-1 h-auto transition-all hover:brightness-125 hover:!bg-transparent"
                          style={{ background: c.bg, border: `1px solid ${c.border}` }}
                        >
                          <p className="flex items-center gap-1 truncate text-[10px] font-semibold leading-tight"
                            style={{ color: c.color }}>
                            {isOffline && <Building2 size={8} className="flex-shrink-0" />}
                            {new Date(s.scheduledStart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zoneOf(s.organizationSlug) })}
                            {' · '}{s.title}
                          </p>
                        </Button>
                      )
                    })}
                    {overflow > 0 && (
                      <p className="px-2 text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.30)' }}>
                        +{overflow} more
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* ── Hint ── */}
      <p className="mt-2 flex-shrink-0 text-center text-[10px]" style={{ color: 'rgba(255,255,255,0.18)' }}>
        Click any day to schedule an online session · Click "Offline Class" to add an in-person session · Click a chip for details
      </p>

      {/* ── Modals ── */}
      <AnimatePresence>
        {selected && (
          <EventPopover
            key="popover"
            live={selected}
            onClose={() => setSelected(null)}
            onEdit={l => { setSelected(null); setEditTarget(l) }}
          />
        )}
        {draft && draftDay && (
          <QuickCreateModal
            key="create"
            draft={draft}
            weekDays={[draftDay]}
            onClose={() => { setDraft(null); setDraftDay(null) }}
            onSuccess={() => { setDraft(null); setDraftDay(null) }}
            categoryProgram={categoryProgram}
          />
        )}
        {editTarget && (
          <EditLiveClassModal
            key="edit"
            live={editTarget}
            onClose={() => setEditTarget(null)}
            onSuccess={() => setEditTarget(null)}
          />
        )}
        {offlineCreateOpen && (
          <CreateOfflineClassModal
            key="offline-create"
            onClose={() => setOfflineCreateOpen(false)}
            onSuccess={() => setOfflineCreateOpen(false)}
            categoryProgram={categoryProgram}
            prefillDate={offlinePrefill}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
