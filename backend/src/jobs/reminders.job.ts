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
import { NotificationService } from '@/services/notification.service.ts'
import {
  sendSessionLinkReminder,
  sendDayOfReminder,
  sendPreSessionReminder,
  sendFiveMinReminder,
  sendClassStartingReminder,
  sendInstructor15MinReminder,
} from '@/services/email.service.ts'
import { wantsStaffEmail } from '@/utils/emailPrefs.ts'

const notifSvc = new NotificationService()

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
  userId: { _id: any; id: string; name: string; email: string } | null
  /* NULL when the class was deleted after the booking was made. Mongoose
     populates a dangling reference as null; typing it as always-present is
     what let the crash below through in the first place. */
  liveClassId: {
    id:             string
    title:          string
    scheduledStart: Date
    meetingUrl?:    string
    muxPlaybackId?: string
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
  return id ? `${base}/live-classes/${String(id)}/watch` : `${base}/class-bookings`
}

function fmtFull(d: Date): string {
  return d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
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
): Promise<void> {
  const dateLabel = fmtFull(sessionStart)
  const timeLabel = fmtTime(sessionStart)

  /* ── Notification body by kind ── */
  const notifBody = {
    'day-before':  `📅 Reminder: "${sessionTitle}" is tomorrow at ${timeLabel}. Make sure you're ready!`,
    'day-of':      `⏰ Today's class: "${sessionTitle}" starts at ${timeLabel}. Join on time!`,
    'pre-session': `🚀 "${sessionTitle}" starts in ~30 minutes. Get ready to join!`,
    'five-min':    `⏱️ "${sessionTitle}" starts in ~5 minutes. Join now so you're ready!`,
    'at-time':     `🎯 "${sessionTitle}" is starting now. Join immediately!`,
  }[kind]

  const notifTitle = {
    'day-before':  `Class tomorrow: ${sessionTitle}`,
    'day-of':      `Class today: ${sessionTitle} at ${timeLabel}`,
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
    link:  notifLink ?? '/class-bookings',
  }).catch(err => logger.error({ err, userId, kind }, '[Reminder] Failed to create in-app notification'))

  /* 2. Email — failure creates a system notification instead of silently dropping */
  try {
    await emailFn()
  } catch (err) {
    logger.error({ err, userId, sessionTitle, kind }, '[Reminder] Email delivery failed')
    await notifSvc.create(userId, {
      kind:  'system',
      title: 'Reminder email could not be sent',
      body:  `We tried to email you about "${sessionTitle}" (${dateLabel}) but delivery failed. Check your Class Schedule to stay on track.`,
      link:  '/class-bookings',
    }).catch(() => {/* truly non-fatal */})
  }
}

/* ── Day-before job ──────────────────────────────────── */
export async function runDayBeforeReminders(): Promise<void> {
  try {
    const { ClassBookingModel } = await import('@/models/schema.ts')
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
      .populate<{ userId: BookingWithRefs['userId'] }>('userId', 'name email organizationId')
      .populate<{ liveClassId: BookingWithRefs['liveClassId'] }>('liveClassId', 'id title scheduledStart meetingUrl muxPlaybackId status')
      .lean({ virtuals: true }) as unknown as BookingWithRefs[]

    const due = dueBetween(bookings, from, to)

    for (const b of due) {
      const userId   = b.userId.id ?? b.userId._id?.toString()
      const start    = new Date(b.liveClassId.scheduledStart)
      const joinUrl  = getJoinUrl(b.liveClassId)

      await dispatch(userId, b.liveClassId.title, start, 'day-before', () =>
        sendSessionLinkReminder(b.userId.email, b.userId.name, b.liveClassId.title, fmtFull(start), joinUrl),
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

      await dispatch(userId, b.liveClassId.title, classAt, 'day-of', () =>
        sendDayOfReminder(b.userId.email, b.userId.name, b.liveClassId.title, fmtTime(classAt), joinUrl),
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

      await dispatch(userId, b.liveClassId.title, classAt, 'pre-session', () =>
        sendPreSessionReminder(b.userId.email, b.userId.name, b.liveClassId.title, 30),
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
      .populate<{ userId: BookingWithRefs['userId'] }>('userId', 'name email organizationId')
      .populate<{ liveClassId: BookingWithRefs['liveClassId'] }>('liveClassId', 'id title scheduledStart meetingUrl muxPlaybackId status')
      .lean({ virtuals: true }) as unknown as BookingWithRefs[]

    const due = dueBetween(bookings, from, to)

    for (const b of due) {
      const userId  = b.userId.id ?? b.userId._id?.toString()
      const classAt = new Date(b.liveClassId.scheduledStart)
      const joinUrl = getJoinUrl(b.liveClassId)

      await dispatch(userId, b.liveClassId.title, classAt, 'five-min', () =>
        sendFiveMinReminder(
          b.userId.email, b.userId.name, b.liveClassId.title, joinUrl, classAt,
          orgSlugFor((b.userId as { organizationId?: unknown }).organizationId),
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
      .populate<{ userId: BookingWithRefs['userId'] }>('userId', 'name email organizationId')
      .populate<{ liveClassId: BookingWithRefs['liveClassId'] }>('liveClassId', 'id title scheduledStart meetingUrl muxPlaybackId status')
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

  // Every 15 min — poll Google Meet API for completed recordings (classes ended in last 48 h)
  cron.schedule('*/15 * * * *', exclusive('recording-poller', runRecordingPoller))

  logger.info('[Reminders] Cron jobs scheduled')
}
