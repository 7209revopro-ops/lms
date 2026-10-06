/**
 * reminders.job.ts — Booking reminder cron jobs
 *
 * Three tiers of reminders for every booked class slot:
 *   1. Day-before  — sent when session is 23–25 h away   (runs every hour)
 *   2. Day-of      — sent on the morning of the session   (runs daily at 7am)
 *   3. Pre-session — sent when session is 25–35 min away  (runs every 5 min)
 *
 * Each reminder:
 *   a) Creates an in-app notification  (always, even if SMTP is unconfigured)
 *   b) Sends an email                  (non-blocking)
 *   c) If email fails → creates a 'system' in-app notification so the student
 *      still gets alerted inside the app
 *
 * Duplicate prevention: reminder flag fields on ClassBooking
 *   (reminderDayBeforeSent / reminderDayOfSent / reminderPreSessionSent)
 *   are set to true after the first successful dispatch.
 */
import cron from 'node-cron'
import { logger } from '@/utils/logger.ts'
import { ensureOrgSlugs, orgSlugFor } from '@/utils/orgSlugs.ts'
import { academyClock, academyTime } from '@/utils/academyClock.ts'
import { NotificationService } from '@/services/notification.service.ts'
import {
  sendSessionLinkReminder,
  sendDayOfReminder,
  sendPreSessionReminder,
  sendFiveMinReminder,
  sendClassStartingReminder,
  sendInstructor15MinReminder,
  sendMentorJoinReminder,
  sendMentorNoShowAlert,
  sendMentorNoShowSelfAlert,
  sendInstructorReviewRequestEmail,
} from '@/services/email.service.ts'
import {
  sendClassReminderTomorrowWhatsApp, sendClassStartingSoonWhatsApp,
  sendClassStartsIn5MinWhatsApp, sendClassHasStartedWhatsApp, sendMentorClassIn10MinWhatsApp,
  sendInstructorReviewRequestWhatsApp,
} from '@/services/whatsapp.service.ts'
import { wantsStaffEmail } from '@/utils/emailPrefs.ts'
import { SCHEDULE_LINK } from '@/utils/clientLinks.ts'
import { UserRepository } from '@/repositories/user.repository.ts'
import { toSubAdminProgram } from '@/utils/programVocabulary.ts'
import { studentJoinClosesAt } from '@/services/liveClassJoin.service.ts'
import { env } from '@/config/env.ts'

const notifSvc = new NotificationService()
const userRepo = new UserRepository()

/* Course.program stores the '4x-trading'/'digital-marketing'/'ai'/'jura'
   vocabulary (the same one categoryScope uses, auth.middleware.ts:557-562) —
   its name suggests otherwise, but grep the field and it's plain unenforced
   String. User.program (the sub_admin's own scoping field, schema.ts:251)
   uses a DIFFERENT vocabulary: 'forex'/'digital_marketing'/'ai'/'jura'. This
   maps a class's course into the vocabulary its sub_admins are actually
   stored under — querying UserModel with the course's raw value would match
   nobody, silently. See utils/programVocabulary.ts — this used to be its own
   copy of that table, independent of the same mapping in classHandoff.service.ts
   and auth.middleware.ts's injectCategoryScope. */

/* ── Types ──────────────────────────────────────────── */
/* Bookings whose class starts inside [from, to].
 *
 * The guard is the point. A booking whose live class has been deleted
 * populates to null, and reading `.scheduledStart` off it threw — inside a
 * .filter(), so the exception escaped the entire job rather than one row. Four
 * stale bookings were therefore stopping EVERY reminder for EVERY class, once
 * a minute, in silence: no pre-session mail, no five-minute mail, no at-time
 * mail, for anybody.
 *
 * All five schedules shared the same unguarded line; only three were visibly
 * failing, because the other two's date windows happened not to reach a broken
 * row yet. One selector now, so the next one cannot drift.
 *
 * A booking with no class has nobody to remind and nothing to remind them
 * about, so it is skipped rather than repaired here — clearing the dangling
 * rows is separate work, and this job must not depend on it having happened.
 */
type BookingWithClass = BookingWithRefs & {
  liveClassId: NonNullable<BookingWithRefs['liveClassId']>
  userId:      NonNullable<BookingWithRefs['userId']>
}

/* A class nobody should still be reminded about. The find() only constrains the
   BOOKING's status, so a cancelled or finished class kept mailing its whole
   roster "your class is starting" right on schedule. */
const DEAD_CLASS_STATUSES = new Set(['cancelled', 'ended'])

function dueBetween(bookings: BookingWithRefs[], from: Date, to: Date): BookingWithClass[] {
  /* A type predicate rather than a cast: every caller loops over the result
     and reads the class directly, and this is what lets the compiler PROVE
     those reads are safe instead of being told to trust them. Make the
     reference nullable without it and tsc lights up twelve real dereferences —
     which is the bug, written out. */
  return bookings.filter((b): b is BookingWithClass => {
    /* A deleted student has nobody to notify. Skipping the row here keeps one
       dangling reference from throwing mid-loop and costing everybody else
       their reminder for this run. */
    if (!b.userId?.email) return false
    const lc = b.liveClassId
    if (!lc?.scheduledStart) return false
    if (lc.status && DEAD_CLASS_STATUSES.has(lc.status)) return false
    const s = new Date(lc.scheduledStart)
    return s >= from && s <= to
  })
}

interface BookingWithRefs {
  _id:    any
  /* NULL for the same reason liveClassId is: a deleted student leaves a
     dangling reference that Mongoose populates as null. Typing it as
     always-present is exactly what let one removed account throw inside the
     dispatch loop and abort the whole batch — every other student's reminder
     for that run lost with it. */
  userId: { _id: any; id: string; name: string; email: string; enrollmentApplication?: { phone?: string } } | null
  /* NULL when the class was deleted after the booking was made. Mongoose
     populates a dangling reference as null; typing it as always-present is
     what let the crash below through in the first place. */
  liveClassId: {
    id:             string
    _id?:           unknown
    title:          string
    scheduledStart: Date
    meetingUrl?:    string
    muxPlaybackId?: string
    /* false for an in-person class — which has no room to join, so its
       WhatsApp reminders carry no Join button (see the 5-min and at-time jobs). */
    isOnline?:      boolean
    /* Needed to stop reminding people about a class that was cancelled or has
       already ended — the query only filters the BOOKING's status. */
    status?:        string
  } | null
  reminderDayBeforeSent:  boolean
  reminderDayOfSent:      boolean
  reminderPreSessionSent: boolean
  reminder5MinSent:       boolean
  reminderAtTimeSent:     boolean
}

