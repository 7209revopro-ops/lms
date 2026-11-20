/* ─────────────────────────────────────────────────────────────
   Who teaches (2026-11-20)
   ─────────────────────────────────────────────────────────────
   An account has one role. A mentor is an `instructor` — and, since
   2026-11-20, a department's `sub_admin` with `alsoTeaches` set: one person
   who runs a department AND takes its classes, on one account, so their
   classes, chats, reviews and KPIs stay theirs.

   Two halves, used in different places:

   • teacherMatch() — a Mongo clause for "is a mentor", for every query that
     LISTS or FINDS mentors (pickers, timetable import, the daily schedule
     email, chat, KPIs, time off, the Root portal). Compose it under $and
     (tenancy.andFilter) when the query already has an $or.

   • teaches(user) — the same rule for one account or one session, for the
     mentor's OWN screens (class-end questions, mentor chat inbox, My KPIs).

   What it does NOT do: narrow a teaching sub admin to "their own classes
   only". The checks that confine an instructor to their own records stay
   keyed on role === 'instructor' — a sub admin already sees their whole
   department, which includes what they teach.
───────────────────────────────────────────────────────────── */

export interface MaybeTeacher { role?: string | null; alsoTeaches?: boolean | null }

/** True for an instructor, and for a sub admin who also teaches. */
export function teaches(u: MaybeTeacher | null | undefined): boolean {
  return u?.role === 'instructor' || (u?.role === 'sub_admin' && u?.alsoTeaches === true)
}

/** Mongo clause: the accounts teaches() is true for. A fresh object each call. */
export function teacherMatch(): { $or: Record<string, unknown>[] } {
  return { $or: [{ role: 'instructor' }, { role: 'sub_admin', alsoTeaches: true }] }
}

/** `extra` AND "is a mentor" — safe when `extra` carries its own $or. */
export function teacherFilter(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { $and: [teacherMatch(), extra] }
}
