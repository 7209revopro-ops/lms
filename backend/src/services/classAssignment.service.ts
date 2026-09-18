import { Types } from 'mongoose'
import {
  ClassAssignmentModel, ClassBookingModel, LiveClassModel, UserModel,
  type IClassAssignment, type IClassAssignmentFile,
} from '@/models/schema.ts'
import { NotificationService } from '@/services/notification.service.ts'
import { logger } from '@/utils/logger.ts'

export class ClassAssignmentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'ClassAssignmentError'
  }
}

const MAX_FILES = 10
const notifications = new NotificationService()

/** Roles that may review anyone's submission within their own reach. */
const STAFF = new Set(['super_admin', 'admin', 'sub_admin', 'support'])

const EMPTY_TOTALS   = { total: 0, pending: 0, approved: 0, rejected: 0 }
const EMPTY_RESPONSE = { medianResponseHours: null, oldestPendingHours: null, pendingOver48h: 0 }

export interface Caller {
  id:             string
  role:           string
  organizationId?: string
}

export class ClassAssignmentService {

  /* ── What a student may submit against ──────────────────────────────────
     Only sessions they actually booked. This is the entitlement gate AND the
     source the form fills itself from: pick the class, and the course, module
     and instructor come with it. A student cannot invent a combination. */
  async submittableSessions(studentId: string): Promise<unknown[]> {
    if (!Types.ObjectId.isValid(studentId)) return []
    const bookings = await ClassBookingModel
      .find({ userId: studentId, status: { $in: ['booked', 'attended'] } })
      .select('liveClassId')
      .lean()
    if (bookings.length === 0) return []

    return LiveClassModel
      .find({ _id: { $in: bookings.map(b => b.liveClassId) }, status: { $ne: 'cancelled' } })
      .select('title scheduledStart courseId sectionId instructorId')
      .populate('courseId', 'title slug')
      .populate('sectionId', 'title')
      .populate('instructorId', 'name')
      .sort({ scheduledStart: -1 })
      .lean()
  }

  /* ── Submit ───────────────────────────────────────────────────────────── */
  async submit(caller: Caller, input: {
    liveClassId: string
    title:       string
    note?:       string
    files:       IClassAssignmentFile[]
  }): Promise<IClassAssignment> {
    if (!Types.ObjectId.isValid(input.liveClassId)) {
      throw new ClassAssignmentError('INVALID_ID', 'Invalid class id.', 400)
    }
    if (input.files.length === 0) {
      throw new ClassAssignmentError('NO_FILES', 'Attach at least one photo or file.', 400)
    }
    if (input.files.length > MAX_FILES) {
      throw new ClassAssignmentError('TOO_MANY_FILES', `Attach at most ${MAX_FILES} files.`, 400)
    }

    /* Entitlement: the session must be one this student booked. Checked
       against the booking, not the enrolment — attending is what earns the
       right to submit, and it is also what makes the instructor the right
       recipient. */
    const booking = await ClassBookingModel.findOne({
      userId:      caller.id,
      liveClassId: input.liveClassId,
      status:      { $in: ['booked', 'attended'] },
    }).select('seatOrganizationId seatCourseId seatSectionId').lean() as {
      seatOrganizationId?: unknown; seatCourseId?: unknown; seatSectionId?: unknown
    } | null
    if (!booking) {
      throw new ClassAssignmentError('NOT_BOOKED', 'You can only submit work for a class you booked.', 403)
    }

    const session = await LiveClassModel.findById(input.liveClassId)
      .select('title courseId sectionId instructorId organizationId')
      .lean()
    if (!session) throw new ClassAssignmentError('CLASS_NOT_FOUND', 'Class not found.', 404)

    /* One open submission per session. A rejected one is reopened by
       resubmit(); an approved one is finished. This is what stops a student
       flooding the instructor's queue with the same work. */
    const existing = await ClassAssignmentModel.findOne({
      studentId: caller.id, liveClassId: input.liveClassId,
    }).lean()
    if (existing) {
      throw new ClassAssignmentError(
        'ALREADY_SUBMITTED',
        existing.status === 'rejected'
          ? 'You already have a submission for this class — send a revision instead.'
          : 'You have already submitted work for this class.',
        409,
      )
    }

    /* FILED AGAINST THE DOOR THE STUDENT CAME THROUGH, not the class's own.

       These three were copied from the session. On a class shared with another
       academy that files a guest student's submitted work — title, note and
       uploaded files — into the HOST academy's review queue, against the host's
       course, invisible to the staff who actually teach them. And
       ClassAssignment.courseId is required, so it is not a field anyone can
       leave empty and fix later.

       The seat stamp carries the answer. Absent, it falls back to the session's
       own values, which is every submission that exists today — so the output
       is byte-identical for any class that is not shared. */
    const created = await ClassAssignmentModel.create({
      studentId:      caller.id,
      liveClassId:    input.liveClassId,
      courseId:       booking.seatCourseId       ?? session.courseId,
      sectionId:      booking.seatSectionId      ?? session.sectionId,
      instructorId:   session.instructorId,
      organizationId: booking.seatOrganizationId ?? session.organizationId,
      title:          input.title.trim(),
      note:           input.note?.trim(),
      files:          input.files,
      status:         'pending',
      attempt:        1,
      submittedAt:    new Date(),
    })

    void this.#tellInstructor(created, session.title, false)
    return created
  }

