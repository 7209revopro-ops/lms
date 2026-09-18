import { Types } from 'mongoose'
import { resolveClassEntitlement, loadEnrolmentIndex, entitlementFrom, type ClassDoors } from '@/services/classEntitlement.service.ts'
import { LiveClassRepository } from '@/repositories/liveClass.repository.ts'
import { CourseRepository } from '@/repositories/course.repository.ts'
import { EnrollmentRepository } from '@/repositories/enrollment.repository.ts'
/* sendLiveClassScheduled is no longer called from here: a new session is a
   Standard-tier event and goes out in the daily digest instead. The sender
   is kept for any caller that genuinely needs a standalone announcement. */
import { queueDigestItem } from '@/jobs/digest.job.ts'
import * as muxSvc from '@/services/mux.service.ts'
import { fetchMeetRecordingUrl } from '@/services/googleMeet.service.ts'
import { logger } from '@/utils/logger.ts'
import { env } from '@/config/env.ts'
import { EnrollmentModel, LiveClassModel, UserModel, type ILiveClass, type LiveClassType, type LiveClassProvider } from '@/models/schema.ts'
import { roomNameFor } from '@/services/integrationTicket.service.ts'
import { tryEnsureRoom } from '@/services/clt.service.ts'

/* CLT caps a LiveKit room at 50 participants and 8 concurrent rooms. Kept here
   as a named constant so the admin UI and the tests quote the same number. */
export const LIVEKIT_MAX_PARTICIPANTS = Number(process.env['LIVEKIT_MAX_PARTICIPANTS'] ?? 50)

export class LiveClassError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'LiveClassError'
  }
}

export class LiveClassService {
  private readonly liveRepo   = new LiveClassRepository()
  private readonly courseRepo = new CourseRepository()
  private readonly enrollRepo = new EnrollmentRepository()

  /* ── Public list — slug-based for the course page ─── */
  /* Admin — list all live classes across all courses */
  async listAll(filter: { status?: string; limit?: number; courseIds?: string[]; organizationId?: string; instructorId?: string } = {}): Promise<ILiveClass[]> {
    return this.liveRepo.listAll(filter)
  }