/* ── Helpers ─────────────────────────────────────────── */
function getJoinUrl(lc: NonNullable<BookingWithRefs['liveClassId']>): string {
  if (lc.meetingUrl) return lc.meetingUrl
  const base = process.env['CLIENT_URL'] ?? 'http://localhost:3000'
  /* `id` is a lean virtual and is not always materialised; falling through to
     the template regardless produced "/live-classes/undefined/watch" — a link
     that 404s — in every reminder for a class with no meeting URL. Fall back to
     the schedule, which always works, rather than mailing a dead link. */
  const id = lc.id ?? (lc as { _id?: unknown })._id
  return id ? `${base}/live-classes/${String(id)}/watch` : `${base}${SCHEDULE_LINK}`
}

/* THESE TWO WERE MISSED BY THE MAIL WORK, and they are the day-before and
   day-of reminders — the ones a student actually plans around. Both formatted
   in whatever zone the server runs in, with no label at all, so a guest
   academy's student could be told the wrong time and, near midnight, the wrong
   DAY. Everything else in the mail path already renders in the reader's
   academy and says which clock it means; these now do too. */
function fmtFull(d: Date, academySlug?: string | null): string {
  return academyClock(d, academySlug).full
}

function fmtTime(d: Date, academySlug?: string | null): string {
  return academyTime(d, academySlug)
}

/* "Tue, 6 Oct" — the short day for a WhatsApp line, in the reader's academy
   zone like every other date here (the time beside it carries the zone tag). */
function fmtShortDay(d: Date, academySlug?: string | null): string {
  const { zone } = academyClock(d, academySlug)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone })
    .replace(/^(\w{3}) /, '$1, ')
}

/* The class's id for a link. `id` is a lean virtual and is not always
   materialised (see getJoinUrl), so fall back to `_id`. */
function classIdOf(lc: NonNullable<BookingWithRefs['liveClassId']>): string {
  return String(lc.id ?? (lc._id as { toString(): string } | undefined)?.toString() ?? '')
}

/* orgSlugFor() is synchronous, and on a cold cache it answers `undefined` —
   which renders every reminder in the default zone. That is the precise bug
   the threading below exists to fix, restored silently and with nothing to
   show for it. startReminderJobs() warms the map at boot, but that is ONE
   attempt: a process that starts before the organizations are readable never
   tries again, and every run* function here is also exported and called
   directly, with no boot at all. Warming per run is a cached read when the map
   is already warm and a real one when it is not — cheap either way at these
   intervals, and it is what makes "the recipient's academy arrived" true
   rather than hoped for. */
async function warmSlugs(): Promise<void> {
  await ensureOrgSlugs().catch(() => {/* non-fatal — falls back to the default */})
}

/**
 * Dispatch one reminder:
 *   1. In-app notification (always)
 *   2. Email — on failure → extra system notification
 */
async function dispatch(
  userId:       string,
  sessionTitle: string,
  sessionStart: Date,
  kind:         'day-before' | 'day-of' | 'pre-session' | 'five-min' | 'at-time',
  emailFn:      () => Promise<void>,
  /* Where the in-app notification should point. Supplied for 'at-time' only:
     that is the moment the student needs the room and nothing else will do.
     Every other reminder keeps sending them to their schedule. */
  notifLink?:   string,
  /* The READER's academy. Every caller here already resolves it for the mail;
     the bell was the one surface that did not receive it, so it rendered in
     the default zone while the email beside it rendered in the student's.
     Same booking, same minute, two different times — and the mail was the
     only one of the two that was right. */
  academySlug?: string | null,
  /* WhatsApp is best-effort ALONGSIDE email, not instead of it — supplied for
     day-before, five-min and (online classes) at-time. A missing or
     unusable phone number is handled inside whatsapp.service.ts itself
     (normalizeWhatsAppNumber returns null → skipped, logged, never thrown),
     so failure here never triggers the "email failed" system notification. */
  whatsappFn?:  () => Promise<void>,
): Promise<void> {
  const dateLabel = fmtFull(sessionStart, academySlug)
  const timeLabel = fmtTime(sessionStart, academySlug)

  /* ── Notification body by kind ── */
  /* 'day-of' states the date rather than claiming "today", for the reason the
     day-of job records at its window: the batch is picked from the BACKEND's
     midnight, so a late-evening Dubai class is selected as today's while
     already being tomorrow's for a reader further east. The mail beside this
     notice stopped asserting the day for the same reason; the two must not
     disagree about the one thing the student acts on. */
  const notifBody = {
    'day-before':  `📅 Reminder: "${sessionTitle}" is tomorrow at ${timeLabel}. Make sure you're ready!`,
    'day-of':      `⏰ Coming up: "${sessionTitle}" starts ${dateLabel}. Join on time!`,
    'pre-session': `🚀 "${sessionTitle}" starts in ~30 minutes. Get ready to join!`,
    'five-min':    `⏱️ "${sessionTitle}" starts in ~5 minutes. Join now so you're ready!`,
    'at-time':     `🎯 "${sessionTitle}" is starting now. Join immediately!`,
  }[kind]

  const notifTitle = {
    'day-before':  `Class tomorrow: ${sessionTitle}`,
    'day-of':      `Coming up: ${sessionTitle} at ${timeLabel}`,
    'pre-session': `Starting soon: ${sessionTitle}`,
    'five-min':    `Starting in 5 min: ${sessionTitle}`,
    'at-time':     `Live now: ${sessionTitle}`,
  }[kind]

  /* 1. In-app notification — always fires */
  await notifSvc.create(userId, {
    kind:  'class-reminder',
    title: notifTitle,
    body:  notifBody,
    /* The class has started: send them to the room, not to a list with the
       room somewhere on it. Every reminder used to land on /class-bookings,
       so the meeting link existed ONLY inside the emails -- a student working
       from the notification bell had no way to reach the class from it. */
    link:  notifLink ?? SCHEDULE_LINK,
  }).catch(err => logger.error({ err, userId, kind }, '[Reminder] Failed to create in-app notification'))

  /* 2. WhatsApp — best-effort, never blocks or substitutes for the email below */
  if (whatsappFn) {
    void whatsappFn().catch(err => logger.debug({ err, userId, kind }, '[Reminder] WhatsApp send failed (non-fatal)'))
  }

  /* 3. Email — failure creates a system notification instead of silently dropping */
  try {
    await emailFn()
  } catch (err) {
    logger.error({ err, userId, sessionTitle, kind }, '[Reminder] Email delivery failed')
    await notifSvc.create(userId, {
      kind:  'system',
      title: 'Reminder email could not be sent',
      body:  `We tried to email you about "${sessionTitle}" (${dateLabel}) but delivery failed. Check your Class Schedule to stay on track.`,
      link:  SCHEDULE_LINK,
    }).catch(() => {/* truly non-fatal */})
  }
}