  /* ── Resubmit after a rejection ───────────────────────────────────────── */
  async resubmit(caller: Caller, id: string, input: {
    note?:  string
    files:  IClassAssignmentFile[]
  }): Promise<IClassAssignment> {
    const doc = await this.#ownedByStudent(caller, id)
    if (doc.status !== 'rejected') {
      throw new ClassAssignmentError(
        'NOT_REJECTED',
        doc.status === 'approved'
          ? 'This submission was approved — there is nothing to revise.'
          : 'This submission is still awaiting review.',
        409,
      )
    }
    if (input.files.length === 0) {
      throw new ClassAssignmentError('NO_FILES', 'Attach at least one photo or file.', 400)
    }
    if (input.files.length > MAX_FILES) {
      throw new ClassAssignmentError('TOO_MANY_FILES', `Attach at most ${MAX_FILES} files.`, 400)
    }

    doc.files       = input.files
    doc.note        = input.note?.trim()
    doc.status      = 'pending'
    doc.attempt     = doc.attempt + 1
    doc.submittedAt = new Date()
    doc.reviewedAt  = undefined
    /* lastReason and reviews are kept deliberately: the instructor should see
       what they sent back last time while judging the revision. */
    await doc.save()

    const session = await LiveClassModel.findById(doc.liveClassId).select('title').lean()
    void this.#tellInstructor(doc, session?.title ?? 'your class', true)
    return doc
  }

  /* ── The student's own list ───────────────────────────────────────────── */
  async listMine(studentId: string): Promise<unknown[]> {
    return ClassAssignmentModel.find({ studentId })
      .populate('liveClassId', 'title scheduledStart')
      .populate('courseId', 'title slug')
      .populate('sectionId', 'title')
      .populate('instructorId', 'name')
      .sort({ submittedAt: -1 })
      .lean()
  }

