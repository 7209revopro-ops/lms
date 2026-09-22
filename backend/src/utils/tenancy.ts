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
           · the record must be role `instructor` AND `sharedAcrossOrgs`. Both
             halves are load-bearing and the role half is what actually holds:
             the schema's validator is document middleware and does NOT run on
             findByIdAndUpdate, so the flag really could be written onto a
             student for a while (see the note on the hook in models/schema.ts
             and the guard in UserService#adminUpdate). Because this clause
             tests the role itself rather than trusting the flag, a mis-flagged
             student was never reachable through it;
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

/* ─────────────────────────────────────────────────────
   requireBorrowedInstructorUnchanged(param)
   ─────────────────────────────────────────────────────
   The limit of the lent-instructor carve-out above.

   That carve-out lets EITHER academy's admin administer a lent instructor —
   reset their second factor, fix their name, deactivate them — because the
   borrowing academy schedules them and needs to be able to act. It was never a
   grant to RE-CLASSIFY them, and two fields on PATCH /users/:id do exactly
   that:

     · `role`. A lent instructor keeps their OWNER's organizationId, so a
       borrowing-academy admin who sets role 'admin' on them does not create an
       admin of their own academy — they create one inside the LENDING academy,
       through the one record that is reachable across the wall. That is the
       academy boundary handing out staff accounts on the other side of itself.
       Neither academy's Users list would show what happened as anything but an
       ordinary role change.

     · `sharedAcrossOrgs`. The lending is the OWNER's decision. Letting the
       borrower switch it off would also un-lend them from a third academy's
       point of view, and — because a class's instructor is re-checked on every
       save — silently make the owner's own classes unsaveable.

   403 rather than 404: the caller can legitimately SEE this user, so there is
   nothing to hide, and a refusal that says which field is the problem is the
   difference between "fix this" and "the panel is broken".

   Mounted only on the PATCH. DELETE and reset-2fa stay inside the carve-out,
   which is the product decision recorded in docs/cross-org-instructor-plan.md.
───────────────────────────────────────────────────── */
export function requireBorrowedInstructorUnchanged(param: 'id' | 'userId' = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.user?.role === 'super_admin') { next(); return }

      const body = req.body as { role?: unknown; sharedAcrossOrgs?: unknown }
      const wantsRole   = body.role !== undefined
      const wantsShared = body.sharedAcrossOrgs !== undefined
      if (!wantsRole && !wantsShared) { next(); return }

      const id = String(req.params[param] ?? '')
      if (!Types.ObjectId.isValid(id)) { next(); return }

      const { UserModel } = await import('@/models/schema.ts')
      const target = await UserModel.findById(id)
        .select('organizationId role sharedAcrossOrgs').lean() as
          { organizationId?: unknown; role?: string; sharedAcrossOrgs?: boolean } | null
      /* A missing user, or one who is not lent, is not this guard's business —
         requireSameOrgUser has already decided whether the caller may be here
         at all, and ctrl.updateUser answers 404 for a missing id. */
      if (!target) { next(); return }
      if (!(target.role === 'instructor' && target.sharedAcrossOrgs === true)) { next(); return }

      const callerOrg = req.user?.organizationId
      const owns = !!callerOrg && !!target.organizationId
        && String(target.organizationId) === String(callerOrg)
      if (owns) { next(); return }

      /* A role that is not actually changing is a no-op the Edit modal sends
         on every save, so refusing on the key's mere presence would break
         ordinary edits — the same trap the cohort gate on the live-class PATCH
         documents. Compare values, not keys. */
      const roleChanges   = wantsRole   && String(body.role) !== String(target.role)
      const sharedChanges = wantsShared && Boolean(body.sharedAcrossOrgs) !== (target.sharedAcrossOrgs === true)
      if (!roleChanges && !sharedChanges) { next(); return }

      res.status(403).json({ success: false, error: {
        code: 'BORROWED_INSTRUCTOR',
        message: roleChanges
          ? 'This instructor belongs to the other academy. Their role can only be changed by the academy that owns them.'
          : 'This instructor belongs to the other academy. Only the academy that owns them can change whether they are shared.',
      } })
    } catch (err) { next(err) }
  }
}

