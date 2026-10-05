/* Which programme a member of staff is confined to.
 *
 * There used to be two ways to answer this. Three roles — `4x_admin`,
 * `digital_marketing_admin`, `ai_admin` — encoded the programme in the ROLE
 * NAME, while `sub_admin` carried it in a separate `program` field. They meant
 * the same thing, so the UI derived scope one way in some files and the other
 * way in others, and only the second could express JURA at all.
 *
 * The three role-encoded variants are gone; every scoped admin is now a
 * `sub_admin` whose programme lives in `program`. This module is the single
 * place that reads it, so the answer cannot differ between screens.
 *
 * Mirrors `injectCategoryScope` in backend/src/middleware/auth.middleware.ts —
 * the two must agree, because the backend enforces what this only displays.
 */
import type { ProgramCategory } from '@/lib/api/enrollmentRequests'

/** `program` on the user → the hyphenated category used everywhere else. */
export const PROGRAM_TO_CATEGORY: Record<string, ProgramCategory> = {
  forex:             '4x-trading',
  digital_marketing: 'digital-marketing',
  ai:                'ai',
  jura:              'jura',
}

/** Short label for a programme, for badges and chips. */
export const PROGRAM_LABEL: Record<string, string> = {
  forex:             'FOREX',
  digital_marketing: 'Digital Mktg',
  ai:                'AI',
  jura:              'JURA',
}

/**
 * The programme this user is confined to, or undefined when unconfined.
 *
 * A `sub_admin` with no `program` is deliberately undefined rather than
 * defaulted: an unset programme means nobody chose one, and guessing would
 * silently narrow or widen what they can see. The backend FAILS CLOSED on it
 * (plan.md §10): every request is refused with NO_DEPARTMENT, and
 * NoDepartmentNotice tells them why.
 */
export function categoryScopeOf(
  user: { role?: string; program?: string; category?: string } | null | undefined,
): ProgramCategory | undefined {
  if (!user) return undefined
  if (user.role === 'sub_admin' && user.program) return PROGRAM_TO_CATEGORY[user.program]
  /* Instructors carry a category directly, already in hyphenated form. */
  if (user.role === 'instructor' && user.category) return user.category as ProgramCategory
  return undefined
}

/** Is this user confined to one programme? */
export function isProgrammeScoped(
  user: { role?: string; program?: string } | null | undefined,
): boolean {
  return user?.role === 'sub_admin'
}
