import mongoose from 'mongoose'
import { PortalError } from '@/services/portal.service.ts'

/* ─────────────────────────────────────────────────────────────
   The mentors' report (Tetra Commission's user, 2026-10-23): for each
   instructor and each day (Dubai time) — their live classes (held,
   cancelled), the students' bookings on them (cancelled, attended, missed),
   their 1:1 mentor meetings (booked, cancelled) and the reviews students
   left that day. A review is a mentor rating (the student's Reviews page) or,
   since 2026-10-25, the feedback a student left after one of their classes
   (the class page's Session feedback) — the user: "the comments aren't visible"
   — one per student per class, the mentor rating's stars when there are both. The portal shows a chief mentor their own team's, matched
   by address. Read only; counts and names, never a student.

   Late to class (2026-10-27): a class not cancelled whose start has passed is
   a late join when its mentor joined more than LATE_JOIN_MINS after the start
   (instructorJoinedAt — for Meet / Zoom the moment they pressed Join in the
   LMS, as the no-show alerts read it), and "no join recorded" with none.
───────────────────────────────────────────────────────────── */

const fail = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)
const DAY_MS = 86_400_000
const TZ = '+04:00' // the academy's day (Dubai)
/** Joined more than this many minutes after the start: late — the line the mentor no-show alert (start + 5) uses. */
export const LATE_JOIN_MINS = 5
/** A class's mentor joining: late (minutes after the start), on time, not recorded — or not due yet (cancelled, still ahead). */
export function joinOf(c: { status?: string; scheduledStart?: Date; instructorJoinedAt?: Date | null }, now = Date.now()): { state: 'late' | 'on_time' | 'none' | 'n/a'; lateMins: number } {
  if (c.status === 'cancelled' || !c.scheduledStart || new Date(c.scheduledStart).getTime() > now) return { state: 'n/a', lateMins: 0 }
  if (!c.instructorJoinedAt) return { state: 'none', lateMins: 0 }
  const mins = Math.round((new Date(c.instructorJoinedAt).getTime() - new Date(c.scheduledStart).getTime()) / 60_000)
  return mins > LATE_JOIN_MINS ? { state: 'late', lateMins: mins } : { state: 'on_time', lateMins: 0 }
}

type Day = {
  classes: number; held: number; classesCancelled: number
  bookings: number; bookingsCancelled: number; attended: number; missed: number
  meetings: number; meetingsCancelled: number
  /** Meetings held or booked (not cancelled) by category (2026-10-25): course pitch, overview, other, none. */
  mCoursePitch: number; mOverview: number; mOther: number; mNone: number
  /** Classes joined late, the minutes late added up, and classes with no join recorded (2026-10-27). */
  lateJoins: number; lateMinutes: number; notJoined: number
  reviews: number; ratingSum: number; lowRatings: number
  /** How many of each star, 1 … 5 (2026-10-23: the breakdown). */
  r1: number; r2: number; r3: number; r4: number; r5: number
}
const blank = (): Day => ({ classes: 0, held: 0, classesCancelled: 0, bookings: 0, bookingsCancelled: 0, attended: 0, missed: 0, meetings: 0, meetingsCancelled: 0, mCoursePitch: 0, mOverview: 0, mOther: 0, mNone: 0, lateJoins: 0, lateMinutes: 0, notJoined: 0, reviews: 0, ratingSum: 0, lowRatings: 0, r1: 0, r2: 0, r3: 0, r4: 0, r5: 0 })
const dayOf = (d: Date) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10)

