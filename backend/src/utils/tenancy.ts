import { Types } from 'mongoose'
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
