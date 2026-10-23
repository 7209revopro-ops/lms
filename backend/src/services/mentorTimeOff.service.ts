import { Types } from 'mongoose'

/* ────────────────────────────────────────────────────────────────────────────
   A mentor's time off (the user, 2026-10-23): "they can mention they're not available at that time … and at that
   time no one can book him, like in every portal". Marked in the LMS admin (the mentor's own Availability page, or an
   admin for any mentor they reach) and from the commission portal (/service/mentor-time-off — the portal decides who
   may); read by every Mentor Calendar through listMentorsForPortal.

   Everything that puts a mentor's hour in the diary goes through here first and is refused over it:
     a 1:1 meeting booked or moved (portal.service.ts — the LMS admin, the commission portal and the CRMs alike),
     a live class created, repeated or moved, or handed to the mentor (liveClass.service.ts, the repeat route),
     a programme made or rescheduled, co-mentors included (program.service.ts),
     a timetable import (classImport.service.ts — those dates come back as clashes).
   What was already booked when the time off is marked stays; the mentor is shown it, nothing is cancelled.
──────────────────────────────────────────────────────────────────────────── */

/** The longest one stretch of time off may be. */
const MAX_DAYS = 180
/** The zone the refusals are written in — the academies' clock, as the slots are (portal.service.ts). */
const TZ = 'Asia/Dubai'

export class MentorUnavailableError extends Error {
  readonly code = 'MENTOR_NOT_AVAILABLE'
  readonly statusCode = 409
  constructor(message: string) { super(message); this.name = 'MentorUnavailableError' }
}

export class TimeOffError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = statusCode === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR') {
    super(message); this.name = 'TimeOffError'
  }
}

type Span = { startsAt: Date; endsAt: Date; allDay?: boolean }
type IdLike = string | Types.ObjectId

const dayFmt = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
const timeFmt = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })

/** "Fri 24 Oct, 14:00–18:00", "Fri 24 Oct – Sun 26 Oct" (whole days), "Fri 24 Oct, 14:00 – Sat 25 Oct, 10:00". */
export function describeSpan(s: Span): string {
  const a = new Date(s.startsAt), b = new Date(s.endsAt)
  if (s.allDay) {
    const last = new Date(b.getTime() - 1)
    return dayFmt(a) === dayFmt(last) ? `${dayFmt(a)} (all day)` : `${dayFmt(a)} – ${dayFmt(last)}`
  }
  return dayFmt(a) === dayFmt(b) ? `${dayFmt(a)}, ${timeFmt(a)}–${timeFmt(b)}` : `${dayFmt(a)}, ${timeFmt(a)} – ${dayFmt(b)}, ${timeFmt(b)}`
}

const oid = (v: IdLike) => (v instanceof Types.ObjectId ? v : new Types.ObjectId(String(v)))
const validIds = (ids: IdLike[]) => [...new Set(ids.map(String))].filter(Types.ObjectId.isValid).map(oid)

/** The time off of these mentors touching [from, to). */
export async function timeOffBetween(mentorIds: IdLike[], from: Date, to: Date) {
  const ids = validIds(mentorIds)
  if (!ids.length) return []
  const { MentorTimeOffModel } = await import('@/models/schema.ts')
  return MentorTimeOffModel.find({ mentorId: { $in: ids }, startsAt: { $lt: to }, endsAt: { $gt: from } })
    .sort({ startsAt: 1 }).lean()
}

/**
 * The first of these times that falls in one of these mentors' time off, or null. Several spans at once — a
 * programme's dates, a repeat's weeks — in one read.
 */
export async function firstTimeOffClash(mentorIds: IdLike[], spans: Array<{ start: Date; durationMins: number }>) {
  if (!spans.length) return null
  const ends = spans.map(s => s.start.getTime() + s.durationMins * 60_000)
  const blocks = await timeOffBetween(mentorIds, new Date(Math.min(...spans.map(s => s.start.getTime()))), new Date(Math.max(...ends)))
  if (!blocks.length) return null
  for (const [i, s] of spans.entries()) {
    const b = blocks.find(x => x.startsAt.getTime() < ends[i]! && x.endsAt.getTime() > s.start.getTime())
    if (b) {
      const { UserModel } = await import('@/models/schema.ts')
      const who = await UserModel.findById(b.mentorId).select('name').lean<{ name?: string }>()
      return { mentorId: String(b.mentorId), mentorName: who?.name || 'The mentor', at: s.start, block: b }
    }
  }
  return null
}

/** The sentence every refusal uses. */
export const notAvailableMessage = (c: NonNullable<Awaited<ReturnType<typeof firstTimeOffClash>>>) =>
  `${c.mentorName} is not available then — time off ${describeSpan(c.block)} (Dubai time)`

/** Refuses when any of these mentors is off at any part of this time. */
export async function assertMentorsFree(mentorIds: IdLike[], start: Date, durationMins: number): Promise<void> {
  const clash = await firstTimeOffClash(mentorIds, [{ start, durationMins }])
  if (clash) throw new MentorUnavailableError(notAvailableMessage(clash))
}

