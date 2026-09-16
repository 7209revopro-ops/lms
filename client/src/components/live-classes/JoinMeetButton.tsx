'use client'

import { Clock, Video } from 'lucide-react'
import Spinner from '@/components/ui/Spinner'
import { useJoinClass } from '@/hooks/useJoinClass'
import { getJoinPhase, type JoinWindowSession } from '@/lib/joinWindow'
import { APP_TIMEZONE } from '@/lib/timezone'

/* ── Sizes ─────────────────────────────────────────────
   Each surface already has a button shape of its own; these mirror them so
   the shared component drops into a card footer, a sidebar row or a modal
   without changing the layout around it. */
const BUTTON = {
  xs: 'gap-1 rounded-xl px-3 py-1.5 text-[10px] font-bold',
  sm: 'gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold',
  md: 'gap-1.5 rounded-xl px-4 py-2 text-xs font-bold',
  lg: 'w-full gap-2 rounded-2xl py-3.5 text-sm font-bold',
} as const
const ICON = { xs: 9, sm: 11, md: 12, lg: 14 } as const
const LINE = { xs: 'text-[10px]', sm: 'text-[11px]', md: 'text-xs', lg: 'text-[11px]' } as const

export interface JoinMeetButtonProps extends JoinWindowSession {
  sessionId:   string
  /** Server-anchored clock — from useJoinClock / useServerNow, never Date.now() at render. */
  now:         number
  size?:       keyof typeof BUTTON
  /** Button background. Defaults to the Meet indigo used across the app. */
  accent?:     string
  /** Colour of the "Join opens at" / "Join link closed" lines. */
  mutedColor?: string
  /** Render the muted before/after lines (default true). Compact rows pass false
   *  so they show nothing outside the window. */
  showLines?:  boolean
  className?:  string
}

/* Device timezone — the client never pins a zone (see lib/timezone.ts). */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: APP_TIMEZONE, hour: 'numeric', minute: '2-digit',
  })
}

/**
 * JoinMeetButton — the ONE way a student reaches a Google Meet class.
 *
 *   not booked / in-app / in-person / cancelled / ended → renders nothing
 *   booked, before joinOpensAt   → "Join opens at HH:MM", a live countdown in the last minute
 *   booked, inside the window    → the button (fetches the link on click)
 *   booked, after joinClosesAt   → "Join link closed"
 *
 * Visibility is driven entirely by `now` against the server's window, so the
 * button appears at the start second without a reload — never early.
 */
export default function JoinMeetButton({
  sessionId, now, size = 'md',
  accent = '#6366F1', mutedColor = 'var(--color-text-muted)',
  showLines = true, className = '',
  ...session
}: JoinMeetButtonProps) {
  const phase = getJoinPhase(session, now)
  const { join, isJoining } = useJoinClass(sessionId)

  if (phase === 'hidden') return null

  if (phase === 'before') {
    if (!showLines) return null
    const secs = Math.max(1, Math.ceil((new Date(session.joinOpensAt!).getTime() - now) / 1000))
    return (
      <p className={`flex items-center gap-1 ${LINE[size]} ${className}`} style={{ color: mutedColor }}>
        <Clock size={ICON[size]} style={{ flexShrink: 0 }} />
        {secs <= 60
          ? <span>Join opens in <strong className="tabular-nums">{secs}s</strong></span>
          : <span>Join opens at <strong>{fmtTime(session.joinOpensAt!)}</strong></span>}
      </p>
    )
  }

  if (phase === 'closed') {
    if (!showLines) return null
    return (
      <p className={`flex items-center gap-1 ${LINE[size]} ${className}`} style={{ color: mutedColor }}>
        <Clock size={ICON[size]} style={{ flexShrink: 0 }} />Join link closed
      </p>
    )
  }

  return (
    <button
      type="button"
      onClick={() => { void join() }}
      disabled={isJoining}
      className={`flex items-center justify-center text-white transition-all hover:brightness-110 disabled:opacity-60 ${BUTTON[size]} ${className}`}
      style={{ background: accent }}>
      {isJoining ? <Spinner size={ICON[size]} variant="white" /> : <Video size={ICON[size]} />}
      Join Google Meet
    </button>
  )
}
