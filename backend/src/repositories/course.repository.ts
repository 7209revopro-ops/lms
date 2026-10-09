import { Types } from 'mongoose'
import { BaseRepository } from './base.repository.ts'
import {
  CourseModel, SectionModel, LessonModel,
  type ICourse, type ISection, type ILesson,
} from '@/models/schema.ts'

export interface CourseListParams {
  page:            number
  perPage:         number
  search?:         string
  /** 'text' (default) uses Mongo $text index — whole-word, relevance-ranked.
   *  'prefix' uses $regex — supports partial strings, ideal for typeahead. */
  searchMode?:     'text' | 'prefix'
  level?:          'beginner' | 'intermediate' | 'advanced'
  category?:       string   // category slug
  program?:        string
  free?:           boolean
  instructorId?:   string
  organizationId?: string
  durationMin?:    number
  durationMax?:    number
  priceMin?:       number
  priceMax?:       number
  /* Accepts named presets ("popular" / "rating" / "newest" / "price_lo" / "price_hi")
     OR `${field}:${direction}` for column sorts coming from admin tables. */
  sort?:           string
}

/** Upper bound on a free-text search term before it reaches $regex. */
const MAX_SEARCH_LEN = 100

/* ─── Sort resolver ────────────────────────────────
   Converts either a named preset or a "key:dir" pair
   into a Mongoose sort spec. Unknown keys fall back to
   the supplied default. */
const ALLOWED_SORT_FIELDS = new Set([
  'title', 'enrolledCount', 'ratingAvg', 'ratingCount',
  'price', 'createdAt', 'updatedAt', 'durationMins',
])
const PRESETS: Record<string, Record<string, 1 | -1>> = {
  popular:  { enrolledCount: -1 },
  rating:   { ratingAvg: -1 },
  newest:   { createdAt: -1 },
  price_lo: { price: 1 },
  price_hi: { price: -1 },
}
function resolveSort(sort: string | undefined, fallback: keyof typeof PRESETS = 'newest'): Record<string, 1 | -1> {
  if (!sort) return PRESETS[fallback]!
  if (PRESETS[sort]) return PRESETS[sort]
  const [field, dir] = sort.split(':')
  if (field && ALLOWED_SORT_FIELDS.has(field)) {
    return { [field]: dir === 'asc' ? 1 : -1 }
  }
  return PRESETS[fallback]!
}

export class CourseRepository extends BaseRepository<ICourse> {
  constructor() {
    super(CourseModel)
  }

  async listPublished(params: CourseListParams): Promise<{ docs: ICourse[]; totalCount: number }> {
    const filter: Record<string, unknown> = { status: 'published' }

    /* Search modes:
       'text'   (default) — Mongo $text index, whole-word/stemmed, relevance-ranked.
       'prefix' — $regex, case-insensitive, supports partial strings (typeahead). */
    if (params.search) {
      if (params.searchMode === 'prefix') {
        const escaped = params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        filter['$or'] = [
          { title:       { $regex: escaped, $options: 'i' } },
          { description: { $regex: escaped, $options: 'i' } },
          { tags:        { $regex: escaped, $options: 'i' } },
        ]
      } else {
        filter['$text'] = { $search: params.search }
      }
    }
    if (params.level)    filter['level']  = params.level
    if (params.free)     filter['isFree'] = true

    /* Instructor filter (id, optional) */
    if (params.instructorId && Types.ObjectId.isValid(params.instructorId)) {
      filter['instructorId'] = new Types.ObjectId(params.instructorId)
    }

    /* Duration range (mins) */
    if (params.durationMin !== undefined || params.durationMax !== undefined) {
      const d: Record<string, number> = {}
      if (params.durationMin !== undefined) d['$gte'] = params.durationMin
      if (params.durationMax !== undefined) d['$lte'] = params.durationMax
      filter['durationMins'] = d
    }

    /* Price range */
    if (params.priceMin !== undefined || params.priceMax !== undefined) {
      const p: Record<string, number> = {}
      if (params.priceMin !== undefined) p['$gte'] = params.priceMin
      if (params.priceMax !== undefined) p['$lte'] = params.priceMax
      filter['price'] = p
    }

    if (params.category && params.category !== 'all') {
      const cat = await CourseModel.db
        .collection('categories')
        .findOne({ slug: params.category.toLowerCase() })
      if (cat) filter['categoryId'] = cat['_id']
      else return { docs: [], totalCount: 0 }
    }

    if (params.program) filter['program'] = params.program

    /* The academy's own courses, plus any course shared by both academies. */
    if (params.organizationId && Types.ObjectId.isValid(params.organizationId)) {
      filter['$and'] = [...((filter['$and'] as unknown[]) ?? []), {
        $or: [{ organizationId: new Types.ObjectId(params.organizationId) }, { sharedAcademies: true }],
      }]
    }

    /* When using $text and no explicit sort, rank by relevance score.
       For prefix ($regex) searches, fall back to popularity (enrolledCount). */
    const useTextScore = !!params.search && params.searchMode !== 'prefix' && !params.sort
    const query = CourseModel.find(filter)
    if (useTextScore) query.select({ score: { $meta: 'textScore' } })

    const sort = useTextScore
      ? ({ score: { $meta: 'textScore' } } as unknown as Record<string, 1 | -1>)
      : resolveSort(params.sort, 'popular')

    const [docs, totalCount] = await Promise.all([
      query
        .sort(sort)
        .skip((params.page - 1) * params.perPage)
        .limit(params.perPage)
        .populate('instructorId', 'name avatarUrl')
        .populate('categoryId',   'name slug')
        .exec(),
      CourseModel.countDocuments(filter).exec(),
    ])

    return { docs, totalCount }
  }

