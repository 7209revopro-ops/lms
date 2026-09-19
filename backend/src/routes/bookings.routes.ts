/**
 * bookings.routes.ts — Student class-slot booking endpoints (Phase 3)
 *
 * POST   /bookings              — book a live-class session
 * GET    /bookings/me           — list my bookings (upcoming + past)
 * DELETE /bookings/:id          — cancel a booking
 *
 * Notifications (Phase 5):
 *   - In-app notification is always created (booking-confirmed / booking-cancelled)
 *   - Confirmation / cancellation email is sent non-blocking
 *   - If email delivery fails, a second 'system' notification is created so the
 *     student sees the failure inside the app
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { resolveClassEntitlement } from '@/services/classEntitlement.service.ts'
import { reserveSeat, releaseSeat, seatStampFrom } from '@/services/seatPool.service.ts'
import { ensureOrgSlugs, orgSlugFor } from '@/utils/orgSlugs.ts'
import { callerOrgForRead } from '@/utils/tenancy.ts'
import { z } from 'zod'
import { resolveLiveStatus, isBookingOpen, bookingClosesAt } from '@/utils/liveStatus.ts'
import { authenticate, requireEnrollmentApproval } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { NotificationService } from '@/services/notification.service.ts'
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
import { sendSuccess, buildPaginationMeta } from '@/utils/response.ts'
import { academyClock } from '@/utils/academyClock.ts'

const router = Router()
const notifSvc = new NotificationService()

/* ── Validation ─────────────────────────────── */
const createBookingSchema = z.object({
  liveClassId: z.string().min(1),
})

const bookingQuerySchema = z.object({
  status:   z.enum(['booked', 'attended', 'missed', 'cancelled']).optional(),
  page:     z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
})

/* ── Helper ─────────────────────────────────── */
/* THE READER'S CLOCK, TAGGED.

   This was a bare toLocaleString: no timeZone, so it rendered in whatever zone
   the process runs in — Asia/Dubai, because backend/src/config/timezone.ts
   pins it — and no tag, so nothing on the page said which clock it meant. On a
   shared class the reader is routinely in the OTHER academy, and a Bangalore
   student was told a Dubai time, unlabelled, 90 minutes off their own. */
function fmtDate(iso: string | Date, academySlug?: string | null): string {
  return academyClock(iso, academySlug).full
}

/* ── Fire-and-forget: notify + email on booking created ── */
async function afterBookingCreated(
  userId: string,
  userEmail: string,
  userName: string,
  sessionTitle: string,
  sessionStart: string | Date,
  joinUrl: string,
  /* THE RECIPIENT'S academy, not the class's. On a shared class the two
     differ, and the reader thinks in their own academy's clock. */
  academySlug?: string | null,
): Promise<void> {
  const dateLabel = fmtDate(sessionStart, academySlug)

  /* 1. In-app notification — always */
  await notifSvc.create(userId, {
    kind:  'booking-confirmed',
    title: `Booking confirmed: ${sessionTitle}`,
    body:  `Your seat is confirmed for ${sessionTitle} on ${dateLabel}.`,
    link:  '/class-bookings',
  })

  /* 2. Confirmation email — if it fails, add a system notification */
  try {
    const { sendBookingConfirmation } = await import('@/services/email.service.ts')
    await sendBookingConfirmation(userEmail, userName, sessionTitle, sessionStart, academySlug)
  } catch {
    await notifSvc.create(userId, {
      kind:  'system',
      title: 'Booking confirmation email failed',
      body:  'We could not send your confirmation email, but your booking is confirmed. Check your Class Schedule.',
      link:  '/class-bookings',
    }).catch(() => {/* truly non-fatal */})
  }
}

/* ── Fire-and-forget: notify + email on booking cancelled ── */
async function afterBookingCancelled(
  userId: string,
  userEmail: string,
  userName: string,
  sessionTitle: string,
  sessionStart: string | Date,
  /* THE RECIPIENT'S academy, not the class's — same rule as the create path
     above. Without it both the bell and the email fell back to Dubai. */
  academySlug?: string | null,
): Promise<void> {
  const dateLabel = fmtDate(sessionStart, academySlug)

  /* 1. In-app notification — always */
  await notifSvc.create(userId, {
    kind:  'booking-cancelled',
    title: `Booking cancelled: ${sessionTitle}`,
    body:  `Your booking for ${sessionTitle} on ${dateLabel} has been cancelled.`,
    link:  '/class-bookings',
  })

  /* 2. Cancellation email — if it fails, add a system notification */
  try {
    const { sendBookingCancelledByStudent } = await import('@/services/email.service.ts')
    /* The Date and the academy, never a pre-formatted label: the leaf formats
       it, so the zone and its tag are decided in one place. */
    await sendBookingCancelledByStudent(userEmail, userName, sessionTitle, sessionStart, academySlug)
  } catch {
    await notifSvc.create(userId, {
      kind:  'system',
      title: 'Cancellation email failed',
      body:  'We could not send your cancellation confirmation email. Your booking has still been cancelled successfully.',
      link:  '/class-bookings',
    }).catch(() => {/* truly non-fatal */})
  }
}

