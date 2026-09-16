/* ─────────────────────────────────────────────────────
   Re-export all document interfaces as canonical types.
   Import from here throughout the app — never directly
   from schema.ts — so the import path stays stable if
   models are split into separate files later.
───────────────────────────────────────────────────── */
export type {
  IUser          as User,
  IRefreshToken  as RefreshToken,
  ICategory      as Category,
  ICourse        as Course,
  ISection       as Section,
  ILesson        as Lesson,
  IEnrollment    as Enrollment,
  ILessonProgress as LessonProgress,
  IReview        as Review,
} from './schema.ts'

/* ─── SafeUser — what an account may see about ITSELF ─
   Returned by /auth/me, /admin/auth/me, login, register and refresh.

   This used to be `toObject()` minus passwordHash: a deny-list of exactly
   one field, so every other column on the user document went to the browser
   and every new column was public the day it was added. That is how a
   student's own /auth/me came to carry the email, name, role and id of the
   super admin who approved them — a valid staff login handed to anyone who
   opened devtools, which is a phishing and credential-stuffing target.

   It is now an allow-list. Anything not named here stays on the server,
   including fields added later. When the client genuinely needs a new field,
   add it deliberately.

   Deliberately absent, and why:
     • passwordHash, twoFactorSecret  — credentials.
     • the approvedBy and rejectedBy fields — the identity of STAFF. The
                                        account holder has no need for it; the
                                        admin screens that legitimately show it
                                        read it from the /admin projections,
                                        not from here.
     • failedLoginAttempts, lockedUntil — lockout internals; telling a client
                                        how close it is to a threshold only
                                        helps someone probing it.
     • provider, providerId           — OAuth linkage internals.

   Timestamps and reasons ABOUT the holder (approvedAt, rejectedAt,
   rejectionReason, enrollmentCancellationReason) stay: they name no third
   party and the UI shows them to explain the account's own status.
───────────────────────────────────────────────────── */
import type { IUser } from './schema.ts'
import { toAssetUrl } from '@/utils/assetUrl.ts'

const SAFE_USER_FIELDS = [
  'id', 'name', 'email', 'pendingEmail', 'avatarUrl', 'role',
  'isVerified', 'isActive',
  'bio', 'headline', 'websiteUrl',
  'twoFactorEnabled',
  'emailPrefs',
  'aiUsage',
  'customRoleId', 'organizationId', 'program',
  'category', 'categories',
  'signupType',
  'enrollmentStatus', 'enrollmentCancellationReason',
  'rejectionReason', 'approvedAt', 'rejectedAt',
  'fullRegistrationSubmittedAt', 'enrollmentApplication',
  'lastLoginAt', 'createdAt', 'updatedAt',
] as const

type SafeUserField = typeof SAFE_USER_FIELDS[number]

export type SafeUser = Pick<IUser, Extract<keyof IUser, SafeUserField>>

export function toSafeUser(user: IUser): SafeUser {
  const obj = user.toObject() as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of SAFE_USER_FIELDS) {
    if (obj[key] !== undefined) out[key] = obj[key]
  }
  /* Route avatars through the asset proxy so they load from the private bucket. */
  if (typeof out['avatarUrl'] === 'string') out['avatarUrl'] = toAssetUrl(out['avatarUrl'] as string)
  return out as SafeUser
}
