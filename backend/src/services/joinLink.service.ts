/* ─────────────────────────────────────────────────────────────
   Join links — {CLIENT_URL}/j/<code>, in a booked student's 5-minute and
   start-time reminders (email and WhatsApp).

   One tap signs the student in if they are not (no password), and the /j
   page then takes the ordinary join path — POST /live-classes/:id/join, which
   re-checks the seat and the window, records the join for attendance and
   hands back the meeting link.

   A code belongs to ONE student and ONE class, and lives 2 hours from when
   it is made. It signs in once: a second tap with no session finds the class
   but issues nothing, and the join call then renews the browser's own session
   or sends them to sign in and back. Only its SHA-256 is stored.

   A Google Meet class's link also carries the meeting code (?m=abc-defg-hij,
   the user, 2026-10-09): the /j page shows it, and when signing in and joining
   take more than 30 seconds it goes straight into the meeting — telling the
   LMS first (POST /auth/join-link/fallback), which records the join from the
   code after the same checks as the ordinary join.
───────────────────────────────────────────────────────────── */
import { createHash, randomBytes } from 'node:crypto'
import { Types } from 'mongoose'

export const JOIN_LINK_TTL_MS = 2 * 60 * 60 * 1000

export const hashJoinCode = (raw: string): string => createHash('sha256').update(raw).digest('hex')

/** A fresh code for this student and class; the raw value goes in the link, never in the database. */
export async function mintJoinCode(userId: string, liveClassId: string, now = Date.now()): Promise<string> {
  const { AuthTokenModel } = await import('@/models/schema.ts')
  const raw = randomBytes(18).toString('base64url')          // 24 URL-safe characters
  await AuthTokenModel.create({
    userId:      new Types.ObjectId(userId),
    liveClassId: new Types.ObjectId(liveClassId),
    tokenHash:   hashJoinCode(raw),
    purpose:     'join-link',
    expiresAt:   new Date(now + JOIN_LINK_TTL_MS),
  })
  return raw
}

/** A Google Meet link's meeting code (abc-defg-hij), else null — only Meet's are carried in a join link. */
export function meetCodeOf(url: unknown): string | null {
  const m = /^https?:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#]|$)/i.exec(String(url ?? '').trim())
  return m ? m[1]!.toLowerCase() : null
}

/** What follows /j/ — the code, and the Meet code when there is one. The WhatsApp Join button takes exactly this. */
export function joinLinkPath(raw: string, meetCode?: string | null): string {
  return meetCode ? `${raw}?m=${meetCode}` : raw
}

export function joinLinkUrl(raw: string, meetCode?: string | null): string {
  const base = (process.env['CLIENT_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '')
  return `${base}/j/${joinLinkPath(raw, meetCode)}`
}
