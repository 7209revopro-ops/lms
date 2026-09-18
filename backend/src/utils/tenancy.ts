import { Types } from 'mongoose'
import { CROSS_ORG_CLASSES_ENABLED } from '@/utils/featureFlags.ts'
import type { Request, Response, NextFunction } from 'express'

/* ─────────────────────────────────────────────────────
   Multi-academy tenancy — one implementation
   ─────────────────────────────────────────────────────
   Delta runs two independent academies (Dubai, Bangalore). Every scoped
   record carries an `organizationId`, and staff below super_admin may only
   reach their own academy's rows.

   That rule was previously hand-written in four places, and each copy grew its
   own bug — N-07, N-10 and N-11 were all the same mistake in different files.
   This module is the single implementation, so a fix lands everywhere at once.

   THREE RULES, and the ORDER matters:

     1. super_admin is never scoped. It picks an active academy via the
        X-Organization-Id header, but that is a view filter, not a permission
        boundary.

     2. A record with no academy stays reachable. These predate the split; the
        boot backfill stamps them, so this is a safety net rather than a path
        anyone should hit.

     3. A caller with no academy ON RECORD is unscoped — but a caller with NO
        RECORD AT ALL is denied. Those are different situations and conflating
        them is exactly how N-04 and N-07 happened: `findById` returns null both
        for a legacy account and for one that was deleted while its token is
        still live.

   Note the caller's academy is resolved from the DATABASE when the request
   does not already carry it. `authenticate` and `authenticateAdmin` populate
   `req.user.organizationId`; `authenticateAny` does NOT. Reading the field
   blind is what let a neighbouring academy's admin read identity documents
   (N-07).
───────────────────────────────────────────────────── */

/** The caller's account no longer exists — distinct from having no academy. */
const ACCOUNT_GONE = Symbol('account-gone')

type CallerOrg = string | null | typeof ACCOUNT_GONE

/** Per-request memo so a handler that checks twice only queries once. */
const CACHE = Symbol('caller-org')

export async function resolveCallerOrg(req: Request): Promise<CallerOrg> {
  const cached = (req as Request & { [CACHE]?: CallerOrg })[CACHE]
  if (cached !== undefined) return cached

  let result: CallerOrg
  if (req.user?.organizationId) {
    result = req.user.organizationId
  } else if (!req.user?.id || !Types.ObjectId.isValid(req.user.id)) {
    result = ACCOUNT_GONE
  } else {
    const { UserModel } = await import('@/models/schema.ts')
    const self = await UserModel.findById(req.user.id).select('organizationId').lean()
    result = !self
      ? ACCOUNT_GONE
      : ((self as { organizationId?: unknown }).organizationId?.toString() ?? null)
  }

  ;(req as Request & { [CACHE]?: CallerOrg })[CACHE] = result
  return result
}

/**
 * May this caller act on a record belonging to `recordOrg`?
 * Applies the three rules above. `recordOrg` may be an ObjectId, a string,
 * null or undefined.
 */
/**
 * True when the caller's account no longer exists — a deleted user whose access
 * token is still inside its lifetime.
 *
 * Callers that FILTER by organisation rather than compare against one need this
 * separately, because `resolveCallerOrg` returns two different falsy-looking
 * things: `null` means "exists, no academy on record" (rule 3b — unscoped, by
 * design) and ACCOUNT_GONE means "no record at all" (rule 3a — deny). Code that
 * writes `typeof callerOrg === 'string' ? callerOrg : undefined` collapses the
 * two and hands a deleted account an UNSCOPED view of the whole platform (P-18).
 */
export async function callerIsGone(req: Request): Promise<boolean> {
  return (await resolveCallerOrg(req)) === ACCOUNT_GONE
}

export async function callerMayAccess(req: Request, recordOrg: unknown): Promise<boolean> {
  if (req.user?.role === 'super_admin') return true      /* rule 1 */
  if (!recordOrg) return true                            /* rule 2 */

  const callerOrg = await resolveCallerOrg(req)
  if (callerOrg === ACCOUNT_GONE) return false           /* rule 3a */
  if (!callerOrg) return true                            /* rule 3b */

  return String(callerOrg) === String(recordOrg)
}

/* ─────────────────────────────────────────────────────
   sharedInstructorFilter(callerOrg)
   ─────────────────────────────────────────────────────
   THIS ANSWERS "MAY YOU SEE AND USE", NEVER "MAY YOU CHANGE".

   If you are about to call this before a write, you want callerMayAccess()
   above instead. The two are deliberately adjacent so that whoever reaches for
   one reads the difference.

   An instructor marked `sharedAcrossOrgs` is OWNED by the academy on their
   `organizationId` and LENT to the other: both academies may list them and
   schedule classes for them. Ownership is unchanged, which is what keeps
   "whose instructor is this" answerable for reporting and for cascade rules.

   Returns a Mongo clause, not a boolean, because the widening belongs inside
   the query — filtering in application code after an unscoped read is how a
   list endpoint ends up paginating another academy's rows.

   COMPOSE THIS UNDER $and. Several callers already assign `filter.$or` for
   search or category; assigning `$or` again silently drops those terms and the
   endpoint quietly stops filtering. `role: 'instructor'` is part of the clause
   rather than assumed, so the widening cannot leak onto students even if a
   caller forgets to scope by role.
───────────────────────────────────────────────────── */
export function sharedInstructorFilter(callerOrg: string | null | undefined): Record<string, unknown> | null {
  if (!callerOrg || !Types.ObjectId.isValid(callerOrg)) return null
  return {
    $or: [
      { organizationId: new Types.ObjectId(callerOrg) },
      { role: 'instructor', sharedAcrossOrgs: true },
    ],
  }
}