/* ── POST /bookings ─────────────────────────── */
router.post('/', authenticate, requireEnrollmentApproval, validate(createBookingSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassBookingModel, LiveClassModel, EnrollmentModel, UserModel } =
      await import('@/models/schema.ts')
    const { Types } = await import('mongoose')

    const userId      = req.user!.id
    const { liveClassId } = req.body as { liveClassId: string }

    if (!Types.ObjectId.isValid(liveClassId)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid liveClassId' } }); return
    }

    /* Fetch the session */
    const session = await LiveClassModel.findById(liveClassId).lean()
    if (!session) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }); return
    }
    if (session.status === 'cancelled' || session.status === 'ended') {
      res.status(400).json({ success: false, error: { code: 'SESSION_UNAVAILABLE', message: 'Session is no longer available for booking' } }); return
    }

    /* Booking closes an hour before the class starts.

       Checked BEFORE the live-window test below, and separately from it, so
       the student is told the truth: between the cut-off and the start there
       is a whole hour where the class is neither live nor bookable, and
       "this class is live" would be a lie for most of it.

       Ordered ahead of the enrolment, module, cap and capacity gates on
       purpose — none of those can be fixed by the student at this point, and
       the deadline is the one answer that explains why. */
    const effectiveStatus = resolveLiveStatus(session.status, session.scheduledStart, session.durationMins)
    if (!isBookingOpen(session.scheduledStart)) {
      const started = Date.now() >= new Date(session.scheduledStart).getTime()
      res.status(400).json({
        success: false,
        error: {
          code: 'BOOKING_CLOSED',
          message: started || effectiveStatus === 'live'
            ? 'Booking is closed — this class has already started.'
            : `Booking closed at ${fmtDate(bookingClosesAt(session.scheduledStart))}. Seats must be reserved at least an hour before the class.`,
          /* The deadline itself, so a client can render it rather than
             re-deriving a rule that only the server owns. */
          closedAt: bookingClosesAt(session.scheduledStart).toISOString(),
        },
      }); return
    }

    /* ENROLMENT AND MODULE, ASKED OF ONE DOOR — see
       services/classEntitlement.service.ts. Booking is the strict path: it
       demands a genuinely ACTIVE enrolment, where join and watch accept
       anything not dropped. That disagreement is real, live and deliberately
       preserved; it is now named in one file instead of re-derived in eight. */
    /* THE STUDENT'S OWN ACADEMY, and passing null here was wrong twice over.

       ONE. It let BOOKING and JOINING disagree, which they must never do.
       assertStudentMayJoin passes ctx.organizationId and refuses WRONG_ACADEMY
       on a mismatch; booking passed null and refused nothing. So a student
       holding an enrolment in the OTHER academy's course could take a seat and
       then be turned away at the door. That disagreement predates cross-academy
       classes and is live today.

       TWO. With more than one door it picks the WRONG door. The resolver takes
       the first door that yields an enrolment, host first, so a student of one
       academy who also holds the other academy's enrolment is admitted through
       the HOST door — their own academy's module block never consulted, and
       their seat drawn from the other academy's floor. Passing the academy
       makes the door selection deterministic and correct.

       A student with no academy on record still resolves to null and stays
       unscoped, which is tenancy rule 3b and today's behaviour. */
    const booker = await callerOrgForRead(req)
    if (booker.gone) {
      res.status(403).json({ success: false, error: { code: 'NOT_ENROLLED', message: 'You must be enrolled in this course to book the session' } }); return
    }
    const entitlement = await resolveClassEntitlement(session, userId, booker.org, 'active')
    /* EVERY refusal, not a list of the ones we remembered. Checking two of the
       three codes left WRONG_ACADEMY falling straight through into a
       SUCCESSFUL booking — the exact hole that passing the academy was added
       to close. Switching on ok means a code introduced later cannot be
       forgotten here.

       A cross-academy refusal answers NOT_ENROLLED on purpose: saying "that
       class belongs to another academy" confirms the class exists, which is
       the same oracle the 404-not-403 rule elsewhere exists to close. */
    if (!entitlement.ok) {
      const refusal = entitlement.code === 'MODULE_BLOCKED'
        ? { code: 'MODULE_BLOCKED', message: "You don't have access to this module. Contact your admin." }
        : { code: 'NOT_ENROLLED', message: 'You must be enrolled in this course to book the session' }
      res.status(403).json({ success: false, error: refusal }); return
    }

    /* 2× attendance cap */
    const attendedCount = await ClassBookingModel.countDocuments({
      userId: new Types.ObjectId(userId),
      liveClassId: new Types.ObjectId(liveClassId),
      status: 'attended',
    })
    if (attendedCount >= 2) {
      res.status(403).json({
        success: false,
        error: {
          code:    'CONTACT_ADMIN',
          message: 'You have already attended this class twice. Please contact the admin team to arrange more access.',
        },
      }); return
    }

    /* Capacity fast-check — the authoritative check is the atomic seat
       reservation below, which is what actually enforces the cap. */
    if (session.bookedCount >= session.sessionCapacity) {
      res.status(400).json({ success: false, error: { code: 'SESSION_FULL', message: 'This session is fully booked' } }); return
    }

    /* Check for existing booking (avoid duplicate) */
    const existing = await ClassBookingModel.findOne({
      userId: new Types.ObjectId(userId),
      liveClassId: new Types.ObjectId(liveClassId),
    }).lean()

    let bookingDoc
    if (existing) {
      if (existing.status === 'cancelled') {
        /* Reserve the seat atomically — the cap is re-evaluated inside the
           filter, so concurrent bookings can never oversell the session. */
        const reserved = await reserveSeat(liveClassId, entitlement.door?.organizationId ?? null)
        if (reserved === null) {
          res.status(400).json({ success: false, error: { code: 'SESSION_FULL', message: 'This session is fully booked' } }); return
        }
        /* Re-book after cancel — reset the reminder flags so the re-booked
         * client gets a fresh set of reminders (otherwise flags left true from
         * the previous booking cycle would suppress them). */
        let rebooked
        try {
          rebooked = await ClassBookingModel.updateOne({ _id: existing._id, status: 'cancelled' }, {
            status: 'booked',
            bookedAt: new Date(),
            cancelledAt: undefined,
            /* Re-stamped, not kept: the student may be coming through a
               different door than the one they cancelled from. */
            ...seatStampFrom(reserved, entitlement.door),
            reminderDayBeforeSent:  false,
            reminderDayOfSent:      false,
            reminderPreSessionSent: false,
            reminder5MinSent:       false,
            reminderAtTimeSent:     false,
          })
        } catch (err) {
          /* Re-book failed — give the reserved seat back, to the pool it came
             from rather than to a re-derived one. */
          await releaseSeat({ liveClassId, ...seatStampFrom(reserved, entitlement.door) })
          throw err
        }
        if (rebooked.modifiedCount === 0) {
          /* Another request re-booked it first — give the seat back */
          await releaseSeat({ liveClassId, ...seatStampFrom(reserved, entitlement.door) })
          res.status(409).json({ success: false, error: { code: 'ALREADY_BOOKED', message: 'You already have a booking for this session' } }); return
        }
        bookingDoc = await ClassBookingModel.findById(existing._id).lean({ virtuals: true })
        sendSuccess(res, bookingDoc, 'Booking created', 201)
      } else {
        res.status(409).json({ success: false, error: { code: 'ALREADY_BOOKED', message: 'You already have a booking for this session' } }); return
      }
    } else {
      /* Reserve the seat atomically — the cap is re-evaluated inside the
         filter, so concurrent bookings can never oversell the session. */
      const reserved = await reserveSeat(liveClassId, entitlement.door?.organizationId ?? null)
      if (reserved === null) {
        res.status(400).json({ success: false, error: { code: 'SESSION_FULL', message: 'This session is fully booked' } }); return
      }

      let booking
      try {
        booking = await ClassBookingModel.create({
          userId:      new Types.ObjectId(userId),
          liveClassId: new Types.ObjectId(liveClassId),
          status:      'booked',
          bookedAt:    new Date(),
          ...seatStampFrom(reserved, entitlement.door),
        })
      } catch (err) {
        /* Booking row not created — give the reserved seat back */
        await releaseSeat({ liveClassId, ...seatStampFrom(reserved, entitlement.door) })
        throw err
      }

      bookingDoc = await booking.populate([
        { path: 'liveClassId', select: 'id title scheduledStart durationMins muxPlaybackId type isOnline' },
      ])

      sendSuccess(res, bookingDoc, 'Booking created', 201)
    }

    /* ── Post-booking: in-app notification + email (non-blocking) ── */
    UserModel.findById(userId).then(user => {
      if (!user) return
      const lc = session  // use already-fetched session for title/start
      const joinUrl = (lc as any).meetingUrl
        ?? `${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/live-classes/${liveClassId}/watch`

      /* THE STUDENT'S OWN ACADEMY, not the class's. On a shared class those
         differ by ninety minutes, and the reader thinks in their own. */
      void (async () => {
        await ensureOrgSlugs()
        await afterBookingCreated(
          userId,
          user.email,
          user.name,
          lc.title,
          lc.scheduledStart,
          joinUrl,
          orgSlugFor((user as { organizationId?: unknown }).organizationId),
        )
      })().catch(() => {/* non-fatal */})
    }).catch(() => {/* non-fatal */})

  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ success: false, error: { code: 'ALREADY_BOOKED', message: 'You already have a booking for this session' } }); return
    }
    next(err)
  }
})

