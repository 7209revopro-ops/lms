import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { instructorOwnsSession, callerOrgForRead } from '@/utils/tenancy.ts'
import { ensureOrgSlugs, orgSlugFor } from '@/utils/orgSlugs.ts'
import { logger } from '@/utils/logger.ts'
import { LiveClassService } from '@/services/liveClass.service.ts'
import { SectionService } from '@/services/section.service.ts'
import { verifyWebhookSignature } from '@/services/mux.service.ts'
import { createGoogleMeetLink } from '@/services/googleMeet.service.ts'
import { sendSuccess } from '@/utils/response.ts'
import { sendInstructorClassScheduled } from '@/services/email.service.ts'
import { wantsStaffEmail } from '@/utils/emailPrefs.ts'
import { bookingClosesAt } from '@/utils/liveStatus.ts'
import { parkCriticalMail, flushCriticalMail, isUrgent } from '@/jobs/criticalmail.job.ts'
import type { CriticalKind } from '@/jobs/criticalmail.job.ts'

function isPopulated(v: unknown): v is Record<string, unknown> & { id: string } {
  return !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string'
}

/* `entitled` gates every field that hands the caller the session itself.
   Mux playback ids are minted with a public playback policy, so the
   image.mux.com thumbnail — which embeds that id — is as good as the stream
   URL and is gated alongside it. Defaults to true: admin/instructor callers
   see everything. `mentorNotes` is deliberately never emitted — it is private
   post-session staff commentary. */
