import { Router, type Request, type Response, type NextFunction } from 'express'
import { resolveClassEntitlement, loadEnrolmentIndex, entitlementFrom, type ClassDoors } from '@/services/classEntitlement.service.ts'
import { callerOrgForRead, andFilter, servedClassFilter } from '@/utils/tenancy.ts'
import { meetingDisplayName } from '@/utils/meetingIdentity.ts'
import express from 'express'
import { z } from 'zod'
import { LiveClassController, seatsLeftForDoor, labelGuestDoors, yourCohortFrom } from '@/controllers/liveClass.controller.ts'
import { authenticate, authenticateAny, injectCategoryScope } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { resolveLiveStatus, bookingClosesAt, studentJoinWindow } from '@/utils/liveStatus.ts'
import type { PaginationMeta } from '@/types/index.ts'
/* The SHARED sendSuccess, deliberately — not a local one.

   @/utils/response.ts rewrites every stored `pub-*.r2.dev/<key>` URL in the
   response to the /assets proxy, because that bucket is private now and those
   URLs 401. A local copy of sendSuccess skips that rewrite, and the failure is
   silent: the JSON looks perfectly correct, the browser gets a URL it cannot
   fetch, and the avatar falls back to an initial. That is exactly why
   instructor photos appeared in the admin table (shared helper) and not in the
   student class-schedule filter (this file's local one), from the same stored
   value.

   Anything that serialises a stored asset URL has to go through here. */
import { sendSuccess } from '@/utils/response.ts'
import { issueClassHandoff } from '@/controllers/classHandoff.controller.ts'

const router = Router()
const ctrl   = new LiveClassController()

/* ── Helper ─────────────────────────────────── */
/* Join / stream fields — only entitled (enrolled) students may receive these. */
const ENTITLED_ONLY_FIELDS = [
  'muxLiveStreamId',
  'muxStreamKey',
  'muxPlaybackId',
  'muxAssetId',
  'recordingUrl',
  'playbackUrl',
  'mentorNotes',
] as const

/* Never sent to a student, entitled or not.

   `meetingUrl` and `googleMeetCode` used to be entitled-only, which meant
   "enrolled in the course" — every enrolled student could read the Meet link
   from this JSON whether or not they had booked, and long before the class.
   The link now leaves the server only through POST /:id/join, which checks
   the booking and the start..start+20min window at the moment of the click.
   The list carries `isBooked`, `joinOpensAt` and `joinClosesAt` instead, so
   the page can show the button at the right moment without ever holding
   what the button fetches. */
const STAFF_ONLY_FIELDS = [
  'mentorNotes',
  'meetingUrl',
  'googleMeetCode',
  /* Cross-academy bookkeeping. This list is built by spreading the raw
     document, so these arrived on a student's browse feed the moment the
     first class was shared: which OTHER academy the class serves, that
     academy's internal course and module ids, and a live seat breakdown of
     every pool. None of it is a student's business, and the course ids in
     particular are exactly what #assertCohortsUsable refuses to disclose to
     an ADMIN of another academy. */
  'guestCohorts',
  'hostSeatsLeft',
  'overflowSeatsLeft',
] as const

