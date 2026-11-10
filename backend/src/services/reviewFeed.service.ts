/* ─────────────────────────────────────────────────────────────
   All reviews (the user, 2026-11-10: "instructor review page also need to
   show on the lms and commission portal … full review with filter … they can
   see their review and others review also"). Every review left on a mentor,
   newest first, filtered and paged in the database:

     mentor_rating   — a student's stars (and words) for the mentor after a
                       class they attended (InstructorReview);
     class_feedback  — a student's stars for the class itself (ClassFeedback),
                       left out where the same student rated the mentor on the
                       same class (that rating stands for it) — as the Mentor
                       Report counts them (portalMentorReport.service.ts).

   Filters: academy, programme, which mentors may be seen (reach) and one
   mentor, stars (1–5, or "low" = 1–2), days, with words only, kind, and a
   search over the student, the class and the words. With the page: the
   totals of everything that matches — how many, the average, each star's
   count, how many with words.

   The LMS admin's Instructor Reviews page asks it (an admin their academy and
   programme, an instructor their academy) and so does the CS Portal's
   (/service/instructor-reviews/feed — every academy, its team by address).
───────────────────────────────────────────────────────────── */
import { Types } from 'mongoose'

export interface ReviewFeedQuery {
  orgId?: string
  program?: string
  /** Who may be seen: undefined = every mentor; [] = nobody. */
  reach?: Types.ObjectId[]
  instructor?: string
  rating?: number | 'low'
  from?: Date
  to?: Date
  withComment?: boolean
  kind?: 'mentor_rating' | 'class_feedback'
  q?: string
  page: number
  perPage: number
}
export interface ReviewFeedItem {
  id: string; kind: 'mentor_rating' | 'class_feedback'; rating: number; comment: string; classComment?: string; createdAt: Date
  student: { id: string; name: string } | null
  class: { id: string; title: string; scheduledStart: Date | null } | null
  instructor: { id: string; name: string; email: string } | null
  program: string
}
export interface ReviewFeed {
  reviews: ReviewFeedItem[]; total: number; page: number; perPage: number
  stats: { count: number; average: number | null; counts: Record<'1' | '2' | '3' | '4' | '5', number>; withComment: number; low: number }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const oid = (v: unknown) => (typeof v === 'string' && Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : null)
const NONE = { _id: { $exists: false } }

/** A filter's words from a query string or body: days are Dubai days, `to` included. */
export function readReviewFilters(q: Record<string, unknown>): Omit<ReviewFeedQuery, 'orgId' | 'reach' | 'page' | 'perPage'> & { page: number; perPage: number } {
  const day = (v: unknown, add = 0) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(new Date(`${v}T00:00:00+04:00`).getTime() + add) : undefined)
  const r = String(q['rating'] ?? '')
  const rating = r === 'low' ? 'low' as const : /^[1-5]$/.test(r) ? Number(r) : undefined
  const kind = q['kind'] === 'mentor_rating' || q['kind'] === 'class_feedback' ? q['kind'] : undefined
  const program = typeof q['program'] === 'string' && /^[a-z0-9-]{1,40}$/.test(q['program']) ? q['program'] : undefined
  return {
    ...(program ? { program } : {}),
    ...(typeof q['instructor'] === 'string' && Types.ObjectId.isValid(q['instructor']) ? { instructor: q['instructor'] } : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(day(q['from']) ? { from: day(q['from']) } : {}),
    ...(day(q['to'], 86_400_000) ? { to: day(q['to'], 86_400_000) } : {}),
    ...(q['withComment'] === true || q['withComment'] === 'true' || q['withComment'] === '1' ? { withComment: true } : {}),
    ...(kind ? { kind } : {}),
    ...(typeof q['q'] === 'string' && q['q'].trim() ? { q: q['q'].trim().slice(0, 80) } : {}),
    page: Math.max(1, Math.floor(Number(q['page']) || 1)),
    perPage: Math.min(100, Math.max(1, Math.floor(Number(q['per_page'] ?? q['perPage']) || 25))),
  }
}

export async function reviewFeed(f: ReviewFeedQuery): Promise<ReviewFeed> {
  const { InstructorReviewModel, ClassFeedbackModel, LiveClassModel, CourseModel, UserModel } = await import('@/models/schema.ts')
  const empty: ReviewFeed = { reviews: [], total: 0, page: f.page, perPage: f.perPage, stats: { count: 0, average: null, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, withComment: 0, low: 0 } }

  // Which mentors: the reach, narrowed to one if asked (one outside the reach is nobody).
  const one = f.instructor ? oid(f.instructor) : null
  let mentors: Types.ObjectId[] | undefined = f.reach
  if (one) mentors = !f.reach || f.reach.some(x => x.equals(one)) ? [one] : []
  if (mentors && !mentors.length) return empty
  const org = f.orgId ? oid(f.orgId) : null

  const created = f.from || f.to ? { createdAt: { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lt: f.to } : {}) } } : {}
  const stars = f.rating === 'low' ? { rating: { $lte: 2 } } : typeof f.rating === 'number' ? { rating: f.rating } : {}
  const words = f.withComment ? { comment: { $regex: /\S/ } } : {}

  // The search: students by name, classes by title, and the words themselves.
  let search: { students: Types.ObjectId[]; classes: Types.ObjectId[]; rx: RegExp } | null = null
  if (f.q) {
    const rx = new RegExp(esc(f.q), 'i')
    const [students, classes] = await Promise.all([
      UserModel.find({ name: rx }, { _id: 1 }).limit(1000).lean() as Promise<{ _id: Types.ObjectId }[]>,
      LiveClassModel.find({ title: rx, ...(mentors ? { instructorId: { $in: mentors } } : {}) }, { _id: 1 }).limit(2000).lean() as Promise<{ _id: Types.ObjectId }[]>,
    ])
    search = { students: students.map(s => s._id), classes: classes.map(c => c._id), rx }
  }
  const searchBy = (who: string) => (search ? { $or: [{ [who]: { $in: search.students } }, { liveClassId: { $in: search.classes } }, { comment: search.rx }] } : {})

  const R = InstructorReviewModel.collection.name, F = ClassFeedbackModel.collection.name, L = LiveClassModel.collection.name, C = CourseModel.collection.name
  const ratingsMatch = f.kind === 'class_feedback' ? NONE : {
    ...created, ...stars, ...words, ...searchBy('studentId'),
    ...(mentors ? { instructorId: { $in: mentors } } : {}), ...(org ? { organizationId: org } : {}), ...(f.program ? { program: f.program } : {}),
  }
  const feedbackPipeline = [
    { $match: { ...created, ...stars, ...words, ...searchBy('userId') } },
    { $lookup: { from: L, let: { c: '$liveClassId' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$c'] } } }, { $project: { instructorId: 1, organizationId: 1, courseId: 1 } }], as: 'lc' } },
    { $unwind: '$lc' },
    { $match: { ...(mentors ? { 'lc.instructorId': { $in: mentors } } : {}), ...(org ? { 'lc.organizationId': org } : {}) } },
    { $lookup: { from: C, let: { c: '$lc.courseId' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$c'] } } }, { $project: { program: 1 } }], as: 'course' } },
    ...(f.program ? [{ $match: { 'course.program': f.program } }] : []),
    // The same student's rating of the mentor on the same class stands for it.
    { $lookup: { from: R, let: { c: '$liveClassId', s: '$userId' }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$liveClassId', '$$c'] }, { $eq: ['$studentId', '$$s'] }] } } }, { $limit: 1 }, { $project: { _id: 1 } }], as: 'rated' } },
    { $match: { rated: { $size: 0 } } },
    { $project: { _id: 1, kind: { $literal: 'class_feedback' }, rating: 1, comment: 1, createdAt: 1, studentId: '$userId', liveClassId: 1, instructorId: '$lc.instructorId', program: { $ifNull: [{ $arrayElemAt: ['$course.program', 0] }, ''] } } },
  ]
  const rows = await InstructorReviewModel.aggregate([
    { $match: ratingsMatch },
    { $project: { _id: 1, kind: { $literal: 'mentor_rating' }, rating: 1, comment: 1, createdAt: 1, studentId: 1, liveClassId: 1, instructorId: 1, program: { $ifNull: ['$program', ''] } } },
    ...(f.kind === 'mentor_rating' ? [] : [{ $unionWith: { coll: F, pipeline: feedbackPipeline } }]),
    { $facet: {
      items: [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: (f.page - 1) * f.perPage }, { $limit: f.perPage }],
      stats: [{ $group: { _id: '$rating', n: { $sum: 1 }, words: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$comment', ''] }, regex: /\S/ } }, 1, 0] } } } }],
    } },
  ]).allowDiskUse(true) as Array<{ items: any[]; stats: { _id: number; n: number; words: number }[] }>

  const { items = [], stats = [] } = rows[0] ?? {}
  const counts: ReviewFeed['stats']['counts'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let count = 0, sum = 0, withComment = 0
  for (const s of stats) {
    const k = String(Math.max(1, Math.min(5, Math.round(Number(s._id) || 0)))) as keyof typeof counts
    counts[k] += s.n; count += s.n; sum += Number(s._id) * s.n; withComment += s.words
  }

  // Names for the page: students, classes, mentors; a mentor rating's class comment by the same student.
  const ids = (k: string) => [...new Set(items.map(i => String(i[k] ?? '')).filter(Boolean))].map(x => new Types.ObjectId(x))
  const ratedPairs = items.filter(i => i.kind === 'mentor_rating')
  const [people, classes, said] = await Promise.all([
    UserModel.find({ _id: { $in: [...ids('studentId'), ...ids('instructorId')] } }, { name: 1, email: 1 }).lean() as Promise<any[]>,
    LiveClassModel.find({ _id: { $in: ids('liveClassId') } }, { title: 1, scheduledStart: 1 }).lean() as Promise<any[]>,
    ratedPairs.length
      ? ClassFeedbackModel.find({ $or: ratedPairs.map(i => ({ liveClassId: i.liveClassId, userId: i.studentId })), comment: { $regex: /\S/ } }, { liveClassId: 1, userId: 1, comment: 1 }).lean() as Promise<any[]>
      : Promise.resolve([] as any[]),
  ])
  const person = new Map(people.map(p => [String(p._id), p]))
  const klass = new Map(classes.map(c => [String(c._id), c]))
  const classSaid = new Map(said.map(s => [`${s.userId}|${s.liveClassId}`, String(s.comment).trim()]))

  return {
    reviews: items.map(i => {
      const s = person.get(String(i.studentId)), m = person.get(String(i.instructorId)), c = klass.get(String(i.liveClassId))
      const comment = String(i.comment ?? '').trim()
      const extra = i.kind === 'mentor_rating' ? classSaid.get(`${i.studentId}|${i.liveClassId}`) : undefined
      return {
        id: i.kind === 'class_feedback' ? `cf:${i._id}` : String(i._id), kind: i.kind, rating: i.rating, comment,
        ...(extra && extra !== comment ? { classComment: extra } : {}),
        createdAt: i.createdAt,
        student: i.studentId ? { id: String(i.studentId), name: s?.name ?? '' } : null,
        class: i.liveClassId ? { id: String(i.liveClassId), title: c?.title ?? '', scheduledStart: c?.scheduledStart ?? null } : null,
        instructor: i.instructorId ? { id: String(i.instructorId), name: m?.name ?? 'Unknown', email: String(m?.email ?? '') } : null,
        program: String(i.program ?? ''),
      }
    }),
    total: count, page: f.page, perPage: f.perPage,
    stats: { count, average: count ? Math.round((sum / count) * 100) / 100 : null, counts, withComment, low: counts[1] + counts[2] },
  }
}

/** Instructors by address (lower case) → their ids — the CS Portal's team, as the LMS knows them. */
export async function instructorIdsByEmail(emails: string[]): Promise<Types.ObjectId[]> {
  const { UserModel } = await import('@/models/schema.ts')
  const list = [...new Set(emails.map(e => e.trim().toLowerCase()).filter(e => e.includes('@')))].slice(0, 500)
  if (!list.length) return []
  const people = await UserModel.find({ email: { $in: list.map(e => new RegExp(`^\\s*${esc(e)}\\s*$`, 'i')) } }, { _id: 1 }).lean() as { _id: Types.ObjectId }[]
  return people.map(p => p._id)
}
