import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { joinTickMs, type JoinWindowSession } from '@shared'

/* A clock for screens that show a Join button: ticks every second only while
   some booked session is within two minutes of its window opening or closing
   (the website's rule, shared/joinWindow), otherwise every 30 s — and
   immediately when the app comes back to the foreground. */
export function useNow(sessions?: readonly JoinWindowSession[]): number {
  const [now, setNow] = useState(() => Date.now())
  const tick = joinTickMs(sessions, now)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tick)
    return () => clearInterval(t)
  }, [tick])

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') setNow(Date.now()) })
    return () => sub.remove()
  }, [])

  return now
}
