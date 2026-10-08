/* ─────────────────────────────────────────────────────────────
   Sign-in links — {CLIENT_URL}/s/<code>, the button in the WhatsApp messages
   that are not about joining a class right now: a new class scheduled in a
   student's course (new_class_scheduled_v1) and the morning list of today's
   classes (todays_classes_v1).

   One tap signs the student in if the browser has no session — no password —
   and opens the page the code was made for (the schedule, My Bookings). Same
   rules as the join links (joinLink.service.ts): ONE student, 24 hours, signs
   in once; a later tap with no session just opens the page (which asks them
   to sign in); another student's session is refused. Only its SHA-256 is
   stored. The page is fixed when the code is made — never taken from the URL.
───────────────────────────────────────────────────────────── */
import { createHash, randomBytes } from 'node:crypto'
import { Types } from 'mongoose'

export const SIGNIN_LINK_TTL_MS = 24 * 60 * 60 * 1000

export const hashSigninCode = (raw: string): string => createHash('sha256').update(raw).digest('hex')

/** Only this site's own pages: "/something", never "//host" or a URL. */
export function safeNextPath(path: string): string {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path.slice(0, 300) : '/my-bookings'
}

export async function mintSigninCode(userId: string, nextPath: string, now = Date.now()): Promise<string> {
  const { AuthTokenModel } = await import('@/models/schema.ts')
  const raw = randomBytes(18).toString('base64url')
  await AuthTokenModel.create({
    userId:    new Types.ObjectId(userId),
    tokenHash: hashSigninCode(raw),
    purpose:   'signin-link',
    nextPath:  safeNextPath(nextPath),
    expiresAt: new Date(now + SIGNIN_LINK_TTL_MS),
  })
  return raw
}