/* ── GET /live-classes — ALL sessions visible to logged-in students ────────────
   Returns every live class (no enrollment filter) so students can browse what's
   coming up. Each session is annotated with `isEnrolled: boolean` so the UI can
   show a "Purchase to join" prompt instead of the join button for non-enrolled users.
   Join/stream fields are only included for sessions the caller is enrolled in.
   Optionally filter by ?status=scheduled|live|ended|all

   NOT paginated, deliberately: `status` is the EFFECTIVE clock-derived status
   computed per row by resolveLiveStatus(), not a stored field, so it cannot be
   filtered in the query. Paginating first would make ?status= search only the
   current page and silently hide a live session sitting further down the list.
──────────────────────────────────────────────────────────────────────────────── */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { LiveClassModel, EnrollmentModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const userId = req.user!.id
    const status = String(req.query['status'] ?? '')

    /* ONE index load, then the same door rule /watch and POST /bookings apply
       — see services/classEntitlement.service.ts. 'active' and 'completed'
       both keep access; only 'dropped' loses it. A session inside a blocked
       module is enrolled but not entitled. */
    const index = await loadEnrolmentIndex(userId, 'notDropped')

    /* Sessions this student's academy is SERVED by: their own academy's, plus
       any class shared with their academy as a guest cohort. A caller with no
       academy on record stays unscoped, which is tenancy rule 3b.

       Resolved rather than read off the request — a session minted before the
       field existed would otherwise leave the caller unscoped.

       Composed under $and via andFilter. The status and search arms elsewhere
       in this handler assign $or, and a second assignment deletes the first. */
    const caller = await callerOrgForRead(req)
    if (caller.gone) { sendSuccess(res, []); return }
    const lcOrgFilter: Record<string, unknown> = {}
    andFilter(lcOrgFilter, servedClassFilter(caller.org, { includeUnowned: true }))
    const classes = await LiveClassModel.find(lcOrgFilter)
      .populate('instructorId', 'id name avatarUrl')
      .populate('courseId', 'id title slug thumbnailUrl program')
      /* `order` and `description` because the module list is a CATALOGUE,
         not a feed: without `order` the modules arrive in whatever order
         their classes were scheduled, so "Module 10" can head the list,
         and without `description` the module has nothing to say for
         itself. Both live on Section already (models/schema.ts:588-596)
         and were simply never selected. */
      .populate('sectionId', 'id title order description')
      .sort({ scheduledStart: 1 })
      .lean({ virtuals: true })

    const now = Date.now()

    /* One query for every seat the caller holds, rather than one per row.
       'attended' still counts: an admin marking a student present mid-class
       must not make their Join button vanish. */
    const { ClassBookingModel } = await import('@/models/schema.ts')
    const seats = await ClassBookingModel.find(
      { userId: new Types.ObjectId(userId), status: { $in: ['booked', 'attended'] } },
      { liveClassId: 1 },
    ).lean()
    const bookedIds = new Set(seats.map((b: any) => String(b.liveClassId)))

    // Annotate with isEnrolled + the effective (clock-based) status:
    // a scheduled session reads 'live' from 15 min before start until its end
    // (resolveLiveStatus), 'ended' after. The STUDENT join window is a
    // different rule — start .. start+20m — carried separately below.
    /* The verdicts BEFORE the map, because the guest doors have to be labelled
       together: their course and module belong to the caller's own academy's
       catalogue, and resolving a name per row would be two queries per class
       instead of two per request. Nothing is asked when no row came through a
       guest door, which is every request until a class is actually shared. */
    const verdicts  = (classes as any[]).map(c => entitlementFrom(c as ClassDoors, index, caller.org))
    const labelDoor = await labelGuestDoors(verdicts.map(v => v.door))

    let annotated = (classes as any[]).map((c, i) => {
      const e = verdicts[i]!
      const isEnrolled = e.ok || e.code === 'MODULE_BLOCKED'
      const isEntitled = e.ok
      const dto: Record<string, unknown> = {
        ...c,
        id:         c.id ?? String(c._id),
        status:     resolveLiveStatus(c.status, c.scheduledStart, c.durationMins ?? 60, now),
        isEnrolled,
        /* ENROLLED IS NOT ENTITLED, AND THE DIFFERENCE IS THE WHOLE
           POINT OF THIS FIELD. `isEnrolled` above is deliberately true
           for MODULE_BLOCKED, so a student the admin locked out of a
           module still SEES its sessions — that is long-standing and
           stays. But it was the only signal on the wire, so the page had
           no way to tell a session it can book from one it cannot, and
           found out only when the click came back 403. Sent so the UI
           can draw the lock BEFORE the click. */
        isEntitled,
        /* When new bookings stop being accepted, computed by the SERVER.
           The schedule screen needs to grey out a seat an hour before the
           class, and deriving that in the browser would put the rule in two
           places — where the two can disagree, and the one the student sees
           is the one that is wrong. */
        bookingClosesAt: c.scheduledStart
          ? bookingClosesAt(c.scheduledStart).toISOString()
          : undefined,
        /* The join window, from the same server clock as everything else on
           this row. The button is drawn from these two instants; the link
           itself is fetched on the click. */
        /* A seat AND a live enrolment. The click requires both (a dropped
           enrolment is refused NOT_ENROLLED), so a row must not promise a
           button the click will refuse; `isEnrolled` above already excludes
           dropped enrolments. */
        isBooked:     isEnrolled && bookedIds.has(String(c._id)),
        joinOpensAt:  c.scheduledStart ? studentJoinWindow(c.scheduledStart).opensAt.toISOString()  : undefined,
        joinClosesAt: c.scheduledStart ? studentJoinWindow(c.scheduledStart).closesAt.toISOString() : undefined,

        /* THIS ROW IS THE CALLER'S DOOR'S TRUTH, NOT THE ROOM'S. Both fields
           are derived on the server and sent as ONE resolved value each,
           because the raw pools are deleted a few lines below for a reason —
           see STAFF_ONLY_FIELDS. The spread above carries the HOST document,
           so without these the schedule screen had only the host's course, the
           host's module and the whole room's seat count to work from:

             · `${sessionCapacity - bookedCount} left` counts seats reserved
               for the other academy's floor. A guest whose own floor was spent
               with the overflow at zero was shown the host's remaining seats
               and then refused SESSION_FULL on every click.
             · the course and module names, and the filters keyed on them, were
               the host academy's — so this page's own programme and course
               filters dropped a class the student holds a seat in.

           `yourCohort` is absent whenever the caller came through the host
           door, and `seatsLeftForYou` whenever no allocation is in force — so
           on a class that is not shared, which is all of them today, both are
           absent and the row serialises exactly as it did. */
        seatsLeftForYou: e.door ? seatsLeftForDoor(c, e.door.organizationId) : undefined,
        yourCohort:      yourCohortFrom(labelDoor(e.door)),
      }
      // Non-entitled students see the listing only — never the way in.
      if (!isEntitled) {
        for (const f of ENTITLED_ONLY_FIELDS) delete dto[f]
      }
      for (const f of STAFF_ONLY_FIELDS) delete dto[f]
      return dto
    })

    // An optional ?status= filter applies to the EFFECTIVE status.
    if (status && status !== 'all') {
      annotated = annotated.filter(c => c['status'] === status)
    }

    sendSuccess(res, annotated)
  } catch (err) { next(err) }
})

