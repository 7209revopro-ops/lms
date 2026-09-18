/* ─────────────────────────────────────────────────────
   classEntitlement — may this student be in this class, and through which door

   THE RULE THIS FILE EXISTS FOR:

     A student is admitted through a DOOR, and every question is asked of that
     door. A door is the triple (academy, course, module). The class's own
     organizationId / courseId / sectionId are the HOST's door. Each guest
     cohort is another door. Entitlement never compares a value from one door
     against a value from another.

   WHY THAT SENTENCE MATTERS. `Enrollment.blockedLessons` stores SECTION ids
   despite its name (a legacy misnomer documented in CLAUDE.md), and the module
   gate is a set-membership test. A set test only means anything when both sides
   live in the same namespace:

     · door.sectionId is a Section OF door.courseId
     · the enrolment was FOUND BY door.courseId, so its blockedLessons hold
       Section ids of door.courseId

   Both sides therefore always come from the same course. Widen only the
   enrolment lookup — a boolean "shared" flag, or an auto-enrolment — and this
   test starts comparing one academy's section id against another academy's
   blocked list. Those ids can never be equal, `includes()` returns false for
   every blocked student, MODULE_BLOCKED never fires, and the gate FAILS OPEN
   for the entire visiting cohort with nothing in the logs. The admin who
   revoked that module watches the student walk in.

   WHY IT IS A SHARED FILE. This question was hand-written in eight places.
   utils/tenancy.ts's own header records what happened the last time one rule
   lived in four copies: N-07, N-10 and N-11, one of which exposed passport
   scans. Eight copies of a gate is eight chances to widen seven of them.

   THE STATUS PREDICATE IS A PARAMETER, AND THE DISAGREEMENT IS DELIBERATE.
   Booking demands status 'active'. Join, watch, homework, the schedule list and
   the upcoming feed all accept anything that is not 'dropped'. So a COMPLETED
   enrolment can see and join but cannot book a new seat. That is a real, live
   inconsistency in this product. It is preserved here rather than quietly
   unified, because unifying it changes behaviour for every existing
   single-academy student with a completed enrolment. It is now written down in
   one place instead of being re-derived in eight. Fixing it is its own decision.
   Same convention as StudentJoinWindow: only the thing that genuinely differs
   becomes a parameter.
───────────────────────────────────────────────────── */

import { Types } from 'mongoose'

/* Cross-academy classes stay dark until the phase that opens them. The resolver
   is shipped, exercised and tested against single-door classes long before any
   guest cohort can be authored, and long before one can be booked. Flipping
   this is a deployment decision, not a code change, so the pilot can be turned
   off from the server without a revert. */
export const CROSS_ORG_CLASSES_ENABLED =
  String(process.env['CROSS_ORG_CLASSES'] ?? '').toLowerCase() === 'true'

export type EnrolmentStatusRule = 'active' | 'notDropped'

export type EntitlementCode = 'WRONG_ACADEMY' | 'NOT_ENROLLED' | 'MODULE_BLOCKED'

export interface Door {
  /** The academy this door admits. null on a class that predates the field. */
  organizationId: string | null
  courseId:       string | null
  sectionId:      string | null
  isHost:         boolean
}

export interface EnrolmentFacts {
  id:             string
  blockedLessons: string[]
}

export interface Entitlement {
  ok:         boolean
  code?:      EntitlementCode
  /** The door the student came through: the seat pool, the roster owner, the
      labels. Present whenever a door matched, even on a MODULE_BLOCKED refusal,
      because the caller may still want to say which module. */
  door?:      Door
  enrolment?: EnrolmentFacts
}

/* A live class as this module needs to see it. Deliberately loose: callers pass
   lean documents, hydrated documents and documents with `courseId` populated
   into an object, and all three must work. */
export interface ClassDoors {
  organizationId?: unknown
  courseId?:       unknown
  sectionId?:      unknown
  guestCohorts?:   Array<{ organizationId?: unknown; courseId?: unknown; sectionId?: unknown }>
}

/** An id from an ObjectId, a string, or a populated document. */
function idOf(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v || null
  if (v instanceof Types.ObjectId) return String(v)
  if (typeof v === 'object') {
    const o = v as { _id?: unknown; id?: unknown }
    if (o._id != null) return String(o._id)
    if (o.id != null) return String(o.id)
  }
  return String(v) || null
}

export function hostDoorFrom(live: ClassDoors): Door {
  return {
    organizationId: idOf(live.organizationId),
    courseId:       idOf(live.courseId),
    sectionId:      idOf(live.sectionId),
    isHost:         true,
  }
}

/** Host door first, then each guest cohort, in authoring order. */
export function doorsFor(live: ClassDoors): Door[] {
  const doors: Door[] = [hostDoorFrom(live)]
  if (!CROSS_ORG_CLASSES_ENABLED) return doors
  for (const c of live.guestCohorts ?? []) {
    doors.push({
      organizationId: idOf(c.organizationId),
      courseId:       idOf(c.courseId),
      sectionId:      idOf(c.sectionId),
      isHost:         false,
    })
  }
  return doors
}

