import { Types } from 'mongoose'
import { logger } from '@/utils/logger.ts'

/* ─────────────────────────────────────────────────────
   "Did the class end?" — the mentor's pop-up (the user, 2026-11-18)
   ─────────────────────────────────────────────────────
   30 minutes after one of their classes starts, its mentor is asked in the admin app — a pop-up with no close
   (ClassOutcomeGate.tsx, like the student-meeting one). "Still going": asked again at the timetable end (or in 15
   minutes, once that has passed). "It ended": when, and a short review — rating, topics, issues, a summary. That
   answer:
     · marks the class ended then (endSource 'mentor') unless Google Meet / the classroom already did, which also
       starts the recording lookup;
     · IS the class verification (verifiedAt, mentorReview), so the verification emails stop for it;
     · lets the students' "rate your class" go out 10 minutes after that end rather than the timetable's.
   Only the class's own mentor (instructorId), only classes from CLASS_OUTCOME_FROM on — the first day it was live —
   so nobody opens the admin to weeks of old classes. A class already verified on the Class Verification page is not
   asked about. */

export const ASK_AFTER_START_MS = 30 * 60_000
export const ASK_AGAIN_MS = 15 * 60_000
const LOOK_BACK_MS = 3 * 864e5   // a mentor away for a week is not met by a week of classes
const DEFAULT_FROM = '2026-11-19T00:00:00+04:00'

export class ClassOutcomeError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message) }
}

export function classOutcomeSince(): Date {
  const raw = (process.env['CLASS_OUTCOME_FROM'] ?? '').trim() || DEFAULT_FROM
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? new Date(DEFAULT_FROM) : d
}

export interface PendingClass {
  id: string; title: string; course: string; module: string
  startsAt: string; endsAt: string; durationMins: number
  isOnline: boolean; location: string; booked: number
  /** Google Meet or the classroom already saw it end — then only the review is asked. */
  endedAt: string | null
  /** True once the timetable end has passed: "still going" then asks again in 15 minutes. */
  pastEnd: boolean
}
export interface NextClass { id: string; title: string; startsAt: string; meetingUrl: string | null }

const waiting = (mentorId: Types.ObjectId, now: Date) => {
  const since = classOutcomeSince()
  const floor = new Date(Math.max(since.getTime(), now.getTime() - LOOK_BACK_MS))
  return {
    instructorId: mentorId,
    status: { $ne: 'cancelled' },
    mentorOutcomeAt: { $exists: false },
    verifiedAt: { $exists: false },
    scheduledStart: { $gte: floor, $lte: new Date(now.getTime() - ASK_AFTER_START_MS) },
    $or: [{ endAskAfter: { $exists: false } }, { endAskAfter: { $lte: now } }],
  }
}

/** The mentor's classes waiting for an answer, oldest first — and their next class, so the pop-up can still send
    them to it. */