export interface TimeOffDTO {
  id: string
  mentorId: string
  startsAt: string
  endsAt: string
  allDay: boolean
  /** Null for whoever may not read it. */
  reason: string | null
  createdByName: string
}

export const timeOffDTO = (b: any, withReason: boolean): TimeOffDTO => ({
  id: String(b._id ?? b.id),
  mentorId: String(b.mentorId),
  startsAt: new Date(b.startsAt).toISOString(),
  endsAt: new Date(b.endsAt).toISOString(),
  allDay: b.allDay === true,
  reason: withReason ? String(b.reason ?? '') : null,
  createdByName: String(b.createdByName ?? ''),
})

/** What the mentor already has inside a span — told back when time off is marked over it, never cancelled. */
export async function bookedWithin(mentorId: IdLike, span: Span) {
  const { LiveClassModel, MentorMeetingModel } = await import('@/models/schema.ts')
  const id = oid(mentorId)
  const lookBack = new Date(span.startsAt.getTime() - 600 * 60_000)
  const [classes, meetings] = await Promise.all([
    LiveClassModel.find({
      $or: [{ instructorId: id }, { coInstructorIds: id }],
      status: { $ne: 'cancelled' },
      scheduledStart: { $gte: lookBack, $lt: span.endsAt },
    }).select('title scheduledStart durationMins').lean(),
    MentorMeetingModel.find({ mentorId: id, cancelledAt: null, scheduledStart: { $gte: lookBack, $lt: span.endsAt } })
      .select('title scheduledStart durationMins').lean(),
  ])
  const inside = (x: { scheduledStart: Date; durationMins?: number }) =>
    new Date(x.scheduledStart).getTime() + (x.durationMins ?? 0) * 60_000 > span.startsAt.getTime()
  return [
    ...classes.filter(inside).map(c => ({ kind: 'class' as const, id: String(c._id), title: c.title ?? '', startsAt: new Date(c.scheduledStart).toISOString(), durationMins: c.durationMins ?? 0 })),
    ...meetings.filter(inside).map(m => ({ kind: 'meeting' as const, id: String(m._id), title: m.title ?? '', startsAt: new Date(m.scheduledStart).toISOString(), durationMins: m.durationMins ?? 0 })),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

/** A mentor's time off from now on (and what is still running), for their own page. */
export async function listTimeOff(mentorId: IdLike, opts: { from?: Date; to?: Date } = {}) {
  const from = opts.from ?? new Date()
  const to = opts.to ?? new Date(from.getTime() + 366 * 864e5)
  return timeOffBetween([mentorId], from, to)
}

/** Marks the mentor off from startsAt to endsAt. Returns it with what was already booked inside it. */
export async function addTimeOff(input: {
  mentorId: IdLike
  startsAt?: unknown
  endsAt?: unknown
  allDay?: unknown
  reason?: unknown
  byEmail?: string
  byName?: string
}) {
  const { UserModel, MentorTimeOffModel } = await import('@/models/schema.ts')
  if (!Types.ObjectId.isValid(String(input.mentorId))) throw new TimeOffError('No such mentor', 404)
  const mentor = await UserModel.findOne({ _id: oid(input.mentorId), role: 'instructor' }).select('name email').lean<{ _id: Types.ObjectId; name?: string; email?: string }>()
  if (!mentor) throw new TimeOffError('No such mentor', 404)

  const startsAt = new Date(String(input.startsAt ?? ''))
  const endsAt = new Date(String(input.endsAt ?? ''))
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new TimeOffError('Give the start and the end')
  if (endsAt <= startsAt) throw new TimeOffError('The end must be after the start')
  if (endsAt.getTime() <= Date.now()) throw new TimeOffError('That time has already passed')
  if (endsAt.getTime() - startsAt.getTime() > MAX_DAYS * 864e5) throw new TimeOffError(`At most ${MAX_DAYS} days at a time`)
  const reason = String(input.reason ?? '').trim().slice(0, 300)

  const created = await MentorTimeOffModel.create({
    mentorId: mentor._id, startsAt, endsAt, allDay: input.allDay === true, reason,
    createdByEmail: String(input.byEmail ?? '').toLowerCase().trim(), createdByName: String(input.byName ?? '').trim(),
  })
  const alreadyBooked = await bookedWithin(mentor._id, { startsAt, endsAt })
  return { timeOff: timeOffDTO(created.toObject({ transform: false }), true), mentor: { id: String(mentor._id), name: mentor.name ?? '', email: mentor.email ?? '' }, alreadyBooked }
}

/** Takes one stretch of time off away — only this mentor's. */
export async function removeTimeOff(mentorId: IdLike, timeOffId: string): Promise<void> {
  const { MentorTimeOffModel } = await import('@/models/schema.ts')
  if (!Types.ObjectId.isValid(timeOffId) || !Types.ObjectId.isValid(String(mentorId))) throw new TimeOffError('No such time off', 404)
  const r = await MentorTimeOffModel.deleteOne({ _id: new Types.ObjectId(timeOffId), mentorId: oid(mentorId) })
  if (!r.deletedCount) throw new TimeOffError('No such time off', 404)
}