/* ─────────────────────────────────────────────────────
   servedClassFilter(callerOrg)  /  classServesOrg(live, callerOrg)
   ─────────────────────────────────────────────────────
   THIS ANSWERS "MAY YOU SEE AND USE", NEVER "MAY YOU CHANGE".

   If you are about to call either of these before a write, you want
   callerMayAccess() or callerMayManageSession() instead. Same rule, same
   reason, as sharedInstructorFilter above: conflating the two is how N-07,
   N-10 and N-11 happened.

   A live class belongs to the academy on its `organizationId` and may ALSO
   serve guest academies named in `guestCohorts`, each through that academy's
   own course and module. A class SERVES an academy if it is the owner or names
   it as a guest. Serving is about reaching the room; ownership still decides
   who may move, edit or cancel it.

   COMPOSE THE FILTER UNDER $and VIA andFilter(), NEVER BY ASSIGNING $or. This
   is mandatory rather than stylistic: liveClass.repository.ts assigns
   `query.$or` for the live/ended status buckets, and the admin bookings filter
   assigns `filter.$or` for roster search. A second $or assignment silently
   deletes the first — which is the P-04 shape, twice over, and the symptom is
   a filter that quietly stops filtering. */
export function servedClassFilter(
  callerOrg: string | null | undefined,
  /* INCLUDE CLASSES THAT BELONG TO NOBODY.

     A class created before organizationId existed carries none, and tenancy
     rule 2 says such a record stays unscoped — the join guard refuses only on a
     GENUINE mismatch, `live.organizationId && ctx.organizationId && they
     differ`. A filter that drops unowned rows is therefore stricter than the
     guard it mirrors, and the difference is invisible: the class simply is not
     there.

     It is an OPTION rather than the default because the two callers want
     opposite things, and both are right.

       · The ADMIN ROSTER already excluded unowned classes — it assigned
         organizationId outright — so including them there would be a widening
         nobody asked for, in a phase about narrowing.
       · The STUDENT BROWSE FEED had no academy term at all, so excluding them
         there would hide rows that were previously visible and that nothing
         about this feature intends to hide. That is how "the classes
         disappeared" support waves start. */
  opts: { includeUnowned?: boolean } = {},
): Record<string, unknown> | null {
  if (!callerOrg || !Types.ObjectId.isValid(callerOrg)) return null
  const oid = new Types.ObjectId(callerOrg)
  const arms: Record<string, unknown>[] = [{ organizationId: oid }]

  /* THE GUEST ARM IS GATED, and gating only the entitlement half was a bug.
     With the switch off, a class carrying an authored cohort would still have
     appeared on that academy's schedule and browse feed, and then refused them
     at booking — visible but unbookable, which is worse than invisible because
     it produces a support ticket instead of silence. Off means dark on BOTH
     halves. */
  if (CROSS_ORG_CLASSES_ENABLED) {
    arms.push({ 'guestCohorts.organizationId': oid })
  }
  if (opts.includeUnowned) {
    arms.push({ organizationId: { $exists: false } }, { organizationId: null })
  }
  return { $or: arms }
}

/** The same question about one already-loaded class. */
export function classServesOrg(
  live:      { organizationId?: unknown; guestCohorts?: Array<{ organizationId?: unknown }> } | null | undefined,
  callerOrg: string | null | undefined,
): boolean {
  if (!live || !callerOrg) return false
  if (live.organizationId && String(live.organizationId) === String(callerOrg)) return true
  if (!CROSS_ORG_CLASSES_ENABLED) return false
  return (live.guestCohorts ?? []).some(c => String(c.organizationId) === String(callerOrg))
}

/* ─────────────────────────────────────────────────────
   callerOrgForRead(req)
   ─────────────────────────────────────────────────────
   For the guards that compare the caller's academy against a RECORD's, and
   that were reading `req.user?.organizationId` straight off the request.

   Reading the field blind has two failure modes, and this codebase has hit
   both. A token minted before the field existed carries no academy, so a blind
   read yields undefined and the comparison is skipped entirely — the caller
   goes UNSCOPED rather than being refused, which is the N-07 shape
   `resolveCallerOrg` was written to close. And collapsing "no academy on
   record" into "no such account" is P-18: one must stay unscoped by design,
   the other must be denied.

   So this returns a discriminated result rather than a bare string. The caller
   is forced to answer the gone case, and cannot accidentally treat it as the
   permissive one.

   `resolveCallerOrg` caches per request, so calling this in several guards on
   one request costs one lookup. */