/* ── Day-before job ──────────────────────────────────── */
export async function runDayBeforeReminders(): Promise<void> {
  try {
    const { ClassBookingModel } = await import('@/models/schema.ts')
    await warmSlugs()
    const now  = new Date()
    const from = new Date(now.getTime() + 23 * 60 * 60 * 1000)
    const to   = new Date(now.getTime() + 25 * 60 * 60 * 1000)

    const bookings = await ClassBookingModel.find({
      status: 'booked',
      reminderDayBeforeSent: false,
    })
      /* organizationId comes back so the mail can be rendered in the READER's
         academy clock. On a shared class the student's academy and the class's
         differ, and an unlabelled ninety-minute gap is a missed class. */
      .populate<{ userId: BookingWithRefs['userId'] }>('userId', 'name email organizationId enrollmentApplication.phone')
      .populate<{ liveClassId: BookingWithRefs['liveClassId'] }>('liveClassId', 'id title scheduledStart meetingUrl muxPlaybackId status')
      .lean({ virtuals: true }) as unknown as BookingWithRefs[]

    const due = dueBetween(bookings, from, to)

    for (const b of due) {
      const userId   = b.userId.id ?? b.userId._id?.toString()
      const start    = new Date(b.liveClassId.scheduledStart)
      const joinUrl  = getJoinUrl(b.liveClassId)
      const slug     = orgSlugFor((b.userId as { organizationId?: unknown }).organizationId)

      await dispatch(userId, b.liveClassId.title, start, 'day-before', () =>
        sendSessionLinkReminder(
          b.userId.email, b.userId.name, b.liveClassId.title,
          fmtFull(start, slug),
          joinUrl,
        ),
        undefined, slug,
        () => sendClassReminderTomorrowWhatsApp(b.userId.enrollmentApplication?.phone, b.liveClassId.title, fmtFull(start, slug)),
      )

      await ClassBookingModel.findByIdAndUpdate(b._id, { reminderDayBeforeSent: true })
    }

    if (due.length) logger.info(`[Reminders] Day-before: dispatched ${due.length} reminders`)
  } catch (err) {
    logger.error({ err }, '[Reminders] day-before job error')
  }
}

/* ── Day-of job ─────────────────────────────────────── */
export async function runDayOfReminders(): Promise<void> {
  try {
    const { ClassBookingModel } = await import('@/models/schema.ts')
    await warmSlugs()
    const now   = new Date()
    const start = new Date(now); start.setHours(0, 0, 0, 0)
    const end   = new Date(now); end.setHours(23, 59, 59, 999)

    const bookings = await ClassBookingModel.find({
      status: 'booked',
      reminderDayOfSent: false,
    })
      /* organizationId comes back so the mail can be rendered in the READER's
         academy clock. On a shared class the student's academy and the class's
         differ, and an unlabelled ninety-minute gap is a missed class. */
      .populate<{ userId: BookingWithRefs['userId'] }>('userId', 'name email organizationId')
      .populate<{ liveClassId: BookingWithRefs['liveClassId'] }>('liveClassId', 'id title scheduledStart meetingUrl muxPlaybackId status')
      .lean({ virtuals: true }) as unknown as BookingWithRefs[]

    const due = dueBetween(bookings, start, end)

    for (const b of due) {
      const userId  = b.userId.id ?? b.userId._id?.toString()
      const classAt = new Date(b.liveClassId.scheduledStart)
      const joinUrl = getJoinUrl(b.liveClassId)
      const slug    = orgSlugFor((b.userId as { organizationId?: unknown }).organizationId)

      /* fmtFull, not fmtTime. The window above is the BACKEND's calendar day,
         so for a reader ahead of it a late-evening Dubai class is selected as
         "today" when it is already tomorrow for them — and the mail used to
         carry a clock time and nothing else, so there was no date on it to
         notice that by. The day is now stated instead of asserted. */
      await dispatch(userId, b.liveClassId.title, classAt, 'day-of', () =>
        sendDayOfReminder(
          b.userId.email, b.userId.name, b.liveClassId.title,
          fmtFull(classAt, slug),
          joinUrl,
        ),
        undefined, slug,
      )

      await ClassBookingModel.findByIdAndUpdate(b._id, { reminderDayOfSent: true })
    }

    if (due.length) logger.info(`[Reminders] Day-of: dispatched ${due.length} reminders`)
  } catch (err) {
    logger.error({ err }, '[Reminders] day-of job error')
  }
}

/* ── Pre-session job (30 min) ────────────────────────── */
export async function runPreSessionReminders(): Promise<void> {
  try {
    const { ClassBookingModel } = await import('@/models/schema.ts')
    await warmSlugs()
    const now  = new Date()
    const from = new Date(now.getTime() + 25 * 60 * 1000)
    const to   = new Date(now.getTime() + 35 * 60 * 1000)

    const bookings = await ClassBookingModel.find({
      status: 'booked',
      reminderPreSessionSent: false,
    })
      /* organizationId comes back so the mail can be rendered in the READER's
         academy clock. On a shared class the student's academy and the class's
         differ, and an unlabelled ninety-minute gap is a missed class. */
      .populate<{ userId: BookingWithRefs['userId'] }>('userId', 'name email organizationId')
      .populate<{ liveClassId: BookingWithRefs['liveClassId'] }>('liveClassId', 'id title scheduledStart meetingUrl muxPlaybackId status')
      .lean({ virtuals: true }) as unknown as BookingWithRefs[]

    const due = dueBetween(bookings, from, to)

    for (const b of due) {
      const userId  = b.userId.id ?? b.userId._id?.toString()
      const classAt = new Date(b.liveClassId.scheduledStart)
      const slug    = orgSlugFor((b.userId as { organizationId?: unknown }).organizationId)

      /* The mail itself carries no time, but the in-app notice and the
         email-failure notice both do, so the reader's academy still has to
         reach dispatch. */
      await dispatch(userId, b.liveClassId.title, classAt, 'pre-session', () =>
        sendPreSessionReminder(b.userId.email, b.userId.name, b.liveClassId.title, 30),
        undefined, slug,
      )

      await ClassBookingModel.findByIdAndUpdate(b._id, { reminderPreSessionSent: true })
    }

    if (due.length) logger.info(`[Reminders] Pre-session: dispatched ${due.length} reminders`)
  } catch (err) {
    logger.error({ err }, '[Reminders] pre-session job error')
  }
}

