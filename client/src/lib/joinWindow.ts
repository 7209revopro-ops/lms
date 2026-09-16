/**
 * joinWindow.ts — when a booked student may take the Google Meet link.
 *
 * The window (start .. start + 20 min) is a SERVER rule: every student-facing
 * live-class row carries `joinOpensAt` / `joinClosesAt`, and
 * POST /live-classes/:id/join enforces the same two instants at the click.
 * This module only reads those instants against a clock — it never derives
 * them from `scheduledStart`, so the rule lives in exactly one place and the
 * button the student sees can never disagree with the endpoint behind it.
 *
 * Deliberately NOT `status === 'live'`: the effective status flips to 'live'
 * 15 minutes BEFORE the start, and the join button must not.
 */
export interface JoinWindowSession {
  isBooked?:     boolean
  joinOpensAt?:  string
  joinClosesAt?: string
  type?:         string        // 'external' | 'internal'
  isOnline?:     boolean       // false = in-person, nothing to join
  status?:       string        // 'scheduled' | 'live' | 'ended' | 'cancelled'
}

/* hidden — no join UI at all (not booked, in-app, in-person, cancelled/ended)
   before — booked; the window has not opened yet
   open   — booked; inside the window, show the button
   closed — booked; the window has passed */
export type JoinPhase = 'hidden' | 'before' | 'open' | 'closed'

/** Can this session ever show a Meet button to this student? */
export function isJoinEligible(s: JoinWindowSession): boolean {
  return s.isBooked === true
    && s.type === 'external'
    && s.isOnline !== false
    && s.status !== 'cancelled'
    && s.status !== 'ended'
    && !!s.joinOpensAt
    && !!s.joinClosesAt
}

export function getJoinPhase(s: JoinWindowSession, now: number): JoinPhase {
  if (!isJoinEligible(s)) return 'hidden'
  /* A clock that is not a number must fail CLOSED. `NaN < x` and `NaN > x`
     are both false, so without this guard a NaN `now` fell through both
     comparisons and read as 'open'. */
  if (Number.isNaN(now)) return 'hidden'
  const opens  = new Date(s.joinOpensAt!).getTime()
  const closes = new Date(s.joinClosesAt!).getTime()
  if (Number.isNaN(opens) || Number.isNaN(closes)) return 'hidden'
  if (now < opens)  return 'before'
  if (now > closes) return 'closed'
  return 'open'
}

/* ── Tick rate ────────────────────────────────────────────────
   The button has to APPEAR at the start second without a reload, so the
   clock that drives it must tick every second — but only while it matters.
   A page full of sessions hours away re-rendering once a second is waste,
   so the fast tick is used only while some booked session sits within two
   minutes of a boundary (either edge of its window). Outside that, 30 s.

   The switch itself is evaluated on the slow tick, so it can happen up to
   30 s late — still 90 s before the boundary, which is more than enough. */
export const JOIN_TICK_FAST_MS = 1_000
export const JOIN_TICK_SLOW_MS = 30_000
const NEAR_BOUNDARY_MS = 2 * 60_000

export function joinTickMs(
  sessions: readonly JoinWindowSession[] | undefined,
  now: number,
): number {
  if (!sessions) return JOIN_TICK_SLOW_MS
  for (const s of sessions) {
    if (!isJoinEligible(s)) continue
    const opens  = new Date(s.joinOpensAt!).getTime()
    const closes = new Date(s.joinClosesAt!).getTime()
    /* Same guard as getJoinPhase: a row whose instants do not parse draws no
       button, so it must not drive the fast tick either. */
    if (Number.isNaN(opens) || Number.isNaN(closes)) continue
    if (Math.abs(now - opens) <= NEAR_BOUNDARY_MS || Math.abs(now - closes) <= NEAR_BOUNDARY_MS) {
      return JOIN_TICK_FAST_MS
    }
  }
  return JOIN_TICK_SLOW_MS
}
