'use client'
import { useEffect, useState } from 'react'
import { useServerNow } from './useServerNow'
import { joinTickMs, JOIN_TICK_SLOW_MS, type JoinWindowSession } from '@/lib/joinWindow'

/**
 * useJoinClock — the server-anchored clock that drives the Join button.
 *
 * Wraps useServerNow with an adaptive tick: 1 s while any booked session in
 * `sessions` is within two minutes of its join window opening or closing,
 * 30 s otherwise (see joinTickMs). Pass every session the screen might draw
 * a button for; the returned `now` is what each button compares against.
 */
export function useJoinClock(sessions: readonly JoinWindowSession[] | undefined): number {
  const [tickMs, setTickMs] = useState(JOIN_TICK_SLOW_MS)
  const now  = useServerNow(tickMs)
  const want = joinTickMs(sessions, now)
  useEffect(() => { setTickMs(want) }, [want])
  return now
}