export async function mentorReportForPortal(q: { from?: unknown; to?: unknown; emails?: unknown }) {
  const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (!isDay(q.from) || !isDay(q.to)) throw fail('from and to are days (YYYY-MM-DD)')
  const start = new Date(`${q.from}T00:00:00${TZ}`), end = new Date(new Date(`${q.to}T00:00:00${TZ}`).getTime() + DAY_MS)
  if (!(end > start)) throw fail('to comes before from')
  if (end.getTime() - start.getTime() > 93 * DAY_MS) throw fail('Three months at most')
  const emails = typeof q.emails === 'string' && q.emails.trim()
    ? [...new Set(q.emails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean))] : null

  const { UserModel, LiveClassModel, ClassBookingModel, MentorMeetingModel, InstructorReviewModel } = await import('@/models/schema.ts')
  // Only these instructors when the portal names them (a chief's team); otherwise everyone who taught, met or was reviewed.
  const named = emails
    ? await UserModel.find({ email: { $in: emails } }, { name: 1, email: 1 }).lean() as any[]
    : null
  const only = named ? { $in: named.map(u => u._id) } : undefined

  const classes = await LiveClassModel.find(
    { scheduledStart: { $gte: start, $lt: end }, ...(only ? { instructorId: only } : {}) },
    { instructorId: 1, scheduledStart: 1, status: 1, startedAt: 1, instructorJoinedAt: 1 },
  ).lean() as any[]
  const classById = new Map(classes.map(c => [String(c._id), c]))
  const bookings = classes.length
    ? await ClassBookingModel.aggregate([
        { $match: { liveClassId: { $in: classes.map(c => c._id) } } },
        { $group: { _id: { c: '$liveClassId', s: '$status', u: '$userId' }, n: { $sum: 1 } } },
      ])
    : []
  const meetings = await MentorMeetingModel.find(
    { scheduledStart: { $gte: start, $lt: end }, ...(only ? { mentorId: only } : {}) },
    { mentorId: 1, scheduledStart: 1, cancelledAt: 1, category: 1 },
  ).lean() as any[]
  const reviews = await InstructorReviewModel.find(
    { createdAt: { $gte: start, $lt: end }, ...(only ? { instructorId: only } : {}) },
    { instructorId: 1, rating: 1, createdAt: 1 },
  ).lean() as any[]
  // Class feedback left in the dates, counted against the class's mentor — unless the same student rated that class.
  for (const f of await classFeedbackAsReviews({ createdAt: { $gte: start, $lt: end } }, only)) reviews.push(f)

  const table = new Map<string, Map<string, Day>>()
  const cell = (who: unknown, at: Date) => {
    const id = String(who ?? ''), day = dayOf(new Date(at))
    let days = table.get(id)
    if (!days) table.set(id, days = new Map())
    let d = days.get(day)
    if (!d) days.set(day, d = blank())
    return d
  }
  for (const c of classes) {
    const d = cell(c.instructorId, c.scheduledStart)
    if (c.status === 'cancelled') { d.classesCancelled++; continue }
    d.classes++
    if (c.status === 'ended' || c.status === 'live' || c.startedAt) d.held++
    const join = joinOf(c)
    if (join.state === 'late') { d.lateJoins++; d.lateMinutes += join.lateMins }
    else if (join.state === 'none') d.notJoined++
  }
  // Different students who booked and who came (2026-10-27): each mentor's, and the whole list's — a student once.
  const studentsOf = new Map<string, { booked: Set<string>; attended: Set<string> }>()
  const everyone = { booked: new Set<string>(), attended: new Set<string>() }
  for (const b of bookings as any[]) {
    const c = classById.get(String(b._id.c))
    if (!c) continue
    const s = studentsOf.get(String(c.instructorId)) ?? { booked: new Set<string>(), attended: new Set<string>() }
    if (b._id.s !== 'cancelled') { s.booked.add(String(b._id.u)); everyone.booked.add(String(b._id.u)) }
    if (b._id.s === 'attended') { s.attended.add(String(b._id.u)); everyone.attended.add(String(b._id.u)) }
    studentsOf.set(String(c.instructorId), s)
    const d = cell(c.instructorId, c.scheduledStart)
    d.bookings += b.n
    if (b._id.s === 'cancelled') d.bookingsCancelled += b.n
    else if (b._id.s === 'attended') d.attended += b.n
    else if (b._id.s === 'missed') d.missed += b.n
  }
  for (const m of meetings) {
    const d = cell(m.mentorId, m.scheduledStart)
    d.meetings++
    if (m.cancelledAt) d.meetingsCancelled++
    else if (m.category === 'course_pitch') d.mCoursePitch++
    else if (m.category === 'overview') d.mOverview++
    else if (m.category === 'other') d.mOther++
    else d.mNone++
  }
  for (const r of reviews) {
    const d = cell(r.instructorId, r.createdAt)
    d.reviews++; d.ratingSum += Number(r.rating) || 0
    if (Number(r.rating) <= 2) d.lowRatings++
    const star = Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0))) as 1 | 2 | 3 | 4 | 5
    d[`r${star}`]++
  }

  const people = named ?? await UserModel.find({ _id: { $in: [...table.keys()].filter(id => mongoose.isValidObjectId(id)).map(id => new mongoose.Types.ObjectId(id)) } }, { name: 1, email: 1 }).lean() as any[]
  const finish = (d: Day) => {
    const { ratingSum, r1, r2, r3, r4, r5, ...rest } = d
    return { ...rest, avgRating: d.reviews ? Math.round((ratingSum / d.reviews) * 10) / 10 : null, ratingCounts: { 1: r1, 2: r2, 3: r3, 4: r4, 5: r5 } }
  }
  return {
    from: q.from, to: q.to, timezone: 'Asia/Dubai',
    mentors: people.map(u => {
      const days = [...(table.get(String(u._id)) ?? new Map<string, Day>()).entries()].sort(([a], [b]) => b.localeCompare(a))
      const total = days.reduce((t, [, d]) => {
        for (const k of Object.keys(t) as (keyof Day)[]) t[k] += d[k]
        return t
      }, blank())
      const s = studentsOf.get(String(u._id))
      return {
        instructorId: String(u._id), name: u.name ?? '', email: String(u.email ?? '').toLowerCase(),
        total: { ...finish(total), students: s?.booked.size ?? 0, studentsAttended: s?.attended.size ?? 0 },
        days: days.map(([day, d]) => ({ day, ...finish(d) })),
      }
    }),
    students: { booked: everyone.booked.size, attended: everyone.attended.size },
  }
}