/* ── 5-min job ───────────────────────────────────────── */
export async function runFiveMinReminders(): Promise<void> {
  try {
    const { ClassBookingModel } = await import('@/models/schema.ts')
    await warmSlugs()
    const now  = new Date()
    const from = new Date(now.getTime() + 3 * 60 * 1000)
    const to   = new Date(now.getTime() + 8 * 60 * 1000)

    const bookings = await ClassBookingModel.find({
      status: 'booked',
      reminder5MinSent: false,
    })
      /* organizationId comes back so the mail can be rendered in the READER's
         academy clock. On a shared class the student's academy and the class's
         differ, and an unlabelled ninety-minute gap is a missed class. */
      .populate<{ userId: BookingWithRefs['userId'] }>('userId', 'name email organizationId enrollmentApplication.phone')
      .populate<{ liveClassId: BookingWithRefs['liveClassId'] }>('liveClassId', 'id title scheduledStart meetingUrl muxPlaybackId status isOnline')
      .lean({ virtuals: true }) as unknown as BookingWithRefs[]

    const due = dueBetween(bookings, from, to)

    for (const b of due) {
      const userId  = b.userId.id ?? b.userId._id?.toString()
      const classAt = new Date(b.liveClassId.scheduledStart)
      const joinUrl = getJoinUrl(b.liveClassId)
      const slug    = orgSlugFor((b.userId as { organizationId?: unknown }).organizationId)
      const phone   = b.userId.enrollmentApplication?.phone

      await dispatch(userId, b.liveClassId.title, classAt, 'five-min', () =>
        sendFiveMinReminder(
          b.userId.email, b.userId.name, b.liveClassId.title, joinUrl, classAt, slug,
        ),
        undefined, slug,
        /* Online: class_starts_in_5_min, whose Join button opens this class's
           page. In person there is nothing to join, so the plain reminder as
           before (class_starting_soon_v5, its fixed button to My Bookings). */
        b.liveClassId.isOnline === false
          ? () => sendClassStartingSoonWhatsApp(phone, b.liveClassId.title, '5')
          : () => sendClassStartsIn5MinWhatsApp(
              phone, b.userId.name, b.liveClassId.title,
              fmtShortDay(classAt, slug), fmtTime(classAt, slug), classIdOf(b.liveClassId),
            ),
      )

      await ClassBookingModel.findByIdAndUpdate(b._id, { reminder5MinSent: true })
    }

    if (due.length) logger.info(`[Reminders] 5-min: dispatched ${due.length} reminders`)
  } catch (err) {
    logger.error({ err }, '[Reminders] 5-min job error')
  }
}

/* ── At-time job ─────────────────────────────────────── */
export async function runAtTimeReminders(): Promise<void> {
  try {
    const { ClassBookingModel } = await import('@/models/schema.ts')
    await warmSlugs()
    const now  = new Date()
    const from = new Date(now.getTime() - 5 * 60 * 1000)   // up to 5 min ago
    const to   = new Date(now.getTime())                    // up to now

    const bookings = await ClassBookingModel.find({
      status: 'booked',
      reminderAtTimeSent: false,
    })
      /* organizationId comes back so the mail can be rendered in the READER's
         academy clock. On a shared class the student's academy and the class's
         differ, and an unlabelled ninety-minute gap is a missed class. */
      .populate<{ userId: BookingWithRefs['userId'] }>('userId', 'name email organizationId enrollmentApplication.phone')
      .populate<{ liveClassId: BookingWithRefs['liveClassId'] }>('liveClassId', 'id title scheduledStart meetingUrl muxPlaybackId status isOnline')
      .lean({ virtuals: true }) as unknown as BookingWithRefs[]

    const due = dueBetween(bookings, from, to)

    for (const b of due) {
      const userId  = b.userId.id ?? b.userId._id?.toString()
      const classAt = new Date(b.liveClassId.scheduledStart)
      const joinUrl = getJoinUrl(b.liveClassId)

      /* The EMAIL carries the Meet link itself — that is the decision on
         record. The in-app notice does not: a Notification row lives for ever
         and is read back by GET /notifications long after the join window,
         and after the student has cancelled the seat, so a raw URL in it is
         a way to obtain the link with no gate at all. The notice points at
         the class page instead, where the Join button is — one tap away
         while the window is open, and honest about it once it is not. */
      const liveClassId = String((b.liveClassId as { id?: string; _id?: unknown }).id
        ?? (b.liveClassId as { _id?: unknown })._id)
      await dispatch(userId, b.liveClassId.title, classAt, 'at-time', () =>
        sendClassStartingReminder(b.userId.email, b.userId.name, b.liveClassId.title, joinUrl),
        `/live-classes/${liveClassId}/watch`,
        orgSlugFor((b.userId as { organizationId?: unknown }).organizationId),
        /* Online only: class_has_started, its Join button opening the same
           class page the in-app notice points at. An in-person class gets no
           WhatsApp at its start, as before — there is nothing to join. */
        b.liveClassId.isOnline === false
          ? undefined
          : () => sendClassHasStartedWhatsApp(
              b.userId.enrollmentApplication?.phone, b.userId.name, b.liveClassId.title, classIdOf(b.liveClassId),
            ),
      )

      await ClassBookingModel.findByIdAndUpdate(b._id, { reminderAtTimeSent: true })
    }

    if (due.length) logger.info(`[Reminders] At-time: dispatched ${due.length} reminders`)
  } catch (err) {
    logger.error({ err }, '[Reminders] at-time job error')
  }
}

/* ── Instructor 15-min job ───────────────────────────── */
export async function runInstructor15MinReminders(): Promise<void> {
  try {
    const { LiveClassModel } = await import('@/models/schema.ts')
    await warmSlugs()
    const now  = new Date()
    /* The window must be AT LEAST as wide as the poll interval, or start times
       fall between ticks and are never seen at all. This was [13,17] — four
       minutes against a five-minute cron — which covers only 80% of possible start times,
       so roughly one instructor in five simply never got their reminder. The
       miss is silent: nothing errors, the flag just stays false for ever.

       Every sibling job already satisfies this (day-before 2h/1h, pre-session
       10m/5m, five-min 5m/5m, at-time 5m/5m); this one did not. Eight minutes
       against a five-minute tick leaves margin for a late tick, and the
       reminderInstructor15MinSent flag still guarantees exactly one send. */
    const from = new Date(now.getTime() + 12 * 60 * 1000)   // 12 min from now
    const to   = new Date(now.getTime() + 20 * 60 * 1000)   // 20 min from now

    const classes = await LiveClassModel.find({
      status:  'scheduled',
      type:    'external',
      isOnline: { $ne: false },
      reminderInstructor15MinSent: false,
      scheduledStart: { $gte: from, $lte: to },
    })
      .populate<{ instructorId: { id: string; name: string; email: string } }>('instructorId', 'name email role emailPrefs')
      .lean({ virtuals: true })

    for (const cls of classes) {
      const instructor = cls.instructorId as any
      if (!instructor?.email || !cls.meetingUrl) continue

      /* Instructor silenced this category. Mark the class handled anyway —
         the flag is what takes it out of the query, so leaving it false would
         make the job re-fetch and re-skip this class every cycle. */
      if (!wantsStaffEmail(instructor, 'classReminder')) {
        await LiveClassModel.findByIdAndUpdate(cls._id, { reminderInstructor15MinSent: true })
        logger.debug({ classId: cls._id }, '[Reminders] Instructor 15-min skipped — opted out')
        continue
      }

      try {
        await sendInstructor15MinReminder(
          instructor.email,
          instructor.name ?? 'Instructor',
          cls.title,
          new Date(cls.scheduledStart),
          cls.meetingUrl,
          orgSlugFor((cls as { organizationId?: unknown }).organizationId),
        )
        await LiveClassModel.findByIdAndUpdate(cls._id, { reminderInstructor15MinSent: true })
        logger.info({ classId: cls._id, instructor: instructor.email }, '[Reminders] Instructor 15-min reminder sent')
      } catch (err) {
        logger.error({ err, classId: cls._id }, '[Reminders] Instructor 15-min email failed')
      }
    }

    if (classes.length) logger.info(`[Reminders] Instructor 15-min: processed ${classes.length} classes`)
  } catch (err) {
    logger.error({ err }, '[Reminders] instructor-15min job error')
  }
}