export async function pendingClassOutcomes(mentorId: string, now = new Date()): Promise<{ classes: PendingClass[]; next: NextClass | null }> {
  if (!Types.ObjectId.isValid(mentorId)) return { classes: [], next: null }
  const { LiveClassModel } = await import('@/models/schema.ts')
  const me = new Types.ObjectId(mentorId)
  const rows = await LiveClassModel.find(waiting(me, now))
    .sort({ scheduledStart: 1 }).limit(20)
    .select('title courseId sectionId scheduledStart durationMins isOnline location room bookedCount status endedAt')
    .populate('courseId', 'title').populate('sectionId', 'title')
    .lean() as any[]
  const classes = rows.map((c): PendingClass => {
    const start = new Date(c.scheduledStart).getTime()
    const end = start + (c.durationMins ?? 60) * 60_000
    return {
      id: String(c._id), title: c.title, course: c.courseId?.title ?? '', module: c.sectionId?.title ?? '',
      startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), durationMins: c.durationMins ?? 60,
      isOnline: c.isOnline !== false, location: [c.location, c.room].filter(Boolean).join(' · '),
      booked: c.bookedCount ?? 0,
      endedAt: c.status === 'ended' && c.endedAt ? new Date(c.endedAt).toISOString() : null,
      pastEnd: now.getTime() >= end,
    }
  })
  let next: NextClass | null = null
  if (classes.length) {
    const n = await LiveClassModel.findOne({
      $or: [{ instructorId: me }, { coInstructorIds: me }],
      status: { $in: ['scheduled', 'live'] },
      scheduledStart: { $gte: new Date(now.getTime() - 30 * 60_000), $lte: new Date(now.getTime() + 60 * 60_000) },
      _id: { $nin: classes.map(c => new Types.ObjectId(c.id)) },
    }).sort({ scheduledStart: 1 }).select('title scheduledStart meetingUrl isOnline type').lean() as any
    if (n) next = { id: String(n._id), title: n.title, startsAt: new Date(n.scheduledStart).toISOString(), meetingUrl: n.isOnline !== false && n.type === 'external' ? (n.meetingUrl || null) : null }
  }
  return { classes, next }
}

export type ClassOutcomeAnswer =
  | { stillRunning: true }
  | { stillRunning?: false; endedAt?: string; rating: number; topics: string; issues?: string; summary?: string }

/** The mentor's answer for one class. 404 when it isn't theirs; 409 when it no longer waits (answered, verified or
    cancelled meanwhile) — the pop-up then just drops it. */