type ReviewItem = {
  _id: string; kind: 'mentor_rating' | 'class_feedback'; rating: number; comment?: string
  /** The same student's class feedback on that class, when it says something else (2026-10-25). */
  classComment?: string
  createdAt: Date; studentId: { name: string } | null; liveClassId: { title: string; scheduledStart?: Date } | null
  instructorId?: unknown
  /** The class's id — for the Mentor Report's breakdown (2026-10-27); never sent on. */
  classId?: string
}

/**
 * Class feedback (ClassFeedback: rating + comment after a class) as reviews of the class's mentor, for `where` (a
 * createdAt range, or class ids) — leaving out those whose student also rated the class (their mentor rating counts).
 * `only`: these mentors.
 */
export async function classFeedbackAsReviews(where: Record<string, unknown>, only?: unknown): Promise<ReviewItem[]> {
  const { ClassFeedbackModel, InstructorReviewModel } = await import('@/models/schema.ts')
  const feedback = await ClassFeedbackModel.find(where, { liveClassId: 1, userId: 1, rating: 1, comment: 1, createdAt: 1 })
    .populate('userId', 'name').populate('liveClassId', 'title scheduledStart instructorId').lean() as any[]
  const mine = feedback.filter(f => f.liveClassId && (!only || (only as { $in: unknown[] }).$in.some(id => String(id) === String(f.liveClassId.instructorId))))
  if (!mine.length) return []
  const rated = new Set((await InstructorReviewModel.find(
    { liveClassId: { $in: mine.map(f => f.liveClassId._id) }, studentId: { $in: mine.map(f => f.userId?._id ?? f.userId) } },
    { liveClassId: 1, studentId: 1 },
  ).lean() as any[]).map(r => `${r.studentId}|${r.liveClassId}`))
  return mine
    .filter(f => !rated.has(`${f.userId?._id ?? f.userId}|${f.liveClassId._id}`))
    .map(f => ({
      _id: `cf:${f._id}`, kind: 'class_feedback' as const, rating: f.rating, ...(f.comment?.trim() ? { comment: f.comment.trim() } : {}),
      createdAt: f.createdAt, studentId: f.userId ? { name: f.userId.name ?? '' } : null,
      liveClassId: { title: f.liveClassId.title ?? '', scheduledStart: f.liveClassId.scheduledStart }, instructorId: f.liveClassId.instructorId,
      classId: String(f.liveClassId._id),
    }))
}