/* Upcoming sessions for authenticated user's enrolled courses */
router.get('/upcoming', authenticate, ctrl.upcomingForMe)

/* Student watch access — checks enrollment, returns playback URL or meeting URL */
router.get('/:id/watch', authenticate, ctrl.watchAccess)

/* ── LMS ↔ CLT Connect join tickets (Phase 3) ─────────────────────────────
   The browser posts the returned ticket to CLT, which exchanges it for a
   LiveKit token. The LMS never holds a LiveKit token and CLT never asks the
   LMS a second question: every authorisation decision is baked into the
   ticket at mint time.

   `authenticateAny` because this endpoint is genuinely shared: the studio page
   lives in the ADMIN app (cookie `lms_admin_at`) while instructors may also
   arrive from the client portal (`lms_at`). Using the client guard alone made
   every admin-panel role — super_admin through support — fail with 401
   MISSING_TOKEN, because their cookie is the other one.

   Authorisation is unchanged and still lives in the service: being able to
   authenticate says nothing about being allowed into this class.
──────────────────────────────────────────────────────────────────────────── */
router.post('/:id/host-ticket', authenticateAny, injectCategoryScope, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mintHostTicket, JoinError } = await import('@/services/liveClassJoin.service.ts')
    const { IntegrationDisabledError } = await import('@/services/integrationTicket.service.ts')
    try {
      /* An admin may opt to be SEEN. Default is hidden, so nobody becomes
         visible by forgetting the flag; the instructor path ignores it. */
      const visible = (req.body as { visible?: boolean } | undefined)?.visible === true

      /* Resolved rather than read off the request. assertAdminMayObserve
         compares ctx.organizationId against the class's, and a session minted
         before the field existed carried none — which made an admin observer
         UNSCOPED across academies instead of refused. The sibling student
         routes below already resolve it from the record; this one did not. */
      const hostCaller = await callerOrgForRead(req)
      if (hostCaller.gone) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Live class not found' } }); return
      }

      const minted = await mintHostTicket(String(req.params['id'] ?? ''), {
        userId: req.user!.id,
        /* The instructor's own identity, by the one rule — see
           utils/meetingIdentity.ts. req.user carries no display name, and the
           email is what the default mode wants anyway. */
        name:   meetingDisplayName({ email: req.user!.email }, 'Instructor'),
        email:  req.user!.email,
        role:   req.user!.role,
        ...(hostCaller.org ? { organizationId: hostCaller.org } : {}),
        /* Set by injectCategoryScope above. Without it the programme gate in
           the service has nothing to compare and lets every class through. */
        ...(req.user!.categoryScope ? { categoryScope: req.user!.categoryScope } : {}),
      }, { visible })
      sendSuccess(res, {
        ticket:    minted.ticket,
        expiresIn: minted.expiresIn,
        roomName:  minted.roomName,
        hidden:    minted.hidden,
        /* Where the browser redeems it. Sent by the server so the frontend
           carries no hard-coded meeting-platform address. */
        joinUrl:   `${(process.env['CLT_BASE_URL'] ?? '').replace(/\/+$/, '')}/api/lms/join`,
      }, 'Host ticket issued')
    } catch (err: any) {
      if (err instanceof IntegrationDisabledError) {
        res.status(503).json({ success: false, error: { code: 'INTEGRATION_DISABLED', message: err.message } })
        return
      }
      if (err instanceof JoinError) {
        if (err.retryAfter) res.set('Retry-After', String(err.retryAfter))
        res.status(err.status).json({
          success: false,
          error: { code: err.code, message: err.message, ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}) },
        })
        return
      }
      throw err
    }
  } catch (err) { next(err) }
})

