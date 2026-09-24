/* ─────────────────────────────────────────────────────
   instructorSchedule.job.ts — "your schedule for tomorrow", 9 PM the night before

   Every active user with the `instructor` role gets ONE email each evening at
   9 PM in their OWN academy's time (GST for Dubai, IST for Bangalore) listing
   tomorrow's live classes they teach and mentor meetings they host, in time
   order. A day with nothing on still gets a short "nothing scheduled" note, so
   an instructor never has to wonder whether silence means a free day or a
   missed email.

   WHY EVERY 15 MINUTES, NOT ONCE AT 21:00: the cron runs in the server's zone
   (Asia/Dubai), and 9 PM IST is 19:30 GST — no single daily trigger hits both.
   Each tick sends to whoever's local clock has passed the send hour and has
   not been mailed for tomorrow yet, so the ticks after 9 PM also act as a
   catch-up if the process was down at the hour itself. The window closes at
   the instructor's local midnight; after that "tomorrow" is a different day.

   EXACTLY ONCE: a row in InstructorScheduleMail is claimed (unique on
   instructor + day) BEFORE the send. A second tick, a restart, or an overlap
   all hit the unique index and skip. A send that throws releases its claim, so
   the next tick retries instead of the instructor silently getting nothing.

   Runs only where the scheduler runs (ENABLE_CRON / PM2 instance 0 — see
   index.ts). INSTRUCTOR_SCHEDULE_MAIL=off switches it off without a deploy;
   INSTRUCTOR_SCHEDULE_HOUR moves the send hour (default 21).
───────────────────────────────────────────────────── */
import cron from 'node-cron'
import type { Types } from 'mongoose'
import { logger } from '@/utils/logger.ts'
import { ensureOrgSlugs, orgSlugFor } from '@/utils/orgSlugs.ts'
import { zoneForAcademy } from '@/utils/academyClock.ts'
import { zoneDateKey, zoneHourMinute, addDaysToDateKey, zoneDayBounds } from '@/utils/zoneDay.ts'
import { wantsStaffEmail, type EmailPrefs } from '@/utils/emailPrefs.ts'
import { sendInstructorDailySchedule, type ScheduleMailItem } from '@/services/email.service.ts'

export const SCHEDULE_MAIL_HOUR = (() => {
  const raw = Number(process.env['INSTRUCTOR_SCHEDULE_HOUR'])
  return Number.isFinite(raw) && raw >= 0 && raw <= 23 ? Math.floor(raw) : 21
})()

const MEETING_KIND_LABEL: Record<string, string> = {
  staff:   'Staff meeting',
  student: 'Student meeting',
  client:  'Client meeting',
}

/* Classes that will not happen tomorrow are not on the schedule. */
const OFF_SCHEDULE = ['cancelled', 'ended']

/**
 * Everything one instructor has during [start, end), in time order.
 * Exported for the preview script, so what it shows is what the job sends.
 */
export async function buildScheduleFor(
  instructorId: Types.ObjectId | string,
  start: Date,
  end: Date,
): Promise<ScheduleMailItem[]> {
  const { LiveClassModel, MentorMeetingModel } = await import('@/models/schema.ts')
  const adminUrl = process.env['ADMIN_URL'] ?? 'http://localhost:3001'

  const [classes, meetings] = await Promise.all([
    LiveClassModel.find({
      instructorId,
      status: { $nin: OFF_SCHEDULE },
      scheduledStart: { $gte: start, $lt: end },
    })
      .select('title scheduledStart durationMins type isOnline meetingUrl googleMeetCode location room bookedCount sessionCapacity courseId')
      .populate<{ courseId: { title?: string } | null }>('courseId', 'title')
      .lean(),
    MentorMeetingModel.find({
      mentorId: instructorId,
      cancelledAt: null,
      scheduledStart: { $gte: start, $lt: end },
    })
      .select('title kind scheduledStart durationMins meetingUrl attendees')
      .lean(),
  ])

  const items: ScheduleMailItem[] = []

  for (const c of classes) {
    const online = c.isOnline !== false
    let joinUrl: string | undefined
    let joinLabel: string | undefined
    if (online) {
      if (c.meetingUrl) {
        joinUrl = c.meetingUrl
        joinLabel = c.googleMeetCode || /meet\.google\.com/.test(c.meetingUrl) ? 'Join Google Meet' : 'Join link'
      } else if (c.type === 'internal') {
        /* Streamed from inside the LMS — the instructor starts it from the studio. */
        joinUrl = `${adminUrl}/live-classes/${String(c._id)}/studio`
        joinLabel = 'Open studio in the LMS'
      }
    }
    items.push({
      kind: 'class',
      title: c.title,
      subtitle: c.courseId?.title,
      start: c.scheduledStart,
      durationMins: c.durationMins,
      online,
      joinUrl,
      joinLabel,
      location: online ? undefined : c.location,
      room: online ? undefined : c.room,
      seats: { booked: c.bookedCount ?? 0, capacity: c.sessionCapacity ?? 0 },
    })
  }

  for (const m of meetings) {
    items.push({
      kind: 'meeting',
      title: m.title,
      subtitle: MEETING_KIND_LABEL[m.kind] ?? 'Meeting',
      start: m.scheduledStart,
      durationMins: m.durationMins,
      online: true,
      joinUrl: m.meetingUrl || undefined,
      joinLabel: m.meetingUrl ? 'Join meeting' : undefined,
      attendees: (m.attendees ?? []).map(a => a.name).filter(Boolean),
    })
  }

  return items.sort((a, b) => a.start.getTime() - b.start.getTime())
}