/**
 * One mentor's reviews for the portal's Mentor Report (GET /service/instructor-reviews/:id, 2026-10-25): their mentor
 * ratings and the class feedback on their classes, newest first, each saying which it is; a mentor rating carries the
 * same student's class comment too when it says something else. In the dates when given (createdAt). The LMS admin's
 * own Instructor Reviews page still reads mentor ratings only (InstructorReviewService.listForInstructor).
 */
export async function mentorReviewsForPortal(instructorId: string, page: number, perPage: number, range: { from?: Date; to?: Date }) {
  if (!mongoose.isValidObjectId(instructorId)) throw fail('Invalid instructor id.')
  const { LiveClassModel, InstructorReviewModel, ClassFeedbackModel } = await import('@/models/schema.ts')
  const id = new mongoose.Types.ObjectId(instructorId)
  const createdAt = range.from || range.to ? { createdAt: { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lt: range.to } : {}) } } : {}
  const ratings = await InstructorReviewModel.find({ instructorId: id, ...createdAt }, { rating: 1, comment: 1, createdAt: 1, studentId: 1, liveClassId: 1 })
    .populate('studentId', 'name').populate('liveClassId', 'title scheduledStart').sort({ createdAt: -1 }).limit(5000).lean() as any[]
  const classIds = (await LiveClassModel.find({ instructorId: id }, { _id: 1 }).lean() as any[]).map(c => c._id)
  const feedback = classIds.length ? await classFeedbackAsReviews({ liveClassId: { $in: classIds }, ...createdAt }) : []
  // The class comment beside a mentor rating by the same student on the same class.
  const said = ratings.length
    ? new Map((await ClassFeedbackModel.find({ liveClassId: { $in: ratings.map(r => r.liveClassId?._id ?? r.liveClassId) }, comment: { $nin: [null, ''] } }, { liveClassId: 1, userId: 1, comment: 1 }).lean() as any[])
      .map(f => [`${f.userId}|${f.liveClassId}`, String(f.comment).trim()]))
    : new Map<string, string>()
  const items: ReviewItem[] = [
    ...ratings.map(r => {
      const extra = said.get(`${r.studentId?._id ?? r.studentId}|${r.liveClassId?._id ?? r.liveClassId}`)
      return {
        _id: String(r._id), kind: 'mentor_rating' as const, rating: r.rating, ...(r.comment?.trim() ? { comment: r.comment.trim() } : {}),
        ...(extra && extra !== r.comment?.trim() ? { classComment: extra } : {}),
        createdAt: r.createdAt, studentId: r.studentId ? { name: r.studentId.name ?? '' } : null,
        liveClassId: r.liveClassId ? { title: r.liveClassId.title ?? '', scheduledStart: r.liveClassId.scheduledStart } : null,
      }
    }),
    ...feedback.map(({ instructorId: _drop, classId: _id, ...f }) => f),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return { reviews: items.slice((page - 1) * perPage, page * perPage), total: items.length, page, perPage }
}