export async function answerClassOutcome(mentorId: string, classId: string, answer: ClassOutcomeAnswer, now = new Date()) {
  if (!Types.ObjectId.isValid(classId) || !Types.ObjectId.isValid(mentorId)) throw new ClassOutcomeError('NOT_FOUND', 'Class not found', 404)
  const { LiveClassModel } = await import('@/models/schema.ts')
  const c = await LiveClassModel.findById(classId)
    .select('instructorId status scheduledStart durationMins endedAt startedAt mentorOutcomeAt verifiedAt verifyRequestedAt mentorReview')
    .lean() as any
  if (!c || String(c.instructorId) !== mentorId) throw new ClassOutcomeError('NOT_FOUND', 'Class not found', 404)
  if (c.status === 'cancelled') throw new ClassOutcomeError('CLASS_CANCELLED', 'This class was cancelled.', 409)
  if (c.mentorOutcomeAt || c.verifiedAt) throw new ClassOutcomeError('ALREADY_ANSWERED', 'This class has already been reviewed.', 409)
  const start = new Date(c.scheduledStart).getTime()
  if (now.getTime() < start + ASK_AFTER_START_MS) throw new ClassOutcomeError('TOO_EARLY', 'This class started less than 30 minutes ago.', 400)
  const end = start + (c.durationMins ?? 60) * 60_000

  if (answer.stillRunning) {
    const askAt = new Date(now.getTime() < end ? end : now.getTime() + ASK_AGAIN_MS)
    await LiveClassModel.updateOne({ _id: c._id }, { $set: { endAskAfter: askAt } })
    return { stillRunning: true as const, askAgainAt: askAt.toISOString() }
  }

  const rating = Number(answer.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ClassOutcomeError('INVALID_RATING', 'Give the class a rating from 1 to 5.', 400)
  const topics = String(answer.topics ?? '').trim()
  if (topics.length < 3) throw new ClassOutcomeError('TOPICS_REQUIRED', 'Say what was covered in the class.', 400)

  /* When it ended: what Google Meet / the classroom saw wins; else the mentor's time, between the start and now. */
  let endedAt: Date
  const alreadyEnded = c.status === 'ended' && c.endedAt
  if (alreadyEnded) endedAt = new Date(c.endedAt)
  else {
    endedAt = answer.endedAt ? new Date(answer.endedAt) : now
    if (Number.isNaN(endedAt.getTime())) throw new ClassOutcomeError('INVALID_TIME', 'That end time is not a time.', 400)
    if (endedAt.getTime() < start) throw new ClassOutcomeError('INVALID_TIME', 'The class cannot end before it started.', 400)
    if (endedAt.getTime() > now.getTime() + 60_000) throw new ClassOutcomeError('INVALID_TIME', 'The end time is in the future.', 400)
  }

  if (!alreadyEnded && c.status !== 'ended') {
    /* Through the service, so a Meet class starts its recording lookup as an admin's "ended" does. */
    const { LiveClassService } = await import('@/services/liveClass.service.ts')
    await new LiveClassService().update(classId, { status: 'ended' })
  }
  await LiveClassModel.updateOne({ _id: c._id }, {
    $set: {
      mentorOutcomeAt: now,
      ...(alreadyEnded ? {} : { endedAt, endSource: 'mentor', ...(c.startedAt ? {} : { startedAt: new Date(start) }) }),
      verifiedAt: now,
      verifiedBy: new Types.ObjectId(mentorId),
      verifyRequestedAt: c.verifyRequestedAt ?? now,
      mentorReview: {
        rating, topics, issues: String(answer.issues ?? '').trim(), summary: String(answer.summary ?? '').trim(),
        screenshots: c.mentorReview?.screenshots ?? [],
      },
    },
    $unset: { endAskAfter: '' },
  })
  return { stillRunning: false as const, endedAt: endedAt.toISOString() }
}

/* ─────────────────────────────────────────────────────
   No bookings 10 minutes before the start → cancelled (the user, 2026-11-18)
   ─────────────────────────────────────────────────────
   Every minute. An ONLINE class starting within the next 10 minutes with no seat booked is called off: reason
   "No bookings 10 minutes before the start", cause 'student' (low booking — not the mentor's, for KPIs), its Meet
   invite withdrawn (LiveClassService.update), and its mentor told in-app and by email so they don't open an empty
   room. Students: nobody booked, so nobody is told.

   Never: in-person classes (bookings close 5 hours ahead and admins add students late), a Program's classes (its
   students are booked for them, guests join through its link without a seat), a class made after its bookings had
   already closed (15 minutes before — nobody could have booked it), or a class already looked at (emptyCheckedAt).

   AUTO_CANCEL_EMPTY: 'report' (the default) only notes the class it WOULD cancel (emptyWouldCancel, and the log) —
   see scripts/auto-cancel-report.ts; 'on' cancels; 'off' does nothing. */
export const AUTO_CANCEL_BEFORE_MS = 10 * 60_000
const BOOKINGS_CLOSE_MS = 15 * 60_000
export const AUTO_CANCEL_REASON = 'No bookings 10 minutes before the start'

export function autoCancelMode(): 'off' | 'report' | 'on' {
  const v = (process.env['AUTO_CANCEL_EMPTY'] ?? 'report').trim().toLowerCase()
  if (/^(on|true|yes|1)$/.test(v)) return 'on'
  if (/^(off|false|no|0)$/.test(v)) return 'off'
  return 'report'
}

export async function runAutoCancelEmpty(now = new Date(), deps: {
  notify?: (mentor: { id: string; name: string; email: string; emailPrefs?: unknown }, cls: { id: string; title: string; scheduledStart: Date; organizationId?: unknown }) => Promise<void>
} = {}): Promise<{ looked: number; cancelled: number; wouldCancel: number }> {
  const out = { looked: 0, cancelled: 0, wouldCancel: 0 }
  const mode = autoCancelMode()
  if (mode === 'off') return out
  try {
    const { LiveClassModel, ClassBookingModel } = await import('@/models/schema.ts')
    const due = await LiveClassModel.find({
      status: 'scheduled',
      isOnline: { $ne: false },
      programId: null,                // none, or null
      emptyCheckedAt: { $exists: false },
      bookedCount: { $lte: 0 },
      scheduledStart: { $gt: now, $lte: new Date(now.getTime() + AUTO_CANCEL_BEFORE_MS) },
    }).select('_id title scheduledStart createdAt instructorId organizationId').lean() as any[]

    for (const c of due) {
      const id = String(c._id)
      try {
        /* Claimed first, so two servers (or a slow tick) never cancel or tell twice. */
        const claim = await LiveClassModel.updateOne({ _id: c._id, emptyCheckedAt: { $exists: false } }, { $set: { emptyCheckedAt: now } })
        if (!claim.modifiedCount) continue
        out.looked++
        const start = new Date(c.scheduledStart).getTime()
        if (c.createdAt && new Date(c.createdAt).getTime() > start - BOOKINGS_CLOSE_MS) continue
        /* bookedCount is the pool's own counter; the seats themselves are the proof. */
        const seats = await ClassBookingModel.countDocuments({ liveClassId: c._id, status: { $in: ['booked', 'attended'] } })
        if (seats > 0) continue

        if (mode === 'report') {
          await LiveClassModel.updateOne({ _id: c._id }, { $set: { emptyWouldCancel: true } })
          out.wouldCancel++
          logger.info({ classId: id, title: c.title, start: c.scheduledStart }, '[AutoCancel] report only — would cancel (no bookings)')
          continue
        }

        const { LiveClassService } = await import('@/services/liveClass.service.ts')
        await new LiveClassService().update(id, {
          status: 'cancelled', cancelReason: AUTO_CANCEL_REASON, cancelledAt: now,
          cancelledByName: 'System (no bookings)', cancelCause: 'student',
        })
        out.cancelled++
        logger.info({ classId: id, title: c.title }, '[AutoCancel] cancelled — no bookings 10 minutes before the start')

        const { UserModel } = await import('@/models/schema.ts')
        const mentor = await UserModel.findById(c.instructorId).select('name email emailPrefs').lean() as any
        if (mentor) {
          const notify = deps.notify ?? tellMentor
          await notify({ id: String(mentor._id), name: mentor.name ?? 'Mentor', email: mentor.email ?? '', emailPrefs: mentor.emailPrefs },
            { id, title: c.title, scheduledStart: new Date(c.scheduledStart), organizationId: c.organizationId })
            .catch(err => logger.warn({ err, classId: id }, '[AutoCancel] telling the mentor failed'))
        }
      } catch (err) {
        logger.error({ err, classId: id }, '[AutoCancel] one class failed')
      }
    }
    if (out.cancelled || out.wouldCancel) logger.info(out, `[AutoCancel] ${mode}`)
  } catch (err) {
    logger.error({ err }, '[AutoCancel] job error')
  }
  return out
}

async function tellMentor(mentor: { id: string; name: string; email: string; emailPrefs?: unknown }, cls: { id: string; title: string; scheduledStart: Date; organizationId?: unknown }) {
  const { NotificationService } = await import('@/services/notification.service.ts')
  const { orgSlugFor } = await import('@/utils/orgSlugs.ts')
  const { academyClock } = await import('@/utils/academyClock.ts')
  const when = academyClock(cls.scheduledStart, orgSlugFor(cls.organizationId)).full
  await new NotificationService().create(mentor.id, {
    kind: 'class-reminder',
    title: 'Class cancelled — no bookings',
    body: `"${cls.title}" (${when}) had no bookings 10 minutes before it started, so it was cancelled. You don't need to join it.`,
    link: '/live-classes',
  }).catch(err => logger.warn({ err, classId: cls.id }, '[AutoCancel] in-app notice failed'))
  /* Sent whatever the mentor's email settings: it is about a class starting in minutes. */
  if (mentor.email) {
    const { sendMentorClassAutoCancelled } = await import('@/services/email.service.ts')
    await sendMentorClassAutoCancelled(mentor.email, mentor.name, cls.title, when)
  }
}