/* ── Mentor 10-min WhatsApp ────────────────────────────────────────────────
   About ten minutes before an ONLINE class, its mentor gets
   mentor_class_in_10_min — the class, its time, how many students are booked
   — with a Start button to {ADMIN_URL}/live-classes/<id>/join, which records
   them as joined and opens the room.

   Every minute against a three-minute window ([7, 10] minutes ahead): close
   enough that "starts in 10 minutes" is true, wide enough that a late tick
   still catches every start time. mentorWhatsApp10MinSent makes it once per
   class — `$ne: true`, so classes made before the field existed count too.
   A mentor with no phone on file is skipped and the class marked done:
   there is nowhere to send it, and leaving the flag false would re-read the
   class every minute until it starts. In person: nothing to start online. */
export async function runMentor10MinWhatsApp(): Promise<void> {
  try {
    const { LiveClassModel } = await import('@/models/schema.ts')
    await warmSlugs()
    const now  = new Date()
    const from = new Date(now.getTime() + 7 * 60 * 1000)
    const to   = new Date(now.getTime() + 10 * 60 * 1000)

    const classes = await LiveClassModel.find({
      status:   'scheduled',
      isOnline: { $ne: false },
      mentorWhatsApp10MinSent: { $ne: true },
      scheduledStart: { $gte: from, $lte: to },
    })
      .populate<{ instructorId: { id: string; name: string; phone?: string } }>('instructorId', 'name phone')
      .lean({ virtuals: true })

    for (const cls of classes) {
      const mentor = cls.instructorId as { id?: string; name?: string; phone?: string } | null
      const liveClassId = String((cls as { id?: string }).id ?? cls._id)
      try {
        if (mentor?.phone?.trim()) {
          await sendMentorClassIn10MinWhatsApp(
            mentor.phone, mentor.name ?? 'Mentor', cls.title,
            fmtTime(new Date(cls.scheduledStart), orgSlugFor((cls as { organizationId?: unknown }).organizationId)),
            cls.bookedCount ?? 0, liveClassId,
          )
        }
        await LiveClassModel.updateOne({ _id: cls._id }, { $set: { mentorWhatsApp10MinSent: true } })
      } catch (err) {
        logger.error({ err, classId: cls._id }, '[Reminders] Mentor 10-min WhatsApp failed')
      }
    }

    if (classes.length) logger.info(`[Reminders] Mentor 10-min WhatsApp: processed ${classes.length} classes`)
  } catch (err) {
    logger.error({ err }, '[Reminders] mentor 10-min WhatsApp job error')
  }
}

/* ── Mentor no-show detection — stage 1: nudge at start time ───────────────
   "Joined" is LiveClassModel.instructorJoinedAt — a real webhook for
   internal/LiveKit classes (cltWebhook.service.ts onParticipantJoined), a
   click-to-join proxy for external ones (POST /:id/mark-joined). Either way,
   an unset timestamp is the only signal this job needs; it does not care
   which provider set it or will set it.

   Window widened to 8 minutes against the 5-minute tick for the same reason
   instructor-15min's window was widened above: a 5-minute window against a
   5-minute tick only covers every start time if ticks are never late, and
   the miss here is silent — the flag just never gets set. */
export async function runMentorJoinReminder(): Promise<void> {
  try {
    const { LiveClassModel } = await import('@/models/schema.ts')
    await warmSlugs()
    const now  = new Date()
    const from = new Date(now.getTime() - 8 * 60 * 1000)
    const to   = now

    const classes = await LiveClassModel.find({
      status: { $in: ['scheduled', 'live'] },
      isOnline: { $ne: false },
      instructorJoinedAt: { $exists: false },
      mentorReminderSent: false,
      scheduledStart: { $gte: from, $lte: to },
    })
      .populate<{ instructorId: { id: string; name: string; email: string } }>('instructorId', 'name email role emailPrefs')
      .lean({ virtuals: true })

    for (const cls of classes) {
      const instructor = cls.instructorId as any
      const liveClassId = String(cls.id ?? cls._id)

      if (!instructor?.email) {
        await LiveClassModel.findByIdAndUpdate(cls._id, { mentorReminderSent: true })
        continue
      }

      /* External: the Zoom/Meet link students see, straight from the record.
         Internal: there is no external link at all — the instructor's door
         into the room is the LMS studio page, not a URL this job can mint
         (that needs a signed CLT ticket, minted per-click, not per-reminder). */
      const joinUrl = cls.type === 'external'
        ? cls.meetingUrl
        : `${env.ADMIN_URL}/live-classes/${liveClassId}/studio`
      if (!joinUrl) {
        await LiveClassModel.findByIdAndUpdate(cls._id, { mentorReminderSent: true })
        continue
      }

      try {
        await notifSvc.create(String(instructor.id ?? instructor._id), {
          kind:  'class-reminder',
          title: 'Your class has started',
          body:  `"${cls.title}" was scheduled to start now — please join.`,
          link:  `/live-classes/${liveClassId}`,
        })
        if (wantsStaffEmail(instructor, 'classReminder')) {
          await sendMentorJoinReminder(instructor.email, instructor.name ?? 'Instructor', cls.title, joinUrl)
        }
        await LiveClassModel.findByIdAndUpdate(cls._id, { mentorReminderSent: true })
        logger.info({ classId: cls._id, instructor: instructor.email }, '[Reminders] Mentor join reminder sent')
      } catch (err) {
        logger.error({ err, classId: cls._id }, '[Reminders] Mentor join reminder failed')
      }
    }

    if (classes.length) logger.info(`[Reminders] Mentor join reminder: processed ${classes.length} classes`)
  } catch (err) {
    logger.error({ err }, '[Reminders] mentor-join-reminder job error')
  }
}

/* ── Mentor no-show detection — stage 2: escalate at start+5min ─────────────
   Still not joined 5 minutes after the reminder's own window ended. Notifies,
   in order: the class's academy admin(s), its course programme's sub_admin(s)
   (mapped through toSubAdminProgram()), every super_admin platform-wide, and
   the mentor themselves — matching what the product asked for exactly: admin,
   org admin, org+programme sub-admin, and the mentor.

   Window: classes whose start+5min falls in the last ~8 minutes, i.e.
   scheduledStart between 13 and 5 minutes ago — the same 8-minute margin as
   stage 1, just shifted 5 minutes later. */
