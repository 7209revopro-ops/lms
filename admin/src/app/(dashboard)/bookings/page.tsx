'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Calendar, Clock,
  CheckCircle2, XCircle, Search,
  BookOpen, User, GraduationCap, LayoutList, X,
  Download, TrendingUp, Users, AlertCircle,
  Filter, ChevronDown, Check, Wifi, Building2, MapPin,
} from 'lucide-react'
import {
  useAdminBookings, useAdminBookingStats, useUpdateAttendance, useCancelBooking, useBulkAttendance,
  fetchAllAdminBookings,
  type AdminBookingStats, type AdminBookingParams,
  type ClassBooking, type BookingStatus,
} from '@/lib/api/liveClasses'
import { useCourses } from '@/lib/api/courses'
import { useUsers } from '@/lib/api/users'
import { useCurrentUser } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'
import { useToast } from '@/store/ui.store'
import { datetimeLocalToISO } from '@/lib/timezone'

/* ─── Custom dark dropdown ───────────────────────────────── */
interface SelectOption { value: string; label: string }

function FilterSelect({
  value, onChange, options, placeholder = 'All', minWidth = 120,
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  placeholder?: string
  minWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  return (
    <div ref={ref} className="relative" style={{ minWidth }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-xs font-medium outline-none transition-colors"
        style={{
          background: open ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${open ? 'rgba(0,87,184,0.40)' : 'rgba(255,255,255,0.09)'}`,
          color: value ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.45)',
        }}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown size={11} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: 'rgba(255,255,255,0.35)' }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full z-50 mt-1 w-full min-w-[180px] overflow-hidden rounded-2xl py-1 shadow-2xl"
            style={{ background: '#1A1A2E', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
                style={{
                  background: opt.value === value ? 'rgba(0,87,184,0.12)' : 'transparent',
                  color: opt.value === value ? '#0057b8' : 'rgba(255,255,255,0.75)',
                }}
                onMouseEnter={e => { if (opt.value !== value) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)' }}
                onMouseLeave={e => { if (opt.value !== value) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                {opt.value === value && <Check size={10} className="flex-shrink-0" style={{ color: '#0057b8' }} />}
                {opt.value !== value && <span className="w-[10px] flex-shrink-0" />}
                <span className="truncate">{opt.label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─── Helpers ────────────────────────────────────────────── */
function toYMD(d: Date): string {
  /* No explicit timeZone: the patched Intl.DateTimeFormat injects the active
     academy zone (Dubai or Bangalore) resolved by TimezoneScope. */
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/* The inverse of toYMD, and it has to be: toYMD formats in the ACADEMY zone
   while `new Date('2026-09-17T00:00:00')` parses in the DEVICE zone, so the
   two did not round-trip. An admin on a device east of the academy — Dubai
   academy, Singapore laptop — picked a day and watched the input snap back to
   the day before, then got that wrong day's bookings, because the same value
   is what goes to the server. Both directions now speak the academy zone, so
   toYMD(ymdToStart(x)) === x for every x. */
/* On a DST spring-forward day the local midnight does not exist, and the
   conversion lands on the day before — filtering the wrong day. Neither
   supported academy zone observes DST, but ORG_TIMEZONES is the kind of map
   that grows, so step to the nearest hour that does exist instead of
   inheriting a silent off-by-one the day an academy opens in one. */
function onSameDay(ymd: string, wall: string): Date | null {
  const d = new Date(datetimeLocalToISO(`${ymd}T${wall}`))
  return toYMD(d) === ymd ? d : null
}
function ymdToStart(ymd: string): Date {
  return onSameDay(ymd, '00:00') ?? onSameDay(ymd, '01:00') ?? new Date(datetimeLocalToISO(`${ymd}T12:00`))
}
function ymdToEnd(ymd: string): Date {
  return onSameDay(ymd, '23:59') ?? onSameDay(ymd, '22:59') ?? new Date(datetimeLocalToISO(`${ymd}T12:00`))
}

/* Start/end of the academy-zone day that `d` falls in. Anchoring to the
   academy day (rather than setHours, which is the device day) keeps the
   presets and the arrows on the same grid as the pickers. */
const dayStart = (d: Date) => ymdToStart(toYMD(d))
const dayEnd   = (d: Date) => ymdToEnd(toYMD(d))

function fmtHeading(ymd: string): string {
  const today     = toYMD(new Date())
  const tomorrow  = toYMD(new Date(Date.now() + 86_400_000))
  const yesterday = toYMD(new Date(Date.now() - 86_400_000))
  if (ymd === today)     return 'Today'
  if (ymd === tomorrow)  return 'Tomorrow'
  if (ymd === yesterday) return 'Yesterday'
  const d = new Date(ymd + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  })
}
function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60); const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}

const LANG_FLAG: Record<string, string> = {
  English:   '🇬🇧',
  Arabic:    '🇦🇪',
  Hindi:     '🇮🇳',
  Malayalam: '🇮🇳',
  Urdu:      '🇵🇰',
}

/* The allowed sort values, shared by the control and the URL parser so the two
   can never disagree about what is valid. */
const SORT_VALUES = ['scheduledStart', '-scheduledStart', '-bookedAt', 'bookedAt'] as const

/* ─── Status palette ─────────────────────────────────────── */
const STATUS_PAL: Record<BookingStatus, { bg: string; color: string; label: string }> = {
  booked:    { bg: 'rgba(16,185,129,0.12)',  color: '#34D399', label: 'Booked'    },
  attended:  { bg: 'rgba(99,102,241,0.12)',  color: '#818CF8', label: 'Attended'  },
  missed:    { bg: 'rgba(245,158,11,0.12)',  color: '#FCD34D', label: 'Missed'    },
  cancelled: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)', label: 'Cancelled' },
}

function StatusBadge({ status }: { status: BookingStatus }) {
  const p = STATUS_PAL[status]
  return (
    <span className="inline-flex items-center rounded-lg px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ background: p.bg, color: p.color }}>
      {p.label}
    </span>
  )
}

/* ─── Avatar ─────────────────────────────────────────────── */
function Avatar({ name, url, size = 28 }: { name: string; url?: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  if (url) return <img src={url} alt={name} className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size }} />
  return (
    <div className="flex items-center justify-center rounded-full flex-shrink-0 font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: 'linear-gradient(135deg,#0057b8,#003d80)' }}>
      {initials}
    </div>
  )
}

/* ─── Attendance toggle ──────────────────────────────────── */
function AttendanceToggle({ booking }: { booking: ClassBooking }) {
  const update = useUpdateAttendance()
  const isPast = new Date(booking.liveClassId.scheduledStart) < new Date()
  if (!isPast || booking.status === 'cancelled') return null
  return (
    <div className="flex gap-1">
      <button onClick={() => update.mutate({ id: booking.id, status: 'attended' })}
        disabled={update.isPending} title="Mark attended"
        className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors"
        style={{
          background: booking.status === 'attended' ? 'rgba(99,102,241,0.20)' : 'rgba(255,255,255,0.04)',
          color:      booking.status === 'attended' ? '#818CF8' : 'rgba(255,255,255,0.25)',
        }}>
        <CheckCircle2 size={13} />
      </button>
      <button onClick={() => update.mutate({ id: booking.id, status: 'missed' })}
        disabled={update.isPending} title="Mark missed"
        className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors"
        style={{
          background: booking.status === 'missed' ? 'rgba(245,158,11,0.20)' : 'rgba(255,255,255,0.04)',
          color:      booking.status === 'missed' ? '#FCD34D' : 'rgba(255,255,255,0.25)',
        }}>
        <XCircle size={13} />
      </button>
    </div>
  )
}

/* Release a seat on the student's behalf.

   There was no admin path to cancel a booking anywhere in the product, so a
   seat taken by mistake kept a session full for ever. Only offered while the
   seat is actually live — a past or already-cancelled booking has nothing to
   release, and the server refuses it. Two-step, because a misclick here removes
   a student from a class they are expecting to attend. */
function CancelBookingButton({ booking }: { booking: ClassBooking }) {
  const cancel = useCancelBooking()
  const [confirming, setConfirming] = useState(false)
  if (booking.status !== 'booked') return null
  if (new Date(booking.liveClassId.scheduledStart) < new Date()) return null

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <button onClick={() => { cancel.mutate(booking.id); setConfirming(false) }}
          disabled={cancel.isPending}
          className="rounded-lg px-2 py-0.5 text-[10px] font-bold transition-opacity disabled:opacity-50"
          style={{ background: 'rgba(239,68,68,0.18)', color: '#F87171' }}>
          {cancel.isPending ? '…' : 'Release'}
        </button>
        <button onClick={() => setConfirming(false)} className="px-1 text-[10px]"
          style={{ color: 'rgba(255,255,255,0.35)' }}>
          Keep
        </button>
      </div>
    )
  }
  return (
    <button onClick={() => setConfirming(true)} title="Cancel this booking and release the seat"
      className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors"
      style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.25)' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#F87171' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'rgba(255,255,255,0.25)' }}>
      <X size={13} />
    </button>
  )
}

function RowActions({ booking }: { booking: ClassBooking }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <AttendanceToggle booking={booking} />
      <CancelBookingButton booking={booking} />
    </div>
  )
}

/* ─── Stats strip ────────────────────────────────────────── */
/* Fed by /admin/bookings/stats — the totals for the WHOLE filtered set.
   Deriving these from the loaded array meant a filter matching 2,340 bookings
   reported "150", and reported "150" again on the next page. */
function StatsStrip({ stats, needsMarking, onNeedsMarking }: {
  stats?: AdminBookingStats
  needsMarking: boolean
  onNeedsMarking: (on: boolean) => void
}) {
  const total     = stats?.total ?? 0
  const attended  = stats?.attended ?? 0
  const booked    = stats?.booked ?? 0
  const concluded = attended + (stats?.missed ?? 0)
  const rate      = concluded > 0 ? (stats?.attendanceRate ?? 0) : null
  /* A seat still `booked` after its session has run is not upcoming — it is a
     session nobody took attendance for. Showing the whole `booked` bucket as
     "Upcoming" hid exactly the rows that need an admin. Fall back to the old
     meaning only for a cached response that predates the split. */
  const upcoming  = stats?.upcoming ?? booked
  const unmarked  = stats?.unmarked ?? 0

  const pills = [
    { label: 'Total',         value: String(total),            icon: <Users size={13} />,    color: 'rgba(255,255,255,0.75)', bg: 'rgba(255,255,255,0.04)',  border: 'rgba(255,255,255,0.08)' },
    { label: 'Upcoming',      value: String(upcoming),         icon: <Calendar size={13} />, color: '#34D399',                bg: 'rgba(16,185,129,0.08)',   border: 'rgba(16,185,129,0.18)' },
    /* Only worth a tile when there is something to act on. */
    /* Worth a tile only when there is something to act on — and then it is a
       button, because a count of work with no way to reach it is just nagging.
       Stays mounted while the filter is on, so it can be switched back off. */
    ...(unmarked > 0 || needsMarking
      ? [{ label: 'Needs marking', value: String(unmarked), icon: <AlertCircle size={13} />, color: '#FCD34D', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.22)',
          onClick: () => onNeedsMarking(!needsMarking), active: needsMarking }]
      : []),
    { label: 'Attended',      value: String(attended),         icon: <CheckCircle2 size={13} />, color: '#818CF8',            bg: 'rgba(99,102,241,0.08)',   border: 'rgba(99,102,241,0.18)' },
    { label: 'Attendance %',  value: rate !== null ? `${rate}%` : '—', icon: <TrendingUp size={13} />, color: rate !== null && rate >= 70 ? '#34D399' : rate !== null && rate >= 40 ? '#FCD34D' : '#F87171', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)' },
  ]

  return (
    /* Column count follows the pill count, or the fifth tile orphans onto a
       row of its own. */
    <div className={`mb-5 grid grid-cols-2 gap-3 ${pills.length === 5 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-4'}`}>
      {pills.map((p, i) => (
        <motion.div key={p.label}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, type: 'spring', stiffness: 320, damping: 28 }}
          {...(p.onClick ? { role: 'button', tabIndex: 0, onClick: p.onClick,
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onClick!() } },
            title: p.active ? 'Showing only sessions that need marking — click to clear' : 'Show only sessions that need marking' } : {})}
          className={`rounded-2xl px-4 py-3 ${p.onClick ? 'cursor-pointer transition-[filter,box-shadow] hover:brightness-125' : ''}`}
          style={{ background: p.bg,
            border: `1px solid ${p.active ? p.color : p.border}`,
            boxShadow: p.active ? `0 0 0 1px ${p.color}` : undefined }}>
          <div className="mb-1 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.30)' }}>
            {p.icon}
            <span className="text-[10px] font-semibold uppercase tracking-widest">{p.label}</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: p.color, fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            {p.value}
          </p>
        </motion.div>
      ))}
    </div>
  )
}

/* ─── Booking row ────────────────────────────────────────── */
function BookingRow({ booking, index, selectable, selected, onToggle }: {
  booking: ClassBooking; index: number
  selectable: boolean
  selected: boolean
  onToggle: (id: string) => void
}) {
  const lc         = booking.liveClassId as typeof booking.liveClassId | null
  const student    = booking.userId
  if (!lc || !student) return null   // live class or user was deleted
  const instructor = lc.instructorId
  const course     = lc.courseId
  const lang       = lc.language
  const isOffline  = lc.isOnline === false
  const accentColor = isOffline ? '#10B981' : '#0057b8'
  const accentBg    = isOffline ? 'rgba(16,185,129,0.06)' : 'rgba(0,87,184,0.04)'

  return (
    <motion.tr
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.018, duration: 0.14 }}
      className="group border-b last:border-b-0 transition-colors"
      style={{ borderColor: 'rgba(255,255,255,0.05)' }}
      onMouseEnter={e => (e.currentTarget.style.background = isOffline ? 'rgba(16,185,129,0.04)' : 'rgba(0,87,184,0.03)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Select — only seats that are still undecided can be marked, so the
          rest render an empty cell rather than a checkbox that does nothing. */}
      <td className="py-3 pl-5 pr-0 align-middle">
        {selectable ? (
          <input type="checkbox" checked={selected}
            onChange={() => onToggle(booking.id)}
            aria-label={`Select ${student.name}`}
            className="h-3.5 w-3.5 cursor-pointer accent-indigo-400" />
        ) : <span className="block h-3.5 w-3.5" />}
      </td>

      {/* Student */}
      <td className="py-3 pr-3" style={{ paddingLeft: 0 }}>
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Delivery accent bar */}
          <div className="h-9 w-[3px] flex-shrink-0 rounded-full" style={{ background: accentColor, opacity: 0.7 }} />
          <Avatar name={student.name} url={student.avatarUrl} size={30} />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'rgba(255,255,255,0.90)' }}>{student.name}</p>
            <p className="text-[11px] truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>{student.email}</p>
          </div>
        </div>
      </td>

      {/* Session */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-1.5 mb-0.5">
          <p className="text-sm font-medium line-clamp-1" style={{ color: 'rgba(255,255,255,0.85)' }}>{lc.title}</p>
          {/* Delivery badge */}
          <span className="flex-shrink-0 flex items-center gap-0.5 rounded-md px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide"
            style={{ background: accentBg, color: accentColor, border: `1px solid ${accentColor}22` }}>
            {isOffline ? <><Building2 size={8} />In-Person</> : <><Wifi size={8} />Online</>}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {fmtTime(lc.scheduledStart)} · {fmtDuration(lc.durationMins)}
          </span>
          {lang && (
            <span className="rounded px-1.5 py-0 text-[10px] font-semibold"
              style={{ background: 'rgba(16,185,129,0.12)', color: '#6EE7B7' }}>
              {LANG_FLAG[lang] ?? '🌐'} {lang}
            </span>
          )}
          {isOffline && lc.location && (
            <span className="flex items-center gap-0.5 text-[10px]" style={{ color: '#10B981' }}>
              <MapPin size={9} />{lc.location}{lc.room ? ` · ${lc.room}` : ''}
            </span>
          )}
        </div>
      </td>

      {/* Course */}
      <td className="py-3 px-3">
        {course ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <BookOpen size={11} className="flex-shrink-0" style={{ color: '#0057b8' }} />
            <span className="text-[12px] truncate" style={{ color: 'rgba(255,255,255,0.70)' }}>{course.title}</span>
          </div>
        ) : <span style={{ color: 'rgba(255,255,255,0.18)' }}>—</span>}
      </td>

      {/* Instructor */}
      <td className="py-3 px-3">
        {instructor ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Avatar name={instructor.name} url={instructor.avatarUrl} size={22} />
            <span className="text-[12px] truncate" style={{ color: 'rgba(255,255,255,0.70)' }}>{instructor.name}</span>
          </div>
        ) : <span style={{ color: 'rgba(255,255,255,0.18)' }}>—</span>}
      </td>

      {/* Booked / Cancelled at */}
      <td className="py-3 px-3 hidden lg:table-cell">
        {booking.status === 'cancelled' && booking.cancelledAt ? (
          <div>
            <span className="text-[10px] font-semibold" style={{ color: '#F87171' }}>Cancelled</span>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {new Date(booking.cancelledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          </div>
        ) : (
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {new Date(booking.bookedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </td>

      {/* Status */}
      <td className="py-3 px-3">
        <StatusBadge status={booking.status} />
      </td>

      {/* Actions */}
      <td className="py-3 pl-3 pr-5">
        <RowActions booking={booking} />
      </td>
    </motion.tr>
  )
}

/* ─── Export CSV ─────────────────────────────────────────── */
function exportCSV(bookings: ClassBooking[], filename: string) {
  const header = ['Student', 'Email', 'Session', 'Date', 'Time', 'Duration', 'Language', 'Course', 'Instructor', 'Status', 'Booked At', 'Cancelled At']
  const rows = bookings.map(b => {
    const lc = b.liveClassId as typeof b.liveClassId | null
    return [
      (b.userId?.name ?? '(deleted student)'),
      (b.userId?.email ?? ''),
      lc?.title ?? '(deleted session)',
      lc ? new Date(lc.scheduledStart).toLocaleDateString('en-US') : '',
      lc ? fmtTime(lc.scheduledStart) : '',
      lc ? fmtDuration(lc.durationMins) : '',
      lc?.language ?? 'English',
      lc?.courseId?.title ?? '',
      lc?.instructorId?.name ?? '',
      b.status,
      new Date(b.bookedAt).toLocaleDateString('en-US'),
      b.cancelledAt ? new Date(b.cancelledAt).toLocaleDateString('en-US') : '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`)
  })
  const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

/* ─── Main page ──────────────────────────────────────────── */
export default function BookingsPage() {
  const { data: me }    = useCurrentUser()
  const toast           = useToast()
  const isInstructor    = me?.role === 'instructor'
  const userScope       = (me as any)?.categoryScope as string | undefined  // '4x-trading' | 'digital-marketing' | undefined

  /* Date range — default: past 30 days to 90 days ahead (shows upcoming bookings) */
  const [dateFrom, setDateFrom] = useState<Date>(() => dayStart(addDays(new Date(), -30)))
  const [dateTo,   setDateTo]   = useState<Date>(() => dayEnd(addDays(new Date(),  90)))

  /* Filters */
  const [statusFilter,     setStatusFilter]     = useState<BookingStatus | ''>('')
  const [deliveryFilter,   setDeliveryFilter]   = useState<'all' | 'online' | 'offline'>('all')
  const [needsMarking,     setNeedsMarking]     = useState(false)
  /* Chronological by default. The table groups rows under a date heading, and
     ordered by bookedAt those groups were built from an arbitrary slice — the
     same day appeared on page 1 and page 3 with a different count each time. */
  const [sort, setSort] = useState<NonNullable<AdminBookingParams['sort']>>('scheduledStart')
  const [courseFilter,     setCourseFilter]     = useState('')
  const [instructorFilter, setInstructorFilter] = useState('')
  const [langFilter,       setLangFilter]       = useState('')
  const [search,           setSearch]           = useState('')
  const [page,             setPage]             = useState(1)

  /* The whole filter lives in the URL, so a view can be bookmarked, shared with
     a colleague, and survives a refresh or a back-button. It used to reset to
     the default range on every reload, which on a console people keep open all
     day meant re-applying the same four filters over and over.

     Read in an effect rather than a useState initializer: the date helpers
     resolve against the ACTIVE ACADEMY zone, which TimezoneScope sets during
     render, so parsing a day at initializer time could land a day out for a
     Bangalore admin. `hydrated` gates the writer so the mount write cannot
     clobber the URL before it has been read.
     It is STATE, not a ref: a ref flips synchronously, so the writer would run
     in the same commit as the reader — seeing the still-default state, because
     the setters below only take effect on the next render — and overwrite the
     URL with defaults before it had been applied. As state it forces the writer
     to wait one render, by which time the parsed values are actually in place. */
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') { setHydrated(true); return }
    const sp = new URLSearchParams(window.location.search)
    /* [0-9] rather than a backslash-d class: this file is edited by script and
       a lost backslash would silently reject every valid date. */
    const ymd = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

    /* Shape-valid is NOT date-valid. "2026-13-99" matches the pattern above but
       is not a real day, and the academy-zone helpers run it through
       Intl.formatToParts, which THROWS on an Invalid Date rather than returning
       one — so a hand-edited or stale link took the whole page down with it,
       during the mount effect, leaving it stuck on the auth spinner. Reject
       anything Date itself cannot parse before the helpers ever see it. */
    const parseDay = (v: string | null, endOfDay: boolean): Date | null => {
      if (!v || !ymd.test(v)) return null
      if (Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) return null
      return endOfDay ? ymdToEnd(v) : ymdToStart(v)
    }
    const from = parseDay(sp.get('from'), false)
    const to   = parseDay(sp.get('to'),   true)
    if (from) setDateFrom(from)
    if (to)   setDateTo(to)

    /* Every value is validated against the same list the control offers. A URL
       is user-editable, and a bogus one would otherwise be forwarded to the API
       and answered 422 with an empty table and no explanation. */
    const st = sp.get('status')
    if (st && (['booked', 'attended', 'missed', 'cancelled'] as const).includes(st as BookingStatus)) setStatusFilter(st as BookingStatus)
    const dv = sp.get('delivery')
    if (dv === 'online' || dv === 'offline') setDeliveryFilter(dv)
    const so = sp.get('sort')
    if (so && (SORT_VALUES as readonly string[]).includes(so)) setSort(so as NonNullable<AdminBookingParams['sort']>)
    if (sp.get('unmarked') === '1') setNeedsMarking(true)
    if (sp.get('course'))     setCourseFilter(sp.get('course')!)
    if (sp.get('instructor')) setInstructorFilter(sp.get('instructor')!)
    if (sp.get('lang'))       setLangFilter(sp.get('lang')!)
    if (sp.get('q'))          setSearch(sp.get('q')!)
    const pg = Number(sp.get('page'))
    if (Number.isInteger(pg) && pg > 1) setPage(pg)

    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [showFilters,      setShowFilters]       = useState(false)

  /* Supporting data for filter dropdowns — course list scoped to this admin's program */
  const { data: coursesData }     = useCourses({ per_page: 200, program: userScope })
  const { data: instructorsData } = useUsers('instructor', { per_page: 200 })
  const courses     = coursesData?.docs ?? []
  const instructors = instructorsData?.docs ?? []

  /* Debounced, because search now runs on the SERVER — bound directly, every
     keystroke would be a round trip. The server requires two characters. */
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  /* One object, so the list and the stats strip can never describe different
     filters — the strip used to be computed from the loaded page instead. */
  const query = useMemo(() => ({
    dateFrom:     toYMD(dateFrom),
    dateTo:       toYMD(dateTo),
    status:       statusFilter || undefined,
    courseId:     courseFilter || undefined,
    instructorId: instructorFilter || undefined,
    language:     langFilter || undefined,
    q:            debouncedSearch.length >= 2 ? debouncedSearch : undefined,
    isOnline:     deliveryFilter === 'all' ? undefined : deliveryFilter === 'online' ? 'true' as const : 'false' as const,
    needsMarking: needsMarking ? 'true' as const : undefined,
    sort,
  }), [dateFrom, dateTo, statusFilter, courseFilter, instructorFilter, langFilter, debouncedSearch, deliveryFilter, needsMarking, sort])

  /* Mirror the live filter into the URL. replaceState rather than router.push:
     typing in the search box changes this on nearly every keystroke, and each
     one would otherwise become a separate history entry, so Back would walk
     letter by letter instead of leaving the page. */
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return
    const sp = new URLSearchParams()
    /* Only non-defaults, so a clean view has a clean URL. */
    sp.set('from', toYMD(dateFrom))
    sp.set('to',   toYMD(dateTo))
    if (statusFilter)             sp.set('status', statusFilter)
    if (deliveryFilter !== 'all') sp.set('delivery', deliveryFilter)
    if (sort !== 'scheduledStart') sp.set('sort', sort)
    if (needsMarking)             sp.set('unmarked', '1')
    if (courseFilter)             sp.set('course', courseFilter)
    if (instructorFilter)         sp.set('instructor', instructorFilter)
    if (langFilter)               sp.set('lang', langFilter)
    if (search.trim())            sp.set('q', search.trim())
    if (page > 1)                 sp.set('page', String(page))
    const next = `${window.location.pathname}?${sp.toString()}`
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next)
    }
  }, [hydrated, dateFrom, dateTo, statusFilter, deliveryFilter, sort, needsMarking,
      courseFilter, instructorFilter, langFilter, search, page])

  /* Narrowing the filter can leave you on a page that no longer exists, which
     renders as an empty table rather than "no results". */
  useEffect(() => { setPage(1) }, [query])

  /* A selection must never outlive the rows it was made on. Keeping it across
     a filter or page change would let a bulk mark hit seats the operator can
     no longer see — the count would say 12 while the screen showed 3. */
  useEffect(() => { setSelected(new Set()) }, [query, page])

  const { data, isLoading } = useAdminBookings({ ...query, page, per_page: 150 })
  const { data: stats }     = useAdminBookingStats(query)

  const bookings: ClassBooking[] = data?.docs ?? []
  const totalPages  = data?.meta?.total_pages  ?? 1
  const totalCount  = data?.meta?.total_count  ?? 0

  /* Export covers the whole filter, not the loaded page, so it has to fetch
     before it can write. Disabled while running: a second click would start a
     competing walk and hand over two half-files. */
  const [exporting, setExporting] = useState<{ loaded: number; total: number } | null>(null)

  async function markSelected(status: 'attended' | 'missed') {
    const ids = [...selected]
    if (ids.length === 0 || bulk.isPending) return
    try {
      const r = await bulk.mutateAsync({ ids, status })
      setSelected(new Set())
      /* Report what the SERVER did, not what was asked. A seat cancelled in
         another tab is skipped, and claiming otherwise would be a lie the
         operator only discovers later. */
      if (r.updated === 0) toast.info('Nothing to update', 'Those seats were already marked or are no longer bookable.')
      else if (r.skipped > 0) toast.success(`Marked ${r.updated} ${status}`, `${r.skipped} skipped — already marked or no longer bookable.`)
      else toast.success(`Marked ${r.updated} ${status}`)
    } catch {
      toast.error('Could not update attendance', 'Nothing was changed. Please try again.')
    }
  }

  /* Bulk selection. Only undecided seats are selectable — marking an already
     attended seat is a no-op and marking a cancelled one would resurrect it. */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const bulk = useBulkAttendance()
  const toggleOne = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  async function handleExport() {
    if (exporting) return
    setExporting({ loaded: 0, total: totalCount })
    try {
      const { docs, truncated } = await fetchAllAdminBookings(query, {
        onProgress: (loaded, total) => setExporting({ loaded, total }),
      })
      /* Rows whose class or student was deleted are hidden in the table; keep
         them out of the file too, so the CSV and the screen agree. */
      const rows = docs.filter(b => !!b.liveClassId && !!b.userId)
      exportCSV(rows, `bookings-${toYMD(dateFrom)}-${toYMD(dateTo)}.csv`)
      if (truncated) {
        toast.info('Export truncated',
          'The file holds the first 20,000 bookings. Narrow the date range and export again for the rest.')
      }
    } catch {
      toast.error('Export failed', 'Nothing was downloaded. Please try again.')
    } finally {
      setExporting(null)
    }
  }

  const isCancelledView = statusFilter === 'cancelled'

  /* Search and delivery are server-side now. All this does is drop rows whose
     class or student was deleted: BookingRow renders null for those, but they
     still counted toward every "N bookings" badge, so a day heading could read
     "5 bookings" above four rows. */
  const filtered = useMemo(
    () => bookings.filter(b => !!b.liveClassId && !!b.userId),
    [bookings],
  )
  const orphanCount = bookings.length - filtered.length

  /* Group by date — cancelled bookings group by cancelledAt, others by scheduledStart */
  const dateGroups = useMemo(() => {
    const map = new Map<string, ClassBooking[]>()
    filtered.forEach(b => {
      const lc = b.liveClassId as typeof b.liveClassId | null
      const dateStr = isCancelledView
        ? (b.cancelledAt ?? b.bookedAt)
        : (lc?.scheduledStart ?? b.bookedAt)
      const key = toYMD(new Date(dateStr))
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(b)
    })
    /* Follow the chosen ordering instead of always ascending. The group order was
       hard-coded, so picking "latest first" re-sorted the page back to ascending
       on screen — the control said one thing and the table showed another.
       Cancelled keeps newest-cancellation-first, which is what that view is for. */
    const desc = isCancelledView || sort.startsWith('-')
    const keyOf = (b: ClassBooking) => new Date(
      isCancelledView
        ? (b.cancelledAt ?? b.bookedAt)
        : ((b.liveClassId as typeof b.liveClassId | null)?.scheduledStart ?? b.bookedAt),
    ).getTime()

    return Array.from(map.entries())
      .sort(([a], [b]) => (desc ? b.localeCompare(a) : a.localeCompare(b)))
      .map(([date, rows]) => ({
        date,
        heading: fmtHeading(date),
        rows: rows.sort((a, b) => (desc ? keyOf(b) - keyOf(a) : keyOf(a) - keyOf(b))),
      }))
  }, [filtered, isCancelledView, sort])

  const isSingleDay  = toYMD(dateFrom) === toYMD(dateTo)
  const isToday      = toYMD(dateFrom) === toYMD(new Date())
  const hasFilters   = !!(search || statusFilter || deliveryFilter !== 'all' || courseFilter || instructorFilter || langFilter || needsMarking)

  function shiftDay(n: number) { setDateFrom(d => dayStart(addDays(d, n))); setDateTo(d => dayEnd(addDays(d, n))); setPage(1) }
  function goToday() {
    setDateFrom(dayStart(new Date())); setDateTo(dayEnd(new Date())); setPage(1)
  }
  function clearFilters() {
    setSearch(''); setStatusFilter(''); setDeliveryFilter('all'); setCourseFilter(''); setInstructorFilter(''); setLangFilter(''); setNeedsMarking(false); setPage(1)
    // Restore default range: -30 days to +90 days
    setDateFrom(dayStart(addDays(new Date(), -30)))
    setDateTo(dayEnd(addDays(new Date(),  90)))
  }

  function handleStatusChange(val: BookingStatus | '') {
    setStatusFilter(val); setPage(1)
    // Cancelled bookings aren't tied to today — expand to all time automatically
    if (val === 'cancelled') {
      setDateFrom(new Date('2020-01-01T00:00:00'))
      setDateTo(new Date(Date.now() + 365 * 86_400_000))
    } else if (statusFilter === 'cancelled') {
      // Switching away from cancelled — restore default -30/+90 range
      const s = addDays(new Date(), -30); s.setHours(0,0,0,0)
      const e = addDays(new Date(),  90); e.setHours(23,59,59,999)
      setDateFrom(s); setDateTo(e)
    }
  }

  const setDateRange = (from: string, to: string) => {
    setDateFrom(ymdToStart(from))
    setDateTo(ymdToEnd(to))
    setPage(1)
  }

  /* Preset ranges */
  const presets = [
    { label: 'Today',      from: toYMD(new Date()),                                                                                   to: toYMD(new Date()) },
    { label: 'This week',  from: toYMD(addDays(new Date(), -3)),                                                                      to: toYMD(addDays(new Date(), 3)) },
    { label: 'This month', from: toYMD(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),                                  to: toYMD(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)) },
    { label: 'Upcoming',   from: toYMD(new Date()),                                                                                   to: toYMD(addDays(new Date(), 90)) },
    { label: 'All time',   from: '2020-01-01',                                                                                        to: toYMD(addDays(new Date(), 365)) },
  ]

  /* Styles */
  const inputStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.80)' }
  const inputCls   = 'rounded-xl px-3 py-1.5 text-xs font-medium outline-none focus:border-orange-400/50'

  const STATUS_OPTS: { value: BookingStatus | ''; label: string }[] = [
    { value: '',          label: 'All statuses' },
    { value: 'booked',    label: 'Booked'       },
    { value: 'attended',  label: 'Attended'     },
    { value: 'missed',    label: 'Missed'       },
    { value: 'cancelled', label: 'Cancelled'    },
  ]

  const SORT_OPTS: { value: NonNullable<AdminBookingParams['sort']>; label: string }[] = [
    { value: 'scheduledStart',  label: 'Session: earliest first' },
    { value: '-scheduledStart', label: 'Session: latest first'   },
    { value: '-bookedAt',       label: 'Recently booked'         },
    { value: 'bookedAt',        label: 'Oldest booked'           },
  ]

  const LANG_OPTS = ['English', 'Arabic', 'Hindi', 'Malayalam', 'Urdu']

  const TH_COLS = [
    { label: 'Student',    icon: <User size={10} />          },
    { label: 'Session',    icon: <Clock size={10} />         },
    { label: 'Course',     icon: <BookOpen size={10} />      },
    { label: 'Instructor', icon: <GraduationCap size={10} /> },
    { label: 'Booked on',  icon: <Calendar size={10} />,  cls: 'hidden lg:table-cell' },
    { label: 'Status',     icon: null                        },
    { label: '',           icon: null                        },
  ]

  /* Scope label for header */
  const scopeLabel = (me as any)?.categoryScope
    ? `${(me as any).categoryScope === 'digital-marketing' ? 'Digital Marketing' : 'FOREX'} Bookings`
    : isInstructor ? 'My Session Bookings' : 'All Bookings'

  return (
    <div className="mx-auto max-w-7xl pb-16">

      {/* ── Header ────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="mb-6 flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Bookings
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>{scopeLabel}</p>
        </div>

        {/* Date nav + presets */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick presets */}
          <div className="flex items-center gap-1 rounded-2xl p-1"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {presets.map(p => (
              <button key={p.label} type="button"
                onClick={() => setDateRange(p.from, p.to)}
                className="rounded-xl px-2.5 py-1 text-[11px] font-medium transition-colors"
                style={{
                  background: toYMD(dateFrom) === p.from && toYMD(dateTo) === p.to ? 'rgba(0,87,184,0.18)' : 'transparent',
                  color:      toYMD(dateFrom) === p.from && toYMD(dateTo) === p.to ? '#0057b8' : 'rgba(255,255,255,0.45)',
                }}>
                {p.label}
              </button>
            ))}
          </div>

          <input type="date" value={toYMD(dateFrom)}
            onChange={e => { if (!e.target.value) return; setDateFrom(ymdToStart(e.target.value)); setPage(1) }}
            className={inputCls} style={inputStyle} />
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.30)' }}>to</span>
          <input type="date" value={toYMD(dateTo)}
            onChange={e => { if (!e.target.value) return; setDateTo(ymdToEnd(e.target.value)); setPage(1) }}
            className={inputCls} style={inputStyle} />

          {isSingleDay && (
            <div className="flex items-center gap-1 rounded-2xl p-1"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <button type="button" onClick={() => shiftDay(-1)}
                className="flex h-7 w-7 items-center justify-center rounded-xl transition-colors hover:bg-white/10"
                style={{ color: 'rgba(255,255,255,0.50)' }}>
                <ChevronLeft size={14} />
              </button>
              {!isToday && (
                <button type="button" onClick={goToday}
                  className="px-2 text-xs font-semibold" style={{ color: '#0057b8' }}>
                  Today
                </button>
              )}
              <button type="button" onClick={() => shiftDay(1)}
                className="flex h-7 w-7 items-center justify-center rounded-xl transition-colors hover:bg-white/10"
                style={{ color: 'rgba(255,255,255,0.50)' }}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Stats ─────────────────────────────────────── */}
      {!isLoading && (bookings.length > 0 || needsMarking) && (
        <StatsStrip stats={stats} needsMarking={needsMarking}
          onNeedsMarking={on => { setNeedsMarking(on); setPage(1) }} />
      )}

      {/* ── Filter bar ───────────────────────────────── */}
      <div className="mb-5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'rgba(255,255,255,0.30)' }} />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search student, session, course…"
              className={`${inputCls} pl-8 pr-8 w-60`}
              style={inputStyle} />
            {search && (
              <button type="button" onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <X size={11} style={{ color: 'rgba(255,255,255,0.35)' }} />
              </button>
            )}
          </div>

          {/* Status */}
          <FilterSelect
            value={statusFilter}
            onChange={v => handleStatusChange(v as BookingStatus | '')}
            options={STATUS_OPTS}
            placeholder="All statuses"
            minWidth={130}
          />

          {/* Sort — the server does the ordering; this no longer re-sorts the
              page in the browser and calls it an ordering. */}
          <FilterSelect
            value={sort}
            onChange={v => { setSort(v as NonNullable<AdminBookingParams['sort']>); setPage(1) }}
            options={SORT_OPTS}
            placeholder="Sort"
            minWidth={165}
          />

          {/* Delivery filter — Online / In-Person */}
          <div className="flex items-center gap-0.5 rounded-2xl p-1"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {([
              { k: 'all'     as const, label: 'All',       icon: null },
              { k: 'online'  as const, label: 'Online',    icon: <Wifi size={10} /> },
              { k: 'offline' as const, label: 'In-Person', icon: <Building2 size={10} /> },
            ]).map(({ k, label, icon }) => (
              <button key={k} type="button"
                onClick={() => { setDeliveryFilter(k); setPage(1) }}
                className="flex items-center gap-1 rounded-xl px-3 py-1 text-[11px] font-semibold transition-all"
                style={deliveryFilter === k
                  ? k === 'offline'
                    ? { background: 'rgba(16,185,129,0.18)', color: '#10B981' }
                    : k === 'online'
                    ? { background: 'rgba(0,87,184,0.18)', color: '#0057b8' }
                    : { background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.85)' }
                  : { background: 'transparent', color: 'rgba(255,255,255,0.35)' }
                }>
                {icon}{label}
              </button>
            ))}
          </div>

          {/* More filters toggle */}
          <button type="button" onClick={() => setShowFilters(f => !f)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: showFilters ? 'rgba(0,87,184,0.12)' : 'rgba(255,255,255,0.05)',
              border:     `1px solid ${showFilters ? 'rgba(0,87,184,0.30)' : 'rgba(255,255,255,0.09)'}`,
              color:      showFilters ? '#0057b8' : 'rgba(255,255,255,0.55)',
            }}>
            <Filter size={12} />
            Filters
            {(courseFilter || instructorFilter || langFilter) && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                style={{ background: '#0057b8', color: 'white' }}>
                {[courseFilter, instructorFilter, langFilter].filter(Boolean).length}
              </span>
            )}
            <ChevronDown size={11} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>

          {hasFilters && (
            <button type="button" onClick={clearFilters}
              className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.06)' }}>
              <X size={11} /> Clear all
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.30)' }}>
              <LayoutList size={13} />
              {totalCount.toLocaleString()} booking{totalCount !== 1 ? 's' : ''}{orphanCount > 0 && <span style={{ opacity: 0.45 }}> · {orphanCount} hidden (deleted class or student)</span>}
            </span>
            {filtered.length > 0 && (
              <button type="button" onClick={handleExport} disabled={!!exporting}
                title={totalCount > bookings.length
                  ? `Exports all ${totalCount.toLocaleString()} bookings matching these filters, not just this page`
                  : 'Export these bookings as CSV'}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors hover:brightness-110 disabled:cursor-progress disabled:opacity-60"
                style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', color: '#818CF8' }}>
                <Download size={12} />
                {exporting
                  ? `Exporting ${exporting.loaded.toLocaleString()}/${(exporting.total || totalCount).toLocaleString()}…`
                  : totalCount > bookings.length ? `Export all ${totalCount.toLocaleString()}` : 'Export CSV'}
              </button>
            )}
          </div>
        </div>

        {/* Expanded filters — NOTE: no overflow-hidden here so absolute dropdowns aren't clipped */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="flex flex-wrap items-center gap-2 pb-1">
              {/* Course */}
              <FilterSelect
                value={courseFilter}
                onChange={v => { setCourseFilter(v); setPage(1) }}
                options={[{ value: '', label: 'All courses' }, ...courses.map(c => ({ value: c.id, label: c.title }))]}
                placeholder="All courses"
                minWidth={180}
              />

              {/* Instructor */}
              {!isInstructor && (
                <FilterSelect
                  value={instructorFilter}
                  onChange={v => { setInstructorFilter(v); setPage(1) }}
                  options={[{ value: '', label: 'All instructors' }, ...instructors.map(i => ({ value: i.id, label: i.name }))]}
                  placeholder="All instructors"
                  minWidth={160}
                />
              )}

              {/* Language */}
              <FilterSelect
                value={langFilter}
                onChange={v => { setLangFilter(v); setPage(1) }}
                options={[{ value: '', label: 'All languages' }, ...LANG_OPTS.map(l => ({ value: l, label: `${LANG_FLAG[l] ?? ''} ${l}` }))]}
                placeholder="All languages"
                minWidth={140}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Loading ───────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-24 text-sm"
          style={{ color: 'rgba(255,255,255,0.35)' }}>
          <Spinner size={20} />
          Loading bookings…
        </div>
      )}

      {/* ── Empty ─────────────────────────────────────── */}
      {!isLoading && filtered.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-3 rounded-3xl py-20 text-center"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(0,87,184,0.10)', border: '1px solid rgba(0,87,184,0.20)' }}>
            <Calendar size={24} style={{ color: '#0057b8' }} />
          </div>
          <p className="font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            No bookings found
          </p>
          <p className="max-w-xs text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {hasFilters
              ? 'Try adjusting or clearing the filters.'
              : 'No sessions are booked for the selected date range.'}
          </p>
          {hasFilters && (
            <button type="button" onClick={clearFilters}
              className="mt-1 rounded-xl px-4 py-2 text-xs font-semibold transition-colors hover:brightness-110"
              style={{ background: 'rgba(0,87,184,0.12)', border: '1px solid rgba(0,87,184,0.25)', color: '#0057b8' }}>
              Clear filters
            </button>
          )}
        </motion.div>
      )}

      {/* ── Day groups ────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {!isLoading && dateGroups.length > 0 && (
          <motion.div
            key={`${toYMD(dateFrom)}-${toYMD(dateTo)}-${search}-${statusFilter}-${courseFilter}-${instructorFilter}-${langFilter}`}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="space-y-6"
          >
            {dateGroups.map(group => (
              <div key={group.date}>
                {/* Date heading */}
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-xl"
                      style={{ background: 'rgba(0,87,184,0.12)' }}>
                      <Calendar size={13} style={{ color: '#0057b8' }} />
                    </div>
                    <h2 className="text-sm font-bold text-white"
                      style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                      {isCancelledView ? `Cancelled · ${group.heading}` : group.heading}
                    </h2>
                  </div>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ background: 'rgba(0,87,184,0.10)', color: '#0057b8' }}>
                    {group.rows.length} booking{group.rows.length !== 1 ? 's' : ''}
                  </span>
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />

                  {/* Per-day attended/missed ratio */}
                  {(() => {
                    const a = group.rows.filter(r => r.status === 'attended').length
                    const m = group.rows.filter(r => r.status === 'missed').length
                    const total = a + m
                    if (!total) return null
                    return (
                      <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        <span style={{ color: '#818CF8' }}>{a} attended</span>
                        {m > 0 && <> · <span style={{ color: '#FCD34D' }}>{m} missed</span></>}
                      </span>
                    )
                  })()}
                </div>

                {/* Table */}
                <div className="rounded-2xl overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px]">
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                          {(() => {
                            /* Scoped to THIS day, not the whole result set: a
                               header box that silently selected rows on other
                               days would be a trap. */
                            const ids  = group.rows.filter(r => r.status === 'booked').map(r => r.id)
                            const on   = ids.length > 0 && ids.every(id => selected.has(id))
                            const some = ids.some(id => selected.has(id))
                            return (
                              <th className="py-2.5 pl-5 pr-0 w-8"
                                style={{ background: 'rgba(255,255,255,0.02)' }}>
                                <input type="checkbox" checked={on} disabled={ids.length === 0}
                                  ref={el => { if (el) el.indeterminate = !on && some }}
                                  aria-label={`Select all bookings on ${group.heading}`}
                                  onChange={() => setSelected(prev => {
                                    const next = new Set(prev)
                                    if (on) ids.forEach(id => next.delete(id))
                                    else    ids.forEach(id => next.add(id))
                                    return next
                                  })}
                                  className="h-3.5 w-3.5 cursor-pointer accent-indigo-400 disabled:opacity-25" />
                              </th>
                            )
                          })()}
                          {TH_COLS.map((col, ci) => (
                            <th key={ci}
                              className={`py-2.5 px-3 text-left text-[10px] font-semibold uppercase tracking-widest first:pl-5 last:pr-5 ${col.cls ?? ''}`}
                              style={{ color: 'rgba(255,255,255,0.30)', background: 'rgba(255,255,255,0.02)' }}>
                              <span className="flex items-center gap-1">
                                {col.icon}{col.label}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((b, i) => (
                          <BookingRow key={b.id} booking={b} index={i}
                            selectable={b.status === 'booked'}
                            selected={selected.has(b.id)}
                            onToggle={toggleOne} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ))}

            {/* Bulk action bar — only while something is selected. Sticky at the
                bottom so it stays reachable on a long day list. */}
            <AnimatePresence>
              {selected.size > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  className="sticky bottom-4 z-20 mx-auto flex w-fit items-center gap-2 rounded-2xl px-3 py-2 backdrop-blur"
                  style={{ background: 'rgba(18,18,22,0.92)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 32px rgba(0,0,0,0.45)' }}>
                  <span className="px-1 text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>
                    {selected.size} selected
                  </span>
                  <span className="h-4 w-px" style={{ background: 'rgba(255,255,255,0.12)' }} />
                  <button type="button" onClick={() => markSelected('attended')} disabled={bulk.isPending}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors hover:brightness-125 disabled:opacity-50"
                    style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#818CF8' }}>
                    <CheckCircle2 size={12} /> Mark attended
                  </button>
                  <button type="button" onClick={() => markSelected('missed')} disabled={bulk.isPending}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors hover:brightness-125 disabled:opacity-50"
                    style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#FCD34D' }}>
                    <XCircle size={12} /> Mark missed
                  </button>
                  <button type="button" onClick={() => setSelected(new Set())} disabled={bulk.isPending}
                    aria-label="Clear selection"
                    className="rounded-xl px-2 py-1.5 transition-colors hover:bg-white/10 disabled:opacity-50"
                    style={{ color: 'rgba(255,255,255,0.45)' }}>
                    <X size={13} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors disabled:opacity-30"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
                  <ChevronLeft size={14} style={{ color: 'rgba(255,255,255,0.60)' }} />
                </button>
                <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.40)' }}>
                  {totalCount === 0 ? 'No results' : `Showing ${(page - 1) * 150 + 1}–${Math.min(page * 150, totalCount)} of ${totalCount.toLocaleString()}`}
                </span>
                <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors disabled:opacity-30"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
                  <ChevronRight size={14} style={{ color: 'rgba(255,255,255,0.60)' }} />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
