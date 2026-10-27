import mongoose from 'mongoose'
import { PortalError } from '@/services/portal.service.ts'
import { classFeedbackAsReviews, joinOf } from '@/services/portalMentorReport.service.ts'

/* ─────────────────────────────────────────────────────────────
   What is behind each number of the portal's Mentor Report (Tetra
   Commission's user, 2026-10-27: "each count we can break down … the
   mentors' classes and bookings, students count, reviews of the class,
   cancellations — which ones; a programs report and a meeting report"):
   the classes, the bookings (and which students), the students, the
   meetings and the Programs, for the same dates and mentors as the report —
   a chief's team (by address), one mentor, or one Program. Read only.

   GET /service/mentor-report/details?kind=&from=&to=&emails=&instructorId=&programId=
     kind: classes | cancelled_classes | bookings | cancelled_bookings | attended
         | missed | students | meetings | cancelled_meetings | programs
         | late_joins | not_joined (2026-10-27: the classes a mentor joined late, or with no join recorded)
───────────────────────────────────────────────────────────── */

const fail = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)
const DAY_MS = 86_400_000
const TZ = '+04:00'
const MAX_ROWS = 3000
export const DETAIL_KINDS = ['classes', 'cancelled_classes', 'bookings', 'cancelled_bookings', 'attended', 'missed', 'students', 'meetings', 'cancelled_meetings', 'programs', 'late_joins', 'not_joined'] as const
type Kind = (typeof DETAIL_KINDS)[number]
const BOOKING_KINDS: Partial<Record<Kind, string | null>> = { bookings: null, cancelled_bookings: 'cancelled', attended: 'attended', missed: 'missed' }

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const oid = (v: unknown) => new mongoose.Types.ObjectId(String(v))
const avg = (sum: number, n: number) => (n ? Math.round((sum / n) * 10) / 10 : null)
const held = (c: any) => c.status === 'ended' || c.status === 'live' || !!c.startedAt

