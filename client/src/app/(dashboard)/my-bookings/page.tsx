'use client'

/* ─────────────────────────────────────────────────────────────────────────
   /my-bookings — the student's FULL booking history.

   THE SHAPE OF THE SCREEN, AND WHY

   The page this replaces asked the SERVER a different question per tab
   (`/bookings/me?status=attended`, then `?status=missed`, …). Three costs
   came out of that, and all three are gone here:

     · the tabs could not carry COUNTS — the browser only ever held one tab's
       worth of rows, so "Attended 12" was unwriteable;
     · switching tabs re-fetched, so a history you were scrolling flickered
       back to a spinner to show rows it had already been given;
     · an attendance rate was impossible — it needs `attended` and `missed`
       in the same array.

   So: ONE request for the whole history, and every tab, count, group and
   statistic below is a `useMemo` pass over that single array. Nothing here
   touches the network again except the cancel mutation.

   THE CLOCK IS THE AUTHORITY, NOT THE STORED STATUS.
   A seat is written `booked` when it is taken and only moves to
   `attended`/`missed` when a human takes the register — which can be days
   later, or never. Filing last Tuesday's class under "Upcoming" because the
   row still says `booked` would put a finished class at the top of the page.
   `classify()` is the single place that rule lives, and the clock it reads is
   the SERVER's (`useServerNow`), so a device clock that is a day out cannot
   move a class either.

   THERE IS DELIBERATELY NO JOIN BUTTON.
   Joining reads a window this row does not carry: `GET /bookings/me` omits
   `meetingUrl` on purpose, because serving it here would be a way to read the
   link without ever being let in. Join lives on the Class Schedule, beside
   the live-class row that owns the window.
   ───────────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertCircle, AlertTriangle, ArrowRight, Ban, CalendarDays, CalendarX2,
  CheckCircle2, Clock, Globe, History, Hourglass, Layers, MapPin, Radio,
  RotateCw, Search, Target, Ticket, Video, X, XCircle,
} from 'lucide-react'
import { useMyBookings, useCancelBooking, type MyBooking } from '@/lib/api/bookings'
import { useServerNow } from '@/hooks/useServerNow'
import { APP_TIMEZONE } from '@/lib/timezone'
import { titleCase } from '@/lib/titleCase'
import { AvatarImg } from '@/components/ui/AvatarImg'
import { useToast } from '@/store/ui.store'
import Spinner from '@/components/ui/Spinner'

/* ── Type faces ───────────────────────────────────────────────────────────
   Syne/DM Sans are declared per-page in this app (the Class Schedule carries
   the same block). The @import is deduplicated by the browser and the rule
   bodies are identical, so carrying it twice across a navigation costs
   nothing — but if a third screen needs them, lift this into globals.css and
   delete both copies rather than pasting it again.

   The focus rule is here for a real reason: the global `:focus-visible` ring
   is `--color-primary` (#0057b8), which is the SAME blue in dark mode and
   nearly invisible against #0B0D14. Inside this page the ring uses
   `--color-primary-on-surface`, which is the token that actually lifts. */
const PAGE_CSS = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap');.syne{font-family:'Syne',sans-serif}.dm{font-family:'DM Sans',sans-serif}.bk-focus:focus-visible{outline:2px solid var(--color-primary-on-surface)!important;outline-offset:2px;border-radius:8px}.bk-row{transition:background-color .15s ease}.bk-row:hover{background:var(--color-bg-inset)}@media (prefers-reduced-motion:reduce){.bk-row{transition:none}}`
// eslint-disable-next-line react/no-danger
const PageStyle = () => <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />

/* ── House chrome ───────────────────────────────────────────────────────── */

const SPRING = { type: 'spring' as const, stiffness: 280, damping: 26 }

/* THE GOTCHA THIS FILE HAS ALREADY BEEN BITTEN BY: a top-level `transition`
   prop is also framer's default for whileHover/whileTap. An entry delay put
   there makes the hover lift wait for it, and the card feels broken under the
   cursor. Every entry animation on this page therefore puts its transition
   INSIDE the animate target, and a sibling `transition` only ever carries the
   hover spring. */
const HOVER_SPRING = { type: 'spring' as const, stiffness: 350, damping: 28 }
const LIFT = { y: -3, boxShadow: '0 16px 40px rgba(0,0,0,0.09)' }

const CARD: React.CSSProperties = {
  background: 'var(--color-bg-surface)',
  border:     '1px solid var(--color-border)',
  boxShadow:  '0 1px 4px rgba(0,0,0,0.04)',
}

/* Blue TEXT needs lifting in the dark; blue FILLS do not. `--color-primary`
   is the same #0057b8 in both themes on purpose, so ink routes through
   `--color-primary-on-surface` and washes stay literal rgba(). */
const BLUE_INK = 'var(--color-primary-on-surface, var(--color-primary))'