function toDTO(doc: any, entitled = true) {
  const j              = doc.toJSON ? doc.toJSON() : doc
  const courseRef      = j.courseId
  const instructorRef  = j.instructorId
  const sectionRef     = j.sectionId
  const isInternal     = j.type === 'internal'

  return {
    id:             j.id,
    courseId:       isPopulated(courseRef)     ? courseRef.id     : String(courseRef),
    course:         isPopulated(courseRef)     ? courseRef        : undefined,
    instructorId:   isPopulated(instructorRef) ? instructorRef.id : String(instructorRef),
    instructor:     isPopulated(instructorRef) ? instructorRef    : undefined,
    title:          j.title,
    description:    j.description,
    scheduledStart: j.scheduledStart,
    durationMins:   j.durationMins,

    /* Type + status */
    type:           j.type   ?? 'external',
    /* WHICH in-app engine. Absent from this DTO meant the admin studio could
       not tell a LiveKit class from a Mux one and fell through to the Mux
       broadcaster — an interactive class showed an OBS stream key and
       "No Mux stream ID found". Older rows have no value and are Mux. */
    provider:       j.provider ?? 'mux',
    status:         j.status ?? 'scheduled',

    /* External-only */
    meetingUrl:     !isInternal && entitled ? j.meetingUrl : undefined,

    /* Internal-only (public fields — no muxStreamKey) */
    muxPlaybackId:  isInternal && entitled ? j.muxPlaybackId : undefined,
    playbackUrl:    isInternal && entitled && j.muxPlaybackId
                      ? `https://stream.mux.com/${j.muxPlaybackId}.m3u8`
                      : undefined,
    thumbnailUrl:   isInternal && entitled && j.muxPlaybackId
                      ? `https://image.mux.com/${j.muxPlaybackId}/thumbnail.jpg?time=0`
                      : undefined,
    recordingUrl:   entitled ? (j.recordingUrl ?? undefined) : undefined,
    /* LiveKit linkage — the room name is not a secret (a ticket is still
       required to enter it) and the studio shows it while live. */
    cltRoomName:    j.cltRoomName ?? undefined,
    cltRecordingId: j.cltRecordingId ?? undefined,
    recordingDurationSecs: j.recordingDurationSecs ?? undefined,
    viewerCount:    j.viewerCount   ?? 0,
    startedAt:      j.startedAt,
    endedAt:        j.endedAt,

    /* Module link */
    sectionId:       sectionRef
                       ? (isPopulated(sectionRef) ? sectionRef.id : String(sectionRef))
                       : undefined,
    section:         isPopulated(sectionRef) ? sectionRef : undefined,

    sessionCapacity: j.sessionCapacity ?? 30,
    bookedCount:     j.bookedCount     ?? 0,

    /* When new bookings stop being accepted — the SERVER's answer, so the UI
       never has to hold its own copy of the rule and drift from it. */
    bookingClosesAt: j.scheduledStart ? bookingClosesAt(j.scheduledStart).toISOString() : undefined,

    language:       j.language ?? 'English',

    /* Offline support */
    isOnline:          j.isOnline ?? true,
    location:          j.location,
    room:              j.room,
    rescheduledReason: j.rescheduledReason,

    seriesId:       j.seriesId ? String(j.seriesId) : undefined,

    /* WHICH ACADEMY'S WALL CLOCK THIS CLASS IS READ IN.

       The admin panel renders every timestamp in one academy's zone, chosen
       from the VIEWER's academy. That was indistinguishable from correct while
       every class a viewer could see was their own academy's. A LENT
       instructor now sees both academies' classes in one list, so the viewer's
       zone is the wrong question: a 9:00 AM Bangalore class rendered in Dubai
       time reads as 7:30 AM to the person teaching it.

       Sending the slug rather than the id keeps the slug-to-zone map in the
       one place that already owns it, admin/src/lib/timezone.ts, instead of
       giving the backend a second opinion about what Asia/Kolkata means.

       undefined when the class carries no academy, or before the cache is
       warm. Every consumer falls back to the viewer's zone on undefined, which
       is exactly today's behaviour — so this degrades to the old rendering
       rather than to a wrong one. */
    organizationId:   j.organizationId ? String(j.organizationId) : undefined,
    organizationSlug: orgSlugFor(j.organizationId),

    /* The academies this class ALSO serves, each through its own course and
       module. Sent so the admin panel can show a "serves both" chip and so a
       guest academy's staff can see which of their courses this belongs to.
       Empty on every class that is not shared, which is all of them today. */
    guestCohorts: Array.isArray(j.guestCohorts)
      ? j.guestCohorts.map((c: any) => ({
          organizationId:   String(c.organizationId),
          organizationSlug: orgSlugFor(c.organizationId),
          courseId:         String(c.courseId),
          sectionId:        c.sectionId ? String(c.sectionId) : undefined,
          seatFloor:        c.seatFloor,
          seatsLeft:        c.seatsLeft,
        }))
      : [],
    hostSeatsLeft:     j.hostSeatsLeft,
    overflowSeatsLeft: j.overflowSeatsLeft,

    createdAt:      j.createdAt,
    updatedAt:      j.updatedAt,
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   notifyBookedStudents — one place that tells everyone holding a booking

   Previously this lived inline in adminUpdate and only sent EMAIL. Two things
   were wrong with that:

     • An instructor change produced nothing at all. A student books a session
       because of who is teaching it; changing that silently is the surprise
       this feature exists to remove.
     • Nothing appeared in the in-app notification bell. Email is the channel
       people miss; the bell is the one they actually see when they next open
       the app. Both now fire for every change.

   Cancelled takes precedence over the rest — if the session is gone, the fact
   the instructor also changed is noise. A reschedule and an instructor change
   in the same edit produce one message each, because they are separate facts.

   Deliberately fire-and-forget: an SMTP outage must not fail the admin's save.
   Each send is caught individually so one bad address cannot stop the rest —
   the loop used to share a single catch, so the first failure silently
   dropped every student after it.
───────────────────────────────────────────────────────────────────────── */
export interface BookingChangeNotice {
  liveClassId:       string
  title:             string
  oldStart?:         Date | string
  newStart?:         Date | string
  wasCancelled:      boolean
  wasRescheduled:    boolean
  instructorChanged: boolean
  oldInstructorId?:  string
  newInstructorId?:  string
}

/* ─────────────────────────────────────────────────────────────────────────
   notifySessionEdited — everything that is NOT Critical

   The Class-Update Notification spec is explicit that the notification centre
   is the source of truth and email is a conditional layer on top: "every
   update — Critical, Standard, and None/internal — is logged in the student's
   in-app notification centre."

   That was not true. Only cancel / reschedule / instructor produced anything
   at all; every other edit notified nobody in any channel. Change the joining
   link and a student booked on the session was never told, which is the gap
   that turned up when somebody asked what happens when an admin pastes a new
   Meet URL.

   Two tiers land here, and the difference is what a student loses by hearing
   late:

     · the MEETING LINK — in-app immediately, no email. Waiting for the 6pm
       digest to mention a link change would be worse than saying nothing: the
       class it refers to may already be over. Emailing it is a decision that
       belongs to whoever owns the mail volume, and the answer for now is no,
       so it goes in the bell where the student can find it.

     · everything else (title, description, duration, capacity, where it
       meets) — in-app AND queued for the daily digest. None of it changes
       whether they can attend.

   Audience is the same as Critical: students holding a booking on THIS
   session, never the course roster.
───────────────────────────────────────────────────────────────────────── */
export interface SessionEditNotice {
  liveClassId:  string
  title:        string
  linkChanged:  boolean
  /* Human labels for the minor fields that changed, e.g. ['time slot length',
     'location']. Empty when nothing minor changed. */
  minorChanges: string[]
}

export async function notifySessionEdited(notice: SessionEditNotice): Promise<{
  recipients: number; notified: number; queued: number
}> {
  const tally = { recipients: 0, notified: 0, queued: 0 }
  if (!notice.linkChanged && notice.minorChanges.length === 0) return tally

  const { ClassBookingModel } = await import('@/models/schema.ts')
  const { NotificationService } = await import('@/services/notification.service.ts')
  const { queueDigestItem } = await import('@/jobs/digest.job.ts')
  const notifications = new NotificationService()

  const bookings = await ClassBookingModel.find({
    liveClassId: notice.liveClassId,
    status:      { $in: ['booked', 'attended'] },
  }).select('userId').lean() as any[]

  tally.recipients = bookings.length
  if (!bookings.length) return tally

  for (const b of bookings) {
    const userId = String(b.userId)

    if (notice.linkChanged) {
      /* Immediate, and pointed at the session so the student can pick the new
         link up from the app rather than hunting for the old mail. */
      try {
        await notifications.create(userId, {
          kind:  'system',
          title: `Joining link updated: ${notice.title}`,
          body:  'The joining link for this session has changed. Open the class to use the new one.',
          link:  `/live-classes/${notice.liveClassId}/watch`,
        })
        tally.notified++
      } catch (err) {
        logger.error({ err, userId }, 'session-edit: link notification failed')
      }
    }

    if (notice.minorChanges.length) {
      const what = notice.minorChanges.join(', ')
      try {
        await notifications.create(userId, {
          kind:  'system',
          title: `Updated: ${notice.title}`,
          body:  `${what} changed for this session.`,
          link:  '/class-bookings',
        })
        tally.notified++
      } catch (err) {
        logger.error({ err, userId }, 'session-edit: notification failed')
      }

      /* Standard tier: it joins tonight's digest rather than becoming mail of
         its own. */
      try {
        await queueDigestItem({
          userId,
          kind:  'session-updated',
          title: `Updated: ${notice.title}`,
          body:  `${what} changed.`,
          link:  '/class-bookings',
        })
        tally.queued++
      } catch (err) {
        logger.error({ err, userId }, 'session-edit: digest queue failed')
      }
    }
  }

  return tally
}

export async function notifyBookedStudents(notice: BookingChangeNotice): Promise<{
  recipients: number; notified: number; emailed: number; parked: number
}> {
  const { ClassBookingModel, UserModel } = await import('@/models/schema.ts')
  const { NotificationService } = await import('@/services/notification.service.ts')
  const notifications = new NotificationService()

  /* A cancelled booking is not a recipient — that student already withdrew. */
  const bookings = await ClassBookingModel.find({
    liveClassId: notice.liveClassId,
    status:      { $in: ['booked', 'attended'] },
  }).select('userId').lean()

  if (bookings.length === 0) return { recipients: 0, notified: 0, emailed: 0, parked: 0 }

  /* One query for every recipient rather than one per booking. */
  const userIds = bookings.map(b => b.userId)
  const users   = await UserModel.find({ _id: { $in: userIds } }).select('name email').lean()

  const instructorIds = [notice.oldInstructorId, notice.newInstructorId].filter(Boolean)
  const instructors   = instructorIds.length
    ? await UserModel.find({ _id: { $in: instructorIds } }).select('name').lean()
    : []
  const nameOf = (id?: string) =>
    (instructors.find(i => String(i._id) === id) as { name?: string } | undefined)?.name ?? 'your instructor'

  const oldStart = notice.oldStart ?? new Date()
  const newStart = notice.newStart ?? new Date()

  /* Same calendar day → a delay; a different day → a full reschedule. */
  const day = (d: Date | string) => new Date(d).toLocaleDateString('en-US', { timeZone: 'Asia/Dubai' })
  const isReschedule = day(oldStart) !== day(newStart)

  /* `isReschedule` is no longer decided here: which of the two templates a
     reschedule uses depends on the times as they stand when the mail finally
     goes, and inside the debounce window they can still move again. The flush
     makes that call. */
  void isReschedule

  let notified = 0, parked = 0
  for (const user of users) {
    const u = user as { _id: unknown; name?: string; email?: string }
    const messages: { title: string; body: string; kind?: CriticalKind }[] = []

    if (notice.wasCancelled) {
      messages.push({
        title: `Class cancelled: ${notice.title}`,
        body:  'The session you booked has been cancelled.',
        kind:  'cancelled',
      })
    } else {
      if (notice.wasRescheduled) {
        messages.push({
          title: `Class rescheduled: ${notice.title}`,
          body:  `The session has moved to ${new Date(newStart).toLocaleString('en-US', { timeZone: 'Asia/Dubai' })}.`,
          kind:  'rescheduled',
        })
      }
      if (notice.instructorChanged) {
        messages.push({
          title: `Instructor changed: ${notice.title}`,
          body:  `${nameOf(notice.oldInstructorId)} has been replaced by ${nameOf(notice.newInstructorId)}.`,
          kind:  'instructor',
        })
      }
    }

    for (const m of messages) {
      /* The bell fires from the request, as it always has. Phase 4's buffer
         is on the EMAIL only: the in-app notice costs nothing to deliver, it
         is the source of truth per §6, and delaying it would mean a student
         refreshing the app right after an admin's edit still saw the old
         session. Every correction inside the window shows up here in order;
         only the mail is collapsed. */
      try {
        await notifications.create(String(u._id), {
          kind:  'system',
          title: m.title,
          body:  m.body,
          link:  `/live-classes/${notice.liveClassId}/watch`,
        })
        notified++
      } catch (err) {
        logger.error({ err, userId: String(u._id) }, 'booking change: in-app notification failed')
      }

      if (u.email && m.kind) {
        try {
          await parkCriticalMail({
            liveClassId: notice.liveClassId,
            userId:      String(u._id),
            email:       u.email,
            name:        u.name ?? '',
            kind:        m.kind,
            title:       notice.title,
            scheduledStart:    notice.newStart ?? notice.oldStart,
            oldStart,
            newStart,
            ...(notice.instructorChanged ? {
              oldInstructorName: nameOf(notice.oldInstructorId),
              newInstructorName: nameOf(notice.newInstructorId),
            } : {}),
          })
          parked++
        } catch (err) {
          logger.error({ err, to: u.email }, 'booking change: could not park email')
        }
      }
    }
  }

  /* The buffer must never outlive the class it is about. A cancellation for a
     session starting in eight minutes waits for nothing — it flushes here,
     in the request, exactly as this function used to behave. */
  let emailed = 0
  if (parked > 0 && isUrgent(notice.newStart ?? notice.oldStart)) {
    try {
      const flushed = await flushCriticalMail({ liveClassId: notice.liveClassId })
      emailed = flushed.sent
    } catch (err) {
      logger.error({ err, liveClassId: notice.liveClassId },
        'booking change: urgent flush failed — rows stay parked for the next tick')
    }
  }

  logger.info({ liveClassId: notice.liveClassId, recipients: users.length, notified, parked, emailed },
    'booking change notifications sent')
  return { recipients: users.length, notified, emailed, parked }
}

export class LiveClassController {
  private readonly service  = new LiveClassService()
  private readonly sections = new SectionService()

  /* GET /courses/:slug/live-classes — optionally authenticated */
  listForCourseSlug = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug   = String(req.params['slug'] ?? '')
      const userId = req.user?.id
      const docs   = await this.service.listForCourseSlug(slug, userId)
      sendSuccess(res, docs.map(d => {
        /* Anonymous and non-entitled callers get no Mux-derived thumbnail and
           no recording — the playback id embedded in the thumbnail URL is
           enough to watch the stream. */
        const dto = toDTO(d, (d as any).isEntitled ?? false)
        /* Strip meeting URL and stream credentials from the course listing.
           Students receive the join link via email after booking a session. */
        delete (dto as any).meetingUrl
        delete (dto as any).muxPlaybackId
        delete (dto as any).playbackUrl
        ;(dto as any).isEnrolled = (d as any).isEnrolled ?? false
        return dto
      }))
    } catch (err) { next(err) }
  }

  /* GET /live-classes/upcoming — auth */
  upcomingForMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = Math.min(Number(req.query['limit'] ?? 10), 100)
      const { UserModel } = await import('@/models/schema.ts')
      const user     = await UserModel.findById(req.user!.id).select('category').lean()
      const category = (user as any)?.category as string | undefined
      const docs     = await this.service.listUpcomingForUser(req.user!.id, limit, category)

      /* The caller's seats, once. The Meet link is fetched on the click via
         POST /live-classes/:id/join; the feed only says whether there is a
         seat and when the button should show. */
      const { ClassBookingModel } = await import('@/models/schema.ts')
      const { studentJoinWindow } = await import('@/utils/liveStatus.ts')
      const { Types } = await import('mongoose')
      const seats = await ClassBookingModel.find(
        { userId: new Types.ObjectId(req.user!.id), status: { $in: ['booked', 'attended'] } },
        { liveClassId: 1 },
      ).lean()
      const bookedIds = new Set(seats.map((b: any) => String(b.liveClassId)))

      sendSuccess(res, docs.map(d => {
        const isEnrolled = (d as any).isEnrolled ?? false
        /* Entitlement is enrolment MINUS any module the admin blocked for this
           student — a blocked module must not hand out the stream fields. */
        const isEntitled = (d as any).isEntitled ?? false
        const dto        = toDTO(d, isEntitled)
        /* The feed lists every upcoming session, enrolled or not — but only
           entitled students receive the stream fields. */
        if (!isEntitled) {
          delete (dto as any).muxPlaybackId
          delete (dto as any).playbackUrl
          delete (dto as any).thumbnailUrl
          delete (dto as any).recordingUrl
        }
        /* Never to a student, entitled or not — see POST /:id/join. */
        delete (dto as any).meetingUrl
        ;(dto as any).isEnrolled   = isEnrolled
        /* A seat AND a live enrolment — the click requires both. */
        ;(dto as any).isBooked     = isEnrolled && bookedIds.has(String((d as any)._id ?? (d as any).id))
        const w = (d as any).scheduledStart ? studentJoinWindow((d as any).scheduledStart) : null
        ;(dto as any).joinOpensAt  = w ? w.opensAt.toISOString()  : undefined
        ;(dto as any).joinClosesAt = w ? w.closesAt.toISOString() : undefined
        return dto
      }))
    } catch (err) { next(err) }
  }

  /* GET /live-classes/:id/watch — auth, checks enrollment */
  watchAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id     = String(req.params['id'] ?? '')
      const result = await this.service.getWatchAccess(id, req.user!.id)
      sendSuccess(res, result)
    } catch (err) { next(err) }
  }

  /* POST /webhooks/mux — no auth, signature verified inside */
  muxWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sig     = req.headers['mux-signature'] as string | undefined
      const rawBody = req.body as Buffer

      if (!verifyWebhookSignature(rawBody, sig)) {
        res.status(401).json({ error: 'Invalid Mux webhook signature' })
        return
      }

      const event = JSON.parse(rawBody.toString('utf8')) as { type: string; data: Record<string, unknown> }

      /* Respond immediately — Mux requires < 30s response */
      res.status(200).json({ received: true })

      /* Process async without blocking the response */
      void this.service.handleMuxWebhook(event).catch(err =>
        console.error('[mux-webhook]', err),
      )
    } catch (err) { next(err) }
  }

  /* ── Admin handlers ─────────────────────────────── */

  /* Ownership gate — an instructor may only touch sessions they own (either
     assigned to the session or owning its course). Every other admin role
     (super_admin / admin / sub_admin / support) passes straight through.
     Returns false once a response has already been sent. */
  /* May this caller act on this session at all?
     Two gates, in order:
       1. TENANCY — everyone below super_admin is confined to their own
          academy. Without this an admin of one academy can rewrite or delete
          the other's sessions purely by knowing an id.
       2. OWNERSHIP — an instructor is further confined to their own sessions.
     Answers 404 rather than 403 across an academy boundary, so the endpoint
     never confirms that an id exists elsewhere. */
  #canManage = async (req: Request, res: Response, id: string): Promise<boolean> => {
    const role = req.user?.role
    if (role === 'super_admin') return true

    const { LiveClassModel, CourseModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')

    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid live class id' } }); return false
    }
    const live = await LiveClassModel.findById(id).select('instructorId courseId organizationId').lean()
    if (!live) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Live class not found' } }); return false
    }

    /* Resolved BEFORE the academy check, because for the instructor this
       session names, assignment is the authority and the academy wall is
       asking the wrong question — it is about reaching into someone else's
       records, not about teaching your own class. A LENT instructor's
       borrowed-academy sessions sit on the far side of their own wall by
       design, so asking tenancy first answered 404 for every class the
       lending feature exists to create. See instructorOwnsSession in
       utils/tenancy.ts. */
    const owns = await instructorOwnsSession(req, live)

    /* 1. Tenancy. A caller with no academy on record, or a session that
       predates the field, stays unscoped — same convention as every other
       org guard in this codebase.

       Skipped only for the assigned instructor. Everyone else, including an
       instructor holding someone else's session id, still gets the 404 that
       refuses to confirm the class exists elsewhere. */
    if (!owns) {
      /* Resolved, not read off the request. A session minted before the field
         existed carried no academy, and the old blind read then skipped this
         comparison altogether — an unscoped caller reaching every academy's
         classes by id. See callerOrgForRead in utils/tenancy.ts. */
      const caller = await callerOrgForRead(req)
      if (caller.gone) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Live class not found' } }); return false
      }
      const liveOrg = (live as { organizationId?: unknown }).organizationId
      if (caller.org && liveOrg && String(liveOrg) !== String(caller.org)) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Live class not found' } }); return false
      }
    }

    /* 2. Ownership applies only to teaching staff. */
    if (role !== 'instructor') return true

    if (!owns) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only manage your own live classes.' } }); return false
    }
    return true
  }

  adminListAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const status = typeof req.query['status'] === 'string' ? req.query['status'] : 'all'
      /* Ceiling, not pagination: the admin UI filters client-side and needs the
         full set. 100/200 was low enough that weekly-repeat series pushed this
         week's classes out of the capped, farthest-future-first response. */
      const limit  = Math.min(Number(req.query['limit'] ?? 1000), 2000)
      const isInstructor = req.user?.role === 'instructor'
      const scope  = isInstructor ? undefined : req.user?.categoryScope
      let courseIds: string[] | undefined
      if (scope) {
        const CourseModel = (await import('@/models/schema.ts')).CourseModel
        const courses = await CourseModel.find({ program: scope }, { _id: 1 }).lean()
        courseIds = courses.map((c: any) => String(c._id))
        // No courses in this category → return empty, don't leak other categories' sessions
        if (courseIds.length === 0) { sendSuccess(res, []); return }
      }
      await ensureOrgSlugs()
      const docs = await this.service.listAll({
        status,
        limit,
        courseIds,
        /* An instructor's list is ALREADY narrowed to sessions that name them,
           and assignment is narrower than the academy: every row this can
           return is one they are booked to teach. Stacking the academy clause
           on top can only SUBTRACT classes that are genuinely theirs, which is
           precisely what hid a LENT instructor's borrowing-academy sessions —
           the sessions lending them exists to create. See
           instructorOwnsSession in utils/tenancy.ts for the rule.

           Every OTHER role keeps the clause, and must: for them instructorId
           is unset, so the academy is the only tenancy narrowing in this
           query and dropping it would hand each academy the other's timetable. */
        organizationId: isInstructor ? undefined : req.user?.organizationId,
        instructorId:   isInstructor ? req.user?.id : undefined,
      })
      sendSuccess(res, docs.map(d => toDTO(d)))
    } catch (err) { next(err) }
  }

  adminGetById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id    = String(req.params['id'] ?? '')
      if (!(await this.#canManage(req, res, id))) return
      await ensureOrgSlugs()
      const live  = await this.service.getById(id)

      /* Programme scope keeps a scoped ADMIN out of another programme's
         classes. It must not be turned on the instructor ASSIGNED to teach
         this one.

         Instructors carry a categoryScope too, derived from their own
         `category`, and an instructor's category does not have to match the
         programme of every course they are booked to teach — a JURA-tagged
         instructor assigned to a 4x-trading session is an ordinary staffing
         decision, not a mistake. Applying the scope here locked such an
         instructor out of their own class: the list showed it, host-ticket
         granted them a room, and this endpoint answered 403, so the studio
         page rendered "Live class not found" and the class could never be
         started.

         #canManage has already proved ownership for the instructor role —
         reaching this line as an instructor means this is their session — so
         the check simply does not apply to them. */
      const scope = req.user?.role === 'instructor'
        ? undefined
        : (req.user?.categoryScope as string | undefined)
      if (scope) {
        const { CourseModel } = await import('@/models/schema.ts')
        const courseIdStr = isPopulated(live.courseId as any) ? (live.courseId as any).id : String(live.courseId)
        const course = await CourseModel.findById(courseIdStr).select('program').lean()
        if (!course || (course as any).program !== scope) {
          res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied.' } }); return
        }
      }
      sendSuccess(res, toDTO(live))
    } catch (err) { next(err) }
  }

  adminListForCourse = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const courseId = String(req.params['courseId'] ?? '')
      const scope    = req.user?.categoryScope as string | undefined
      if (scope) {
        const { CourseModel } = await import('@/models/schema.ts')
        const course = await CourseModel.findById(courseId).select('program').lean()
        if (!course || (course as any).program !== scope) {
          res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied.' } }); return
        }
      }
      await ensureOrgSlugs()
      const docs = await this.service.listForCourseId(courseId)

      /* An instructor sees only their own sessions, even inside a course they
         own — matching adminListAll and the by-id guard. Without this, opening
         a course exposes every colleague's session for it. Filtered here
         rather than in the query because the set is one course's worth of
         rows and it keeps the repository signature untouched. */
      const visible = req.user?.role === 'instructor'
        ? docs.filter(d => String((d as { instructorId?: unknown }).instructorId ?? '') === String(req.user!.id))
        : docs

      sendSuccess(res, visible.map(d => toDTO(d)))
    } catch (err) { next(err) }
  }

  /* ── Shared create logic — used by both adminCreate (single) and
     adminRepeat (looped, one call per generated week). Category-scope
     check, Meet-link/Mux generation, and the instructor notification
     email all happen here so every code path gets them identically. ── */
  #createOne = async (
    dto: {
      courseId:         string
      title:            string
      description?:     string
      scheduledStart:   string | Date
      durationMins:     number
      type?:            'external' | 'internal'
      instructorId?:    string
      sectionId?:       string
      sessionCapacity?: number
      language?:        string
      isOnline?:        boolean
      location?:        string
      room?:            string
    },
    req: Request,
    seriesId?: string,
  ): Promise<{ live: Awaited<ReturnType<LiveClassService['create']>>; meetingUrl?: string }> => {
    /* Category scope check — a programme-scoped sub_admin can only create for their program */
    const scope = req.user?.categoryScope as string | undefined
    if (scope) {
      const { CourseModel } = await import('@/models/schema.ts')
      const course = await CourseModel.findById(dto.courseId).select('program').lean()
      if (!course) {
        throw Object.assign(new Error('Course not found'), { statusCode: 404, code: 'COURSE_NOT_FOUND' })
      }
      if ((course as any).program !== scope) {
        throw Object.assign(new Error('You can only create sessions for your category courses.'), { statusCode: 403, code: 'FORBIDDEN' })
      }
    }

    const sessionType  = dto.type ?? 'external'
    const isOnline      = dto.isOnline ?? true
    const instructorId  = dto.instructorId ?? req.user!.id

    /* FORMAT ONLY, and only so an unparseable id never reaches the two calls
       below. The real rule — the user exists, is not a student, and belongs to
       this academy or is lent to it — lives in one place,
       liveClass.service.ts #assertInstructorUsable, and runs inside create().

       Without this the Meet lookup on the next line calls findById with a
       malformed id, Mongoose raises a CastError, and the admin gets
       "No record matches that _id." with a 404 — pointing at the class rather
       than at the field they got wrong. For an internal class, where there is
       no lookup, the same input correctly returned 400 from the service. Same
       bad input, two different answers, depending on the class type. */
    if (!Types.ObjectId.isValid(instructorId)) {
      throw Object.assign(
        new Error('Invalid instructor id'),
        { statusCode: 400, code: 'INVALID_INSTRUCTOR_ID' },
      )
    }

    /* Auto-generate a Google Meet link for online external sessions */
    let meetingUrl: string | undefined
    let googleMeetCode: string | undefined
    if (sessionType === 'external' && isOnline) {
      /* Look up instructor email so workspace users become the Meet host */
      const { UserModel } = await import('@/models/schema.ts')
      const instructor = await UserModel.findById(instructorId).select('email').lean()
      const instructorEmail = (instructor as any)?.email as string | undefined

      /* Google is a third party in the critical path of scheduling a class,
         and this call had no error handling: a rate limit, an expired token or
         a network blip threw straight past the error middleware and the admin
         saw "An unexpected error occurred" with no idea what to do. It showed
         up as an INTERMITTENT 500 — the suite passed six times standalone and
         failed inside the full chain, where the call is more likely to be
         throttled.

         The session is deliberately still NOT created on failure, matching the
         previous behaviour: a live class with no join link would strand the
         students who booked it. What changes is that the caller now gets a
         specific, actionable error instead of a generic one, and the cause is
         logged. Whether a Google outage should instead create the session and
         let an admin attach a link later (there is already a /recreate
         endpoint for that) is a product decision, not a code one. */
      try {
        const meet = await createGoogleMeetLink({
          title:            dto.title,
          startISO:         String(dto.scheduledStart),
          durationMins:     dto.durationMins,
          instructorEmail,
        })
        meetingUrl     = meet.meetingUrl
        googleMeetCode = meet.meetingCode || undefined
      } catch (err) {
        logger.error({ err, title: dto.title, instructorEmail },
          'Google Meet link generation failed — live class not created')
        throw Object.assign(
          new Error('Could not create the Google Meet link. Please try again in a moment.'),
          { statusCode: 503, code: 'MEET_LINK_UNAVAILABLE' },
        )
      }
    }

    const live = await this.service.create({
      courseId:        dto.courseId,
      instructorId:    instructorId,
      title:           dto.title,
      description:     dto.description,
      scheduledStart:  new Date(dto.scheduledStart),
      durationMins:    dto.durationMins,
      type:            sessionType,
      provider:        (dto as { provider?: 'mux' | 'livekit' }).provider,
      meetingUrl,
      googleMeetCode,
      sectionId:       dto.sectionId,
      sessionCapacity: dto.sessionCapacity,
      language:        dto.language,
      isOnline,
      location:        dto.location,
      room:            dto.room,
      organizationId:  req.user?.organizationId,
      seriesId,
    })

    /* Notify assigned instructor — fire-and-forget, only for Google Meet sessions */
    if (meetingUrl && live.instructorId) {
      void (async () => {
        try {
          const { UserModel, CourseModel } = await import('@/models/schema.ts')
          const [instructor, course] = await Promise.all([
            UserModel.findById(live.instructorId).select('name email role emailPrefs').lean(),
            CourseModel.findById(live.courseId).select('title').lean(),
          ])
          if (instructor && (instructor as any).email && wantsStaffEmail(instructor as never, 'classScheduled')) {
            await sendInstructorClassScheduled(
              (instructor as any).email,
              (instructor as any).name ?? 'Instructor',
              (course as any)?.title ?? '',
              live.title,
              live.scheduledStart,
              meetingUrl,
              /* The CLASS's academy — the same clock the admin panel shows this
                 instructor for this class. */
              orgSlugFor((live as { organizationId?: unknown }).organizationId),
            )
          }
        } catch (err) {
          const { logger } = await import('@/utils/logger.ts')
          logger.error({ err }, '[LiveClass] Failed to send instructor scheduled email')
        }
      })()
    }

    return { live, meetingUrl }
  }

  adminCreate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = { ...(req.body as Record<string, unknown>) } as any
      /* Ownership gate — categoryScope alone is not one: it is only set for
         three admin categories, so an instructor with no category slipped past
         every check in #createOne and could schedule inside any course (and
         mass-notify its students). An instructor may only target a course they
         own, and is always the instructor of record — a caller-supplied
         instructorId is ignored (mirrors course create in admin.controller.ts). */
      if (req.user?.role === 'instructor') {
        await this.sections.assertCourseEditable(
          String(body.courseId ?? ''), req.user.id, req.user.role, req.user.categoryScope,
        )
        body.instructorId = req.user.id
      }
      const { live } = await this.#createOne(body, req)
      sendSuccess(res, toDTO(live), 'Live class scheduled', 201)
    } catch (err: any) {
      if (err?.statusCode) {
        res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } })
        return
      }
      next(err)
    }
  }

  /* ── Repeat an existing class weekly ─────────────────
     Generates `weeks` additional LiveClass documents, one per week,
     each `7 * i` days after the source class's scheduledStart. All
     generated classes (and the source, if it didn't have one yet)
     share a seriesId so they can be identified as one recurring
     pattern — editing any single generated class afterwards is a
     normal, independent edit and never affects the others. ── */
  adminRepeat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { LiveClassModel } = await import('@/models/schema.ts')
      const { Types } = await import('mongoose')
      const sourceId = req.params['id'] as string
      const { weeks } = req.body as { weeks: number }

      if (!Types.ObjectId.isValid(sourceId)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid live class id' } })
        return
      }
      const source = await LiveClassModel.findById(sourceId).lean()
      if (!source) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Live class not found' } })
        return
      }
      if (!(await this.#canManage(req, res, sourceId))) return

      let seriesId = (source as any).seriesId ? String((source as any).seriesId) : undefined
      if (!seriesId) {
        seriesId = new Types.ObjectId().toString()
        await LiveClassModel.findByIdAndUpdate(sourceId, { seriesId: new Types.ObjectId(seriesId) })
      }

      const created: unknown[] = []
      for (let i = 1; i <= weeks; i++) {
        const scheduledStart = new Date(source.scheduledStart)
        scheduledStart.setDate(scheduledStart.getDate() + 7 * i)

        const { live } = await this.#createOne({
          courseId:        String(source.courseId),
          title:           source.title,
          description:     source.description,
          scheduledStart,
          durationMins:    source.durationMins,
          type:            source.type,
          instructorId:    String(source.instructorId),
          sectionId:       source.sectionId ? String(source.sectionId) : undefined,
          sessionCapacity: source.sessionCapacity,
          language:        source.language,
          isOnline:        source.isOnline,
          location:        source.location,
          room:            source.room,
        }, req, seriesId)
        created.push(toDTO(live))
      }

      sendSuccess(res, created, `${weeks} session${weeks === 1 ? '' : 's'} created`, 201)
    } catch (err: any) {
      if (err?.statusCode) {
        res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } })
        return
      }
      next(err)
    }
  }

  adminUpdate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id    = String(req.params['id'] ?? '')
      if (!(await this.#canManage(req, res, id))) return
      const scope = req.user?.categoryScope as string | undefined
      if (scope) {
        const existing = await this.service.getById(id)
        const { CourseModel } = await import('@/models/schema.ts')
        const courseIdStr = isPopulated(existing.courseId as any) ? (existing.courseId as any).id : String(existing.courseId)
        const course = await CourseModel.findById(courseIdStr).select('program').lean()
        if (!course || (course as any).program !== scope) {
          res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only edit sessions for your category courses.' } }); return
        }
      }
      const dto = req.body as Record<string, unknown>
      const data: Parameters<LiveClassService['update']>[1] = {}
      if (typeof dto['title']             === 'string')  data.title             = dto['title']
      if (typeof dto['description']       === 'string')  data.description       = dto['description']
      if (typeof dto['scheduledStart']    === 'string')  data.scheduledStart    = new Date(dto['scheduledStart'])
      if (typeof dto['durationMins']      === 'number')  data.durationMins      = dto['durationMins']
      if (typeof dto['meetingUrl']        === 'string')  data.meetingUrl        = dto['meetingUrl']
      if (typeof dto['recordingUrl']      === 'string')  data.recordingUrl      = dto['recordingUrl'] || undefined
      if (typeof dto['status']            === 'string')  data.status            = dto['status'] as any
      if (typeof dto['sessionCapacity']   === 'number')  data.sessionCapacity   = dto['sessionCapacity']
      if (typeof dto['mentorNotes']       === 'string')  data.mentorNotes       = dto['mentorNotes']
      /* Re-parenting is validated against the TARGET, not just the current
         session (P-16). #canManage above checked the session as it stands;
         these two fields decide who may attend and who owns it, and were
         copied from the body unchecked — so an instructor could attach their
         session to any course on the platform, and an org admin could move one
         across the academy boundary.

         assertCourseEditable applies tenancy then ownership, so a legitimate
         move between courses the caller already administers still passes. */
      if (typeof dto['courseId'] === 'string') {
        const existing      = await this.service.getById(id)
        const currentCourse = isPopulated(existing.courseId as any)
          ? (existing.courseId as any).id
          : String(existing.courseId)
        /* Only a genuine MOVE needs re-validating; re-submitting the course the
           session already belongs to is a no-op the caller has already been
           cleared for by #canManage. */
        if (dto['courseId'] !== currentCourse) {
          await this.sections.assertCourseEditable(
            dto['courseId'], req.user!.id, req.user!.role, req.user!.categoryScope,
          )
        }
        data.courseId = dto['courseId']
      }

      /* An instructor is always the instructor of record for their own
         sessions — mirrors adminCreate, which forces the same thing. */
      if (typeof dto['instructorId'] === 'string' && req.user?.role !== 'instructor') {
        data.instructorId = dto['instructorId']
      }
      if (typeof dto['sectionId']         === 'string')  data.sectionId         = dto['sectionId']
      if (typeof dto['language']          === 'string')  data.language          = dto['language']
      if (typeof dto['isOnline']          === 'boolean') data.isOnline          = dto['isOnline']
      if (typeof dto['location']          === 'string')  data.location          = dto['location']
      if (typeof dto['room']              === 'string')  data.room              = dto['room']
      if (typeof dto['rescheduleReason']  === 'string')  data.rescheduledReason = dto['rescheduleReason']

      /* ── Tell the people who booked (feature: change notifications) ──────
         Snapshot BEFORE the update so old and new can be compared. Three
         changes matter to somebody holding a booking: the session was
         cancelled, the time moved, or the instructor changed.

         The instructor case did not exist until now, and it is the one a
         student is most likely to care about after the time — people book a
         session because of who is teaching it. */
      const { LiveClassModel } = await import('@/models/schema.ts')
      const oldSession = await LiveClassModel.findById(id).lean()

      const live = await this.service.update(id, data)

      const wasCancelled   = oldSession?.status !== 'cancelled' && data.status === 'cancelled'
      const wasRescheduled = !!data.scheduledStart && !!oldSession?.scheduledStart &&
        new Date(oldSession.scheduledStart).getTime() !== new Date(data.scheduledStart).getTime()
      const oldInstructorId = oldSession?.instructorId ? String(oldSession.instructorId) : undefined
      const instructorChanged = !!data.instructorId && !!oldInstructorId &&
        String(data.instructorId) !== oldInstructorId

      /* Everything that is NOT Critical, so that no edit passes silently.

         Compared against the session as it stood, not against whether the
         field was present in the request: an admin re-saving a form sends
         every field back, so "was it in the body" would report a change on
         every save and bury the real ones. */
      const changed = (k: string, incoming: unknown) =>
        incoming !== undefined && String(incoming ?? '') !== String((oldSession as any)?.[k] ?? '')

      const linkChanged = changed('meetingUrl', data.meetingUrl)

      /* Field name -> what a student would call it. Anything not listed is
         staff-facing (mentor notes, stream ids) and stays out of the message
         while still being logged by the audit trail. */
      const MINOR_LABELS: Record<string, string> = {
        title:           'the title',
        description:     'the description',
        durationMins:    'the length',
        sessionCapacity: 'the number of seats',
        location:        'the location',
        room:            'the room',
      }
      const minorChanges = Object.entries(MINOR_LABELS)
        .filter(([k]) => changed(k, (data as any)[k]))
        .map(([, label]) => label)

      if (linkChanged || minorChanges.length) {
        void notifySessionEdited({
          liveClassId: id,
          title:       live.title,
          linkChanged,
          minorChanges,
        }).catch(err => logger.error({ err, liveClassId: id }, 'session edit notification failed'))
      }

      if (wasCancelled || wasRescheduled || instructorChanged) {
        void notifyBookedStudents({
          liveClassId:   id,
          title:         live.title,
          oldStart:      oldSession?.scheduledStart ?? live.scheduledStart,
          newStart:      live.scheduledStart,
          wasCancelled,
          wasRescheduled,
          instructorChanged,
          oldInstructorId,
          newInstructorId: instructorChanged ? String(data.instructorId) : undefined,
        }).catch(err => logger.error({ err, liveClassId: id }, 'live class change notification failed'))
      }

      sendSuccess(res, toDTO(live), 'Live class updated')
    } catch (err) { next(err) }
  }

  adminDelete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id    = String(req.params['id'] ?? '')
      if (!(await this.#canManage(req, res, id))) return
      const scope = req.user?.categoryScope as string | undefined
      if (scope) {
        const live = await this.service.getById(id)
        const { CourseModel } = await import('@/models/schema.ts')
        const courseIdStr = isPopulated(live.courseId as any) ? (live.courseId as any).id : String(live.courseId)
        const course = await CourseModel.findById(courseIdStr).select('program').lean()
        if (!course || (course as any).program !== scope) {
          res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only delete sessions for your category courses.' } }); return
        }
      }
      await this.service.delete(id)
      sendSuccess(res, null, 'Live class deleted')
    } catch (err) { next(err) }
  }

  adminStart = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params['id'] ?? '')
      if (!(await this.#canManage(req, res, id))) return
      const live = await this.service.startStream(id)
      sendSuccess(res, toDTO(live), 'Stream started')
    } catch (err) { next(err) }
  }

  adminEnd = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params['id'] ?? '')
      if (!(await this.#canManage(req, res, id))) return
      const live = await this.service.endStream(id)
      sendSuccess(res, toDTO(live), 'Stream ended')
    } catch (err) { next(err) }
  }

  adminGetStreamCredentials = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const creds = await this.service.getStreamCredentials(String(req.params['id'] ?? ''))
      sendSuccess(res, creds)
    } catch (err) { next(err) }
  }

  adminRecreate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params['id'] ?? '')
      if (!(await this.#canManage(req, res, id))) return
      const live = await this.service.recreateStream(id)
      sendSuccess(res, toDTO(live), 'Stream credentials recreated')
    } catch (err) { next(err) }
  }
}