  async findBySlug(slug: string): Promise<ICourse | null> {
    return CourseModel
      .findOne({ slug })
      .populate('instructorId', 'name avatarUrl headline bio')
      .populate('categoryId',   'name slug')
      .exec()
  }

  async getOutline(courseId: string | Types.ObjectId): Promise<{
    sections: ISection[]
    lessons:  ILesson[]
  }> {
    const [sections, lessons] = await Promise.all([
      SectionModel.find({ courseId }).sort({ order: 1 }).exec(),
      LessonModel
        .find({ courseId })
        .sort({ order: 1 })
        .select('sectionId courseId title type durationMins order isFree contentUrl contentBody')
        .exec(),
    ])
    return { sections, lessons }
  }

  async incrementEnrollment(courseId: string | Types.ObjectId, delta = 1): Promise<void> {
    await CourseModel.updateOne({ _id: courseId }, { $inc: { enrolledCount: delta } }).exec()
  }

  /* ─── Admin-only list — any status ─────────────────
     Same shape as listPublished but the status filter
     comes from the caller rather than being hardcoded.
  ───────────────────────────────────────────────────── */
  async listAdmin(params: CourseListParams & { status?: 'draft' | 'published' | 'archived' | 'all' }): Promise<{ docs: ICourse[]; totalCount: number }> {
    const filter: Record<string, unknown> = {}

    if (params.status && params.status !== 'all') filter['status'] = params.status

    if (params.search) {
      const escaped = params.search.slice(0, MAX_SEARCH_LEN).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filter['$or'] = [
        { title:       { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
      ]
    }
    if (params.level) filter['level']  = params.level
    if (params.free)  filter['isFree'] = true

    /* Instructor scoping — instructor admins only see their own courses. */
    if (params.instructorId && Types.ObjectId.isValid(params.instructorId)) {
      filter['instructorId'] = new Types.ObjectId(params.instructorId)
    }

    if (params.category && params.category !== 'all') {
      const cat = await CourseModel.db.collection('categories').findOne({ slug: params.category.toLowerCase() })
      if (cat) filter['categoryId'] = cat['_id']
      else return { docs: [], totalCount: 0 }
    }

    if (params.program) filter['program'] = params.program

    /* The academy's own courses, plus any course shared by both academies. */
    if (params.organizationId && Types.ObjectId.isValid(params.organizationId)) {
      filter['$and'] = [...((filter['$and'] as unknown[]) ?? []), {
        $or: [{ organizationId: new Types.ObjectId(params.organizationId) }, { sharedAcademies: true }],
      }]
    }

    const sort = resolveSort(params.sort)

    const [docs, totalCount] = await Promise.all([
      CourseModel
        .find(filter)
        .sort(sort)
        .skip((params.page - 1) * params.perPage)
        .limit(params.perPage)
        .populate('instructorId', 'name avatarUrl')
        .populate('categoryId',   'name slug')
        .exec(),
      CourseModel.countDocuments(filter).exec(),
    ])

    await this.attachTrueEnrolledCounts(docs)
    return { docs, totalCount }
  }

  /* ─── The student count the ADMIN table shows ───────────────────────────
     `enrolledCount` on the course is a denormalised counter, and it is only
     maintained on two of the paths that create an enrolment (self-enrol and
     purchase). Admin enrolments, the bulk-import scripts and every deletion
     path leave it untouched, so it drifts up and never comes back down —
     locally 18 of 19 courses disagreed with reality, and the seeded ones
     carry `Math.random() * 3000` from scripts/seed.ts.

     For an admin page of ~20 rows the honest number is cheap: one grouped
     count over the enrolments for exactly the courses being shown. That
     cannot drift, because nothing is being remembered.

     Deliberately scoped to the admin list. The public catalogue still reads
     the stored field, which it sorts by ("popular"), and sorting a whole
     collection on a derived value is a different problem — see the
     backfill script for keeping that field honest.
  ─────────────────────────────────────────────────────────────────────── */
  private async attachTrueEnrolledCounts(docs: ICourse[]): Promise<void> {
    if (!docs.length) return

    const ids = docs.map(d => d._id)
    const rows = await CourseModel.db.collection('enrollments').aggregate<{
      _id: Types.ObjectId; n: number
    }>([
      { $match: { courseId: { $in: ids } } },
      { $group: { _id: '$courseId', n: { $sum: 1 } } },
    ]).toArray()

    const byCourse = new Map(rows.map(r => [String(r._id), r.n]))
    for (const doc of docs) {
      /* set() rather than assignment so the value survives toJSON/DTO. These
         documents are read-only on this path — nothing saves them — so the
         overwrite never reaches the database. */
      doc.set('enrolledCount', byCourse.get(String(doc._id)) ?? 0)
    }
  }

  async findById_(id: string | Types.ObjectId): Promise<ICourse | null> {
    const course = await CourseModel
      .findById(id)
      .populate('instructorId', 'name avatarUrl headline')
      .populate('categoryId',   'name slug')
      .exec()

    /* Derive the student count here too, exactly as the list does.
       The list already showed the truth while this path returned the stored
       counter, so one course reported two different numbers depending on which
       screen you were looking at — 8 in the table, 21 on its own detail page.
       Sharing the helper is what stops them drifting apart again. */
    if (course) await this.attachTrueEnrolledCounts([course])
    return course
  }

  async createOne(data: Partial<ICourse>): Promise<ICourse> {
    return CourseModel.create(data)
  }

  /* A key set to `undefined` means CLEAR THIS FIELD, and it has to be split
     out into $unset to actually do that: Mongoose strips undefined values from
     $set, so `{ $set: { priceINR: undefined } }` is a silent no-op. The
     service layer already wrote `= undefined` in five places — priceAED,
     priceINR, level, categoryId and program — on the assumption it cleared
     them, so clearing a course's level or per-currency price never took
     effect. Found while fixing B-01; the same line fixes all five. */
  async updateOne_(id: string, data: Partial<ICourse>): Promise<ICourse | null> {
    const $set: Record<string, unknown> = {}
    const $unset: Record<string, ''>    = {}
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) $unset[key] = ''
      else $set[key] = value
    }
    const update: Record<string, unknown> = {}
    if (Object.keys($set).length   > 0) update['$set']   = $set
    if (Object.keys($unset).length > 0) update['$unset'] = $unset

    return CourseModel
      .findByIdAndUpdate(id, update, { new: true, runValidators: true })
      .populate('instructorId', 'name avatarUrl')
      .populate('categoryId',   'name slug')
      .exec()
  }