/* ── GET /bookings/me ───────────────────────── */
router.get('/me', authenticate, validate(bookingQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassBookingModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const userId = req.user!.id
    const q = req.query as unknown as z.infer<typeof bookingQuerySchema>
    const filter: Record<string, any> = { userId: new Types.ObjectId(userId) }
    if (q.status) filter['status'] = q.status
    const page     = Number(q.page)     || 1
    const per_page = Number(q.per_page) || 20
    const skip     = (page - 1) * per_page
    const [docs, total] = await Promise.all([
      ClassBookingModel.find(filter)
        /* No meetingUrl in the populate: the link is released only by
           POST /live-classes/:id/join, inside the join window, to the seat
           holder. A booking row carried it for every status — cancelled
           included — and at any time; that was a way to read the link
           without ever being let in. */
        .populate('liveClassId', 'id title scheduledStart durationMins status muxPlaybackId type isOnline')
        .sort({ bookedAt: -1 })
        .skip(skip).limit(per_page)
        .lean({ virtuals: true }),
      ClassBookingModel.countDocuments(filter),
    ])
    /* No avatar in this projection today, but the rule is the rule: anything
       that serialises a stored document goes through sendSuccess, so a field
       added to the populate later cannot quietly start shipping dead URLs. */
    sendSuccess(res, docs, undefined, 200, buildPaginationMeta(total, page, per_page))
  } catch (err) { next(err) }
})

