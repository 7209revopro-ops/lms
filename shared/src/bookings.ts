import type { MyBooking } from './liveClass'

/* ── Booking history — the website's My Bookings rules
      (client (dashboard)/my-bookings/page.tsx: classify, matchesTab, stats) ── */

export type BookingTab = 'all' | 'upcoming' | 'attended' | 'missed' | 'cancelled'
export const BOOKING_TABS: readonly BookingTab[] = ['all', 'upcoming', 'attended', 'missed', 'cancelled']

/** What one booking is, for the student reading their history. */
export type BookingVerdict =
  | 'booked'      // a seat for a class still ahead
  | 'live'        // the server says the class is running
  | 'attended' | 'missed' | 'cancelled'
  | 'called-off'  // the academy cancelled the class; the seat went with it
  | 'unmarked'    // the class is over and the register has not been taken

export interface BookingRow { booking: MyBooking; start: number; end: number }

export function bookingRow(booking: MyBooking): BookingRow {
  const start = new Date(booking.liveClassId.scheduledStart).getTime()
  return { booking, start, end: start + (booking.liveClassId.durationMins || 60) * 60_000 }
}

export function bookingVerdict(r: BookingRow, now: number): { kind: BookingVerdict; lane: 'upcoming' | 'past' } {
  const s = r.booking.status
  const lc = r.booking.liveClassId
  if (s === 'cancelled') return { kind: 'cancelled', lane: 'past' }
  if (s === 'attended') return { kind: 'attended', lane: 'past' }
  if (s === 'missed') return { kind: 'missed', lane: 'past' }
  if (lc.status === 'cancelled') return { kind: 'called-off', lane: 'past' }
  /* 'live' is the server's word: a class can run a little before or after its slot. */
  if (lc.status === 'live') return { kind: 'live', lane: 'upcoming' }
  /* Over by the END, not the start; 'ended' is trusted when set (late, never early). */
  if (now >= r.end || lc.status === 'ended') return { kind: 'unmarked', lane: 'past' }
  return { kind: 'booked', lane: 'upcoming' }
}

/** Upcoming reads the clock; the other three read the register. */
export function inBookingTab(r: BookingRow, now: number, tab: BookingTab): boolean {
  if (tab === 'all') return true
  if (tab === 'upcoming') return bookingVerdict(r, now).lane === 'upcoming'
  return r.booking.status === tab
}

/** Figures over the WHOLE history. The rate counts only classes that have
 *  happened — next month's seats are not absences — and is null until one has. */
export function bookingStats(rows: readonly BookingRow[]) {
  let attended = 0, missed = 0, cancelled = 0
  for (const r of rows) {
    if (r.booking.status === 'attended') attended++
    else if (r.booking.status === 'missed') missed++
    else if (r.booking.status === 'cancelled') cancelled++
  }
  const settled = attended + missed
  return { total: rows.length, attended, missed, cancelled, rate: settled > 0 ? Math.round((attended / settled) * 100) : null }
}

/** What a search box matches: the class, its course and module, the mentor. */
export function bookingHaystack(b: MyBooking): string {
  const lc = b.liveClassId
  return [lc.title, lc.yourCohort?.courseTitle ?? lc.courseId?.title, lc.yourCohort?.sectionTitle ?? lc.sectionId?.title,
    lc.instructorId?.name, lc.language].filter(Boolean).join(' ').toLowerCase()
}