  async slugExists(slug: string, excludeId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { slug: slug.toLowerCase() }
    if (excludeId) filter['_id'] = { $ne: excludeId }
    return this.exists(filter)
  }

  /* ── 7.5 Recommendations ───────────────────────────
     Find published courses similar to the given one.
     Scoring (descending priority):
       1. Same category  (+3)
       2. Each overlapping tag (+1)
       3. Same level (+1)
     Returns up to `limit` docs ordered by score desc,
     excluding the source course itself.
  ─────────────────────────────────────────────────── */
  async findSimilar(
    excludeId:  string | Types.ObjectId,
    categoryId: Types.ObjectId | undefined,
    tags:       string[],
    level:      string | undefined,
    limit = 6,
  ): Promise<ICourse[]> {
    const or: Record<string, unknown>[] = []
    if (categoryId) or.push({ categoryId })
    if (tags.length > 0) or.push({ tags: { $in: tags } })
    if (level)      or.push({ level })

    if (or.length === 0) {
      /* No signals at all — return newest published courses */
      return CourseModel
        .find({ status: 'published', _id: { $ne: excludeId } })
        .sort({ enrolledCount: -1 })
        .limit(limit)
        .populate('instructorId', 'name avatarUrl')
        .populate('categoryId',   'name slug')
        .exec()
    }

    const candidates = await CourseModel
      .find({
        status: 'published',
        _id:    { $ne: excludeId },
        $or:    or,
      })
      .limit(50) // score within a small candidate set
      .populate('instructorId', 'name avatarUrl')
      .populate('categoryId',   'name slug')
      .exec()

    /* Client-side scoring */
    const tagSet = new Set(tags.map(t => t.toLowerCase()))
    const scored = candidates.map(c => {
      let score = 0
      if (categoryId && String((c.categoryId as unknown as { _id: unknown })?._id ?? c.categoryId) === String(categoryId)) {
        score += 3
      }
      for (const t of (c.tags ?? [])) {
        if (tagSet.has(t.toLowerCase())) score++
      }
      if (level && c.level === level) score++
      return { c, score }
    })

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.c)
  }

  async recomputeRating(courseId: string | Types.ObjectId): Promise<void> {
    const result = await CourseModel.db
      .collection('reviews')
      .aggregate([
        { $match: { courseId: new Types.ObjectId(String(courseId)) } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
      .toArray()
    const avg   = result[0]?.['avg']   ?? 0
    const count = result[0]?.['count'] ?? 0
    await CourseModel.updateOne(
      { _id: courseId },
      { $set: { ratingAvg: Math.round(avg * 10) / 10, ratingCount: count } },
    ).exec()
  }
}