export async function mentorReportDetailForPortal(q: Record<string, unknown>) {
  const kind = String(q.kind ?? '') as Kind
  if (!DETAIL_KINDS.includes(kind)) throw fail(`kind is one of ${DETAIL_KINDS.join(', ')}`)
  if (!isDay(q.from) || !isDay(q.to)) throw fail('from and to are days (YYYY-MM-DD)')
  const start = new Date(`${q.from}T00:00:00${TZ}`), end = new Date(new Date(`${q.to}T00:00:00${TZ}`).getTime() + DAY_MS)
  if (!(end > start)) throw fail('to comes before from')
  if (end.getTime() - start.getTime() > 93 * DAY_MS) throw fail('Three months at most')
  for (const k of ['instructorId', 'programId'] as const) if (q[k] && !mongoose.isValidObjectId(String(q[k]))) throw fail(`Invalid ${k}`)

  const { UserModel, LiveClassModel, ClassBookingModel, MentorMeetingModel, InstructorReviewModel, ProgramModel, CourseModel } = await import('@/models/schema.ts')
  // Whose: one mentor, else the portal's list (a chief's team), else everyone.
  const emails = typeof q.emails === 'string' && q.emails.trim()
    ? [...new Set(q.emails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean))] : null
  let mentors: mongoose.Types.ObjectId[] | null = emails ? (await UserModel.find({ email: { $in: emails } }, { _id: 1 }).lean() as any[]).map(u => u._id) : null
  if (q.instructorId) {
    const one = oid(q.instructorId)
    if (mentors && !mentors.some(m => m.equals(one))) mentors = []
    else mentors = [one]
  }
  const only = mentors ? { $in: mentors } : undefined
  const names = async (ids: unknown[]) => new Map((await UserModel.find({ _id: { $in: [...new Set(ids.filter(Boolean).map(String))].map(oid) } }, { name: 1, email: 1 }).lean() as any[])
    .map(u => [String(u._id), { name: u.name ?? '', email: String(u.email ?? '').toLowerCase() }]))

  // ── Meetings ──
  if (kind === 'meetings' || kind === 'cancelled_meetings') {
    const rows = await MentorMeetingModel.find(
      { scheduledStart: { $gte: start, $lt: end }, ...(only ? { mentorId: only } : {}), ...(kind === 'cancelled_meetings' ? { cancelledAt: { $ne: null } } : {}) },
      { mentorId: 1, title: 1, kind: 1, category: 1, scheduledStart: 1, durationMins: 1, isOnline: 1, location: 1, attendees: 1, bookedByEmail: 1, bookedVia: 1, cancelledAt: 1 },
    ).sort({ scheduledStart: -1 }).limit(MAX_ROWS).lean() as any[]
    const who = await names(rows.map(m => m.mentorId))
    return {
      kind, total: rows.length,
      rows: rows.map(m => ({
        id: String(m._id), title: m.title ?? '', start: m.scheduledStart, durationMins: m.durationMins ?? 0,
        mentor: who.get(String(m.mentorId))?.name ?? '', mentorEmail: who.get(String(m.mentorId))?.email ?? '',
        meetingKind: m.kind ?? '', category: m.category ?? '', online: m.isOnline !== false, location: m.location ?? '',
        attendees: (m.attendees ?? []).map((a: any) => a?.name ?? '').filter(Boolean), bookedBy: m.bookedByEmail ?? '', bookedVia: m.bookedVia ?? '',
        cancelled: !!m.cancelledAt, cancelledAt: m.cancelledAt ?? null,
      })),
    }
  }

  // ── Classes in the dates (a Program's when asked), with their bookings ──
  const classes = await LiveClassModel.find(
    { scheduledStart: { $gte: start, $lt: end }, ...(only ? { instructorId: only } : {}), ...(q.programId ? { programId: oid(q.programId) } : {}) },
    { instructorId: 1, title: 1, scheduledStart: 1, durationMins: 1, status: 1, startedAt: 1, courseId: 1, programId: 1, instructorJoinedAt: 1 },
  ).sort({ scheduledStart: -1 }).lean() as any[]
  const classById = new Map(classes.map(c => [String(c._id), c]))
  const bookings = classes.length
    ? await ClassBookingModel.find({ liveClassId: { $in: classes.map(c => c._id) } }, { userId: 1, liveClassId: 1, status: 1, bookedAt: 1, attendedAt: 1, cancelledAt: 1 }).lean() as any[]
    : []
  const [who, courses, programs] = await Promise.all([
    names([...classes.map(c => c.instructorId), ...bookings.map(b => b.userId)]),
    CourseModel.find({ _id: { $in: [...new Set(classes.map(c => String(c.courseId)))].map(oid) } }, { title: 1 }).lean() as Promise<any[]>,
    ProgramModel.find({ _id: { $in: [...new Set(classes.filter(c => c.programId).map(c => String(c.programId)))].map(oid) } }, { title: 1 }).lean() as Promise<any[]>,
  ])
  const courseOf = new Map(courses.map(c => [String(c._id), c.title ?? '']))
  const programOf = new Map(programs.map(p => [String(p._id), p.title ?? '']))

  if (kind in BOOKING_KINDS) {
    const status = BOOKING_KINDS[kind]
    const rows = bookings.filter(b => !status || b.status === status)
      .map(b => {
        const c = classById.get(String(b.liveClassId))
        return {
          id: String(b._id), student: who.get(String(b.userId))?.name ?? '', studentEmail: who.get(String(b.userId))?.email ?? '',
          status: b.status, bookedAt: b.bookedAt ?? null, attendedAt: b.attendedAt ?? null, cancelledAt: b.cancelledAt ?? null,
          classId: String(b.liveClassId), class: c?.title ?? '', classStart: c?.scheduledStart ?? null, classStatus: c?.status ?? '',
          mentor: who.get(String(c?.instructorId))?.name ?? '', program: programOf.get(String(c?.programId)) ?? '', course: courseOf.get(String(c?.courseId)) ?? '',
        }
      })
      .sort((a, b) => new Date(b.classStart ?? 0).getTime() - new Date(a.classStart ?? 0).getTime())
    return { kind, total: rows.length, rows: rows.slice(0, MAX_ROWS) }
  }

  if (kind === 'students') {
    const per = new Map<string, { booked: number; attended: number; missed: number; cancelled: number; classes: Set<string>; mentors: Set<string>; last: Date | null }>()
    for (const b of bookings) {
      const s = per.get(String(b.userId)) ?? { booked: 0, attended: 0, missed: 0, cancelled: 0, classes: new Set<string>(), mentors: new Set<string>(), last: null }
      const c = classById.get(String(b.liveClassId))
      s.booked++
      if (b.status === 'attended') s.attended++
      else if (b.status === 'missed') s.missed++
      else if (b.status === 'cancelled') s.cancelled++
      s.classes.add(String(b.liveClassId))
      if (c) s.mentors.add(who.get(String(c.instructorId))?.name ?? '')
      if (c && (!s.last || c.scheduledStart > s.last)) s.last = c.scheduledStart
      per.set(String(b.userId), s)
    }
    const rows = [...per.entries()].map(([id, s]) => ({
      id, student: who.get(id)?.name ?? '', studentEmail: who.get(id)?.email ?? '',
      booked: s.booked, attended: s.attended, missed: s.missed, cancelled: s.cancelled, classes: s.classes.size,
      mentors: [...s.mentors].filter(Boolean), lastClass: s.last,
    })).sort((a, b) => b.attended - a.attended || b.booked - a.booked || a.student.localeCompare(b.student))
    return { kind, total: rows.length, rows: rows.slice(0, MAX_ROWS) }
  }

  // Each class's reviews: mentor ratings on it, and class feedback (one per student, the mentor rating's when both).
  const ids = classes.map(c => c._id)
  const ratings = ids.length ? await InstructorReviewModel.find({ liveClassId: { $in: ids } }, { liveClassId: 1, rating: 1 }).lean() as any[] : []
  const feedback = ids.length ? await classFeedbackAsReviews({ liveClassId: { $in: ids } }) : []
  const stars = new Map<string, { sum: number; n: number }>()
  const addStar = (classId: string, rating: number) => {
    const s = stars.get(classId) ?? { sum: 0, n: 0 }
    s.sum += Number(rating) || 0; s.n++
    stars.set(classId, s)
  }
  for (const r of ratings) addStar(String(r.liveClassId), r.rating)
  for (const f of feedback) if (f.classId) addStar(f.classId, f.rating)
  const tally = (cid: string) => {
    const t = { booked: 0, attended: 0, missed: 0, cancelled: 0 }
    for (const b of bookings) if (String(b.liveClassId) === cid) {
      t.booked++
      if (b.status === 'attended') t.attended++
      else if (b.status === 'missed') t.missed++
      else if (b.status === 'cancelled') t.cancelled++
    }
    return t
  }

  if (kind === 'classes' || kind === 'cancelled_classes' || kind === 'late_joins' || kind === 'not_joined') {
    const pick = kind === 'late_joins' ? (c: any) => joinOf(c).state === 'late'
      : kind === 'not_joined' ? (c: any) => joinOf(c).state === 'none'
        : (c: any) => (kind === 'cancelled_classes') === (c.status === 'cancelled')
    const rows = classes.filter(pick).map(c => {
      const s = stars.get(String(c._id))
      const join = joinOf(c)
      return {
        id: String(c._id), title: c.title ?? '', start: c.scheduledStart, durationMins: c.durationMins ?? 0,
        status: c.status, held: held(c), mentor: who.get(String(c.instructorId))?.name ?? '', mentorEmail: who.get(String(c.instructorId))?.email ?? '',
        course: courseOf.get(String(c.courseId)) ?? '', program: programOf.get(String(c.programId)) ?? '', programId: c.programId ? String(c.programId) : '',
        ...tally(String(c._id)), reviews: s?.n ?? 0, avgRating: avg(s?.sum ?? 0, s?.n ?? 0),
        joinedAt: c.instructorJoinedAt ?? null, join: join.state, lateMins: join.lateMins,
      }
    })
    return { kind, total: rows.length, rows: rows.slice(0, MAX_ROWS) }
  }

  // ── Programs: every Program of these mentors running in the dates, with its classes in them ──
  const progs = await ProgramModel.find(
    {
      ...(q.programId ? { _id: oid(q.programId) } : {}),
      ...(only ? { $or: [{ instructorId: only }, { coInstructorIds: only }] } : {}),
      startDate: { $lte: q.to }, endDate: { $gte: q.from },
    },
    { title: 1, instructorId: 1, coInstructorIds: 1, studentIds: 1, status: 1, repeat: 1, weekdays: 1, startDate: 1, endDate: 1, time: 1, isOnline: 1, courseId: 1 },
  ).lean() as any[]
  const progClasses = progs.length
    ? await LiveClassModel.find({ programId: { $in: progs.map(p => p._id) }, scheduledStart: { $gte: start, $lt: end } }, { _id: 1, programId: 1, status: 1, startedAt: 1, title: 1, scheduledStart: 1 }).lean() as any[]
    : []
  // Their bookings and reviews too, when the classes above (the mentor's own) left some out (a co-mentor's Program).
  const missing = progClasses.filter(c => !classById.has(String(c._id))).map(c => c._id)
  const moreBookings = missing.length ? await ClassBookingModel.find({ liveClassId: { $in: missing } }, { liveClassId: 1, status: 1, userId: 1 }).lean() as any[] : []
  const moreRatings = missing.length ? await InstructorReviewModel.find({ liveClassId: { $in: missing } }, { liveClassId: 1, rating: 1 }).lean() as any[] : []
  for (const r of moreRatings) addStar(String(r.liveClassId), r.rating)
  const allBookings = [...bookings, ...moreBookings]
  const progWho = await names(progs.flatMap(p => [p.instructorId, ...(p.coInstructorIds ?? [])]))
  const progCourse = new Map((await CourseModel.find({ _id: { $in: progs.map(p => p.courseId).filter(Boolean) } }, { title: 1 }).lean() as any[]).map(c => [String(c._id), c.title ?? '']))
  const rows = progs.map(p => {
    const mine = progClasses.filter(c => String(c.programId) === String(p._id))
    const mineIds = new Set(mine.map(c => String(c._id)))
    const b = allBookings.filter(x => mineIds.has(String(x.liveClassId)))
    let sum = 0, n = 0
    for (const id of mineIds) { const s = stars.get(id); if (s) { sum += s.sum; n += s.n } }
    const heldN = mine.filter(c => c.status !== 'cancelled' && held(c)).length
    const attended = b.filter(x => x.status === 'attended').length, missed = b.filter(x => x.status === 'missed').length
    return {
      id: String(p._id), title: p.title ?? '', status: p.status ?? 'active', repeat: p.repeat ?? '', weekdays: p.weekdays ?? [], time: p.time ?? '',
      startDate: p.startDate, endDate: p.endDate, online: p.isOnline !== false, course: progCourse.get(String(p.courseId)) ?? '',
      mentor: progWho.get(String(p.instructorId))?.name ?? '', mentorEmail: progWho.get(String(p.instructorId))?.email ?? '',
      coMentors: (p.coInstructorIds ?? []).map((id: unknown) => progWho.get(String(id))?.name ?? '').filter(Boolean),
      students: (p.studentIds ?? []).length,
      classes: mine.filter(c => c.status !== 'cancelled').length, held: heldN, cancelled: mine.filter(c => c.status === 'cancelled').length,
      bookings: b.length, attended, missed, bookingsCancelled: b.filter(x => x.status === 'cancelled').length,
      studentsAttended: new Set(b.filter(x => x.status === 'attended').map(x => String(x.userId))).size,
      attendancePct: attended + missed ? Math.round((attended / (attended + missed)) * 100) : null,
      reviews: n, avgRating: avg(sum, n),
    }
  }).sort((a, b) => b.held - a.held || a.title.localeCompare(b.title))
  return { kind, total: rows.length, rows }
}
