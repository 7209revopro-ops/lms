/* ─────────────────────────────────────────────────────────────
   Sign-in links — {CLIENT_URL}/s/<code>, the button in the WhatsApp messages
   that are not about joining a class right now: a new class scheduled in a
   student's course (new_class_scheduled_v1) and the morning list of today's
   classes (todays_classes_v1).

   One tap signs the student in if the browser has no session — no password —
   and opens the page the code was made for (the schedule, My Bookings). Same
   rules as the join links (joinLink.service.ts): ONE student, 24 hours, signs
   in up to LINK_MAX_SIGNINS times (auth.service.ts) — or `maxUses`; a later
   tap with no session just opens the page (which asks them to sign in);
   another student's session is refused. Only its SHA-256 is stored. The page
   is fixed when the code is made — never taken from the URL.

   An admin can also make one by hand for any of their students (Students →
   Login link, the user 2026-10-29: "one time, 24 hours"): it signs in ONCE,
   and making a new one cancels that student's earlier hand-made ones that
   are still waiting. WhatsApp's are left alone.
───────────────────────────────────────────────────────────── */
import { createHash, randomBytes } from 'node:crypto'
import { Types } from 'mongoose'

export const SIGNIN_LINK_TTL_MS = 24 * 60 * 60 * 1000

export const hashSigninCode = (raw: string): string => createHash('sha256').update(raw).digest('hex')

/** Only this site's own pages: "/something", never "//host" or a URL. */
export function safeNextPath(path: string): string {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path.slice(0, 300) : '/my-bookings'
}

export async function mintSigninCode(
  userId: string, nextPath: string, now = Date.now(), opts: { maxUses?: number; issuedBy?: string } = {},
): Promise<string> {
  const { AuthTokenModel } = await import('@/models/schema.ts')
  const raw = randomBytes(18).toString('base64url')
  await AuthTokenModel.create({
    userId:    new Types.ObjectId(userId),
    tokenHash: hashSigninCode(raw),
    purpose:   'signin-link',
    nextPath:  safeNextPath(nextPath),
    expiresAt: new Date(now + SIGNIN_LINK_TTL_MS),
    ...(opts.maxUses ? { maxUses: opts.maxUses } : {}),
    ...(opts.issuedBy ? { issuedBy: new Types.ObjectId(opts.issuedBy) } : {}),
  })
  return raw
}

/** An admin's one-time login link for a student: signs in once, 24 hours, opens the class schedule.
 *  Cancels that student's earlier hand-made links still waiting to be used. */
export async function mintAdminLoginLink(studentId: string, adminId: string, now = Date.now()): Promise<{ url: string; expiresAt: Date }> {
  const { AuthTokenModel } = await import('@/models/schema.ts')
  await AuthTokenModel.deleteMany({
    userId: new Types.ObjectId(studentId), purpose: 'signin-link', issuedBy: { $exists: true },
    $or: [{ useCount: { $exists: false } }, { useCount: 0 }],
  })
  const raw = await mintSigninCode(studentId, '/class-bookings', now, { maxUses: 1, issuedBy: adminId })
  const base = (process.env['CLIENT_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '')
  return { url: `${base}/s/${raw}`, expiresAt: new Date(now + SIGNIN_LINK_TTL_MS) }
}