/* ─────────────────────────────────────────────────────
   requireImpersonableStudent(param)
   ─────────────────────────────────────────────────────
   Who an admin or sub_admin may "view as".

   Impersonation was super_admin only. Widening it is a real grant, so the
   widening is deliberately the narrow half of the feature:

     · The CLIENT-PORTAL flow only. That session is READ-ONLY - every non-GET
       is refused by denyImpersonatedWrite (auth.middleware.ts:133) - so an
       admin sees what a student sees and cannot act as them. The admin-panel
       flow, which is not read-only and exists to impersonate STAFF, stays
       super_admin only.
     · STUDENTS only. Anything else is a privilege question rather than a
       support one, and an admin impersonating another admin - or a
       super_admin - would be escalation with a trail that names the wrong
       person as the actor.
     · The caller's OWN academy. Neither impersonation route ever compared
       organisations, which was safe only because the one role that could
       reach them is cross-org by design. The moment a per-academy role can
       call it, that omission becomes a cross-tenant hole.
     · A sub_admin is confined further, to its programme, using the same
       clause the rest of the admin applies to students:
       { $or: [{ category: scope }, { categories: scope }] }.

   404 for a target outside the caller's reach, never 403 - the same rule
   requireSameOrgUser follows, so the endpoint cannot be used to discover
   which ids exist in the other academy.

   super_admin passes through untouched: the existing behaviour, and the
   suites that assert it, are unchanged.
───────────────────────────────────────────────────── */
export function requireImpersonableStudent(param: 'id' | 'userId' = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const role = req.user?.role
      if (role === 'super_admin') { next(); return }

      if (role !== 'admin' && role !== 'sub_admin') {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Your role cannot view accounts as their owner.' },
        }); return
      }

      const id = String(req.params[param] ?? '')
      if (!Types.ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid user id' },
        }); return
      }

      const { UserModel } = await import('@/models/schema.ts')
      const target = await UserModel.findById(id)
        .select('organizationId role isActive category categories').lean() as {
          organizationId?: unknown; role?: string; isActive?: boolean
          category?: string; categories?: string[]
        } | null

      const notFound = () => res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      })

      /* Absent, or in the other academy: the same answer, so neither can be
         told apart from the outside.

         NOT callerMayAccess. That helper is deliberately generous about
         missing data — rule 2 lets a record with no academy be read by
         anyone, and rule 3b (tenancy.ts:94) returns TRUE when the CALLER has
         no academy. Those allowances exist so legacy rows stay readable, and
         they are wrong for this question. `bun run seed` creates its admin
         with no organizationId at all, and index.ts's boot backfill skips
         super_admin, so an org-less staff account is ordinary rather than
         exotic — and under rule 3b such an admin would have passed this wall
         for students of BOTH academies.

         "Whose identity may I borrow" is the strictest question this codebase
         asks, so it gets the strictest comparison: both sides must name an
         academy, and they must be the same one. */
      if (!target) { notFound(); return }

      const caller = await callerOrgForRead(req)
      if (caller.gone || !caller.org) { notFound(); return }
      if (!target.organizationId || String(target.organizationId) !== String(caller.org)) {
        notFound(); return
      }

      if (target.role !== 'student') {
        res.status(403).json({
          success: false,
          error: { code: 'NOT_A_STUDENT', message: 'Only student accounts can be viewed this way.' },
        }); return
      }

      /* A sub_admin sees one programme, and "in this programme" is a
         THREE-arm rule, not an equality test. The third arm is the one that
         matters: nothing about enrolling on a course writes `categories`, so
         a student categorised for one programme but sitting on another's
         course appears in that sub_admin's Students table through
         studentIdsOnProgramCourses. Comparing only the two fields would have
         404'd the "View as student" button on exactly the rows the table had
         just drawn — the button and the server disagreeing about the very
         population this widening exists for. The predicate is imported rather
         than restated so the two cannot drift.

         404 rather than 403, consistent with the academy boundary above: a
         403 here would let a sub_admin probe which students exist outside
         their programme. The write-side precedents (rejectEnrollment) answer
         403 because by then the record is already on the admin's screen; this
         runs before anything is shown. */
      /* A SUB-ADMIN WITH NO PROGRAMME GETS NOTHING.

         This first read `if (role === 'sub_admin' && scope)`, so a missing
         scope skipped the whole test and handed that account the academy.
         I justified it against `if (scope)` at admin.controller.ts:236 and
         :698 — but those COERCE a value (stamp my programme on what I
         create), they do not AUTHORISE. Every place that authorises fails
         closed: admin.routes.ts:938 `if (!scope || !(await
         studentMatchesScope(...)))` -> 403, and :1128 `const ok = !!scope &&
         ...`. I checked the wrong precedent.

         It matters because the account is easy to produce by accident rather
         than rare: userUpdateSchema (admin.routes.ts:283) carries no
         `program`, so promoting somebody to sub_admin through Edit User
         silently drops the programme the modal insisted on — leaving exactly
         this scope-less sub_admin. Failing open meant that account could read
         any student's portal while being refused a mere list of the same
         student's enrolments. */
      const scope = req.user?.categoryScope
      if (role === 'sub_admin') {
        if (!scope) { notFound(); return }
        let inScope = target.category === scope
          || (Array.isArray(target.categories) && target.categories.includes(scope))
        if (!inScope) {
          const { UserRepository } = await import('@/repositories/user.repository.ts')
          const enrolled = await new UserRepository().studentIdsOnProgramCourses(scope)
          inScope = enrolled.some(eid => String(eid) === id)
        }
        if (!inScope) { notFound(); return }
      }

      next()
    } catch (err) { next(err) }
  }
}