/* Student join ticket. Same shape as /host-ticket, but every entitlement rule
   in §7 of the plan runs first: booking, enrolment, module access, academy and
   the time window. A refusal here is the ONLY thing standing between a student
   and a classroom they have not paid for — CLT trusts the ticket completely. */
/* ── POST /live-classes/:id/join — the Google Meet link, on the click ─────
   The only way a student obtains a Meet URL. Everything the LiveKit ticket
   checks is checked here too (booking, enrolment, module, academy, account),
   then the Meet window: from the class start to twenty minutes after it. A
   refusal is the whole protection — no list, feed or watch payload carries
   the URL any more.

   425 + Retry-After for "not yet", so the page can count down rather than
   show a dead error to somebody who is merely early. */
router.post('/:id/join', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { resolveMeetJoin, JoinError } = await import('@/services/liveClassJoin.service.ts')
    try {
      const { UserModel } = await import('@/models/schema.ts')
      /* enrollmentStatus and isActive are not on the token — they change while
         a session is live, so they are read fresh on every click.

         `authenticate` already refuses a disabled account before this runs,
         so isActive here is a second line, not the first; it is kept because
         the gate must stay correct if it is ever called from a path without
         that middleware, and because the ticket route beside it does the
         same. enrollmentStatus has no upstream check at all. */
      const me = await UserModel.findById(req.user!.id)
        .select('name email enrollmentStatus isActive organizationId').lean() as any

      const joined = await resolveMeetJoin(String(req.params['id'] ?? ''), {
        userId: req.user!.id,
        name:   meetingDisplayName({ name: me?.name, email: req.user!.email }, 'Student'),
        email:  req.user!.email,
        role:   req.user!.role,
        ...(me?.organizationId ? { organizationId: String(me.organizationId) } : {}),
        ...(me?.enrollmentStatus ? { enrollmentStatus: me.enrollmentStatus } : {}),
        isActive: me?.isActive !== false,
      })
      /* The one response that carries the link must never be served from a
         cache — not the browser's, not a proxy's. Everything the gate just
         decided is only true for this click. */
      res.set('Cache-Control', 'no-store')
      sendSuccess(res, { url: joined.url, closesAt: joined.closesAt.toISOString() }, 'Join link issued')
    } catch (err: any) {
      if (err instanceof JoinError) {
        if (err.retryAfter) res.set('Retry-After', String(err.retryAfter))
        res.status(err.status).json({
          success: false,
          error: { code: err.code, message: err.message, ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}) },
        })
        return
      }
      throw err
    }
  } catch (err) { next(err) }
})