/* ── Formatting ───────────────────────────────────────────────────────────
   Intl formatters are expensive to construct and this list is built to hold a
   year of history, so they are made ONCE at module scope rather than per row.
   Each is pinned to APP_TIMEZONE — on this app that is the student's own
   device zone — so the day a class files under and the time printed on it can
   never disagree. */
const f = (o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: APP_TIMEZONE, ...o })

const FMT = {
  day:      f({ day: 'numeric' }),
  mon:      f({ month: 'short' }),
  weekday:  f({ weekday: 'short' }),
  time:     f({ hour: 'numeric', minute: '2-digit' }),
  monthYr:  f({ month: 'long', year: 'numeric' }),
  stamp:    f({ day: 'numeric', month: 'short', year: 'numeric' }),
  /** MM/DD/YYYY in the student's zone — what the month grouping keys on. */
  key:      f({ year: 'numeric', month: '2-digit', day: '2-digit' }),
}

const MS_MIN = 60_000

/** "1h 30m", "45m", "2h". */
function fmtDuration(mins: number): string {
  if (!mins || mins < 0) return ''
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** "09/20/2026" → "2026-09". */
function monthKeyOf(ms: number): string {
  const [mm, , yyyy] = FMT.key.format(ms).split('/')
  return `${yyyy}-${mm}`
}

/* ── One row's worth of derived truth ─────────────────────────────────────
   Everything on `Row` is clock-INDEPENDENT, so it is computed once per fetch
   rather than on every 30-second tick. Anything that depends on "now" lives
   in `classify()` below. */

interface Row {
  booking:     MyBooking
  start:       number
  end:         number
  monthKey:    string
  monthLabel:  string
  day:         string
  mon:         string
  weekday:     string
  timeRange:   string
  duration:    string
  course?:     string
  module?:     string
  moduleNo?:   number
  instructor?: { name: string; avatarUrl?: string }
  language?:   string
  online:      boolean
  place?:      string
  bookedOn:    string
  cancelledOn?: string
  /** Lower-cased course / module / class / instructor — what search matches. */
  haystack:    string
}

/* A booking OUTLIVES the rows it points at. If an admin deletes the class,
   `liveClassId` comes back unpopulated (null) and there is no title, no clock
   and no course left to print — so the row is dropped rather than rendered as
   a shell of undefineds, and the page says how many it dropped instead of
   quietly disagreeing with the student's own count. */
function toRow(b: MyBooking): Row | null {
  const lc = b?.liveClassId
  if (!lc || typeof lc !== 'object' || !lc.scheduledStart) return null

  const startDate = new Date(lc.scheduledStart)
  const start = startDate.getTime()
  if (Number.isNaN(start)) return null

  const mins   = lc.durationMins > 0 ? lc.durationMins : 60
  const end    = start + mins * MS_MIN
  /* CLAUDE.md: `isOnline: false` is the in-person marker. Absent means
     online, which is what every class was before the field existed. */
  const online = lc.isOnline !== false
  const place  = [lc.location, lc.room].filter(Boolean).map(s => titleCase(String(s))).join(' · ')

  const course     = lc.courseId?.title  ? titleCase(lc.courseId.title)  : undefined
  const module     = lc.sectionId?.title ? titleCase(lc.sectionId.title) : undefined
  const instructor = lc.instructorId?.name
    ? { name: titleCase(lc.instructorId.name), avatarUrl: lc.instructorId.avatarUrl }
    : undefined

  const bookedMs    = b.bookedAt    ? new Date(b.bookedAt).getTime()    : NaN
  const cancelledMs = b.cancelledAt ? new Date(b.cancelledAt).getTime() : NaN

  return {
    booking:     b,
    start,
    end,
    monthKey:    monthKeyOf(start),
    monthLabel:  FMT.monthYr.format(start),
    day:         FMT.day.format(start),
    mon:         FMT.mon.format(start).toUpperCase(),
    weekday:     FMT.weekday.format(start),
    timeRange:   `${FMT.time.format(start)} – ${FMT.time.format(end)}`,
    duration:    fmtDuration(mins),
    course,
    module,
    moduleNo:    lc.sectionId?.order,
    instructor,
    language:    lc.language ? titleCase(lc.language) : undefined,
    online,
    place:       online ? undefined : (place || undefined),
    bookedOn:    Number.isNaN(bookedMs)    ? '' : FMT.stamp.format(bookedMs),
    cancelledOn: Number.isNaN(cancelledMs) ? undefined : FMT.stamp.format(cancelledMs),
    haystack: [course, module, lc.title, instructor?.name]
      .filter(Boolean).join(' ').toLowerCase(),
  }
}

/* ── What became of this seat ─────────────────────────────────────────────

   Seven outcomes, resolved in precedence order, because more than one can be
   true at once — a seat you cancelled for a class the academy then also
   cancelled is, to you, still "you cancelled it".

     cancelled   you released the seat
     attended    the register says you were there
     missed      the register says you were not
     called-off  the ACADEMY cancelled the class under your booking
     live        the class is running right now
     unmarked    the class has finished and nobody took the register
     booked      still ahead of the clock

   `unmarked` is the honest name for a row stored as 'booked' whose class is
   over. Calling it "missed" would be inventing a fact the server has not
   stated; calling it "booked" would put a finished class under Upcoming. It
   therefore appears in All and in no attendance tab, because it is genuinely
   in no attendance bucket — and it is excluded from the attendance rate for
   the same reason. */

type Kind = 'booked' | 'live' | 'attended' | 'missed' | 'cancelled' | 'called-off' | 'unmarked'

interface Verdict {
  kind:  Kind
  /** 'upcoming' = still on your calendar. Everything else is history. */
  lane:  'upcoming' | 'past'
  label: string
  /** Light-mode triple, used ONLY for the 8%/20% wash a badge sits on — a
      translucent tint reads correctly over #FFFFFF and #12151F alike. The
      SOLID hue is always a token, because that is what moves between themes. */
  rgb:   string
  ink:   string
  Icon:  typeof CheckCircle2
  note?: string
}

function classify(r: Row, now: number): Verdict {
  const lc = r.booking.liveClassId
  const s  = r.booking.status

  if (s === 'cancelled')
    return { kind: 'cancelled', lane: 'past', label: 'Cancelled', rgb: '156,163,175', ink: 'var(--color-text-muted)', Icon: Ban }
  if (s === 'attended')
    return { kind: 'attended', lane: 'past', label: 'Attended', rgb: '14,204,142', ink: 'var(--color-success)', Icon: CheckCircle2 }
  if (s === 'missed')
    return { kind: 'missed', lane: 'past', label: 'Missed', rgb: '239,68,68', ink: 'var(--color-danger)', Icon: XCircle }
  if (lc.status === 'cancelled')
    return {
      kind: 'called-off', lane: 'past', label: 'Class cancelled', rgb: '245,158,11',
      ink: 'var(--color-warning)', Icon: CalendarX2,
      note: 'This class was cancelled by the academy. Your seat was released automatically.',
    }
  /* 'live' is the server's word and it owns it: a class can be live a little
     before or after its printed slot. */
  if (lc.status === 'live')
    return { kind: 'live', lane: 'upcoming', label: 'Live now', rgb: '239,68,68', ink: 'var(--color-danger)', Icon: Radio }

  /* Over is decided by the END of the class, not the start, so a session that
     began ten minutes ago is still the one you care about. `ended` is trusted
     when it is set, because the cron that sets it can be late but is never
     early. */
  const over = now >= r.end || lc.status === 'ended'
  if (over)
    return {
      kind: 'unmarked', lane: 'past', label: 'No record', rgb: '245,158,11',
      ink: 'var(--color-warning)', Icon: Hourglass,
      note: 'The class has finished — attendance has not been recorded yet.',
    }

  return { kind: 'booked', lane: 'upcoming', label: 'Booked', rgb: '0,87,184', ink: BLUE_INK, Icon: Ticket }
}

/* CANCEL IS A STRICTER TEST THAN "UPCOMING", and the difference is deliberate.
   The grouping keeps a class on the upcoming side until it ENDS; you may not
   cancel it once it has STARTED, because walking out is not the same as
   freeing a seat somebody else could have taken. The server refuses anything
   else with CANNOT_CANCEL, and a button that only ever produces an error is
   worse than no button. `now` is the server clock, not `Date.now()`. */
function canCancel(r: Row, v: Verdict, now: number): boolean {
  return r.booking.status === 'booked' && v.kind === 'booked' && now < r.start
}

/* ── Small parts ────────────────────────────────────────────────────────── */

function Badge({ v }: { v: Verdict }) {
  const reduce = useReducedMotion()
  const pulse  = v.kind === 'live' && !reduce
  return (
    <span
      title={v.note}
      className="dm inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `rgba(${v.rgb},0.08)`, border: `1px solid rgba(${v.rgb},0.20)`, color: v.ink }}
    >
      {pulse ? (
        <motion.span className="flex" animate={{ opacity: [1, 0.35, 1] }}
          transition={{ duration: 1.4, repeat: Infinity }}>
          <v.Icon size={10} strokeWidth={2.5} />
        </motion.span>
      ) : (
        <v.Icon size={10} strokeWidth={2.5} />
      )}
      {v.label}
    </span>
  )
}

function Meta({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {icon}<span className="truncate">{children}</span>
    </span>
  )
}

function StatTile({ icon, value, label, accent, meter, className = '' }: {
  icon: React.ReactNode
  value: string
  label: string
  accent?: boolean
  meter?: number | null
  className?: string
}) {
  const reduce = useReducedMotion()
  return (
    <div
      className={`flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 ${className}`}
      style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)' }}
    >
      <span
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
        style={accent
          ? { background: 'rgba(0,87,184,0.09)', border: '1px solid rgba(0,87,184,0.18)', color: BLUE_INK }
          : { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="syne block truncate text-[14px] font-extrabold leading-tight tabular-nums"
          style={{ color: 'var(--color-text-primary)' }}>{value}</span>
        <span className="dm block truncate text-[9px] font-bold uppercase tracking-[0.12em]"
          style={{ color: 'var(--color-text-muted)' }}>{label}</span>
        {meter != null && (
          <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full"
            style={{ background: 'var(--color-bg-subtle)' }}>
            <motion.span
              className="block h-full rounded-full"
              style={{ background: 'var(--color-success)' }}
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${meter}%`, transition: { duration: 0.6, ease: 'easeOut' } }}
            />
          </span>
        )}
      </span>
    </div>
  )
}

/* Cancel, as ONE focusable element.

   The house rule is one tab stop per row, which rules out a Cancel/Keep pair
   sitting beside each other. The same safety comes from arming the single
   button: the first press turns it red and reads "Confirm", the second
   releases the seat, and it disarms itself after five seconds so a stray
   press cannot sit there waiting to be completed by an unrelated one. The
   accessible name changes with the state, so a screen reader is never told
   "Cancel" while the button is actually armed to confirm. */
function CancelSeat({ booking }: { booking: MyBooking }) {
  const cancel = useCancelBooking()
  const toast  = useToast()
  const [armed, setArmed] = useState(false)
  const title = titleCase(booking.liveClassId.title)

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 5_000)
    return () => clearTimeout(t)
  }, [armed])

  const onClick = async () => {
    if (!armed) { setArmed(true); return }
    try {
      await cancel.mutateAsync(booking.id)
      toast.success('Seat released', `Your seat for ${title} has been cancelled.`)
    } catch (err: any) {
      toast.error(
        'Could not cancel',
        err?.response?.data?.error?.message ?? 'Please try again in a moment.',
      )
    } finally {
      setArmed(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={cancel.isPending}
      aria-label={armed ? `Confirm cancelling your seat for ${title}` : `Cancel your seat for ${title}`}
      className="bk-focus dm inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors disabled:opacity-60"
      style={armed
        ? { background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.32)', color: 'var(--color-danger)' }
        : { background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
    >
      {cancel.isPending ? <Spinner size={10} variant="gray" /> : <X size={11} strokeWidth={2.25} />}
      {armed ? 'Confirm' : 'Cancel'}
    </button>
  )
}

/* ── One booking ────────────────────────────────────────────────────────── */

function BookingRow({ row, now }: { row: Row; now: number }) {
  const b   = row.booking
  const lc  = b.liveClassId
  const v   = classify(row, now)
  const dim = v.kind === 'cancelled' || v.kind === 'called-off'

  return (
    <li
      className="bk-row flex items-start gap-3 px-3 py-3 sm:px-4"
      style={{ borderTop: '1px solid var(--color-border)', opacity: dim ? 0.82 : 1 }}
    >
      {/* The scan anchor. Reading a year of history is reading a date column,
          so it gets a fixed width and never wraps. */}
      <div className="w-[46px] flex-shrink-0 rounded-xl py-1.5 text-center"
        style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)' }}>
        <span className="dm block text-[9px] font-bold uppercase tracking-[0.1em]"
          style={{ color: 'var(--color-text-muted)' }}>{row.mon}</span>
        <span className="syne block text-[15px] font-extrabold leading-none tabular-nums"
          style={{ color: 'var(--color-text-primary)' }}>{row.day}</span>
        <span className="dm block text-[9px] font-semibold"
          style={{ color: 'var(--color-text-muted)' }}>{row.weekday}</span>
      </div>

      <div className="min-w-0 flex-1">
        {/* Course › module. The context sits ABOVE the class title because
            "Session 4" means nothing without it. Both are optional: a class
            can be filed under no module, and a deleted course leaves the
            reference unpopulated. */}
        {(row.course || row.module) && (
          <p className="dm flex min-w-0 flex-wrap items-center gap-x-1 text-[10px] font-bold uppercase tracking-[0.09em]"
            style={{ color: BLUE_INK }}>
            <span className="min-w-0 max-w-full truncate">{row.course ?? 'General session'}</span>
            {row.module && (
              <>
                <span aria-hidden className="h-1 w-1 flex-shrink-0 rounded-full"
                  style={{ background: 'var(--color-border)' }} />
                <span className="inline-flex min-w-0 items-center gap-1"
                  style={{ color: 'var(--color-text-muted)' }}>
                  <Layers size={10} strokeWidth={2.25} className="flex-shrink-0" />
                  <span className="truncate">
                    {row.moduleNo != null ? `${String(row.moduleNo).padStart(2, '0')} · ` : ''}{row.module}
                  </span>
                </span>
              </>
            )}
          </p>
        )}

        {/* Wraps rather than truncates. The line above may be clipped — it is
            context — but the name of the class IS the row, and a narrow phone
            would otherwise leave "Introduction to Candlestick Pat…". */}
        <p className="syne mt-0.5 line-clamp-2 break-words text-[13px] font-bold leading-snug"
          style={{ color: dim ? 'var(--color-text-secondary)' : 'var(--color-text-primary)' }}>
          {titleCase(lc.title)}
        </p>

        {/* When, how long, in what language, and where. */}
        <div className="dm mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]"
          style={{ color: 'var(--color-text-secondary)' }}>
          <Meta icon={<Clock size={11} strokeWidth={2} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />}>
            {row.timeRange}
          </Meta>
          {row.duration && (
            <span style={{ color: 'var(--color-text-muted)' }}>{row.duration}</span>
          )}
          {row.language && (
            <Meta icon={<Globe size={11} strokeWidth={2} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />}>
              {row.language}
            </Meta>
          )}
          {row.online ? (
            <Meta icon={<Video size={11} strokeWidth={2} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />}>
              Online
            </Meta>
          ) : (
            <Meta icon={<MapPin size={11} strokeWidth={2} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />}>
              {row.place ?? 'In person'}
            </Meta>
          )}
        </div>

        {row.instructor && (
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
            <AvatarImg
              src={row.instructor.avatarUrl}
              name={row.instructor.name}
              className="h-[18px] w-[18px] flex-shrink-0 rounded-full object-cover"
              fallbackClassName="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
              fallbackStyle={{ background: 'rgba(0,87,184,0.10)', border: '1px solid rgba(0,87,184,0.20)', color: BLUE_INK }}
            />
            <span className="dm truncate text-[11px] font-semibold"
              style={{ color: 'var(--color-text-secondary)' }}>
              {row.instructor.name}
            </span>
          </div>
        )}

        {/* The paper trail — quietest line on the row on purpose. It answers
            "when did I do this", it is not something to scan past. */}
        {(row.bookedOn || row.cancelledOn) && (
          <p className="dm mt-1.5 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            {row.bookedOn && <>Booked {row.bookedOn}</>}
            {row.bookedOn && row.cancelledOn && ' · '}
            {row.cancelledOn && <>Cancelled {row.cancelledOn}</>}
          </p>
        )}

        {v.note && (
          <p className="dm mt-1.5 flex items-start gap-1.5 text-[10px] leading-relaxed"
            style={{ color: 'var(--color-text-muted)' }}>
            <AlertTriangle size={11} strokeWidth={2} className="mt-px flex-shrink-0"
              style={{ color: 'var(--color-warning)' }} />
            {v.note}
          </p>
        )}
      </div>

      {/* Status, and the one thing you may still do about it. */}
      <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
        <Badge v={v} />
        {canCancel(row, v, now) && <CancelSeat booking={b} />}
      </div>
    </li>
  )
}

/* ── A run of rows under one heading ────────────────────────────────────── */

function Group({ title, rows, now, accent, index }: {
  title: string
  rows: Row[]
  now: number
  accent?: boolean
  index: number
}) {
  const reduce = useReducedMotion()
  return (
    <motion.section
      className="overflow-hidden rounded-2xl"
      style={CARD}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      /* Delay lives INSIDE the animate target — see HOVER_SPRING above. This
         group deliberately does NOT take the house hover-lift: it is a
         container that can be thirty rows tall, and lifting a whole screen of
         history because the cursor crossed it reads as a glitch. The lift is
         for things you click. What a ledger wants instead is a ROW hover, and
         that is the `.bk-row` rule in PAGE_CSS — a background change, so it
         costs no layout and does not fight the scroll. */
      animate={{ opacity: 1, y: 0, transition: { ...SPRING, delay: Math.min(index, 6) * 0.04 } }}
    >
      <header className="flex items-center gap-2.5 px-3 py-2 sm:px-4"
        style={{ background: 'var(--color-bg-inset)' }}>
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md"
          style={accent
            ? { background: 'rgba(0,87,184,0.10)', color: BLUE_INK }
            : { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}>
          {accent ? <CalendarDays size={11} strokeWidth={2.5} /> : <History size={11} strokeWidth={2.5} />}
        </span>
        <h2 className="syne truncate text-[11px] font-extrabold uppercase tracking-[0.14em]"
          style={{ color: accent ? BLUE_INK : 'var(--color-text-secondary)' }}>
          {title}
        </h2>
        <span aria-hidden className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
        <span className="dm flex-shrink-0 text-[10px] font-semibold tabular-nums"
          style={{ color: 'var(--color-text-muted)' }}>
          {rows.length} {rows.length === 1 ? 'class' : 'classes'}
        </span>
      </header>

      <ul className="m-0 list-none p-0">
        {rows.map(r => <BookingRow key={r.booking.id} row={r} now={now} />)}
      </ul>
    </motion.section>
  )
}

/* ── Tabs ─────────────────────────────────────────────────────────────────
   Deliberately NOT role="tablist". That contract promises arrow-key roving
   focus and an owned tabpanel; without both, a screen-reader user is told to
   press arrows and nothing happens. These are what they actually are —
   toggle buttons over one list — so they use aria-pressed, which is honest
   and keyboard-correct with no extra machinery. */

type TabKey = 'all' | 'upcoming' | 'attended' | 'missed' | 'cancelled'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'upcoming',  label: 'Upcoming' },
  { key: 'attended',  label: 'Attended' },
  { key: 'missed',    label: 'Missed' },
  { key: 'cancelled', label: 'Cancelled' },
]

/** Which tab a row belongs to. Upcoming reads the CLOCK; the other three read
    the register, because the register is exactly what the student came to
    check. */
function matchesTab(v: Verdict, status: MyBooking['status'], tab: TabKey): boolean {
  if (tab === 'all')      return true
  if (tab === 'upcoming') return v.lane === 'upcoming'
  return status === tab
}

function Tabs({ value, onChange, counts }: {
  value: TabKey
  onChange: (k: TabKey) => void
  counts: Record<TabKey, number>
}) {
  return (
    /* Wraps rather than scrolls at 375px: a hidden horizontal scroller is a
       tab you cannot find, and five chips on two lines cost nothing. */
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter bookings">
      {TABS.map(t => {
        const on = value === t.key
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(t.key)}
            className="bk-focus dm inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
            style={on
              ? { background: 'rgba(0,87,184,0.08)', border: '1px solid rgba(0,87,184,0.20)', color: BLUE_INK }
              : { background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
          >
            {t.label}
            <span className="text-[10px] font-bold tabular-nums" style={{ opacity: on ? 0.8 : 0.65 }}>
              {counts[t.key]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ── States with nothing in them ────────────────────────────────────────── */

const EMPTY_COPY: Record<TabKey, { title: string; body: string; cta: boolean }> = {
  all:       { title: 'No bookings yet',      body: 'Every class you reserve a seat for is recorded here — before it runs, and long after.', cta: true },
  upcoming:  { title: 'Nothing booked ahead', body: 'You have no seats reserved for a class that has not run yet.', cta: true },
  attended:  { title: 'No attended classes',  body: 'Classes you show up to appear here once your instructor takes the register.', cta: false },
  missed:    { title: 'Nothing missed',       body: 'A class you booked but did not attend would be listed here.', cta: false },
  cancelled: { title: 'No cancellations',     body: 'Seats you release before a class starts are kept here for your records.', cta: false },
}

function EmptyState({ tab, search, onClear }: {
  tab: TabKey
  search: string
  onClear: () => void
}) {
  const reduce = useReducedMotion()
  const searching = search.trim().length > 0
  const copy = searching
    ? { title: 'Nothing matches that', body: `No booking in ${tab === 'all' ? 'your history' : `the ${tab} tab`} mentions “${search.trim()}”.`, cta: false }
    : EMPTY_COPY[tab]

  return (
    <motion.div
      className="flex flex-col items-center gap-4 rounded-2xl px-6 py-16 text-center"
      style={CARD}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: SPRING }}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(0,87,184,0.07)', border: '1px solid rgba(0,87,184,0.14)' }}>
        {searching
          ? <Search size={22} strokeWidth={1.75} style={{ color: BLUE_INK }} />
          : <CalendarDays size={22} strokeWidth={1.75} style={{ color: BLUE_INK }} />}
      </span>
      <div className="max-w-sm">
        <p className="syne text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {copy.title}
        </p>
        <p className="dm mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {copy.body}
        </p>
      </div>

      {searching ? (
        <button type="button" onClick={onClear}
          className="bk-focus dm rounded-full px-3 py-1.5 text-[12px] font-semibold"
          style={{ background: 'rgba(0,87,184,0.08)', border: '1px solid rgba(0,87,184,0.20)', color: BLUE_INK }}>
          Clear search
        </button>
      ) : copy.cta ? (
        <motion.div className="rounded-full"
          whileHover={reduce ? undefined : LIFT}
          whileTap={reduce ? undefined : { scale: 0.99 }}
          transition={HOVER_SPRING}>
          <Link href="/class-bookings"
            className="bk-focus dm inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-bold"
            style={{ background: 'var(--color-primary)', color: 'var(--color-text-inverse, #ffffff)' }}>
            Browse the class schedule
            <ArrowRight size={13} strokeWidth={2.5} />
          </Link>
        </motion.div>
      ) : null}
    </motion.div>
  )
}

function LoadingState() {
  return (
    <div className="overflow-hidden rounded-2xl" style={CARD} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your booking history…</span>
      <div className="px-3 py-2 sm:px-4" style={{ background: 'var(--color-bg-inset)' }}>
        <span className="block h-3 w-32 animate-pulse rounded-full" style={{ background: 'var(--color-bg-subtle)' }} />
      </div>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="flex items-start gap-3 px-3 py-3 sm:px-4"
          style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="h-12 w-[46px] flex-shrink-0 animate-pulse rounded-xl"
            style={{ background: 'var(--color-bg-subtle)' }} />
          <div className="min-w-0 flex-1 space-y-2 py-0.5">
            <span className="block h-2.5 w-1/3 animate-pulse rounded-full" style={{ background: 'var(--color-bg-subtle)' }} />
            <span className="block h-3 w-2/3 animate-pulse rounded-full" style={{ background: 'var(--color-bg-subtle)' }} />
            <span className="block h-2.5 w-1/2 animate-pulse rounded-full" style={{ background: 'var(--color-bg-subtle)' }} />
          </div>
          <span className="h-5 w-16 flex-shrink-0 animate-pulse rounded-full" style={{ background: 'var(--color-bg-subtle)' }} />
        </div>
      ))}
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────────
   The server caps `per_page` at 100 (bookingQuerySchema: `.max(100)`), so
   asking for 200 is a 400, not a longer list. This asks for the ceiling and
   SAYS SO when a history runs past it, rather than presenting 100 rows as a
   complete record. Note the ordering subtlety: the server sorts by
   `bookedAt desc`, so the window is the 100 most recently BOOKED seats, which
   on a very long history is not the same as the 100 most recent classes. */
const PAGE_SIZE = 100

export default function MyBookingsPage() {
  const reduce = useReducedMotion()
  const [tab, setTab]       = useState<TabKey>('all')
  const [search, setSearch] = useState('')

  /* APP_TIMEZONE is the DEVICE zone in the browser and the SERVER's zone
     during Next's prerender — Asia/Dubai in production. Printing it straight
     into the first render hands React "Asia/Dubai" from the server and
     "Asia/Kolkata" from a student in Bangalore: a hydration mismatch that
     only ever fires for the students who are not in Dubai. So the label waits
     for the client. (Every other formatted date on this page sits behind
     react-query, which has no data during prerender, so this is the one
     exposed spot.) */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  /* ONE query, no `status` param. Every tab below is a filter over this one
     array — no refetch on tab change, and therefore counts that can exist. */
  const { data, isLoading, isError, refetch, isFetching } = useMyBookings({ per_page: PAGE_SIZE })

  /* Server-anchored and ticking every 30s: a class crossing from upcoming to
     past while the page is open should move by itself, and a device clock
     that is days out must not be able to move it. */
  const now = useServerNow(30_000)

  /* Clock-independent work: once per fetch, not once per tick. */
  const docs = data?.docs
  const rows = useMemo(
    () => (docs ?? []).map(toRow).filter((r): r is Row => r !== null),
    [docs],
  )
  /* Bookings whose class row is gone. Nothing truthful is left to draw, but
     silently dropping them would make the totals disagree with the student's
     own count, so the page owns up to it in a footnote. */
  const orphaned = (docs?.length ?? 0) - rows.length

  /* Profile-level figures — over the WHOLE history, never the current tab or
     search, because they describe the student and not the filter. */
  const stats = useMemo(() => {
    let attended = 0, missed = 0, cancelled = 0
    for (const r of rows) {
      const s = r.booking.status
      if (s === 'attended') attended++
      else if (s === 'missed') missed++
      else if (s === 'cancelled') cancelled++
    }
    /* ONLY over classes that have actually HAPPENED. Dividing by every
       booking would treat next month's seats as absences and greet a brand
       new student with 0% on the day they join — wrong, and discouraging. */
    const settled = attended + missed
    return {
      total: rows.length,
      attended, missed, cancelled,
      rate: settled > 0 ? Math.round((attended / settled) * 100) : null,
    }
  }, [rows])

  /* Search FIRST, then count, so a tab count always describes what pressing
     that tab would actually show. A tab reading "Attended 12" that opens
     empty because of the search box is a bug report waiting to happen. */
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? rows.filter(r => r.haystack.includes(q)) : rows
  }, [rows, search])

  /* One classify() pass, reused by the counts and the grouping. */
  const verdicts = useMemo(
    () => searched.map(r => ({ row: r, v: classify(r, now) })),
    [searched, now],
  )

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { all: 0, upcoming: 0, attended: 0, missed: 0, cancelled: 0 }
    for (const { row, v } of verdicts)
      for (const t of TABS)
        if (matchesTab(v, row.booking.status, t.key)) c[t.key]++
    return c
  }, [verdicts])

  /* Grouped by TIME, not by status: "Upcoming" soonest-first at the top, then
     history newest-first under month headings. A seat cancelled for a class
     that has not run yet files under the past — it is not on your calendar
     any more — which means the first history heading can read a month AHEAD
     of today. Deliberate: the past list is "everything you are not going to". */
  const groups = useMemo(() => {
    const visible = verdicts.filter(({ row, v }) => matchesTab(v, row.booking.status, tab))

    const ahead: Row[]  = []
    const behind: Row[] = []
    for (const { row, v } of visible) (v.lane === 'upcoming' ? ahead : behind).push(row)

    ahead.sort((a, b) => a.start - b.start)
    behind.sort((a, b) => b.start - a.start)

    const out: { id: string; title: string; rows: Row[]; accent?: boolean }[] = []
    if (ahead.length) out.push({ id: 'upcoming', title: 'Upcoming', rows: ahead, accent: true })

    let current: { id: string; title: string; rows: Row[] } | null = null
    for (const r of behind) {
      if (!current || current.id !== r.monthKey) {
        current = { id: r.monthKey, title: r.monthLabel, rows: [] }
        out.push(current)
      }
      current.rows.push(r)
    }
    return out
  }, [verdicts, tab])

  const truncated = Boolean(data?.meta?.has_next)

  return (
    <div className="dm mx-auto w-full max-w-3xl pb-16">
      <PageStyle />

      {/* ── Header ─────────────────────────────────────────────── */}
      <motion.header
        className="mb-5"
        initial={reduce ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0, transition: SPRING }}
      >
        <h1 className="syne text-[24px] font-extrabold leading-tight"
          style={{ color: 'var(--color-text-primary)' }}>
          Booking History
        </h1>
        <p className="dm mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          Every seat you have reserved — upcoming and past.
          {mounted && <> Shown in your local time ({APP_TIMEZONE.replace(/_/g, ' ')}).</>}
          {' '}Joining a class happens on the{' '}
          <Link href="/class-bookings"
            className="bk-focus font-semibold underline underline-offset-2"
            style={{ color: BLUE_INK }}>
            class schedule
          </Link>.
        </p>
      </motion.header>

      {/* ── Summary ────────────────────────────────────────────── */}
      {!isLoading && !isError && stats.total > 0 && (
        <motion.div
          className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: SPRING }}
        >
          <StatTile accent icon={<Ticket size={13} strokeWidth={2} />}
            value={String(stats.total)} label="Booked" />
          <StatTile icon={<CheckCircle2 size={13} strokeWidth={2} />}
            value={String(stats.attended)} label="Attended" />
          <StatTile icon={<XCircle size={13} strokeWidth={2} />}
            value={String(stats.missed)} label="Missed" />
          <StatTile icon={<Ban size={13} strokeWidth={2} />}
            value={String(stats.cancelled)} label="Cancelled" />
          {/* Five tiles into two columns leaves a half-width orphan on a
              phone, so the headline figure takes the whole last row. */}
          <StatTile icon={<Target size={13} strokeWidth={2} />}
            className="col-span-2 sm:col-span-1"
            value={stats.rate == null ? '—' : `${stats.rate}%`}
            label="Attendance"
            meter={stats.rate}
          />
        </motion.div>
      )}

      {/* ── Filters ────────────────────────────────────────────── */}
      {!isError && !isLoading && (
        <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={tab} onChange={setTab} counts={counts} />

          <label className="flex min-w-0 items-center gap-2 rounded-full px-3 py-1.5 sm:w-60"
            style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
            <Search size={13} strokeWidth={2} className="flex-shrink-0"
              style={{ color: search ? BLUE_INK : 'var(--color-text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Course, class or instructor"
              aria-label="Search your bookings"
              className="dm min-w-0 flex-1 bg-transparent text-[12px] outline-none"
              style={{ color: 'var(--color-text-primary)' }}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
                className="bk-focus flex-shrink-0 rounded-full transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-text-muted)' }}>
                <X size={13} strokeWidth={2.5} />
              </button>
            )}
          </label>
        </div>
      )}

      {/* ── The list ───────────────────────────────────────────── */}
      {isError ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center" style={CARD}>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}>
            <AlertCircle size={20} strokeWidth={1.75} style={{ color: 'var(--color-danger)' }} />
          </span>
          <div>
            <p className="syne text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
              Could not load your bookings
            </p>
            <p className="dm mt-1 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              The connection dropped on the way. Your history is safe.
            </p>
          </div>
          <button type="button" onClick={() => void refetch()} disabled={isFetching}
            className="bk-focus dm inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-60"
            style={{ background: 'rgba(0,87,184,0.08)', border: '1px solid rgba(0,87,184,0.20)', color: BLUE_INK }}>
            {isFetching ? <Spinner size={11} /> : <RotateCw size={12} strokeWidth={2.5} />}
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <LoadingState />
      ) : groups.length === 0 ? (
        <EmptyState tab={tab} search={search} onClear={() => setSearch('')} />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g, i) => (
            <Group key={`${tab}-${g.id}`} index={i} title={g.title}
              rows={g.rows} now={now} accent={g.accent} />
          ))}
        </div>
      )}

      {/* ── Footnotes ──────────────────────────────────────────────
          Both of these exist because a history that quietly stops, or quietly
          drops rows, is worse than one that says what it is missing. */}
      {!isLoading && !isError && (truncated || orphaned > 0) && (
        <div className="mt-4 space-y-1.5">
          {truncated && (
            <p className="dm flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              <History size={12} strokeWidth={2} className="mt-px flex-shrink-0" />
              Showing your {rows.length} most recent bookings
              {data?.meta?.total_count ? ` of ${data.meta.total_count}` : ''}. The figures above cover those.
            </p>
          )}
          {orphaned > 0 && (
            <p className="dm flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              <AlertTriangle size={12} strokeWidth={2} className="mt-px flex-shrink-0" />
              {orphaned === 1
                ? '1 booking is not shown because its class has since been removed.'
                : `${orphaned} bookings are not shown because their classes have since been removed.`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