export async function runMentorNoShowEscalation(): Promise<void> {
  try {
    const { LiveClassModel, UserModel } = await import('@/models/schema.ts')
    await warmSlugs()
    const now  = new Date()
    const from = new Date(now.getTime() - 13 * 60 * 1000)
    const to   = new Date(now.getTime() - 5 * 60 * 1000)

    const classes = await LiveClassModel.find({
      status: { $in: ['scheduled', 'live'] },
      isOnline: { $ne: false },
      instructorJoinedAt: { $exists: false },
      mentorNoShowAlertSent: false,
      scheduledStart: { $gte: from, $lte: to },
    })
      .populate<{ instructorId: { id: string; name: string; email: string } }>('instructorId', 'name email')
      .populate<{ courseId: { program?: string } }>('courseId', 'program')
      .lean({ virtuals: true })

    for (const cls of classes) {
      const liveClassId = String(cls.id ?? cls._id)
      const instructor  = cls.instructorId as any
      const orgId       = (cls as { organizationId?: unknown }).organizationId

      /* No academy to escalate within — extremely unlikely for a real class,
         but if it happens there is no admin/sub_admin set to notify. Still
         mark it handled so the job does not re-read it forever; the mentor
         still gets their own copy below regardless of org. */
      try {
        const courseProgram = (cls.courseId as { program?: string } | undefined)?.program
        const subAdminProgram = toSubAdminProgram(courseProgram)
        const slug = orgSlugFor(orgId)
        const when = new Date(cls.scheduledStart)
        const mentorName = instructor?.name ?? 'The instructor'

        const staff = orgId ? await userRepo.findOrgStaffForProgram(String(orgId), subAdminProgram) : []
        const superAdmins = await UserModel.find({ role: 'super_admin', isActive: true })
          .select('name email').lean() as { id?: string; _id?: unknown; name?: string; email?: string }[]

        /* super_admins are platform-wide and never in `staff` (findOrgStaffForProgram
           only matches admin/sub_admin), so no de-dupe needed between the two lists. */
        const recipients = [...staff, ...superAdmins]

        for (const r of recipients) {
          if (!r.email) continue
          const recipientId = String((r as { id?: string }).id ?? (r as { _id?: unknown })._id)
          await notifSvc.create(recipientId, {
            kind:  'mentor-no-show',
            title: `Mentor has not joined: ${cls.title}`,
            body:  `${mentorName} has not joined their class, scheduled for ${academyTime(when, slug)}.`,
            link:  `/live-classes/${liveClassId}`,
          })
          try {
            await sendMentorNoShowAlert(r.email, r.name ?? 'Admin', mentorName, cls.title, when, slug)
          } catch (err) {
            logger.error({ err, classId: cls._id, to: r.email }, '[Reminders] Mentor no-show alert email failed')
          }
        }

        if (instructor?.email) {
          await notifSvc.create(String(instructor.id ?? instructor._id), {
            kind:  'mentor-no-show',
            title: `You have not joined: ${cls.title}`,
            body:  `Your class was scheduled for ${academyTime(when, slug)} and you still have not joined.`,
            link:  `/live-classes/${liveClassId}`,
          })
          try {
            await sendMentorNoShowSelfAlert(instructor.email, instructor.name ?? 'Instructor', cls.title, when, slug)
          } catch (err) {
            logger.error({ err, classId: cls._id }, '[Reminders] Mentor no-show self-alert email failed')
          }
        }

        await LiveClassModel.findByIdAndUpdate(cls._id, { mentorNoShowAlertSent: true })
        logger.warn({ classId: cls._id, instructor: instructor?.email, recipients: recipients.length },
          '[Reminders] Mentor no-show escalated')
      } catch (err) {
        logger.error({ err, classId: cls._id }, '[Reminders] Mentor no-show escalation failed')
      }
    }

    if (classes.length) logger.info(`[Reminders] Mentor no-show escalation: processed ${classes.length} classes`)
  } catch (err) {
    logger.error({ err }, '[Reminders] mentor-no-show job error')
  }
}

/* ── Recording poller ────────────────────────────────── */
async function runRecordingPoller(): Promise<void> {
  try {
    const { LiveClassModel } = await import('@/models/schema.ts')
    const { fetchMeetRecordingUrl } = await import('@/services/googleMeet.service.ts')

    const now      = new Date()
    const earliest = new Date(now.getTime() - 48 * 60 * 60 * 1000)  // don't poll classes older than 48 h

    // Classes that have ended, have a Meet code, but no recording URL yet
    const candidates = await LiveClassModel.find({
      type:          'external',
      googleMeetCode: { $exists: true, $ne: '' },
      recordingUrl:  { $exists: false },
      scheduledStart: { $gte: earliest, $lt: new Date(now.getTime() - 10 * 60 * 1000) },
    }).lean()

    // Filter to those whose scheduled end time has passed
    const ended = candidates.filter(c => {
      const endMs = new Date(c.scheduledStart).getTime() + c.durationMins * 60_000
      return endMs < now.getTime()
    })

    let found = 0
    for (const cls of ended) {
      const url = await fetchMeetRecordingUrl(cls.googleMeetCode!)
      if (url) {
        found++
        await LiveClassModel.findByIdAndUpdate(cls._id, { recordingUrl: url })
        logger.info({ classId: cls._id, url }, '[Recording] Recording URL saved')
      }
    }

    if (ended.length) {
      logger.info(`[Recording] Polled ${ended.length} classes, found ${found} recordings`)
    }
  } catch (err) {
    logger.error({ err }, '[Recording] Poller job error')
  }
}

/* ── When a Meet class really ended ───────────────────────
   Google sends no webhook when a meeting ends, so a Meet class stayed
   'scheduled' for ever and only its timetable slot said when it was over.
   Every 5 minutes, each online Meet class past its timetable end — for up to
   MEET_END_WINDOW after it, then it is left alone — is looked up in Google's
   conference records (googleMeet.service.ts fetchMeetConferences). The
   conference that began around the class (from an hour before it to its
   timetable end) is the class's; once Google says that one ended, the class
   is 'ended' then (endSource 'meet') and started when it began. Still going
   → asked again next time. None at all (nobody joined), a room this LMS
   can't see, or Google not answering → left as it is: the commission portal
   then goes by the timetable. */
const MEET_END_WINDOW_MS = 12 * 60 * 60 * 1000