  async getById(id: string): Promise<ILiveClass> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    const live = await this.liveRepo.findByIdPopulated(id)
    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)

    /* When live, refresh viewer count from Mux monitoring API in the background.
       We fire-and-forget so the response is still fast — next poll gets updated count. */
    if (live.status === 'live' && live.type === 'internal' && env.MUX_TOKEN_ID) {
      void muxSvc.getLiveViewerCount().then(async count => {
        await LiveClassModel.updateOne({ _id: live._id }, { $set: { viewerCount: count } })
      }).catch(() => {/* non-fatal */})
    }

    return live
  }

  async listForCourseSlug(slug: string, userId?: string): Promise<(ILiveClass & { isEnrolled: boolean; isEntitled: boolean })[]> {
    const course = await this.courseRepo.findBySlug(slug)
    if (!course) throw new LiveClassError('COURSE_NOT_FOUND', 'Course not found', 404)
    const sessions = await this.liveRepo.listForCourse(course.id)

    /* ONE index load, then the same door rule the watch page and the booking
       route apply — see services/classEntitlement.service.ts. 'active' and
       'completed' both keep access; only 'dropped' loses it. */
    if (!userId) {
      return sessions.map(s => Object.assign(s, { isEnrolled: false, isEntitled: false }))
    }
    const index = await loadEnrolmentIndex(userId, 'notDropped')

    return sessions.map(s => {
      const e = entitlementFrom(s as unknown as ClassDoors, index, null)
      return Object.assign(s, {
        isEnrolled: e.ok || e.code === 'MODULE_BLOCKED',
        /* A blocked module is never entitled — the same gate /watch applies. */
        isEntitled: e.ok,
      })
    })
  }

  async listForCourseId(courseId: string): Promise<ILiveClass[]> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new LiveClassError('INVALID_ID', 'Invalid course id', 400)
    }
    return this.liveRepo.listForCourse(courseId)
  }

  /* ── Upcoming feed — all sessions, annotated with isEnrolled ─────────────── */
  async listUpcomingForUser(userId: string, limit = 50, categoryFilter?: string): Promise<(ILiveClass & { isEnrolled: boolean; isEntitled: boolean })[]> {
    // Find which courses the user has purchased so we can annotate isEnrolled.
    // 'active' and 'completed' both keep access — only 'dropped' loses it.
    // blockedLessons stores SECTION ids (legacy misnomer): a session inside a
    // blocked module is not entitled even though the course enrolment is.
    const index = await loadEnrolmentIndex(userId, 'notDropped')

    // If student has a category, restrict to that category's courses
    let courseIds: string[] | undefined
    if (categoryFilter) {
      const { CourseModel } = await import('@/models/schema.ts')
      const courses = await CourseModel.find({ program: categoryFilter }, { _id: 1 }).lean()
      courseIds = courses.map((c: any) => String(c._id))
      // No courses in this category → return empty rather than showing all sessions
      if (courseIds.length === 0) return []
    }

    // Return upcoming sessions (optionally filtered by category's courseIds)
    const sessions = await this.liveRepo.listAllUpcoming(limit, courseIds)

    return sessions
      .slice()
      .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
      .slice(0, limit)
      .map(s => {
        const e = entitlementFrom(s as unknown as ClassDoors, index, null)
        return Object.assign(s, {
          isEnrolled: e.ok || e.code === 'MODULE_BLOCKED',
          isEntitled: e.ok,
        })
      })
  }

  /* ── Who may be named as the instructor on a class ──────────────────────
     create() cast `instructorId` straight to an ObjectId and update() checked
     only that the string parsed. Existence, role and academy were never
     checked on either path, so all three of these were accepted:

       · a student's id                         (no role check)
       · an id matching no user at all          (no existence check)
       · another academy's UNSHARED instructor  (no tenancy check)

     All three are proven in crossorginstructor.deep.suite.ts, where they were
     recorded as observations rather than failures. This is that fix.

     THE ROLE RULE IS "NOT A STUDENT", NOT "IS AN INSTRUCTOR", DELIBERATELY.
     liveClass.controller.ts #createOne defaults instructorId to the CALLER's
     own id when the form omits it, and that caller is routinely an admin,
     sub_admin or support scheduling a session they will host themselves.
     Requiring role 'instructor' would refuse that everyday path. Every
     non-student role already signs in to the admin portal and can hold a host
     ticket (see liveClassJoin.service.ts), so the boundary that actually
     matters here is the student one.

     ACROSS ACADEMIES THE ANSWER IS 404, carrying the same code a missing user
     gets. Same reasoning as requireSameOrgUser in utils/tenancy.ts: an admin
     must not be able to discover which ids exist in the other academy by
     reading the difference between two error codes.

     A LENT INSTRUCTOR IS THE ONE EXCEPTION. `sharedAcrossOrgs` answers the
     same SEE-and-USE question as sharedInstructorFilter() in utils/tenancy.ts,
     which is what puts the instructor in the borrowing academy's picker in the
     first place. Refusing them here would offer an instructor the admin then
     could not schedule. The flag is unpersistable on a non-instructor (schema
     validator), and the role is re-checked here rather than assumed. */
  async #assertInstructorUsable(
    instructorId: string,
    classOrgId:   Types.ObjectId | null,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(instructorId)) {
      throw new LiveClassError('INVALID_INSTRUCTOR_ID', 'Invalid instructor id', 400)
    }

    const instructor = await UserModel.findById(instructorId)
      .select('role organizationId sharedAcrossOrgs').lean() as
        { role?: string; organizationId?: Types.ObjectId; sharedAcrossOrgs?: boolean } | null

    if (!instructor) {
      throw new LiveClassError('INSTRUCTOR_NOT_FOUND', 'Instructor not found', 404)
    }

    /* TENANCY BEFORE ROLE, and the order is the point. Every refusal about a
       record the caller cannot see has to be the SAME refusal a missing record
       gets, or the difference between two error codes enumerates the other
       academy. Answering "that is a student" first would do exactly that: it
       confirms the id exists, and that it belongs to a student, for an account
       the caller has no business resolving at all.

       Compare academies only when BOTH are known. A class with no academy, or
       a staff account that predates organizationId, stays unscoped — the same
       convention as callerMayAccess rule 3b in utils/tenancy.ts and the guard
       in liveClass.controller.ts canManage. Refusing on a missing value would
       reject legitimate legacy rows without closing anything the org scope
       does not already cover. A super_admin carries no organizationId by
       design (src/index.ts skips the role in the boot backfill, and
       create-super-admin.ts never sets it), so this is never out of reach
       for them rather than needing a role exemption. */
    const instructorOrg = instructor.organizationId
    const outOfReach =
      classOrgId && instructorOrg &&
      String(instructorOrg) !== String(classOrgId) &&
      !(instructor.role === 'instructor' && instructor.sharedAcrossOrgs === true)

    if (outOfReach) {
      throw new LiveClassError('INSTRUCTOR_NOT_FOUND', 'Instructor not found', 404)
    }

    /* Only now, about a record the caller can legitimately see. */
    if (instructor.role === 'student') {
      throw new LiveClassError(
        'INSTRUCTOR_NOT_STAFF',
        'That account is a student and cannot be assigned to teach a class',
        400,
      )
    }
  }

  /* ── A module must belong to the course it gates ───────────────────────
     create() and update() validated only that sectionId PARSED. So a class
     could already be gated to a module of some OTHER course — and then the
     module gate tests an id that appears in nobody's blockedLessons for that
     course, which means it never fires. A silent open door, predating this
     work, and #studentsAtModule carries a defensive targetIdx === -1 branch
     precisely because of it.

     A design keyed on (course, module) pairs cannot inherit that hole, so it
     is closed here for the host pair as well as for every guest cohort. */
  async #assertSectionBelongsToCourse(sectionId: string, courseId: string): Promise<void> {
    const { SectionModel } = await import('@/models/schema.ts')
    const section = await SectionModel.findById(sectionId).select('courseId').lean()
    if (!section || String((section as { courseId?: unknown }).courseId ?? '') !== String(courseId)) {
      throw new LiveClassError('SECTION_NOT_IN_COURSE',
        'That module does not belong to the selected course', 400)
    }
  }

  /* ── Guest cohorts: each academy's own door into this room ──────────────
     Modelled on #assertInstructorUsable, including its ordering: the TENANCY
     question is answered before anything more specific, so the error code can
     never be used to enumerate which ids exist in the other academy.

     What is proven here, per cohort:
       · the academy exists;
       · the course belongs to THAT academy — otherwise the class would admit
         a cohort through a door into a third party's catalogue;
       · the module belongs to THAT course — the namespace guarantee the whole
         module gate rests on.

     What CANNOT be proven here, and is the feature's known sharp edge: that the
     guest module teaches the same syllabus as the host's. Somebody picks it by
     hand. Course.program is a one-to-many programme scope, so it is a hint for
     the picker and can never be the check. */
  async #assertCohortsUsable(
    cohorts:    Array<{ organizationId?: unknown; courseId?: unknown; sectionId?: unknown }>,
    classOrgId: Types.ObjectId | null,
  ): Promise<void> {
    if (!cohorts.length) return
    const { OrganizationModel, CourseModel } = await import('@/models/schema.ts')

    const seen = new Set<string>()
    for (const c of cohorts) {
      const org     = String(c.organizationId ?? '')
      const course  = String(c.courseId ?? '')
      const section = c.sectionId ? String(c.sectionId) : ''

      if (!Types.ObjectId.isValid(org) || !Types.ObjectId.isValid(course)) {
        throw new LiveClassError('INVALID_COHORT', 'A guest cohort must name an academy and a course', 400)
      }
      if (classOrgId && org === String(classOrgId)) {
        throw new LiveClassError('INVALID_COHORT', 'A class cannot be a guest of its own academy', 400)
      }
      if (seen.has(org)) {
        throw new LiveClassError('INVALID_COHORT', 'An academy may appear only once', 400)
      }
      seen.add(org)

      if (!(await OrganizationModel.exists({ _id: org }))) {
        throw new LiveClassError('COHORT_NOT_FOUND', 'Academy not found', 404)
      }

      const courseDoc = await CourseModel.findById(course).select('organizationId').lean()
      /* 404, and the SAME code a missing academy gets: a Dubai admin must not
         learn which Bangalore course ids exist by reading the difference. */
      if (!courseDoc || String((courseDoc as { organizationId?: unknown }).organizationId ?? '') !== org) {
        throw new LiveClassError('COHORT_NOT_FOUND', 'Course not found', 404)
      }

      if (section) {
        if (!Types.ObjectId.isValid(section)) {
          throw new LiveClassError('INVALID_COHORT', 'Invalid module id', 400)
        }
        await this.#assertSectionBelongsToCourse(section, course)
      }
    }
  }

  /* ── Admin/instructor create ──────────────────────── */
  async create(input: {
    courseId:         string
    instructorId:     string
    title:            string
    description?:     string
    scheduledStart:   Date
    durationMins:     number
    type:             LiveClassType
    provider?:        LiveClassProvider
    meetingUrl?:      string
    googleMeetCode?:  string
    sectionId?:       string
    sessionCapacity?: number
    language?:        string
    isOnline?:        boolean
    location?:        string
    room?:            string
    organizationId?:  string
    seriesId?:        string
    /* Guest academies this class also serves. Authoring only in this phase —
       nothing reads them for entitlement until CROSS_ORG_CLASSES is on. */
    guestCohorts?:    Array<{ organizationId: string; courseId: string; sectionId?: string; seatFloor: number }>
    overflowSeats?:   number
  }): Promise<ILiveClass> {
    if (!Types.ObjectId.isValid(input.courseId)) {
      throw new LiveClassError('INVALID_COURSE_ID', 'Invalid course id', 400)
    }
    const course = await this.courseRepo.findById(input.courseId)
    if (!course) throw new LiveClassError('COURSE_NOT_FOUND', 'Course not found', 404)

    /* The academy this class will belong to, resolved ONCE and reused at the
       document build below. The caller's academy wins when it is present;
       otherwise the class inherits its course's. Two independent resolutions
       of the same value drift, and the instructor check immediately after has
       to compare against exactly what gets stored. */
    const classOrgId: Types.ObjectId | null =
      input.organizationId && Types.ObjectId.isValid(input.organizationId)
        ? new Types.ObjectId(input.organizationId)
        : ((course as { organizationId?: Types.ObjectId }).organizationId ?? null)

    /* Runs before the Mux stream is opened and before the caller's Meet link
       is spent, so a refused instructor leaves no third-party room behind. */
    await this.#assertInstructorUsable(input.instructorId, classOrgId)

    /* Validate meetingUrl is provided for online external sessions */
    if (input.type === 'external' && input.isOnline !== false) {
      if (!input.meetingUrl?.trim()) {
        throw new LiveClassError('MEETING_URL_REQUIRED', 'meetingUrl is required for external live classes', 400)
      }
    }

    /* Which in-app engine backs this class. Absent means Mux, which is what
       every existing row is — the provider was added without a migration. */
    const provider: LiveClassProvider = input.provider ?? 'mux'
    const isInAppLive = input.type === 'internal' && input.isOnline !== false

    /* CAPACITY (plan §9). LiveKit rooms are SFU-backed and CLT caps them at
       LIVEKIT_MAX_PARTICIPANTS; the LMS schema allows up to 500 because a Mux
       stream genuinely scales that far. Refusing here — rather than at join
       time — means the mismatch surfaces to the person creating the class,
       not to the 51st student who cannot get in. */
    if (isInAppLive && provider === 'livekit') {
      const capacity = input.sessionCapacity ?? 30
      if (capacity > LIVEKIT_MAX_PARTICIPANTS) {
        throw new LiveClassError(
          'LIVEKIT_CAPACITY_EXCEEDED',
          `Interactive rooms hold up to ${LIVEKIT_MAX_PARTICIPANTS} participants. `
          + `Reduce the seat count, or use a Mux stream for a larger session.`,
          400,
        )
      }
    }

    let muxData: { streamId: string; streamKey: string; playbackId: string } | null = null

    /* Create Mux stream for online internal sessions — LiveKit classes get a
       CLT room instead, provisioned after the document exists because the room
       name is derived from its id. */
    if (isInAppLive && provider === 'mux') {
      if (!env.MUX_TOKEN_ID || !env.MUX_TOKEN_SECRET) {
        throw new LiveClassError(
          'MUX_NOT_CONFIGURED',
          'In-app streaming is not configured. Set MUX_TOKEN_ID and MUX_TOKEN_SECRET.',
          503,
        )
      }
      muxData = await muxSvc.createLiveStream()
    }

    const doc: Partial<ILiveClass> = {
      courseId:        new Types.ObjectId(input.courseId),
      instructorId:    new Types.ObjectId(input.instructorId),
      title:           input.title.trim(),
      description:     input.description,
      scheduledStart:  input.scheduledStart,
      durationMins:    input.durationMins,
      type:            input.type,
      provider,
      status:          'scheduled',
      sessionCapacity: input.sessionCapacity ?? 30,
      bookedCount:     0,
      language:        input.language ?? 'English',
      isOnline:        input.isOnline ?? true,
    }
    if (input.location) (doc as any).location = input.location.trim()
    if (input.room)     (doc as any).room     = input.room.trim()
    /* Resolved above, where the instructor was checked against it. No caller
       academy (super_admin browsing "All Orgs" sends no X-Organization-Id)
       means the class inherits its course's. A class must live in its course's
       academy anyway — every list students and org-scoped admins see filters
       on organizationId with strict equality, so an unstamped class is
       invisible to all of them until the boot backfill claims it. */
    if (classOrgId) (doc as any).organizationId = classOrgId
    /* GUEST COHORTS. Validated before the allocation is computed, so a bad
       cohort never reaches the arithmetic. */
    const cohorts = input.guestCohorts ?? []
    if (cohorts.length > 0) {
      await this.#assertCohortsUsable(cohorts, classOrgId)

      /* If the host is gated to a module, every guest must be. Duplicated from
         the schema hook on purpose: the hook does not run on the edit path, and
         a rule enforced in only one of the two places is a rule that holds
         until the first edit. */
      if (input.sectionId && cohorts.some(c => !c.sectionId)) {
        throw new LiveClassError('INVALID_COHORT',
          'This class is gated to a module, so every guest cohort must name one too', 400)
      }

      const capacity = (doc.sessionCapacity ?? 30) as number
      const overflow = Math.max(0, Math.trunc(input.overflowSeats ?? 0))
      const floors   = cohorts.reduce((n, c) => n + Math.max(0, Math.trunc(c.seatFloor ?? 0)), 0)
      const host     = capacity - floors - overflow
      if (host < 0) {
        throw new LiveClassError('SEATS_OVERALLOCATED',
          `The guest floors and overflow come to ${floors + overflow}, which is more than the ${capacity} seats this class has`,
          400)
      }

      ;(doc as any).guestCohorts = cohorts.map(c => ({
        organizationId: new Types.ObjectId(c.organizationId),
        courseId:       new Types.ObjectId(c.courseId),
        ...(c.sectionId ? { sectionId: new Types.ObjectId(c.sectionId) } : {}),
        seatFloor:      Math.max(0, Math.trunc(c.seatFloor ?? 0)),
        seatsLeft:      Math.max(0, Math.trunc(c.seatFloor ?? 0)),
      }))
      ;(doc as any).hostSeatsLeft     = host
      ;(doc as any).overflowSeatsLeft = overflow
    }

    if (input.seriesId && Types.ObjectId.isValid(input.seriesId)) {
      doc.seriesId = new Types.ObjectId(input.seriesId)
    }

    if (input.sectionId && Types.ObjectId.isValid(input.sectionId)) {
      await this.#assertSectionBelongsToCourse(input.sectionId, input.courseId)
      doc.sectionId = new Types.ObjectId(input.sectionId)
    }

    if (input.type === 'external' && input.meetingUrl) {
      doc.meetingUrl = input.meetingUrl.trim()
      if (input.googleMeetCode) doc.googleMeetCode = input.googleMeetCode
    }

    if (muxData) {
      doc.muxLiveStreamId = muxData.streamId
      doc.muxStreamKey    = muxData.streamKey
      doc.muxPlaybackId   = muxData.playbackId
    }

    const created = await this.liveRepo.createOne(doc)

    /* Provision the CLT room AFTER the insert: the room name is derived from
       the class id, so it cannot be known before one exists. Best-effort by
       design — tryEnsureRoom never throws, because a meeting-platform outage
       must not stop an instructor scheduling a class. An unprovisioned room is
       created on demand the first time somebody hosts. */
    if (isInAppLive && provider === 'livekit') {
      const roomName = roomNameFor(created.id)
      await this.liveRepo.updateOne({ _id: created._id }, { $set: { cltRoomName: roomName } })
      created.cltRoomName = roomName

      const room = await tryEnsureRoom({
        liveClassId:    created.id,
        roomName,
        title:          created.title,
        /* ISO-8601 WITH offset. The LMS runs Asia/Dubai and CLT computes in
           UTC; a naive local timestamp would land four hours out. */
        scheduledStart: created.scheduledStart.toISOString(),
        durationMins:   created.durationMins,
        capacity:       created.sessionCapacity,
        ...(course as { organizationId?: unknown }).organizationId
          ? { orgSlug: String((course as { organizationId?: unknown }).organizationId) }
          : {},
      })
      if (room?.courseId) {
        await this.liveRepo.updateOne({ _id: created._id }, { $set: { cltCourseId: room.courseId } })
        created.cltCourseId = room.courseId
      }
    }

    /* Fire-and-forget notification to enrolled students */
    void this.#notifyEnrolledStudents(created, course.title, course.slug).catch(err =>
      logger.warn({ err, liveClassId: created.id }, 'live-class notification failed'),
    )

    return created
  }

  /* ── Start an internal stream (instructor going live) */
  async startStream(id: string): Promise<ILiveClass> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    const live = await this.liveRepo.findByIdPopulated(id)
    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)
    if (live.type !== 'internal') {
      throw new LiveClassError('NOT_INTERNAL', 'Only internal (Mux) live classes can be started this way', 400)
    }
    if (live.status === 'live') {
      throw new LiveClassError('ALREADY_LIVE', 'Stream is already live', 400)
    }
    if (live.status === 'ended' || live.status === 'cancelled') {
      throw new LiveClassError('STREAM_ENDED', `Cannot start a stream with status "${live.status}"`, 400)
    }
    if (!live.muxLiveStreamId) {
      throw new LiveClassError('NO_STREAM_ID', 'No Mux stream ID found for this class', 500)
    }

    try {
      await muxSvc.enableLiveStream(live.muxLiveStreamId)
    } catch (err) {
      const msg = ((err as Error).message ?? '').toLowerCase()
      logger.error({ err, id }, 'mux: failed to enable live stream')

      if (msg.includes('disabled')) {
        /* Stream key was explicitly disabled — user must recreate */
        throw new LiveClassError(
          'MUX_ERROR',
          'Could not start the stream: stream key has been disabled, please recreate the class',
          502,
        )
      }

      /* Any other error (e.g. "stream is not in a disabled state" — stream is already
         idle/enabled after recreate): non-fatal. The stream is ready to receive RTMP. */
      logger.warn({ err, id }, 'mux: enableLiveStream non-fatal error — stream already idle, proceeding')
    }

    const updated = await this.liveRepo.updateByIdPopulated(id, {
      status:    'live',
      startedAt: new Date(),
    } as Partial<ILiveClass>)

    return updated!
  }

  /* ── End an internal stream ───────────────────────── */
  async endStream(id: string): Promise<ILiveClass> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    const live = await this.liveRepo.findByIdPopulated(id)
    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)
    if (live.type !== 'internal') {
      throw new LiveClassError('NOT_INTERNAL', 'Only internal (Mux) live classes can be ended this way', 400)
    }
    if (live.status !== 'live' && live.status !== 'scheduled') {
      throw new LiveClassError('NOT_LIVE', `Stream is not live (current status: "${live.status}")`, 400)
    }
    if (!live.muxLiveStreamId) {
      throw new LiveClassError('NO_STREAM_ID', 'No Mux stream ID found for this class', 500)
    }

    await muxSvc.disableLiveStream(live.muxLiveStreamId)

    const updated = await this.liveRepo.updateByIdPopulated(id, {
      status:  'ended',
      endedAt: new Date(),
    } as Partial<ILiveClass>)

    return updated!
  }

  /* ── Stream credentials (admin only) ─────────────── */
  async getStreamCredentials(id: string): Promise<{ rtmpUrl: string; streamKey: string; playbackId: string }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    /* select:false field — must explicitly include muxStreamKey */
    const live = await LiveClassModel
      .findById(id)
      .select('+muxStreamKey')
      .exec()

    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)
    if (live.type !== 'internal') {
      throw new LiveClassError('NOT_INTERNAL', 'No RTMP credentials for external live classes', 400)
    }
    if (!live.muxStreamKey || !live.muxPlaybackId) {
      throw new LiveClassError('NO_CREDENTIALS', 'Stream credentials not found', 500)
    }

    return {
      rtmpUrl:    muxSvc.MUX_RTMP_URL,
      streamKey:  live.muxStreamKey,
      playbackId: live.muxPlaybackId,
    }
  }

  /* ── Student watch access ─────────────────────────── */
  async getWatchAccess(id: string, userId: string): Promise<{
    type:          'external' | 'internal'
    provider?:     LiveClassProvider
    /* Second signal for "this is an interactive room". Sent so the client can
       branch on evidence rather than on one field that has gone missing before. */
    cltRoomName?:  string
    title:         string
    status:        string
    /* External (Google Meet) only. The URL itself is NOT here — it is fetched
       on the click through POST /live-classes/:id/join. These three let the
       watch page draw the button at the right moment for the right student. */
    isBooked?:     boolean
    /* So the page can tell an in-person class from an online one — a class
       typed external with isOnline false has nothing to join. */
    isOnline?:     boolean
    joinOpensAt?:  string
    joinClosesAt?: string
    playbackUrl?:  string
    recordingUrl?: string
    thumbnailUrl?: string
    viewerCount:   number
  }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    const live = await this.liveRepo.findByIdPopulated(id)
    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)

    /* Access gate: student must be enrolled in (purchased) the course */
    const rawCourseId = live.courseId as unknown
    const courseId =
      rawCourseId instanceof Types.ObjectId
        ? rawCourseId
        : (rawCourseId as { _id?: Types.ObjectId })?._id ?? String(rawCourseId)
    /* ENROLMENT AND MODULE, ASKED OF ONE DOOR — see
       services/classEntitlement.service.ts.

       A dropped enrolment is no enrolment, and this used to be easy to get
       wrong here: findByUserCourse has no status filter, so a student whose
       course access was withdrawn still got the landing page, with isBooked
       true and a Join button whose click would then refuse. The watch page,
       the list and the feed must agree, and now they agree by construction
       because they ask the same function the same way. */
    const entitlement = await resolveClassEntitlement(live, userId, null, 'notDropped')
    if (entitlement.code === 'NOT_ENROLLED') {
      throw new LiveClassError('NOT_ENROLLED', 'You must be enrolled in this course to watch this session', 403)
    }
    if (entitlement.code === 'MODULE_BLOCKED') {
      throw new LiveClassError('MODULE_BLOCKED', 'You don\'t have access to this module. Contact your admin.', 403)
    }

    if (live.status === 'cancelled') {
      throw new LiveClassError('SESSION_CANCELLED', 'This session was cancelled', 410)
    }

    if (live.type === 'external') {
      /* The link used to be handed out here to anyone enrolled, at any time.
         Now the page gets the window and whether this student holds a seat;
         the link is released only inside that window, only to that seat, by
         the join endpoint. */
      const { ClassBookingModel } = await import('@/models/schema.ts')
      const { studentJoinWindow } = await import('@/utils/liveStatus.ts')
      const seat = await ClassBookingModel.exists({
        userId: new Types.ObjectId(userId),
        liveClassId: live._id,
        status: { $in: ['booked', 'attended'] },
      })
      const w = studentJoinWindow(live.scheduledStart)
      return {
        type:         'external',
        title:        live.title,
        status:       live.status,
        isBooked:     !!seat,
        isOnline:     (live as { isOnline?: boolean }).isOnline !== false,
        joinOpensAt:  w.opensAt.toISOString(),
        joinClosesAt: w.closesAt.toISOString(),
        viewerCount:  0,
        // recordingUrl intentionally excluded — admin-only, not exposed to students
      }
    }

    /* Internal — Mux or LiveKit. The client branches on `provider`: a LiveKit
       class has no playback URL at all, because the media only exists inside
       the room. */
    return {
      type:        'internal',
      provider:    (live as { provider?: LiveClassProvider }).provider ?? 'mux',
      cltRoomName: (live as { cltRoomName?: string }).cltRoomName ?? undefined,
      title:       live.title,
      status:      live.status,
      playbackUrl: live.muxPlaybackId
        ? muxSvc.buildPlaybackUrl(live.muxPlaybackId)
        : undefined,
      recordingUrl: live.recordingUrl ?? undefined,
      thumbnailUrl: live.muxPlaybackId
        ? muxSvc.buildThumbnailUrl(live.muxPlaybackId)
        : undefined,
      viewerCount: live.viewerCount ?? 0,
    }
  }

  /* ── Handle Mux webhook events ───────────────────── */
  async handleMuxWebhook(event: { type: string; data: Record<string, unknown> }): Promise<void> {
    const streamId = event.data['id'] as string | undefined

    switch (event.type) {

      /* Stream went live — update status idempotently + kick off viewer count fetch */
      case 'video.live_stream.active': {
        if (!streamId) return
        await LiveClassModel.updateOne(
          { muxLiveStreamId: streamId, status: { $in: ['scheduled', 'live'] } },
          { $set: { status: 'live', startedAt: new Date() } },
        )
        /* Kick off viewer count refresh */
        if (env.MUX_TOKEN_ID) {
          void muxSvc.getLiveViewerCount().then(count =>
            LiveClassModel.updateOne({ muxLiveStreamId: streamId }, { $set: { viewerCount: count } })
          ).catch(() => {})
        }
        logger.info({ streamId }, 'mux webhook: stream active')
        break
      }

      /* Stream went idle — instructor stopped streaming */
      case 'video.live_stream.idle': {
        if (!streamId) return
        await LiveClassModel.updateOne(
          { muxLiveStreamId: streamId, status: 'live' },
          { $set: { status: 'ended', endedAt: new Date() } },
        )
        logger.info({ streamId }, 'mux webhook: stream idle → ended')
        break
      }

      /* Stream disconnected — instructor dropped (within reconnect window, may reconnect) */
      case 'video.live_stream.disconnected': {
        /* Don't change status — Mux may reconnect within reconnect_window (60s).
           If it doesn't reconnect, video.live_stream.idle fires. */
        logger.info({ streamId }, 'mux webhook: stream disconnected (waiting for reconnect)')
        break
      }

      /* Recording asset is ready — save recording URL */
      case 'video.asset.ready': {
        const assetId    = event.data['id'] as string
        const liveStream = event.data['live_stream_id'] as string | undefined
        if (!liveStream) return

        const playbackIds = event.data['playback_ids'] as Array<{ id: string; policy: string }> | undefined
        const assetPlaybackId = playbackIds?.[0]?.id

        if (assetPlaybackId) {
          const recordingUrl = muxSvc.buildRecordingUrl(assetPlaybackId)
          await LiveClassModel.updateOne(
            { muxLiveStreamId: liveStream },
            { $set: { muxAssetId: assetId, recordingUrl } },
          )
          logger.info({ liveStream, assetId, recordingUrl }, 'mux webhook: recording ready')
        }
        break
      }

      default:
        logger.debug({ type: event.type }, 'mux webhook: unhandled event type')
    }
  }

  /* ── Recreate Mux stream (when key is disabled) ──── */
  async recreateStream(id: string): Promise<ILiveClass> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    const live = await this.liveRepo.findByIdPopulated(id)
    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)
    if (live.type !== 'internal') {
      throw new LiveClassError('NOT_INTERNAL', 'Only internal (Mux) live classes have stream credentials', 400)
    }
    if (live.status === 'live') {
      throw new LiveClassError('ALREADY_LIVE', 'Cannot recreate credentials while stream is live', 400)
    }
    if (!env.MUX_TOKEN_ID || !env.MUX_TOKEN_SECRET) {
      throw new LiveClassError('MUX_NOT_CONFIGURED', 'Mux credentials not configured', 503)
    }

    /* Best-effort delete old stream — non-fatal if already gone on Mux's side */
    if (live.muxLiveStreamId) {
      await muxSvc.deleteLiveStream(live.muxLiveStreamId)
    }

    /* Create a fresh Mux live stream */
    const muxData = await muxSvc.createLiveStream()

    const updated = await this.liveRepo.updateByIdPopulated(id, {
      muxLiveStreamId: muxData.streamId,
      muxStreamKey:    muxData.streamKey,
      muxPlaybackId:   muxData.playbackId,
      status:          'scheduled',
      startedAt:       undefined,
      endedAt:         undefined,
      viewerCount:     0,
    } as unknown as Partial<ILiveClass>)

    if (!updated) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)

    logger.info({ id, newStreamId: muxData.streamId }, 'live-class: stream recreated')
    return updated
  }

  /* ── Update ──────────────────────────────────────── */
  async update(id: string, input: Partial<{
    title:             string
    description:       string
    scheduledStart:    Date
    durationMins:      number
    meetingUrl:        string
    recordingUrl:      string
    status:            'scheduled' | 'live' | 'ended' | 'cancelled'
    sessionCapacity:   number
    mentorNotes:       string
    instructorId:      string
    courseId:          string
    sectionId:         string
    language:          string
    isOnline:          boolean
    location:          string
    room:              string
    rescheduledReason: string
  }>): Promise<ILiveClass> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }

    // Snapshot current doc so we can detect status transitions for recording poll
    // and a change of start time (which invalidates every reminder already sent)
    const current = await LiveClassModel.findById(id)
      .select('type status googleMeetCode recordingUrl scheduledStart organizationId '
            + 'courseId isOnline provider sessionCapacity bookedCount '
            + 'hostSeatsLeft overflowSeatsLeft guestCohorts')
      .lean()

    const patch: Partial<ILiveClass> = { ...(input as any) }
    if (input.instructorId != null) {
      /* Same rule as create(). Without it the create-side check is one PATCH
         away from being bypassed: schedule with a real instructor, then move
         the class onto a student's id. Compared against the academy the class
         is ALREADY stamped with — organizationId is not a patchable field, so
         a class cannot be walked into another academy on the way past. */
      await this.#assertInstructorUsable(
        input.instructorId,
        ((current as { organizationId?: Types.ObjectId } | null)?.organizationId) ?? null,
      )
      patch.instructorId = new Types.ObjectId(input.instructorId) as any
    }
    if (input.courseId != null) {
      if (!Types.ObjectId.isValid(input.courseId)) throw new LiveClassError('INVALID_ID', 'Invalid courseId', 400)
      patch.courseId = new Types.ObjectId(input.courseId) as any
    }
    if (input.sectionId != null) {
      if (!Types.ObjectId.isValid(input.sectionId)) throw new LiveClassError('INVALID_ID', 'Invalid sectionId', 400)
      /* Against the course the class will HAVE after this patch, not the one it
         had before — moving a class to another course and re-pointing its
         module is one request. */
      const courseAfter = input.courseId ?? String((current as { courseId?: unknown } | null)?.courseId ?? '')
      if (courseAfter) await this.#assertSectionBelongsToCourse(input.sectionId, courseAfter)
      patch.sectionId = new Types.ObjectId(input.sectionId) as any
    }
    /* ── SEAT GUARDS ON THE EDIT PATH ──────────────────────────────────────
       The counters are a promise to two academies, and an edit is the one
       place that promise can be broken silently.

       A capacity LOWERED below what is already taken would leave the room
       oversold with nothing to refuse. A capacity RAISED on an allocated class
       has to go somewhere, and it goes to the overflow — never to a floor,
       because a floor is what an academy was promised and quietly enlarging
       one is as surprising as quietly shrinking it.

       And the LiveKit ceiling was only ever checked at CREATE, so raising the
       seat count afterwards produced a class LiveKit refuses at the door. */
    if (input.sessionCapacity != null) {
      const cur = current as {
        bookedCount?: number; sessionCapacity?: number; provider?: string
        type?: string; isOnline?: boolean
        hostSeatsLeft?: number; overflowSeatsLeft?: number
        guestCohorts?: Array<{ seatFloor?: number }>
      } | null

      const taken = cur?.bookedCount ?? 0
      if (input.sessionCapacity < taken) {
        throw new LiveClassError('CAPACITY_BELOW_BOOKED',
          `${taken} seat(s) are already taken, so the capacity cannot be set to ${input.sessionCapacity}`,
          400)
      }

      const isInAppLive = (cur?.type ?? 'external') === 'internal' && cur?.isOnline !== false
      if (isInAppLive && (cur?.provider ?? 'mux') === 'livekit'
          && input.sessionCapacity > LIVEKIT_MAX_PARTICIPANTS) {
        throw new LiveClassError('LIVEKIT_CAPACITY_EXCEEDED',
          `Interactive rooms hold up to ${LIVEKIT_MAX_PARTICIPANTS} participants. `
          + `Reduce the seat count, or use a Mux stream for a larger session.`,
          400)
      }

      /* Allocated class: the difference lands in the overflow. */
      if (typeof cur?.hostSeatsLeft === 'number') {
        const delta = input.sessionCapacity - (cur.sessionCapacity ?? 0)
        const nextOverflow = (cur.overflowSeatsLeft ?? 0) + delta
        if (nextOverflow < 0) {
          throw new LiveClassError('CAPACITY_BELOW_FLOORS',
            'That capacity is smaller than the seats already promised to each academy. '
            + 'Lower a floor first.',
            400)
        }
        ;(patch as any).overflowSeatsLeft = nextOverflow
      }
    }

    const updated = await this.liveRepo.updateByIdPopulated(id, patch)
    if (!updated) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)

    /* Rescheduling moves the class, which invalidates every reminder already
       marked as sent — those flags describe a start time that no longer exists.
       Left set, the student gets NOTHING at the new time because the chain
       believes it already ran. Clear them so the reminders fire again against
       the new start. Only booked seats matter; a cancelled one stays cancelled. */
    const movedFrom = (current as { scheduledStart?: Date } | null)?.scheduledStart
    if (input.scheduledStart && movedFrom &&
        new Date(input.scheduledStart).getTime() !== new Date(movedFrom).getTime()) {
      const { ClassBookingModel } = await import('@/models/schema.ts')
      const reset = await ClassBookingModel.updateMany(
        { liveClassId: new Types.ObjectId(id), status: 'booked' },
        { $set: {
          reminderDayBeforeSent:  false,
          reminderDayOfSent:      false,
          reminderPreSessionSent: false,
          reminder5MinSent:       false,
          reminderAtTimeSent:     false,
        } },
      )
      await LiveClassModel.findByIdAndUpdate(id, { reminderInstructor15MinSent: false })
      logger.info({ classId: id, bookings: reset.modifiedCount },
        'live-class: rescheduled — reminder flags reset so the chain runs again')
    }

    // When an external class with a Meet code is marked "ended", auto-poll for recording
    const isNewlyEnded = input.status === 'ended' && current?.status !== 'ended'
    const hasCode      = !!(current as any)?.googleMeetCode
    const noRecording  = !(current as any)?.recordingUrl
    if (isNewlyEnded && current?.type === 'external' && hasCode && noRecording) {
      void this.#pollForMeetRecording(id, (current as any).googleMeetCode)
    }

    return updated
  }

  /* Polls Google Meet API for the recording of an external class.
     Retries every 3 minutes for up to 30 minutes after the class ends. */
  async #pollForMeetRecording(classId: string, meetingCode: string): Promise<void> {
    const INTERVAL_MS  = 3 * 60 * 1000   // 3 minutes between attempts
    const MAX_ATTEMPTS = 10              // up to 30 minutes total

    // Give Meet a few minutes to process the recording before first poll
    await new Promise(r => setTimeout(r, INTERVAL_MS))

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const url = await fetchMeetRecordingUrl(meetingCode)
        if (url) {
          await LiveClassModel.findByIdAndUpdate(classId, { recordingUrl: url })
          logger.info({ classId, meetingCode, url }, 'meet-recording: auto-saved recording URL')
          return
        }
      } catch (err) {
        logger.warn({ err, classId, attempt }, 'meet-recording: poll error')
      }

      logger.debug({ classId, meetingCode, attempt }, 'meet-recording: recording not ready yet')
      await new Promise(r => setTimeout(r, INTERVAL_MS))
    }

    logger.warn({ classId, meetingCode }, 'meet-recording: no recording found after 30 minutes')
  }

  /* ── Delete ──────────────────────────────────────── */
  async delete(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    const live = await this.liveRepo.findByIdPopulated(id)
    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)

    /* Cleanup Mux stream if internal */
    if (live.type === 'internal' && live.muxLiveStreamId) {
      await muxSvc.deleteLiveStream(live.muxLiveStreamId)
    }

    await this.liveRepo.hardDelete(id)
  }

  /* ── Helpers ─────────────────────────────────────── */

  /* Which students has this new session actually become available to?

     Returns the set of user ids whose OWN progress puts them at the module
     this session belongs to — "last completed module is the one immediately
     prior", per the Class-Update Notification spec.

     Everyone else still gets the in-app notification; they simply do not get
     an email about a module they have not reached. That is the whole point:
     email volume should track each student's progress, not the admin's
     data-entry order.

     Positions are compared by INDEX in the ordered module list, not by the
     raw `order` value, because those are author-assigned and need not be
     contiguous — a course numbered 10/20/30 would otherwise never match.

     Three queries regardless of roster size: the lessons, the completions,
     and the modules. Doing it per-student would be a query per person on
     every class creation. */
  async #studentsAtModule(
    courseId: unknown,
    sectionId: unknown,
    userIds: string[],
  ): Promise<Set<string>> {
    const reached = new Set<string>()
    if (!sectionId || userIds.length === 0) return reached

    const { SectionModel, LessonModel, LessonProgressModel } = await import('@/models/schema.ts')

    const sections = await SectionModel.find({ courseId }).sort({ order: 1 }).select('_id').lean() as any[]
    const targetIdx = sections.findIndex(x => String(x._id) === String(sectionId))
    /* The session hangs off a module that is not in this course's list — a
       re-parented session, or stale data. Relevance cannot be established, so
       nobody is emailed and everybody still sees it in-app. */
    if (targetIdx === -1) return reached

    const lessons = await LessonModel.find({ courseId }).select('_id sectionId').lean() as any[]
    /* A module with no lessons cannot be "completed", so it can never be the
       prior module. Tracked explicitly rather than treated as complete — the
       opposite would mail the whole roster the moment somebody adds an empty
       module. */
    const lessonsBySection = new Map<string, string[]>()
    for (const l of lessons) {
      const k = String(l.sectionId)
      lessonsBySection.set(k, [...(lessonsBySection.get(k) ?? []), String(l._id)])
    }

    const done = await LessonProgressModel.find({
      courseId,
      userId:      { $in: userIds },
      completedAt: { $ne: null },
    }).select('userId lessonId').lean() as any[]

    const doneByUser = new Map<string, Set<string>>()
    for (const d of done) {
      const k = String(d.userId)
      if (!doneByUser.has(k)) doneByUser.set(k, new Set())
      doneByUser.get(k)!.add(String(d.lessonId))
    }

    for (const uid of userIds) {
      const mine = doneByUser.get(uid) ?? new Set<string>()

      /* The furthest module this student has finished, as an index. -1 means
         they have completed none — a brand-new student, who sits immediately
         BEFORE the first module and so is exactly the audience for a session
         in it. Reading "no completions" as "no match" would silence the one
         announcement a new joiner most wants. */
      let lastCompletedIdx = -1
      for (let i = 0; i < sections.length; i++) {
        const ls = lessonsBySection.get(String(sections[i]!._id)) ?? []
        if (ls.length > 0 && ls.every(id => mine.has(id))) lastCompletedIdx = i
      }

      if (targetIdx === lastCompletedIdx + 1) reached.add(uid)
    }

    return reached
  }

  async #notifyEnrolledStudents(live: ILiveClass, courseTitle: string, courseSlug: string): Promise<void> {
    const enrolledStudents = await EnrollmentModel
      .find({ courseId: live.courseId, status: { $ne: 'dropped' } })
      .limit(200)
      .populate('userId', '_id email name isActive')
      .exec()

    const courseUrl = `${env.CLIENT_URL}/courses/${courseSlug}`

    const { NotificationService } = await import('@/services/notification.service.ts')
    const notifications = new NotificationService()

    const whenLabel = live.scheduledStart.toLocaleString('en-US',
      { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

    /* Who is this session actually FOR?

       Every enrolled student keeps their in-app notification — the spec's
       "always logged, not always emailed" — but the email now goes only to
       the students whose own progress has brought them to this module.

       A session with no module cannot be judged for relevance at all. Those
       fall back to in-app only rather than to the old roster-wide mail: not
       being able to tell who needs it is not a reason to mail everybody, and
       the warning below makes the case visible instead of silent. */
    const candidateIds = enrolledStudents
      .map(e => (e.userId as any)?._id)
      .filter(Boolean)
      .map((id: any) => String(id))

    let reached = new Set<string>()
    if (live.sectionId) {
      reached = await this.#studentsAtModule(live.courseId, live.sectionId, candidateIds)
      logger.info(
        { liveClassId: String((live as any).id ?? (live as any)._id),
          enrolled: candidateIds.length, emailed: reached.size },
        'new live class: progress-gated notification',
      )
    } else {
      logger.warn(
        { liveClassId: String((live as any).id ?? (live as any)._id) },
        'new live class has no module — in-app only, nobody emailed',
      )
    }

    for (const e of enrolledStudents) {
      const u = e.userId as unknown as {
        _id: { toString: () => string }
        email: string
        name: string
        isActive: boolean
      }
      if (!u?.email || u.isActive === false) continue

      try {
        await notifications.create(u._id.toString(), {
          kind:  'live-class-scheduled',
          title: `Live class scheduled in ${courseTitle}`,
          body:  `"${live.title}" — ${whenLabel}`,
          link:  `/live-classes/${live.id}/watch`,
        })
      } catch (err) {
        logger.warn({ err, userId: u._id.toString() }, 'live-class in-app notification failed')
      }

      /* The gate. A student who has not reached this module has the
         notification waiting for them in the app and nothing in their inbox. */
      if (!reached.has(u._id.toString())) continue

      /* Standard tier: QUEUED, not sent.

         A new session is worth telling the student about, but it is not worth
         interrupting them for — so it joins their daily digest instead of
         becoming its own email. An admin entering next term's timetable in
         one sitting now produces one line each in one mail, rather than a
         mail per session.

         Critical-tier changes to a session they have BOOKED (cancelled,
         rescheduled, mentor changed) never come through here; those still
         send immediately from notifyBookedStudents. */
      try {
        await queueDigestItem({
          userId: u._id.toString(),
          kind:   'new-session',
          title:  `New session in ${courseTitle}`,
          body:   `"${live.title}" — ${whenLabel}`,
          link:   `/live-classes/${live.id}/watch`,
        })
      } catch (err) {
        logger.warn({ err, email: u.email }, 'live-class digest queue failed')
      }
    }
  }
}
