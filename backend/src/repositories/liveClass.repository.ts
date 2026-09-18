import { Types } from 'mongoose'
import { andFilter, servedClassFilter } from '@/utils/tenancy.ts'
import { BaseRepository } from './base.repository.ts'
import { LiveClassModel, type ILiveClass } from '@/models/schema.ts'
import { resolveLiveStatus, LIVE_LEAD_MS } from '@/utils/liveStatus.ts'

export class LiveClassRepository extends BaseRepository<ILiveClass> {
  constructor() {
    super(LiveClassModel)
  }

  async listForCourse(courseId: string | Types.ObjectId): Promise<ILiveClass[]> {
    return LiveClassModel
      .find({ courseId })
      .sort({ scheduledStart: 1 })
      .populate('instructorId', 'name avatarUrl')
      .exec()
  }

  /* Upcoming sessions in a set of courses (used for "my upcoming" feed) */
  async listUpcomingForCourses(courseIds: Array<string | Types.ObjectId>, limit = 10): Promise<ILiveClass[]> {
    if (courseIds.length === 0) return []
    return LiveClassModel
      .find({
        courseId: { $in: courseIds },
        status:   { $in: ['scheduled', 'live'] },          // exclude ended/cancelled
        scheduledStart: { $gte: new Date(Date.now() - 60 * 60_000) }, // include sessions starting in the last hour
      })
      .sort({ scheduledStart: 1 })
      .limit(limit)
      .populate('courseId',     'title slug thumbnailUrl')
      .populate('instructorId', 'name avatarUrl')
      .exec()
  }

  /* All upcoming/live sessions across every course — no enrollment filter */
  async listAllUpcoming(limit = 50, courseIds?: string[], callerOrg?: string | null): Promise<ILiveClass[]> {
    const query: Record<string, unknown> = {
      status: { $in: ['scheduled', 'live'] },
      scheduledStart: { $gte: new Date(Date.now() - 60 * 60_000) },
    }
    if (courseIds && courseIds.length > 0) {
      query['courseId'] = { $in: courseIds.map(id => new Types.ObjectId(id)) }
    }

    /* THE BROWSE FEED HAD NO ACADEMY TERM AT ALL. Every other student-facing
       list is scoped; this one was not, so a student has always been able to
       see the OTHER academy's entire upcoming timetable here — titles,
       instructors and times for classes they can neither book nor join.

       Narrowed to classes that SERVE the caller: their own academy's, plus any
       shared class that names their academy as a guest cohort. A caller with no
       academy on record stays unscoped, which is tenancy rule 3b.

       Composed under $and via andFilter, never by assigning $or. That is not
       stylistic here: the status bucket above and the search arms elsewhere in
       this repository assign query.$or, and a second assignment silently
       deletes the first — the P-04 shape, and the symptom is a filter that
       quietly stops filtering. */
    andFilter(query, servedClassFilter(callerOrg, { includeUnowned: true }))
    return LiveClassModel
      .find(query)
      .sort({ scheduledStart: 1 })
      .limit(limit)
      .populate('courseId',     'title slug thumbnailUrl')
      .populate('instructorId', 'name avatarUrl')
      .exec()
  }

  /* Admin global list — all live classes across all courses.
   *
   * A 'scheduled' session is bucketed by the clock (see utils/liveStatus.ts):
   *   - LIVE    while within [start - 15m, start + durationMins]
   *   - ENDED   once past class end time
   *   - UPCOMING until 15 min before start
   * The returned `status` reflects this so tabs, counts, and badges all agree.
   * We do NOT mutate the DB, so internal (Mux) sessions can still be started
   * late or rescheduled. */
  async listAll(filter: {
    status?:         string
    limit?:          number
    courseIds?:      string[]
    organizationId?: string
    instructorId?:   string
  } = {}): Promise<ILiveClass[]> {
    const now      = Date.now()
    // Use a generous 12-hour lookback so any class up to 12h long is captured;
    // resolveLiveStatus filters per-doc using the actual durationMins.
    const liveFrom = new Date(now - 12 * 60 * 60_000)
    const liveTo   = new Date(now + LIVE_LEAD_MS)   // start ≤ this → live window opened (15 min ahead)
    const query: Record<string, unknown> = {}

    if (filter.courseIds && filter.courseIds.length > 0) {
      query['courseId'] = { $in: filter.courseIds.map(id => new Types.ObjectId(id)) }
    }
    if (filter.organizationId && Types.ObjectId.isValid(filter.organizationId)) {
      query['organizationId'] = new Types.ObjectId(filter.organizationId)
    }
    if (filter.instructorId && Types.ObjectId.isValid(filter.instructorId)) {
      query['instructorId'] = new Types.ObjectId(filter.instructorId)
    }

    if (filter.status && filter.status !== 'all') {
      if (filter.status === 'live') {
        query['$or'] = [
          { status: 'live' },
          { status: 'scheduled', scheduledStart: { $gte: liveFrom, $lte: liveTo } },
        ]
      } else if (filter.status === 'scheduled') {
        // "Upcoming" = scheduled and the live window hasn't opened yet
        query['status'] = 'scheduled'
        query['scheduledStart'] = { $gt: liveTo }
      } else if (filter.status === 'ended') {
        query['$or'] = [
          { status: 'ended' },
          { status: 'scheduled', scheduledStart: { $lt: liveFrom } },
        ]
      } else {
        query['status'] = filter.status   // 'cancelled'
      }
    }

    /* The bound exists only to keep a runaway collection from flattening the
       process — it must stay far above any realistic class count. At 100 it
       silently swallowed real data: the sort is farthest-future-first, so
       once weekly-repeat series pushed the collection past 100 docs, the
       NEAREST sessions (this week's classes) fell off the response and the
       admin UI showed them as vanished while students could still book them. */
    const docs = await LiveClassModel
      .find(query)
      .sort({ scheduledStart: -1 })   // newest first
      .limit(filter.limit ?? 1000)
      .populate('courseId',     'title slug thumbnailUrl')
      .populate('instructorId', 'name avatarUrl')
      .exec()

    // Reflect the effective (clock-based) status. Not persisted.
    for (const d of docs) {
      d.status = resolveLiveStatus(d.status, d.scheduledStart, d.durationMins, now) as ILiveClass['status']
    }
    return docs
  }

  async createOne(data: Partial<ILiveClass>): Promise<ILiveClass> {
    const created = await LiveClassModel.create(data)
    return (await this.findByIdPopulated(created.id)) as ILiveClass
  }

  async findByIdPopulated(id: string): Promise<ILiveClass | null> {
    return LiveClassModel
      .findById(id)
      .populate('courseId',     'title slug thumbnailUrl')
      .populate('instructorId', 'name avatarUrl')
      .exec()
  }

  async updateByIdPopulated(id: string, data: Partial<ILiveClass>): Promise<ILiveClass | null> {
    return LiveClassModel
      .findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true })
      .populate('courseId',     'title slug thumbnailUrl')
      .populate('instructorId', 'name avatarUrl')
      .exec()
  }
}
