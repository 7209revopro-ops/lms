/**
 * liveStatus.ts — effective live-class status based on the clock.
 *
 * A scheduled session is shown/counted as **Live Now** during the window:
 *   from 15 min BEFORE its start
 *   to   the session END time  (scheduledStart + durationMins)
 *
 * Timeline for a 'scheduled' session relative to now:
 *   now < start - 15m              → 'scheduled' (upcoming)
 *   start - 15m ≤ now < start + durationMins → 'live'  (live window)
 *   now ≥ start + durationMins     → 'ended'
 *
 * Sessions the backend has explicitly marked ('live' streaming, 'ended', 'cancelled')
 * keep that status — a real live stream is always live regardless of the clock.
 *
 * This is display/counting only; the stored DB status is never changed, so internal
 * (Mux) sessions can still be started late or rescheduled.
 */
export const LIVE_LEAD_MS = 15 * 60_000  // session becomes "live" 15 min before start

/* ── When a student may still take a seat ────────────────────────────────
   Booking closes a fixed period BEFORE the class starts, and the period
   depends on where the class happens:

     online     15 minutes before — an 11:00 class stops taking seats at 10:45,
                the moment resolveLiveStatus() starts calling it "live";
     in person  5 hours before    — a 19:00 class stops at 14:00, time enough
                to set out the room for the final head-count.

   History, so neither number is mistaken for an accident: online booking
   closed 15 minutes before (when a class goes "live"), then an hour before,
   and is back at 15 minutes at the academy's request. In-person booking
   closed at midnight before the class day, a rule only the student app held;
   it is now 5 hours before the start, and the server enforces it too.

   An admin seating a student (book-for-student) is not governed by either —
   a staff override for a genuine exception.

   Overridable so an academy can move either without a deploy:
   BOOKING_CUTOFF_MINUTES (online) and IN_PERSON_BOOKING_CUTOFF_MINUTES.
   Parsed once — env is fixed at boot. */
const minutesFromEnv = (name: string, fallback: number): number => {
  const raw = Number(process.env[name])
  return process.env[name]?.trim() && Number.isFinite(raw) && raw >= 0 ? raw : fallback
}

export const BOOKING_CUTOFF_MS           = minutesFromEnv('BOOKING_CUTOFF_MINUTES', 15) * 60_000
export const IN_PERSON_BOOKING_CUTOFF_MS = minutesFromEnv('IN_PERSON_BOOKING_CUTOFF_MINUTES', 300) * 60_000

/** How long before its start a class stops taking seats. `isOnline: false` is
 *  in person; anything else — absent included — is online, as the class
 *  model defaults. */
export function bookingCutoffMs(isOnline?: boolean | null): number {
  return isOnline === false ? IN_PERSON_BOOKING_CUTOFF_MS : BOOKING_CUTOFF_MS
}

/** The cut-off in words for a message: "15 minutes", "5 hours". */
export function bookingCutoffPhrase(isOnline?: boolean | null): string {
  const mins = Math.round(bookingCutoffMs(isOnline) / 60_000)
  if (mins % 60 === 0 && mins >= 60) return `${mins / 60} hour${mins === 60 ? '' : 's'}`
  return `${mins} minute${mins === 1 ? '' : 's'}`
}

/** The instant after which no new booking is accepted. */
export function bookingClosesAt(scheduledStart: Date | string, isOnline?: boolean | null): Date {
  return new Date(new Date(scheduledStart).getTime() - bookingCutoffMs(isOnline))
}

/** True while a seat may still be taken. `now` is injectable so the rule can
 *  be tested at an exact instant rather than against the wall clock. */
export function isBookingOpen(
  scheduledStart: Date | string,
  now: number = Date.now(),
  isOnline?: boolean | null,
): boolean {
  return now < bookingClosesAt(scheduledStart, isOnline).getTime()
}

/** Minutes until booking closes — negative once it has. For messages. */
export function minutesUntilBookingCloses(
  scheduledStart: Date | string,
  now: number = Date.now(),
  isOnline?: boolean | null,
): number {
  return Math.round((bookingClosesAt(scheduledStart, isOnline).getTime() - now) / 60_000)
}

export function resolveLiveStatus(
  rawStatus: string,
  scheduledStart: Date | string,
  durationMins: number,
  now: number = Date.now(),
): string {
  if (rawStatus !== 'scheduled') return rawStatus   // live / ended / cancelled stay as-is
  const start = new Date(scheduledStart).getTime()
  const end   = start + durationMins * 60_000       // class end time
  if (now >= end) return 'ended'
  if (now >= start - LIVE_LEAD_MS) return 'live'
  return 'scheduled'
}

/* ── When a BOOKED student may open the Meet link ────────────────────────
   From the moment the class starts until STUDENT_JOIN_GRACE minutes after
   its SCHEDULED END. Not before the start: the link is not a preview, and a
   room that fills up early is a room the instructor has to manage before
   they meant to start.

   THIS USED TO BE A FLAT WINDOW OFF THE START TIME ALONE (start .. start +
   20min), with no regard for how long the class was actually scheduled to
   run. That is exactly backwards for anything longer than twenty minutes —
   which is nearly every real class (most run 60-90 minutes) — because it
   closed the join link while the class was still genuinely live, instructor
   present and running normally. Reported directly by students as "the class
   is live but I can't join." Now keyed off `durationMins`, matching how
   LIVEKIT_WINDOW (liveClassJoin.service.ts) has always computed the same
   thing for internal classes: the window covers the FULL scheduled class,
   plus a grace period after its end for a late or reconnecting student.

   Deliberately NOT the same window as `resolveLiveStatus`. That one calls a
   class "live" from fifteen minutes before, and drives tab counts, card
   accents and the admin's own Join button, which stays exactly as it is. This
   is a separate rule with its own name so changing one can never move the
   other.

   Overridable per academy without a deploy. Parsed once — env is fixed at
   boot. */
const STUDENT_JOIN_GRACE_MINUTES = (() => {
  const raw = Number(process.env['STUDENT_JOIN_GRACE_MINUTES'])
  return Number.isFinite(raw) && raw >= 0 && raw <= 240 ? raw : 20
})()

export const STUDENT_JOIN_GRACE_MS = STUDENT_JOIN_GRACE_MINUTES * 60_000

/** The interval in which a booked student may take the Meet link — both ends
 *  inclusive, which is how the gate (assertStudentMayJoin) reads it: refused
 *  while now < opensAt, refused while now > closesAt, released between. This
 *  is the ONLY place the two instants are computed; the gate, every student
 *  DTO and the button the student sees all take them from here.
 *
 *  `durationMins` is required, not optional with a fallback — a caller that
 *  forgets to pass it is exactly how this closed early for a live class the
 *  first time; better a type error at the call site than a silent flat 20
 *  minutes again. */
export function studentJoinWindow(
  scheduledStart: Date | string,
  durationMins: number,
): { opensAt: Date; closesAt: Date } {
  const start = new Date(scheduledStart).getTime()
  const end   = start + Math.max(0, durationMins) * 60_000
  return { opensAt: new Date(start), closesAt: new Date(end + STUDENT_JOIN_GRACE_MS) }
}
