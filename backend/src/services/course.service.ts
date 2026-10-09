import { Types } from 'mongoose'
import { CourseRepository, type CourseListParams } from '@/repositories/course.repository.ts'
import { ReviewModel, type ICourse, type ISection, type ILesson } from '@/models/schema.ts'
import { AIService } from '@/services/ai.service.ts'
import { logger } from '@/utils/logger.ts'

/* ─── Domain error ──────────────────────────────────── */
export class CourseError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'CourseError'
  }
}

/* ─── Service ───────────────────────────────────────── */
export class CourseService {
  private readonly repo   = new CourseRepository()
  private readonly aiSvc  = new AIService()

  /* ── 7.7 Auto-tag helper ────────────────────────────
     Fire-and-forget: generate AI tags and merge with any
     user-supplied ones. Never throws — LLM errors are
     logged and ignored so course creation still succeeds.
  ─────────────────────────────────────────────────── */
  private async mergeAutoTags(
    title:       string,
    description: string | undefined,
    manualTags:  string[] | undefined,
  ): Promise<string[]> {
    const manual = manualTags ?? []
    try {
      const aiTags = await this.aiSvc.autoTag(title, description)
      // de-duplicate, manual tags take priority (appear first)
      const merged = [...manual]
      for (const t of aiTags) {
        if (!merged.some(m => m.toLowerCase() === t.toLowerCase())) {
          merged.push(t)
        }
      }
      return merged.slice(0, 15)
    } catch (err) {
      logger.warn({ err }, '7.7 autoTag failed — using manual tags only')
      return manual
    }
  }

  async listPublished(params: CourseListParams) {
    return this.repo.listPublished(params)
  }

  async getBySlug(slug: string): Promise<{
    course:   ICourse
    sections: ISection[]
    lessons:  ILesson[]
  }> {
    const course = await this.repo.findBySlug(slug)
    if (!course || course.status !== 'published') {
      throw new CourseError('COURSE_NOT_FOUND', 'Course not found.', 404)
    }
    const { sections, lessons } = await this.repo.getOutline(course.id)
    return { course, sections, lessons }
  }