type ScheduleSender = typeof sendInstructorDailySchedule

interface InstructorRow {
  _id: Types.ObjectId
  name?: string
  email?: string
  role?: string
  emailPrefs?: EmailPrefs | null
  organizationId?: Types.ObjectId | null
}

/**
 * One pass. `now` and `send` are parameters so a test can pin the clock and
 * make a send fail; production calls it with neither.
 */
export async function runInstructorScheduleMail(
  now: Date = new Date(),
  send: ScheduleSender = sendInstructorDailySchedule,
): Promise<{ sent: number; failed: number; optedOut: number }> {
  const { UserModel, InstructorScheduleMailModel } = await import('@/models/schema.ts')
  /* The unique (instructor, day) index IS the exactly-once guarantee, and
     Mongoose builds it in the background. A tick landing seconds after boot
     could otherwise claim before it exists. init() resolves once the build is
     done and is a cached no-op on every later run. */
  await InstructorScheduleMailModel.init()
  /* orgSlugFor() answers undefined on a cold cache, which would put every
     instructor in the default zone — warm it every run, as the reminders do. */
  await ensureOrgSlugs().catch(() => {/* non-fatal — falls back to the default zone */})

  const instructors = await UserModel.find({
    role: 'instructor',
    isActive: true,
    email: { $exists: true, $nin: [null, ''] },
  })
    .select('name email role emailPrefs organizationId')
    .lean<InstructorRow[]>()

  let sent = 0, failed = 0, optedOut = 0

  for (const ins of instructors) {
    const slug = orgSlugFor(ins.organizationId)
    const zone = zoneForAcademy(slug)

    /* Not yet the send hour where this instructor is. The window runs to their
       local midnight, after which "tomorrow" becomes the next day. */
    if (zoneHourMinute(now, zone).hour < SCHEDULE_MAIL_HOUR) continue

    if (!wantsStaffEmail(ins, 'dailySchedule')) { optedOut++; continue }

    const forDate = addDaysToDateKey(zoneDateKey(now, zone), 1)

    /* Claim before sending — the unique index is what makes this exactly-once. */
    try {
      await InstructorScheduleMailModel.create({ instructorId: ins._id, forDate })
    } catch (err) {
      if ((err as { code?: number }).code === 11000) continue   // already mailed for this day
      throw err
    }

    try {
      const { start, end } = zoneDayBounds(forDate, zone)
      const items = await buildScheduleFor(ins._id, start, end)
      await send(ins.email!, ins.name ?? 'Instructor', start, items, slug)
      await InstructorScheduleMailModel.updateOne(
        { instructorId: ins._id, forDate },
        { $set: { itemCount: items.length, sentAt: new Date() } },
      )
      sent++
    } catch (err) {
      failed++
      /* Release the claim so the next tick tries again rather than the
         instructor quietly getting nothing tonight. */
      await InstructorScheduleMailModel.deleteOne({ instructorId: ins._id, forDate }).catch(() => {})
      logger.error({ err, instructorId: String(ins._id), forDate }, '[InstructorSchedule] send failed — will retry next tick')
    }
  }

  return { sent, failed, optedOut }
}

let running = false

export function startInstructorScheduleJob(): void {
  if ((process.env['INSTRUCTOR_SCHEDULE_MAIL'] ?? '').toLowerCase() === 'off') {
    logger.warn('[InstructorSchedule] disabled by INSTRUCTOR_SCHEDULE_MAIL=off')
    return
  }

  cron.schedule('*/15 * * * *', async () => {
    if (running) {
      logger.warn('[InstructorSchedule] previous run still going — skipping this tick')
      return
    }
    running = true
    try {
      const r = await runInstructorScheduleMail()
      if (r.sent || r.failed) logger.info(r, '[InstructorSchedule] evening schedule mail')
    } catch (err) {
      logger.error({ err }, '[InstructorSchedule] job error')
    } finally {
      running = false
    }
  })

  logger.info({ hour: SCHEDULE_MAIL_HOUR }, '[InstructorSchedule] tomorrow-schedule mail scheduled (instructor local time)')
}