/* THE ACADEMY TEST, AND ITS FALSY SEMANTICS ARE LOAD-BEARING.

   The check being replaced reads, at liveClassJoin.service.ts:

     if (live.organizationId && ctx.organizationId
         && String(live.organizationId) !== String(ctx.organizationId)) -> refuse

   Both guards matter and both are preserved verbatim. A class with no academy
   (a legacy row) admits anyone — tenancy rule 2. A caller with no academy on
   record stays unscoped — tenancy rule 3b. Only a genuine mismatch refuses.

   ACCOUNT_GONE is NOT handled here: it is answered by callerOrgForRead in
   utils/tenancy.ts before this runs. Collapsing "no academy" into "no account"
   is P-18. */
function doorAdmitsAcademy(door: Door, callerOrg: string | null): boolean {
  if (!door.organizationId || !callerOrg) return true
  return String(door.organizationId) === String(callerOrg)
}

/* ─────────────────────────────────────────────────────
   Single-class form — the seven non-list call sites
───────────────────────────────────────────────────── */
export async function resolveClassEntitlement(
  live:      ClassDoors,
  userId:    string,
  callerOrg: string | null,
  statuses:  EnrolmentStatusRule,
): Promise<Entitlement> {
  const candidates = doorsFor(live).filter(d => doorAdmitsAcademy(d, callerOrg))
  if (candidates.length === 0) {
    return { ok: false, code: 'WRONG_ACADEMY' }
  }

  const { EnrollmentModel } = await import('@/models/schema.ts')
  const statusClause = statuses === 'active' ? 'active' : { $ne: 'dropped' }

  /* Host door first. When the caller carries no academy every door admits them,
     so the first door that yields an enrolment wins and its module verdict is
     final — a student is admitted through ONE door, not through the best of
     several. */
  for (const door of candidates) {
    if (!door.courseId || !Types.ObjectId.isValid(door.courseId)) continue

    const enrolment = await EnrollmentModel.findOne({
      userId:   new Types.ObjectId(userId),
      courseId: new Types.ObjectId(door.courseId),
      status:   statusClause,
    }).select('_id blockedLessons').lean()

    if (!enrolment) continue

    const facts: EnrolmentFacts = {
      id:             String((enrolment as { _id?: unknown })._id),
      blockedLessons: (((enrolment as { blockedLessons?: unknown[] }).blockedLessons) ?? []).map(String),
    }
    return verdictFor(door, facts)
  }

  /* A class with no course at all gates nothing — the pre-existing
     `if (session.courseId)` semantics, preserved. */
  if (candidates.every(d => !d.courseId)) {
    return { ok: true, ...(candidates[0] ? { door: candidates[0] } : {}) }
  }

  return { ok: false, code: 'NOT_ENROLLED' }
}

function verdictFor(door: Door, enrolment: EnrolmentFacts): Entitlement {
  if (door.sectionId && enrolment.blockedLessons.includes(String(door.sectionId))) {
    return { ok: false, code: 'MODULE_BLOCKED', door, enrolment }
  }
  return { ok: true, door, enrolment }
}

/* ─────────────────────────────────────────────────────
   Batch form — the three list call sites

   The lists must not run one resolver call per row; they already load the
   caller's enrolments once and that property is preserved exactly. Same door
   logic, same module rule, one implementation, no N+1.
───────────────────────────────────────────────────── */
export type EnrolmentIndex = Map<string, EnrolmentFacts>

/** Every enrolment the caller holds, keyed by course id. One query. */
export async function loadEnrolmentIndex(
  userId:   string,
  statuses: EnrolmentStatusRule,
): Promise<EnrolmentIndex> {
  const { EnrollmentModel } = await import('@/models/schema.ts')
  const rows = await EnrollmentModel.find(
    {
      userId: new Types.ObjectId(userId),
      status: statuses === 'active' ? 'active' : { $ne: 'dropped' },
    },
    { courseId: 1, blockedLessons: 1 },
  ).lean()

  const index: EnrolmentIndex = new Map()
  for (const r of rows as Array<{ _id?: unknown; courseId?: unknown; blockedLessons?: unknown[] }>) {
    const key = idOf(r.courseId)
    if (!key) continue
    index.set(key, {
      id:             String(r._id),
      blockedLessons: (r.blockedLessons ?? []).map(String),
    })
  }
  return index
}

/** The same verdict as resolveClassEntitlement, computed in memory. */
export function entitlementFrom(
  live:      ClassDoors,
  index:     EnrolmentIndex,
  callerOrg: string | null,
): Entitlement {
  const candidates = doorsFor(live).filter(d => doorAdmitsAcademy(d, callerOrg))
  if (candidates.length === 0) return { ok: false, code: 'WRONG_ACADEMY' }

  for (const door of candidates) {
    if (!door.courseId) continue
    const enrolment = index.get(door.courseId)
    if (!enrolment) continue
    return verdictFor(door, enrolment)
  }

  if (candidates.every(d => !d.courseId)) {
    return { ok: true, ...(candidates[0] ? { door: candidates[0] } : {}) }
  }
  return { ok: false, code: 'NOT_ENROLLED' }
}
