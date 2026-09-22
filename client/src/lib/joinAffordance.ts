/**
 * joinAffordance.ts — WHICH way in a student gets, for one session they hold.
 *
 * There are three kinds of class and they are reached three different ways:
 * a Google Meet class through a link the server releases inside a window, an
 * in-app (Mux) class through a page on this site, and an in-person class by
 * walking to a room. Four screens offer a way in, and each had worked the
 * three-way branch out for itself.
 *
 * That is how Booking History came to show a pulsing "Live now" badge over an
 * empty space. It rendered only <JoinMeetButton>, which is not a generic join
 * button — isJoinEligible requires `type === 'external'` — so for an in-app
 * class it returned null and the row offered nothing at all. Its own guard
 * made it worse: `canJoin` tested `isOnline` but not `type`, so it green-lit
 * exactly the class the button then refused.
 *
 * So the DECISION lives here and the CHROME stays on each screen. What drifted
 * between the four was never the padding — it was the branch, and the words
 * ("Join the class" on one, "Join the Class" on another). A shared component
 * would have had to carry a density axis and a focus-ring prop to span a
 * compact list row and a full-width card, and parameterised presentation is
 * how shared components rot. A resolver has no such problem.
 *
 * What this module does NOT decide: whether the Meet link may be taken. That
 * is the server's, in studentJoinWindow(), mirrored onto every student row as
 * joinOpensAt/joinClosesAt and enforced again at POST /live-classes/:id/join.
 * This only reads those instants, through getJoinPhase.
 */
import { getJoinPhase, type JoinPhase, type JoinWindowSession } from './joinWindow'
import { LIVE_LEAD_MINS } from './classSchedule'

/** An in-app room opens with the class, not with the Meet window.
 *  LIVE_LEAD_MINS is the display rule — a class reads as live from fifteen
 *  minutes before it starts — and for a room on this site that is the right
 *  gate: there is no link to leak and nothing to release. It is deliberately
 *  NOT the Meet rule, which begins at the start second precisely because the
 *  link is not ours to hand out early. */
const LIVE_LEAD_MS = LIVE_LEAD_MINS * 60_000

export interface JoinSubject extends JoinWindowSession {
  id:              string
  scheduledStart:  string
  durationMins?:   number
  /** Already formatted for display. Passed in rather than derived because the
   *  row titleCases location and room for its own chip, and deriving it again
   *  here would print the same place in a second casing a line below. */
  place?:          string
}

export type JoinAffordance =
  | { kind: 'none' }
  | { kind: 'watch';    href: string; label: string }
  | { kind: 'meet';     phase: Exclude<JoinPhase, 'hidden'> }
  | { kind: 'inPerson'; text: string }

/** One copy of every string, so two screens cannot capitalise it differently. */
export const JOIN_COPY = {
  watch:       'Join the class',
  inPersonNow: (place?: string) =>
    place ? `On now — go to ${place}.` : 'On now — go to your classroom.',
} as const

/**
 * Is the class actually running — from LIVE_LEAD_MINS before the start until
 * the end of its duration?
 *
 * Guards cancelled and ended itself rather than trusting the caller. Today
 * every caller already filters those out through its own verdict, but a pure
 * exported predicate that is only correct because of one caller's allow-list
 * is a trap for the second caller.
 */
export function isInSession(s: JoinSubject, now: number): boolean {
  if (s.status === 'cancelled' || s.status === 'ended') return false
  if (Number.isNaN(now)) return false
  const start = new Date(s.scheduledStart).getTime()
  if (Number.isNaN(start)) return false
  return now >= start - LIVE_LEAD_MS && now < start + (s.durationMins || 60) * 60_000
}

/**
 * The way in, or the honest absence of one.
 *
 * `isBooked` must come from the booking the caller is drawing, never from the
 * class payload: MyBooking['liveClassId'] carries no isBooked field at all, so
 * reading it there is silently always false and the row goes quiet again.
 */
export function resolveJoin(s: JoinSubject, now: number): JoinAffordance {
  if (!s.isBooked) return { kind: 'none' }

  /* In person — there is no control to offer, only a place to be. Silent
     until it is on, because the row already carries a location chip and
     repeating it on every future booking makes the ledger noisier to read. */
  if (s.isOnline === false) {
    return isInSession(s, now)
      ? { kind: 'inPerson', text: JOIN_COPY.inPersonNow(s.place) }
      : { kind: 'none' }
  }

  /* In-app (Mux). No join mail is ever sent for one of these — the scheduled
     class mail carries the course URL — so the answer must be a door on this
     site and never a nudge towards an inbox. */
  if (s.type === 'internal') {
    return isInSession(s, now)
      ? { kind: 'watch', href: `/live-classes/${s.id}/watch`, label: JOIN_COPY.watch }
      : { kind: 'none' }
  }

  /* Google Meet. The button owns its own before/open/closed rendering; all
     this decides is whether there is anything to show at all. */
  const phase = getJoinPhase(s, now)
  return phase === 'hidden' ? { kind: 'none' } : { kind: 'meet', phase }
}
