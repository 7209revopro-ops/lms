/* A student's join is recorded the moment they press Join (Meet link) or enter
   the in-app room, but the booking's status stays 'booked' until the
   finalization job decides attended/missed after the join window closes —
   up to ~35 minutes after the class ends. Without surfacing this evidence the
   admin register shows a student who is sitting in class as merely "Booked". */
export interface JoinEvidence {
  status:            string
  attendedAt?:       string
  attendanceSource?: 'click' | 'livekit'
}

/** Joined but not yet finalized — the register should read this as present. */
export function hasJoined(b: JoinEvidence): boolean {
  return b.status === 'booked' && !!b.attendedAt
}

/** "Joined 1:10 PM · join link", or null when there is no join on record. */
export function joinedLabel(b: JoinEvidence, timeZone?: string): string | null {
  if (!b.attendedAt) return null
  const time = new Date(b.attendedAt).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}),
  })
  const via = b.attendanceSource === 'livekit' ? 'in-app room' : 'join link'
  return `Joined ${time} · ${via}`
}