export async function callerOrgForRead(
  req: Request,
): Promise<{ gone: true } | { gone: false; org: string | null }> {
  const org = await resolveCallerOrg(req)
  if (org === ACCOUNT_GONE) return { gone: true }
  return { gone: false, org }
}

/* ─────────────────────────────────────────────────────
   instructorOwnsSession(req, live)
   ─────────────────────────────────────────────────────
   ASSIGNMENT IS THE AUTHORITY, AND IT IS NARROWER THAN THE ACADEMY.

   The academy wall exists so staff cannot reach into the OTHER academy's
   records. It was never meant to answer "may I teach the class I was booked
   to teach". For the instructor named on a session those are different
   questions, and only one of them is about tenancy.

   This matters because an instructor can be LENT. `sharedAcrossOrgs` exists so
   the borrowing academy can schedule them, and `organizationId` still names the
   OWNER — so a lent instructor's borrowed-academy sessions sit, correctly, on
   the other side of their own academy wall. Every guard that asked the academy
   question BEFORE the assignment question therefore answered 404 for the exact
   classes the feature was built to create: the list hid them, the studio would
   not open them, attendance could not be marked on them.

   liveClassJoin.service.ts already had this right — it computes `isAssigned`
   and only falls back to the academy check when the caller is NOT the assigned
   instructor. This helper is that same rule, extracted so the three guards
   that had it backwards share one implementation rather than three copies,
   which is how N-07, N-10 and N-11 happened in the first place.

   WHAT THIS DOES NOT WIDEN. It answers true only for the instructor the
   session itself names. A colleague's session, any session in a course they do
   not teach, and every non-instructor role all fall straight through to the
   ordinary academy check. Students, orders, enrolments and documents are not
   reachable from here at all.

   The parent course's owner is consulted only when the session names nobody,
   which is legacy data from before instructorId was populated (N-10). */
export async function instructorOwnsSession(
  req: Request,
  live: { instructorId?: unknown; courseId?: unknown } | null | undefined,
): Promise<boolean> {
  if (!live) return false
  if (req.user?.role !== 'instructor') return false

  const userId = String(req.user.id)
  if (live.instructorId) return String(live.instructorId) === userId

  if (live.courseId) {
    const { CourseModel } = await import('@/models/schema.ts')
    const course = await CourseModel.findById(String(live.courseId)).select('instructorId').lean()
    return String((course as { instructorId?: unknown } | null)?.instructorId ?? '') === userId
  }
  return false
}

/* Attach a filter clause to `target` without clobbering an existing $or.
   The trap this exists for: user.repository.ts builds `filter.$or` for search
   and category before the org scope is applied. */
export function andFilter(target: Record<string, unknown>, clause: Record<string, unknown> | null): void {
  if (!clause) return
  const existing = (target['$and'] as unknown[] | undefined) ?? []
  target['$and'] = [...existing, clause]
}

/* ─────────────────────────────────────────────────────
   requireSameOrgUser(param)
   ─────────────────────────────────────────────────────
   Route guard for the ~10 admin endpoints that address a USER by id —
   editing, deleting, approving enrolment, rewriting identity-document links.
   None of them compared academies, so an admin of one could act on the
   other's students purely by knowing an id (H-04).

   Answers 404 rather than 403 across an academy boundary, so the endpoint
   never confirms that an id exists elsewhere.
───────────────────────────────────────────────────── */
export function requireSameOrgUser(param: 'id' | 'userId' = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params[param] ?? '')
      if (!Types.ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid user id' },
        }); return
      }

      const { UserModel } = await import('@/models/schema.ts')
      const target = await UserModel.findById(id)
        .select('organizationId role sharedAcrossOrgs').lean() as
          { organizationId?: unknown; role?: string; sharedAcrossOrgs?: boolean } | null
      if (!target) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        }); return
      }

      /* ── The one carve-out ───────────────────────────────────────────────
         An instructor lent to the other academy may be administered by EITHER
         academy — but only by an `admin` or `super_admin`. Sub-admins and
         support get view + schedule through the read-side widening and the
         same 404 as before on anything that writes.

         Narrow on purpose, in three independent ways, because this guard also
         protects DELETE /users/:id and reset-2fa:
           · the record must be role `instructor` AND `sharedAcrossOrgs` — a
             shared student cannot exist (schema validator), so this cannot
             widen to students even if the flag were set by some future path;
           · the caller's role is an explicit allow-list, not a negation;
           · everything else still routes through callerMayAccess untouched.

         This is the product owner's decision, recorded in
         docs/cross-org-instructor-plan.md. The default — and the behaviour for
         every other record — remains strict owner equality. */
      const isLentInstructor = target.role === 'instructor' && target.sharedAcrossOrgs === true
      const callerRole       = req.user?.role
      if (isLentInstructor && (callerRole === 'admin' || callerRole === 'super_admin')) {
        next(); return
      }

      if (!(await callerMayAccess(req, target.organizationId))) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        }); return
      }

      next()
    } catch (err) { next(err) }
  }
}