export async function runMeetClassEnd(fetchConferences?: (cls: { meetSpace?: unknown; googleMeetCode?: string | null }) => Promise<{ startTime: Date; endTime?: Date }[] | undefined>): Promise<void> {
  try {
    const { LiveClassModel } = await import('@/models/schema.ts')
    const fetch = fetchConferences ?? (await import('@/services/googleMeet.service.ts')).fetchMeetConferences as NonNullable<typeof fetchConferences>
    const now = Date.now()
    const candidates = await LiveClassModel.find({
      type: 'external',
      isOnline: { $ne: false },
      status: { $in: ['scheduled', 'live'] },
      googleMeetCode: { $exists: true, $ne: '' },
      // The longest class (600 min) plus the window: older than this can't be due.
      scheduledStart: { $gte: new Date(now - 600 * 60_000 - MEET_END_WINDOW_MS), $lt: new Date(now) },
    }).select('_id scheduledStart durationMins googleMeetCode meetSpace').lean()

    let ended = 0
    for (const cls of candidates) {
      const start = new Date(cls.scheduledStart).getTime()
      const end = start + cls.durationMins * 60_000
      if (end > now || end < now - MEET_END_WINDOW_MS) continue
      const conferences = await fetch(cls)
      const theirs = (conferences ?? [])
        .filter(c => c.startTime.getTime() >= start - 60 * 60_000 && c.startTime.getTime() <= end)
        .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())[0]
      if (!theirs?.endTime) continue
      const res = await LiveClassModel.updateOne(
        { _id: cls._id, status: { $in: ['scheduled', 'live'] } },
        { $set: { status: 'ended', endedAt: theirs.endTime, startedAt: theirs.startTime, endSource: 'meet' } },
      )
      ended += res.modifiedCount ?? 0
    }
    if (ended) logger.info(`[Meet] ${ended} class${ended === 1 ? '' : 'es'} ended, as Google Meet recorded`)
  } catch (err) {
    logger.error({ err }, '[Meet] Class-end job error')
  }
}

/* ── Auto-attendance finalization ─────────────────────────
   attendedAt (set by the CLT participant.joined webhook for internal/LiveKit
   classes, or by the gated join-link hand-off in resolveMeetJoin for
   external ones) has always been evidence nobody acted on — ClassBooking's
   own field comment says status stays 'booked' regardless, and nothing
   automated ever moved it. That is the "unmarked" bucket in
   /admin/bookings/stats: every seat waiting on a human to click it by hand.

   This closes the loop, once a class has been over long enough that no more
   evidence is coming in: 'booked' -> 'attended' if attendedAt was ever set,
   'booked' -> 'missed' otherwise. Never touches a seat that already moved —
   cancelled, or already decided by a human before this ever got to it.

   OFFLINE (in-person) classes are excluded entirely: nobody clicks a link
   for those, so there is no attendedAt to check, and finalizing them would
   mark every single seat 'missed' regardless of who actually showed up. They
   stay fully manual, exactly as before this feature existed. */
export async function runAttendanceFinalization(): Promise<void> {
  try {
    const { LiveClassModel, ClassBookingModel } = await import('@/models/schema.ts')
    const now      = new Date()
    const earliest = new Date(now.getTime() - 48 * 60 * 60 * 1000)   // don't rescan classes older than 48h
    /* Necessary-but-not-sufficient on scheduledStart alone — durationMins
       varies per class, so the real "has this ended" check happens per-class
       below, the same two-step shape runRecordingPoller already uses just
       above. 15 min buffer past scheduledStart is the loosest possible
       filter; a 10-minute class and a 3-hour class both pass it, and both
       get the exact end-time check next. */
    const candidates = await LiveClassModel.find({
      status: { $ne: 'cancelled' },
      isOnline: { $ne: false },
      /* $ne: true, not `false` — a class inserted by anything that bypasses
         Mongoose defaults (a raw driver script, a migration, a fixture
         written before this field existed) has the field simply ABSENT, and
         Mongo's equality match on `false` does not consider "absent" a
         match. The org-scope filters elsewhere in this codebase hit this
         exact class of bug already (see auditlog.repository.ts's own
         $exists:false arm) — same fix, applied here before it ever shipped
         rather than after. */
      attendanceFinalized: { $ne: true },
      scheduledStart: { $gte: earliest, $lt: new Date(now.getTime() - 15 * 60 * 1000) },
    }).select('_id scheduledStart durationMins type meetingUrl isOnline').lean()

    /* Two conditions, both required. 15 minutes past the class's own end, so a
       trailing webhook delivery lands first. AND past the moment the student's
       join door actually shuts (a minute's margin for a click already in
       flight) — a Meet link stays open 20 minutes after the end, and deciding
       at 15 turned a student still allowed in into 'missed', whom the join gate
       then refused as "You have not booked this class". */
    const ended = candidates.filter(c => {
      const endMs = new Date(c.scheduledStart).getTime() + c.durationMins * 60_000
      const decideAfter = Math.max(endMs + 15 * 60_000, studentJoinClosesAt(c) + 60_000)
      return decideAfter < now.getTime()
    })

    let attendedCount = 0, missedCount = 0
    for (const cls of ended) {
      try {
        const toAttended = await ClassBookingModel.updateMany(
          { liveClassId: cls._id, status: 'booked', attendedAt: { $exists: true } },
          { $set: { status: 'attended' } },
        )
        const toMissed = await ClassBookingModel.updateMany(
          { liveClassId: cls._id, status: 'booked' },
          { $set: { status: 'missed' } },
        )
        attendedCount += toAttended.modifiedCount ?? 0
        missedCount   += toMissed.modifiedCount ?? 0
        await LiveClassModel.findByIdAndUpdate(cls._id, { attendanceFinalized: true })
      } catch (err) {
        logger.error({ err, classId: cls._id }, '[Attendance] Finalization failed for one class')
      }
    }

    if (ended.length) {
      logger.info(`[Attendance] Finalized ${ended.length} classes — ${attendedCount} attended, ${missedCount} missed`)
    }
  } catch (err) {
    logger.error({ err }, '[Attendance] Finalization job error')
  }
}

/* ── Instructor-review request dispatch ──────────────────────────────────
   Runs strictly downstream of runAttendanceFinalization: it only considers
   classes whose attendance has ALREADY been decided (attendanceFinalized),
   so it never has to guess who attended — it reads the same 'attended'
   status the finalization job just wrote. A class with zero attended seats
   (everyone missed it) is still marked reviewRequestSent — there is nobody
   to ask, and the alternative is rescanning the same empty class forever.

   One request per (class, attended student), fire-and-forget per channel —
   same shape as SupportService#notifyStaffOfNewTicket: a mail/WhatsApp
   outage must never block the next recipient, let alone the class being
   marked done. WhatsApp only fires for a student with a phone number on
   file; email and the in-app notification always fire. */