  /* Public lookup by MongoDB ObjectId — returns the same shape as
     getBySlug. Used for legacy / admin-style links that have an id
     instead of a slug. Still gated to published courses for the
     public catalogue. */
  async getByIdPublic(id: string): Promise<{
    course:   ICourse
    sections: ISection[]
    lessons:  ILesson[]
  }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new CourseError('INVALID_ID', 'Invalid course id', 400)
    }
    const course = await this.repo.findById_(id)
    if (!course || course.status !== 'published') {
      throw new CourseError('COURSE_NOT_FOUND', 'Course not found.', 404)
    }
    const { sections, lessons } = await this.repo.getOutline(course.id)
    return { course, sections, lessons }
  }

  async getRatingHistogram(slug: string): Promise<{
    histogram: Record<1|2|3|4|5, number>
    total:     number
    avg:       number
  }> {
    const course = await this.repo.findBySlug(slug)
    if (!course) {
      throw new CourseError('COURSE_NOT_FOUND', 'Course not found.', 404)
    }
    const rows = await ReviewModel.aggregate([
      { $match: { courseId: new Types.ObjectId(course.id) } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]).exec()

    const histogram = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1|2|3|4|5, number>
    for (const r of rows) {
      const k = Number(r._id)
      if (k >= 1 && k <= 5) histogram[k as 1|2|3|4|5] = r.count
    }
    const total = Object.values(histogram).reduce((a, b) => a + b, 0)
    return { histogram, total, avg: course.ratingAvg ?? 0 }
  }

  /* ─── Admin ─────────────────────────────────────── */

  async listAdmin(params: CourseListParams & { status?: 'draft' | 'published' | 'archived' | 'all'; organizationId?: string }) {
    return this.repo.listAdmin(params)
  }

  async getById(id: string): Promise<ICourse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new CourseError('INVALID_ID', 'Invalid course id', 400)
    }
    const course = await this.repo.findById_(id)
    if (!course) throw new CourseError('COURSE_NOT_FOUND', 'Course not found.', 404)
    return course
  }

  async create(input: {
    title:           string
    slug:            string
    description?:    string
    thumbnailUrl?:   string
    previewUrl?:     string
    price:           number
    priceAED?:       number
    priceINR?:       number
    isFree:          boolean
    status:          'draft' | 'published' | 'archived'
    level?:          'beginner' | 'intermediate' | 'advanced'
    language:        string
    tags?:           string[]
    instructorId:    string
    categoryId?:     string
    program?:        '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
    organizationId?: string
    sharedAcademies?: boolean
  }): Promise<ICourse> {
    if (await this.repo.slugExists(input.slug)) {
      throw new CourseError('SLUG_TAKEN', 'Another course already uses this slug.', 409)
    }
    /* 7.7 — merge AI-generated tags with any the user supplied */
    const tags = await this.mergeAutoTags(input.title, input.description, input.tags)
    const payload: Partial<ICourse> = {
      title:        input.title.trim(),
      slug:         input.slug.toLowerCase().trim(),
      description:  input.description,
      thumbnailUrl: input.thumbnailUrl || undefined,
      previewUrl:   input.previewUrl   || undefined,
      price:        input.isFree ? 0 : input.price,
      /* Undefined stays undefined so the gateway falls back to its conversion
         rate, which is what every existing course does today (B-01). */
      priceAED:     input.isFree ? undefined : input.priceAED,
      priceINR:     input.isFree ? undefined : input.priceINR,
      isFree:       input.isFree,
      status:       input.status,
      level:        input.level,
      language:     input.language,
      tags,
      instructorId: new Types.ObjectId(input.instructorId) as unknown as ICourse['instructorId'],
    }
    if (input.categoryId) {
      payload.categoryId = new Types.ObjectId(input.categoryId) as unknown as ICourse['categoryId']
    }
    if (input.program) payload.program = input.program
    if (input.organizationId && Types.ObjectId.isValid(input.organizationId)) {
      ;(payload as any).organizationId = new Types.ObjectId(input.organizationId)
    }
    if (input.sharedAcademies !== undefined) payload.sharedAcademies = input.sharedAcademies
    return this.repo.createOne(payload)
  }

  async update(
    id: string,
    input: Partial<{
      title:        string
      slug:         string
      description:  string
      thumbnailUrl: string
      previewUrl:   string
      price:        number
      priceAED:     number
      priceINR:     number
      isFree:       boolean
      status:       'draft' | 'published' | 'archived'
      level:        'beginner' | 'intermediate' | 'advanced' | ''
      language:     string
      tags:         string[]
      categoryId:   string
      instructorId: string
      program:      '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | ''
      sharedAcademies: boolean
    }>,
  ): Promise<ICourse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new CourseError('INVALID_ID', 'Invalid course id', 400)
    }
    const existing = await this.repo.findById(id)
    if (!existing) throw new CourseError('COURSE_NOT_FOUND', 'Course not found.', 404)

    if (input.slug && input.slug !== existing.slug) {
      if (await this.repo.slugExists(input.slug, id)) {
        throw new CourseError('SLUG_TAKEN', 'Another course already uses this slug.', 409)
      }
    }

    const update: Partial<ICourse> = {}
    if (input.title        !== undefined) update.title        = input.title.trim()
    if (input.slug         !== undefined) update.slug         = input.slug.toLowerCase().trim()
    if (input.description  !== undefined) update.description  = input.description
    if (input.thumbnailUrl !== undefined) update.thumbnailUrl = input.thumbnailUrl || undefined
    if (input.previewUrl   !== undefined) update.previewUrl   = input.previewUrl   || undefined
    if (input.isFree       !== undefined) update.isFree       = input.isFree
    if (input.price        !== undefined) update.price        = input.isFree ? 0 : input.price
    /* B-01 — these were accepted by the API and dropped by the schema, so
       every AED and INR order fell back to a conversion rate no matter what an
       admin entered. Left undefined they still fall back, which is what every
       existing course does; set, they are what the gateway charges. */
    if (input.isFree === true) {
      /* Clearing has to be unconditional, not gated on the override being in
         the body: "make this course free" usually arrives as {isFree, price}
         alone, and a stale INR override left behind is a price on a course
         that is supposed to cost nothing. */
      update.priceAED = undefined
      update.priceINR = undefined
    } else {
      if (input.priceAED   !== undefined) update.priceAED     = input.priceAED
      if (input.priceINR   !== undefined) update.priceINR     = input.priceINR
    }
    if (input.status       !== undefined) update.status       = input.status
    if (input.sharedAcademies !== undefined) update.sharedAcademies = input.sharedAcademies
    if (input.level !== undefined) {
      update.level = input.level === '' ? undefined : input.level
    }
    if (input.language     !== undefined) update.language     = input.language
    /* 7.7 — re-run auto-tag when title/description/tags change */
    if (input.tags !== undefined || input.title !== undefined || input.description !== undefined) {
      update.tags = await this.mergeAutoTags(
        update.title ?? existing.title,
        update.description ?? existing.description,
        input.tags,
      )
    }
    if (input.categoryId   !== undefined) {
      update.categoryId = input.categoryId
        ? (new Types.ObjectId(input.categoryId) as unknown as ICourse['categoryId'])
        : undefined
    }
    if (input.instructorId !== undefined) {
      update.instructorId = new Types.ObjectId(input.instructorId) as unknown as ICourse['instructorId']
    }
    if (input.program !== undefined) {
      update.program = input.program === '' ? undefined : input.program
    }

    const updated = await this.repo.updateOne_(id, update)
    if (!updated) throw new CourseError('COURSE_NOT_FOUND', 'Course not found.', 404)
    return updated
  }

  /* ── 7.5 Recommendations ────────────────────────── */
  async getRecommendations(slug: string, limit = 6): Promise<ICourse[]> {
    const course = await this.repo.findBySlug(slug)
    if (!course || course.status !== 'published') {
      throw new CourseError('COURSE_NOT_FOUND', 'Course not found.', 404)
    }
    const categoryId = course.categoryId
      ? (course.categoryId as unknown as { _id: Types.ObjectId })?._id ?? (course.categoryId as unknown as Types.ObjectId)
      : undefined
    return this.repo.findSimilar(
      course.id,
      categoryId instanceof Types.ObjectId ? categoryId : undefined,
      course.tags ?? [],
      course.level,
      limit,
    )
  }

  async delete(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new CourseError('INVALID_ID', 'Invalid course id', 400)
    }
    const ok = await this.repo.hardDelete(id)
    if (!ok) throw new CourseError('COURSE_NOT_FOUND', 'Course not found.', 404)
  }
}