router.post('/:id/join-ticket', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mintStudentTicket, JoinError } = await import('@/services/liveClassJoin.service.ts')
    const { IntegrationDisabledError } = await import('@/services/integrationTicket.service.ts')
    try {
      const { UserModel } = await import('@/models/schema.ts')
      /* enrollmentStatus and isActive are not on the token — they change while
         a session is live, so they are read fresh on every mint. */
      const me = await UserModel.findById(req.user!.id)
        .select('name email enrollmentStatus isActive organizationId').lean() as any

      const minted = await mintStudentTicket(String(req.params['id'] ?? ''), {
        userId: req.user!.id,
        name:   meetingDisplayName({ name: me?.name, email: req.user!.email }, 'Student'),
        email:  req.user!.email,
        role:   req.user!.role,
        ...(me?.organizationId ? { organizationId: String(me.organizationId) } : {}),
        ...(me?.enrollmentStatus ? { enrollmentStatus: me.enrollmentStatus } : {}),
        isActive: me?.isActive !== false,
      })
      sendSuccess(res, {
        ticket:    minted.ticket,
        expiresIn: minted.expiresIn,
        roomName:  minted.roomName,
        joinUrl:   `${(process.env['CLT_BASE_URL'] ?? '').replace(/\/+$/, '')}/api/lms/join`,
      }, 'Join ticket issued')
    } catch (err: any) {
      if (err instanceof IntegrationDisabledError) {
        res.status(503).json({ success: false, error: { code: 'INTEGRATION_DISABLED', message: err.message } })
        return
      }
      if (err instanceof JoinError) {
        /* 425 carries Retry-After so the page can count down instead of
           showing a dead error to somebody who is simply early. */
        if (err.retryAfter) res.set('Retry-After', String(err.retryAfter))
        res.status(err.status).json({
          success: false,
          error: { code: err.code, message: err.message, ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}) },
        })
        return
      }
      throw err
    }
  } catch (err) { next(err) }
})

/* Mux webhook — must use raw body parser BEFORE json parser for signature verification */
router.post(
  '/mux-webhook',
  express.raw({ type: 'application/json' }),
  ctrl.muxWebhook,
)

/* ─────────────────────────────────────────────────────
   STUDENT HOMEWORK ENDPOINTS
   GET  /live-classes/:id/homework    — view homework for a session
   POST /live-classes/homework/:id/submit — submit homework
─────────────────────────────────────────────────────── */

/* A student may only see/submit homework for a session they booked, or
   whose course they are actively enrolled in. */