export async function runReviewRequestDispatch(): Promise<void> {
  try {
    const { LiveClassModel, ClassBookingModel, UserModel } = await import('@/models/schema.ts')
    const now      = new Date()
    const earliest = new Date(now.getTime() - 48 * 60 * 60 * 1000)   // don't rescan classes older than 48h

    const candidates = await LiveClassModel.find({
      status: { $ne: 'cancelled' },
      attendanceFinalized: true,
      /* $ne: true, not `false` — see the identical guard on attendanceFinalized
         above; a class from before this field existed must still match. */
      reviewRequestSent: { $ne: true },
      scheduledStart: { $gte: earliest, $lt: now },
    }).select('_id title instructorId courseId').lean()

    if (candidates.length === 0) return

    let requestedCount = 0
    for (const cls of candidates) {
      try {
        const attended = await ClassBookingModel.find({
          liveClassId: cls._id, status: 'attended',
        }).select('userId').lean()

        if (attended.length > 0) {
          const instructor = await UserModel.findById(cls.instructorId).select('name').lean()
          const instructorName = (instructor as { name?: string } | null)?.name ?? 'the instructor'

          for (const b of attended) {
            const student = await UserModel.findById(b.userId).select('name email phone').lean() as
              { name?: string; email?: string; phone?: string } | null
            if (!student) continue
            const studentName = student.name ?? 'there'

            try {
              await notifSvc.create(String(b.userId), {
                kind:  'instructor-review-requested',
                title: `How was "${cls.title}"?`,
                body:  `Rate your class with ${instructorName}`,
                link:  '/reviews',
              })
            } catch (err) {
              logger.error({ err, userId: b.userId, classId: cls._id }, 'in-app review-request notification failed')
            }

            if (student.email) {
              try {
                await sendInstructorReviewRequestEmail(student.email, studentName, instructorName, cls.title)
              } catch (err) {
                logger.error({ err, userId: b.userId, classId: cls._id }, 'review-request email failed')
              }
            }

            if (student.phone) {
              try {
                await sendInstructorReviewRequestWhatsApp(student.phone, studentName, cls.title)
              } catch (err) {
                logger.error({ err, userId: b.userId, classId: cls._id }, 'review-request WhatsApp failed')
              }
            }
          }
          requestedCount += attended.length
        }

        await LiveClassModel.findByIdAndUpdate(cls._id, { reviewRequestSent: true })
      } catch (err) {
        logger.error({ err, classId: cls._id }, '[ReviewRequest] Dispatch failed for one class')
      }
    }

    if (candidates.length) {
      logger.info(`[ReviewRequest] Processed ${candidates.length} classes — ${requestedCount} students asked to rate`)
    }
  } catch (err) {
    logger.error({ err }, '[ReviewRequest] Dispatch job error')
  }
}

/* ── Entry point ─────────────────────────────────────── */
/* Each run* function above is exported for one reason: so a test can call it.

   cron.schedule() hands back nothing a test can await, so the only other way
   to prove a reminder fires is to run the server and wait for the wall clock.
   The header of this file records what that cost once already -- four
   bookings whose class had been deleted threw inside a .filter(), and every
   reminder for every student stopped, silently, for as long as it took
   somebody to notice. Exporting the jobs is what lets remindermails.suite.ts
   put a booking at each window and check the mail actually goes. */
/* One run of a job at a time.

   Every reminder job reads a batch, mails it, and only then writes the
   `reminder*Sent` flags. A run that takes longer than its interval therefore
   overlaps the next tick, and BOTH copies read the same still-unflagged
   bookings — so the student gets the same reminder twice. A single slow SMTP
   batch is enough to do it.

   Deliberately explicit rather than the scheduler's own option: a guard that
   silently stops working because an option was renamed is worse than none, and
   this one is directly testable. */
const inFlight = new Set<string>()
export function exclusive(name: string, task: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (inFlight.has(name)) {
      logger.warn({ job: name }, '[Reminders] previous run still in flight — skipping this tick')
      return
    }
    inFlight.add(name)
    try { await task() } finally { inFlight.delete(name) }
  }
}

export function startReminderJobs(): void {
  /* Warm the academy slug map once at start-up. orgSlugFor() is synchronous
     because it is called inside mail assembly; a cold cache falls back to the
     default zone, which is the old unlabelled behaviour but now labelled. */
  void ensureOrgSlugs().catch(() => {/* non-fatal — falls back to the default */})

  // Every hour at :00 — day-before reminders (23–25 h window)
  cron.schedule('0 * * * *', exclusive('day-before', runDayBeforeReminders))

  // Every day at 7:00am — day-of reminders
  cron.schedule('0 7 * * *', exclusive('day-of', runDayOfReminders))

  // Every 5 min — pre-session reminders (25–35 min window, NO link).
  // Must run at the window's resolution; an hourly job would miss most sessions
  // because the 10-min window rarely lines up with a single :30 run.
  cron.schedule('*/5 * * * *', exclusive('pre-session', runPreSessionReminders))

  // Every 5 min — 5-min reminder WITH link (3–8 min window)
  cron.schedule('*/5 * * * *', exclusive('five-min', runFiveMinReminders))

  // Every 5 min — at-time reminder WITH link (0–5 min after start)
  cron.schedule('*/5 * * * *', exclusive('at-time', runAtTimeReminders))

  // Every 5 min — instructor 15-min reminder with Google Meet link (13–17 min window)
  cron.schedule('*/5 * * * *', exclusive('instructor-15min', runInstructor15MinReminders))

  // Every minute — the mentor's WhatsApp ~10 min before an online class, with a Start button (7–10 min window)
  cron.schedule('* * * * *', exclusive('mentor-10min-whatsapp', runMentor10MinWhatsApp))

  // Every 5 min — mentor no-show stage 1: nudge the mentor if not joined by start time
  cron.schedule('*/5 * * * *', exclusive('mentor-join-reminder', runMentorJoinReminder))

  // Every 5 min — mentor no-show stage 2: escalate to admins/sub-admins if still not joined 5 min after start
  cron.schedule('*/5 * * * *', exclusive('mentor-no-show', runMentorNoShowEscalation))

  // Every 15 min — poll Google Meet API for completed recordings (classes ended in last 48 h)
  cron.schedule('*/15 * * * *', exclusive('recording-poller', runRecordingPoller))

  // Every 15 min — finalize attendance (booked -> attended/missed) for online classes ended 15+ min ago
  cron.schedule('*/15 * * * *', exclusive('attendance-finalization', runAttendanceFinalization))
  /* Downstream of attendance-finalization — same tick rate is fine since it
     only picks up classes the OTHER job already finalized; it is never the
     bottleneck. */
  cron.schedule('*/15 * * * *', exclusive('review-request-dispatch', runReviewRequestDispatch))

  // Every 5 min — a Meet class past its timetable end: has Google Meet recorded it ending?
  cron.schedule('*/5 * * * *', exclusive('meet-class-end', () => runMeetClassEnd()))

  logger.info('[Reminders] Cron jobs scheduled')
}
