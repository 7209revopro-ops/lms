/* ─────────────────────────────────────────────────────────────
   Staff email-notification preferences.

   Admin-side users (super_admin, admin, sub_admin, support, instructor) can
   silence the mail the platform sends them, either wholesale (masterEnabled)
   or per category. This module is the ONLY place that decides "should this
   person get this email", so the five send sites stay one-liners.

   Opt-OUT model: a user who has never touched the setting has no `emailPrefs`
   at all, and an absent value means SEND. That keeps every existing account
   behaving exactly as before and needs no backfill.

   The one exception is role-aware: sub_admin and support were never recipients
   of the two admin alerts before this feature. Making them eligible with the
   usual opt-out default would have flooded previously-silent inboxes on deploy,
   so for those two categories they opt IN instead. An explicit choice always
   wins over either default.
───────────────────────────────────────────────────────────── */

export const STAFF_EMAIL_CATEGORIES = [
  'enrollmentRequest',
  'deviceApproval',
  'classScheduled',
  'classReminder',
  'assignmentSubmitted',
  /* The 9 PM "your schedule for tomorrow" summary. Instructors only — see
     jobs/instructorSchedule.job.ts. Opt-out like the rest: absent ⇒ send. */
  'dailySchedule',
] as const

export type StaffEmailCategory = typeof STAFF_EMAIL_CATEGORIES[number]

export function isStaffEmailCategory(v: unknown): v is StaffEmailCategory {
  return typeof v === 'string' && (STAFF_EMAIL_CATEGORIES as readonly string[]).includes(v)
}

/* The alerts that existed as super_admin/admin-only before this feature. */
const ADMIN_ALERT_CATEGORIES: ReadonlySet<string> = new Set(['enrollmentRequest', 'deviceApproval'])
/* Roles newly made eligible for those alerts — they opt in rather than being
   subscribed on deploy. */
const OPT_IN_ROLES: ReadonlySet<string> = new Set(['sub_admin', 'support'])

export interface EmailPrefs {
  masterEnabled?: boolean
  categories?: Partial<Record<StaffEmailCategory, boolean>>
}

/** Anything carrying the fields the gate needs — a lean doc is fine. */
export interface PrefBearingUser {
  role?: string
  emailPrefs?: EmailPrefs | null
}

/** What this category does when the user has expressed no explicit choice. */
export function defaultWants(role: string | undefined, category: StaffEmailCategory): boolean {
  return !(ADMIN_ALERT_CATEGORIES.has(category) && OPT_IN_ROLES.has(role ?? ''))
}

/**
 * Should this staff member receive `category`?
 *
 * Precedence: master switch → explicit per-category choice → role-aware default.
 * Callers must pass a doc projected with at least `role emailPrefs`.
 */
export function wantsStaffEmail(
  user: PrefBearingUser | null | undefined,
  category: StaffEmailCategory,
): boolean {
  if (!user) return false
  const prefs = user.emailPrefs
  if (prefs?.masterEnabled === false) return false
  const explicit = prefs?.categories?.[category]
  if (typeof explicit === 'boolean') return explicit
  return defaultWants(user.role, category)
}

/** Every category resolved for one user — what the Settings UI renders. */
export function resolveAllPrefs(user: PrefBearingUser): Record<StaffEmailCategory, boolean> {
  const out = {} as Record<StaffEmailCategory, boolean>
  for (const c of STAFF_EMAIL_CATEGORIES) out[c] = wantsStaffEmail(user, c)
  return out
}