  /* ── The reviewer's queue ─────────────────────────────────────────────
     An instructor sees submissions for sessions they teach — nobody else's.
     Staff see their own academy. super_admin sees everything, matching every
     other guard in the codebase. */
  /* Who this caller is allowed to see, expressed as a filter.

     Extracted because the queue and the dashboard MUST agree: a count that
     includes submissions the same admin cannot open in the list below it is
     worse than no count at all. One function, both callers. */
  #reach(caller: Caller): Record<string, unknown> {
    if (caller.role === 'instructor') {
      return { instructorId: new Types.ObjectId(caller.id) }
    }
    if (!STAFF.has(caller.role)) {
      throw new ClassAssignmentError('FORBIDDEN', 'You cannot review submissions.', 403)
    }
    /* A super_admin carries no organizationId unless the topbar switcher
       supplies one — and then they are scoped like anybody else. */
    if (caller.role !== 'super_admin' && caller.organizationId && Types.ObjectId.isValid(caller.organizationId)) {
      return { organizationId: new Types.ObjectId(caller.organizationId) }
    }
    return {}
  }

  /* Narrowing to one instructor must never WIDEN reach. An instructor's own
     id is already the only value their own scope permits, so naming somebody
     else intersects to nothing rather than leaking a row. Returns null when
     the request is for someone the caller cannot see. */
  #narrowToInstructor(
    reach: Record<string, unknown>,
    instructorId?: string,
  ): Record<string, unknown> | null {
    if (!instructorId || !Types.ObjectId.isValid(instructorId)) return reach
    const asked = new Types.ObjectId(instructorId)
    const own   = reach['instructorId'] as Types.ObjectId | undefined
    if (own && !own.equals(asked)) return null
    return { ...reach, instructorId: asked }
  }

  async listForReview(caller: Caller, status?: string, instructorId?: string): Promise<unknown[]> {
    const scoped = this.#narrowToInstructor(this.#reach(caller), instructorId)
    if (!scoped) return []

    const filter: Record<string, unknown> = { ...scoped }
    if (status && ['pending', 'approved', 'rejected'].includes(status)) filter['status'] = status

    return ClassAssignmentModel.find(filter)
      .populate('studentId', 'name email avatarUrl')
      .populate('instructorId', 'name email avatarUrl')
      .populate('liveClassId', 'title scheduledStart')
      .populate('courseId', 'title slug')
      .populate('sectionId', 'title')
      .sort({ status: 1, submittedAt: -1 })
      .limit(200)
      .lean()
  }

  /* ── The review dashboard ───────────────────────────────────────────────
     Two questions an admin actually has: how much work is outstanding, and
     which instructors are keeping up with theirs.

     Response time is reported as a MEDIAN, not a mean. One submission left
     for three weeks drags a mean far enough to make a responsive instructor
     look negligent, and the number then stops being usable for the very
     comparison it exists for. A median says what a typical student waits.

     Every figure is derived from the rows themselves — nothing reads a stored
     counter, so nothing can drift out of agreement with the queue below it. */
  async reviewStats(caller: Caller, instructorId?: string): Promise<unknown> {
    const scoped = this.#narrowToInstructor(this.#reach(caller), instructorId)
    if (!scoped) {
      return { totals: EMPTY_TOTALS, responsiveness: EMPTY_RESPONSE, instructors: [] }
    }

    const rows = await ClassAssignmentModel.find(scoped, {
      instructorId: 1, status: 1, submittedAt: 1, reviewedAt: 1,
    }).lean()

    const now = Date.now()
    const hours = (ms: number) => Math.round((ms / 36e5) * 10) / 10

    interface Bucket {
      total: number; pending: number; approved: number; rejected: number
      waits: number[]; oldestPendingMs: number
    }
    const blank = (): Bucket => ({
      total: 0, pending: 0, approved: 0, rejected: 0, waits: [], oldestPendingMs: 0,
    })

    const overall = blank()
    const byInstructor = new Map<string, Bucket>()
    let pendingOver48h = 0

    for (const r of rows as any[]) {
      const key = String(r.instructorId ?? '')
      let b = byInstructor.get(key)
      if (!b) { b = blank(); byInstructor.set(key, b) }

      for (const t of [overall, b]) {
        t.total++
        if (r.status === 'pending')  t.pending++
        if (r.status === 'approved') t.approved++
        if (r.status === 'rejected') t.rejected++
      }

      const submitted = r.submittedAt ? new Date(r.submittedAt).getTime() : null
      if (submitted === null) continue

      if (r.status === 'pending') {
        const waited = now - submitted
        if (waited > overall.oldestPendingMs) overall.oldestPendingMs = waited
        if (waited > b.oldestPendingMs)       b.oldestPendingMs = waited
        if (waited > 48 * 36e5) pendingOver48h++
      } else if (r.reviewedAt) {
        /* Clamped at zero: clock skew between two writes should not produce a
           negative wait that then drags a median below zero. */
        overall.waits.push(Math.max(0, new Date(r.reviewedAt).getTime() - submitted))
        b.waits.push(Math.max(0, new Date(r.reviewedAt).getTime() - submitted))
      }
    }

    const median = (xs: number[]): number | null => {
      if (!xs.length) return null
      const a = [...xs].sort((x, y) => x - y)
      const mid = Math.floor(a.length / 2)
      return a.length % 2 ? a[mid]! : Math.round((a[mid - 1]! + a[mid]!) / 2)
    }

    /* Names in one lookup rather than a populate per row. */
    const ids = [...byInstructor.keys()].filter(k => Types.ObjectId.isValid(k))
    const people = await UserModel
      .find({ _id: { $in: ids.map(i => new Types.ObjectId(i)) } }, { name: 1, email: 1, avatarUrl: 1 })
      .lean()
    const byId = new Map(people.map(x => [String(x._id), x as any]))

    const instructors = [...byInstructor.entries()].map(([id, b]) => {
      const judged = b.approved + b.rejected
      const med    = median(b.waits)
      const person = byId.get(id)
      return {
        id,
        name:      person?.name  ?? 'Unknown instructor',
        email:     person?.email ?? '',
        avatarUrl: person?.avatarUrl,
        total: b.total, pending: b.pending, approved: b.approved, rejected: b.rejected,
        /* Null, not 0 — an instructor who has judged nothing has no rate, and
           printing 0% would read as "approves nothing", which is a different
           and much worse claim. */
        approvalRate:        judged ? Math.round((b.approved / judged) * 100) : null,
        medianResponseHours: med === null ? null : hours(med),
        oldestPendingHours:  b.pending ? hours(b.oldestPendingMs) : null,
      }
    })
    /* Most outstanding work first — that is the row an admin needs to act on. */
    instructors.sort((a, z) => z.pending - a.pending || z.total - a.total)

    const overallMed = median(overall.waits)
    return {
      totals: {
        total:    overall.total,
        pending:  overall.pending,
        approved: overall.approved,
        rejected: overall.rejected,
      },
      responsiveness: {
        medianResponseHours: overallMed === null ? null : hours(overallMed),
        oldestPendingHours:  overall.pending ? hours(overall.oldestPendingMs) : null,
        /* Two working days. The one number worth alarming on. */
        pendingOver48h,
      },
      instructors,
    }
  }

  /* ── Approve / reject ─────────────────────────────────────────────────── */
  async review(caller: Caller, id: string, decision: 'approved' | 'rejected', reason?: string): Promise<IClassAssignment> {
    if (decision === 'rejected' && !reason?.trim()) {
      throw new ClassAssignmentError('REASON_REQUIRED', 'Give a reason so the student knows what to change.', 400)
    }
    const doc = await this.#reviewable(caller, id)
    if (doc.status !== 'pending') {
      throw new ClassAssignmentError('ALREADY_REVIEWED', `This submission was already ${doc.status}.`, 409)
    }

    doc.status     = decision
    doc.reviewedAt = new Date()
    doc.lastReason = decision === 'rejected' ? reason!.trim() : undefined
    doc.reviews.push({
      status:     decision,
      reason:     decision === 'rejected' ? reason!.trim() : undefined,
      reviewerId: new Types.ObjectId(caller.id),
      attempt:    doc.attempt,
      reviewedAt: new Date(),
    } as never)
    await doc.save()

    void this.#tellStudent(doc, decision, reason)
    return doc
  }

  /* ── Access helpers ───────────────────────────────────────────────────── */
  async getForCaller(caller: Caller, id: string): Promise<unknown> {
    if (!Types.ObjectId.isValid(id)) {
      throw new ClassAssignmentError('NOT_FOUND', 'Submission not found.', 404)
    }
    const doc = await ClassAssignmentModel.findById(id)
      .populate('studentId', 'name email')
      .populate('liveClassId', 'title scheduledStart')
      .populate('courseId', 'title slug')
      .populate('sectionId', 'title')
      .populate('instructorId', 'name')
      .lean()
    if (!doc) throw new ClassAssignmentError('NOT_FOUND', 'Submission not found.', 404)

    const studentId = String((doc as any).studentId?._id ?? (doc as any).studentId)
    if (studentId === caller.id) return doc

    const instructorId = String((doc as any).instructorId?._id ?? (doc as any).instructorId)
    if (caller.role === 'instructor' && instructorId === caller.id) return doc
    if (STAFF.has(caller.role)) {
      if (caller.role === 'super_admin') return doc
      const org = (doc as any).organizationId
      if (!org || !caller.organizationId || String(org) === String(caller.organizationId)) return doc
    }
    /* Same answer as "not there" — a reviewer outside this session learns
       nothing about whether it exists. */
    throw new ClassAssignmentError('NOT_FOUND', 'Submission not found.', 404)
  }

  async #ownedByStudent(caller: Caller, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new ClassAssignmentError('NOT_FOUND', 'Submission not found.', 404)
    }
    const doc = await ClassAssignmentModel.findById(id)
    if (!doc || String(doc.studentId) !== caller.id) {
      throw new ClassAssignmentError('NOT_FOUND', 'Submission not found.', 404)
    }
    return doc
  }

  async #reviewable(caller: Caller, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new ClassAssignmentError('NOT_FOUND', 'Submission not found.', 404)
    }
    const doc = await ClassAssignmentModel.findById(id)
    if (!doc) throw new ClassAssignmentError('NOT_FOUND', 'Submission not found.', 404)

    if (caller.role === 'instructor') {
      if (String(doc.instructorId) !== caller.id) {
        throw new ClassAssignmentError('NOT_FOUND', 'Submission not found.', 404)
      }
      return doc
    }
    if (!STAFF.has(caller.role)) {
      throw new ClassAssignmentError('FORBIDDEN', 'You cannot review submissions.', 403)
    }
    if (caller.role !== 'super_admin' && doc.organizationId && caller.organizationId &&
        String(doc.organizationId) !== String(caller.organizationId)) {
      throw new ClassAssignmentError('NOT_FOUND', 'Submission not found.', 404)
    }
    return doc
  }

  /* ── Notifications ────────────────────────────────────────────────────
     Fire-and-forget on purpose: a mail outage must not fail the submission
     the student just spent time preparing. Each channel is caught separately
     so one failure cannot swallow the other. */
  async #tellInstructor(doc: IClassAssignment, sessionTitle: string, isRevision: boolean): Promise<void> {
    try {
      const student = await UserModel.findById(doc.studentId).select('name').lean()
      const who     = (student as { name?: string } | null)?.name ?? 'A student'
      await notifications.create(String(doc.instructorId), {
        kind:  'system',
        title: isRevision ? `Revised assignment: ${sessionTitle}` : `New assignment: ${sessionTitle}`,
        body:  `${who} sent ${isRevision ? `a revision (attempt ${doc.attempt})` : 'work'} for review.`,
        link:  `/assignments`,
      })
    } catch (err) {
      logger.error({ err, assignmentId: String(doc._id) }, 'assignment: instructor notification failed')
    }
    try {
      const instructor = await UserModel.findById(doc.instructorId).select('name email role emailPrefs').lean()
      const email = (instructor as { email?: string } | null)?.email
      if (!email) return
      const { wantsStaffEmail } = await import('@/utils/emailPrefs.ts')
      if (!wantsStaffEmail(instructor as never, 'assignmentSubmitted')) return
      const { sendAssignmentSubmitted } = await import('@/services/email.service.ts')
      await sendAssignmentSubmitted(
        email,
        (instructor as { name?: string }).name ?? '',
        doc.title, sessionTitle, doc.attempt,
      )
    } catch (err) {
      logger.error({ err, assignmentId: String(doc._id) }, 'assignment: instructor email failed')
    }
  }

  async #tellStudent(doc: IClassAssignment, decision: 'approved' | 'rejected', reason?: string): Promise<void> {
    const session = await LiveClassModel.findById(doc.liveClassId).select('title').lean()
    const title   = (session as { title?: string } | null)?.title ?? doc.title
    try {
      await notifications.create(String(doc.studentId), {
        kind:  'system',
        title: decision === 'approved'
          ? `Assignment approved: ${title}`
          : `Assignment sent back: ${title}`,
        body:  decision === 'approved'
          ? 'Your instructor approved your work.'
          : `Reason: ${reason?.trim()}`,
        link:  `/assignments`,
      })
    } catch (err) {
      logger.error({ err, assignmentId: String(doc._id) }, 'assignment: student notification failed')
    }
    try {
      const student = await UserModel.findById(doc.studentId).select('name email').lean()
      const email = (student as { email?: string } | null)?.email
      if (!email) return
      const { sendAssignmentReviewed } = await import('@/services/email.service.ts')
      await sendAssignmentReviewed(
        email,
        (student as { name?: string }).name ?? '',
        doc.title, title, decision, reason,
      )
    } catch (err) {
      logger.error({ err, assignmentId: String(doc._id) }, 'assignment: student email failed')
    }
  }
}