/* ── DELETE /bookings/:id ───────────────────── */
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassBookingModel, LiveClassModel, UserModel } = await import('@/models/schema.ts')
    const userId = req.user!.id
    const id = String(req.params['id'] ?? '')

    const booking = await ClassBookingModel.findOne({ _id: id, userId })
      .populate('liveClassId', 'title scheduledStart meetingUrl type')
      .lean({ virtuals: true })

    if (!booking) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Booking not found' } }); return
    }
    if (booking.status !== 'booked') {
      res.status(400).json({ success: false, error: { code: 'CANNOT_CANCEL', message: 'Only active bookings can be cancelled' } }); return
    }

    /* Atomic booked → cancelled transition — a repeated cancel of the same
       booking modifies nothing, so the seat is released exactly once. */
    const cancelled = await ClassBookingModel.updateOne(
      { _id: id, userId, status: 'booked' },
      { status: 'cancelled', cancelledAt: new Date() },
    )
    if (cancelled.modifiedCount === 0) {
      res.status(400).json({ success: false, error: { code: 'CANNOT_CANCEL', message: 'Only active bookings can be cancelled' } }); return
    }

    /* Back to the pool the seat was TAKEN from, read off the booking row.
       Re-deriving it here would hand a guest academy's seat to the host when
       the student's entitlement changed after they booked. */
    /* The row is POPULATED here, so hand the helper the id rather than the
       document. releaseSeat normalises this too; both, because one of the two
       quietly losing a seat is exactly how this shipped. */
    await releaseSeat({
      ...(booking as any),
      liveClassId: (booking.liveClassId as any)?._id ?? booking.liveClassId,
    })

    sendSuccess(res, null, 'Booking cancelled')

    /* ── Post-cancel: in-app notification + email (non-blocking) ── */
    const lc = booking.liveClassId as any
    const sessionTitle = lc?.title ?? 'Session'
    const sessionStart = lc?.scheduledStart ?? new Date().toISOString()

    UserModel.findById(userId).then(async user => {
      if (!user) return
      /* Awaited, not fire-and-forget: orgSlugFor is SYNCHRONOUS and answers
         undefined from a cold cache, which silently restores the Dubai
         default. The create path above warms it the same way. */
      await ensureOrgSlugs()
      afterBookingCancelled(
        userId,
        user.email,
        user.name,
        sessionTitle,
        sessionStart,
        orgSlugFor(user.organizationId),
      ).catch(() => {/* non-fatal */})
    }).catch(() => {/* non-fatal */})

  } catch (err) { next(err) }
})

export default router