async function hasSessionAccess(userId: string, liveClassId: string, callerOrg: string | null = null): Promise<boolean> {
  const { ClassBookingModel, EnrollmentModel, LiveClassModel } = await import('@/models/schema.ts')
  const { Types } = await import('mongoose')
  if (!Types.ObjectId.isValid(liveClassId)) return false

  const booking = await ClassBookingModel.findOne({
    userId:      new Types.ObjectId(userId),
    liveClassId: new Types.ObjectId(liveClassId),
    status:      { $ne: 'cancelled' },
  }).lean()
  if (booking) return true

  const session = await LiveClassModel.findById(liveClassId)
    .select('courseId sectionId organizationId guestCohorts').lean()
  if (!session?.courseId) return false

  /* ENROLMENT, ASKED OF ONE DOOR — see classEntitlement.service.ts. 'active'
     and 'completed' both keep access; only 'dropped' loses it.

     MODULE_BLOCKED IS DELIBERATELY TREATED AS ACCESS HERE, because it always
     has been: this gate never had a module check, and Phase 1 of the
     cross-academy work is a refactor that changes no answer. Whether a student
     blocked on a module should still reach that session's homework is a real
     question with a defensible answer either way, and it is not this change's
     to decide. Written down rather than silently altered. */
  /*       THE ACADEMY IS PASSED HERE TOO, and it has to be. Booking and JOIN both
       resolve the door with the caller's academy; a read path that resolves it
       with null can pick a DIFFERENT door, and then the page says yes while the
       door says no. Same rule everywhere, or the rule is not a rule. */
  const entitlement = await resolveClassEntitlement(session, userId, callerOrg, 'notDropped')
  return entitlement.ok || entitlement.code === 'MODULE_BLOCKED'
}

router.get('/:id/homework', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { SessionHomeworkModel } = await import('@/models/schema.ts')
    const liveClassId = String(req.params['id'] ?? '')
    const hwCaller = await callerOrgForRead(req)
    if (hwCaller.gone || !(await hasSessionAccess(req.user!.id, liveClassId, hwCaller.org))) {
      res.status(403).json({ success: false, error: { code: 'NOT_ENROLLED', message: 'You must be enrolled in this course to view this homework' } }); return
    }
    const list = await SessionHomeworkModel.find({ liveClassId }).lean({ virtuals: true })
    sendSuccess(res, list)
  } catch (err) { next(err) }
})

const submitHomeworkSchema = z.object({
  submissionText: z.string().max(10000).optional(),
  submissionUrl:  z.string().url().max(500).optional(),
}).refine(d => d.submissionText || d.submissionUrl, { message: 'Provide text or URL' })

router.post('/homework/:id/submit', authenticate, validate(submitHomeworkSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { HomeworkSubmissionModel, SessionHomeworkModel } = await import('@/models/schema.ts')
    const homeworkId = String(req.params['id'] ?? '')
    const hw = await SessionHomeworkModel.findById(homeworkId)
    if (!hw) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Homework not found' } }); return }
    const hwCaller2 = await callerOrgForRead(req)
    if (hwCaller2.gone || !(await hasSessionAccess(req.user!.id, String(hw.liveClassId), hwCaller2.org))) {
      res.status(403).json({ success: false, error: { code: 'NOT_ENROLLED', message: 'You must be enrolled in this course to submit this homework' } }); return
    }

    const { submissionText, submissionUrl } = req.body as { submissionText?: string; submissionUrl?: string }
    const existing = await HomeworkSubmissionModel.findOne({ homeworkId, userId: req.user!.id })
    if (existing) {
      // Update existing submission
      existing.submissionText = submissionText
      existing.submissionUrl  = submissionUrl
      existing.status         = 'submitted'
      await existing.save()
      sendSuccess(res, existing, 'Submission updated')
      return
    }
    const sub = await HomeworkSubmissionModel.create({
      homeworkId,
      userId: req.user!.id,
      submissionText,
      submissionUrl,
    })
    sendSuccess(res, sub, 'Homework submitted', 201)
  } catch (err) { next(err) }
})

/* HANDOFF — send this browser to CLT Connect to enter the class.

   `authenticate`, not `authenticateAny`: this router must resolve the STUDENT
   session and nothing else. The admin portal mounts the very same handler
   behind its own guard, so the identity follows the portal the click came
   from. The handler explains why that matters. */
router.post('/:id/handoff', authenticate, injectCategoryScope, issueClassHandoff)

export default router
