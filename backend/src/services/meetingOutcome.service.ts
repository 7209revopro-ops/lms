import { Types } from 'mongoose'
import { PortalError } from '@/services/portal.service.ts'
import {
  MEETING_OUTCOME_STAGES,
  MEETING_FOLLOW_UP_KINDS,
  MEETING_PAYMENT_MODES,
  MEETING_NOT_INTERESTED_REASONS,
  MEETING_EXPERIENCE,
  MEETING_LOSS_WAYS,
  MEETING_LOSS_CURRENCIES,
  type IMeetingOutcome,
  type IClientProfile,
} from '@/models/schema.ts'

/* ─────────────────────────────────────────────────────
   How a student meeting went (the user, 2026-10-27: "after the meeting completes … a popup form, it closes only
   after it is filled"). A meeting Tetra Commission booked (askOutcome) with a student, over and not cancelled, waits
   on its mentor until they say where the client stands — interested (course, payment date and mode), follow-up (the
   CSE's or a revision, and when), a meeting with another mentor, a revision (course, module, preferred mentor) or not
   interested (why) — with the client's concern and a remark; then, a second step, who the client is (trading
   experience and years, losses — how much and how — country, family in Dubai, occupation), started from what the
   last meeting with them said. The mentor fills it in LMS admin or in Tetra Commission (the same email), the
   first one counts, and Tetra Commission reads what was filled to put it on the student.
───────────────────────────────────────────────────── */

const httpError = (message: string, statusCode: number) =>
  new PortalError(statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', message, statusCode)

const DATE = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max)
const oid = (v: unknown) => (Types.ObjectId.isValid(String(v ?? '')) ? new Types.ObjectId(String(v)) : null)
const endOf = (m: { scheduledStart: Date; durationMins?: number }) => new Date(new Date(m.scheduledStart).getTime() + (m.durationMins ?? 0) * 60_000)

/** What waits for a mentor: their student meetings to say how they went (askOutcome), over, not cancelled, not filled. */
const waitingFilter = (mentorId: Types.ObjectId, now: Date) => ({
  mentorId, askOutcome: true, kind: 'student', cancelledAt: null, outcome: null, scheduledStart: { $lte: now },
})

export interface PendingMeeting {
  id: string; title: string; category: string; startsAt: string; endsAt: string; durationMins: number
  inPerson: boolean; location: string; attendees: { name: string; email: string }[]; bookedByEmail: string
  /** What the last meeting with any of them said about the client — the second step starts from it. */
  lastProfile: ReturnType<typeof profileOut>
}

const profileOut = (p: IClientProfile | null | undefined) => p ? {
  experience: p.experience, years: p.years ?? null, hadLosses: p.hadLosses, lossAmount: p.lossAmount ?? null,
  lossCurrency: p.lossCurrency ?? '', lossHow: [...(p.lossHow ?? [])], country: p.country, familyInDubai: p.familyInDubai, occupation: p.occupation,
} : null

/** The latest profile a filled meeting with any of these addresses has. */
async function lastProfileOf(emails: string[]) {
  const list = emails.map((e) => e.toLowerCase()).filter(Boolean)
  if (!list.length) return null
  const { MentorMeetingModel } = await import('@/models/schema.ts')
  const m = await MentorMeetingModel.findOne({ askOutcome: true, 'attendees.email': { $in: list }, 'outcome.profile': { $ne: null } })
    .sort({ 'outcome.filledAt': -1 }).select('outcome.profile').lean()
  return profileOut(m?.outcome?.profile)
}

/** A mentor's meetings waiting for an outcome, oldest first. */
async function pendingOf(mentorId: Types.ObjectId, now = new Date()): Promise<PendingMeeting[]> {
  const { MentorMeetingModel } = await import('@/models/schema.ts')
  const rows = await MentorMeetingModel.find(waitingFilter(mentorId, now)).sort({ scheduledStart: 1 }).limit(200).lean()
  const over = rows.filter((m) => endOf(m).getTime() <= now.getTime())
  const profiles = await Promise.all(over.map((m) => lastProfileOf((m.attendees ?? []).map((a) => a.email ?? ''))))
  return over
    .map((m, i) => ({
      id: String(m._id),
      title: m.title,
      category: String(m.category ?? ''),
      startsAt: new Date(m.scheduledStart).toISOString(),
      endsAt: endOf(m).toISOString(),
      durationMins: m.durationMins,
      inPerson: m.isOnline === false,
      location: m.location ?? '',
      attendees: (m.attendees ?? []).map((a) => ({ name: a.name, email: a.email ?? '' })),
      bookedByEmail: m.bookedByEmail,
      lastProfile: profiles[i] ?? null,
    }))
}

/** The instructor with this address (any academy), or null. */
async function mentorByEmail(email: unknown) {
  const e = str(email).toLowerCase()
  if (!e) return null
  const { UserModel } = await import('@/models/schema.ts')
  return UserModel.findOne({ email: e, role: 'instructor' }).select('name email').lean()
}

/** LMS admin: the signed-in mentor's. */
export const pendingOutcomesForUser = (userId: string, now = new Date()) =>
  Types.ObjectId.isValid(userId) ? pendingOf(new Types.ObjectId(userId), now) : Promise.resolve([])

/** Tetra Commission: the mentor with this address's — none for anybody who isn't one. */
export async function pendingOutcomesForEmail(email: unknown, now = new Date()): Promise<PendingMeeting[]> {
  const mentor = await mentorByEmail(email)
  return mentor ? pendingOf(mentor._id as Types.ObjectId, now) : []
}

/** What the form offers: the lists, every published course with its modules, every active mentor. */
export async function outcomeOptions() {
  const { CourseModel, SectionModel, UserModel } = await import('@/models/schema.ts')
  const [courses, mentors] = await Promise.all([
    CourseModel.find({ status: 'published' }).select('title').sort({ title: 1 }).lean(),
    UserModel.find({ role: 'instructor', isActive: { $ne: false } }).select('name email').sort({ name: 1 }).lean(),
  ])
  const sections = await SectionModel.find({ courseId: { $in: courses.map((c) => c._id) } }).select('courseId title order').sort({ order: 1 }).lean()
  const modulesOf = new Map<string, { id: string; title: string }[]>()
  for (const s of sections) {
    const k = String(s.courseId)
    if (!modulesOf.has(k)) modulesOf.set(k, [])
    modulesOf.get(k)!.push({ id: String(s._id), title: s.title })
  }
  return {
    stages: MEETING_OUTCOME_STAGES,
    followUpKinds: MEETING_FOLLOW_UP_KINDS,
    paymentModes: MEETING_PAYMENT_MODES,
    notInterestedReasons: MEETING_NOT_INTERESTED_REASONS,
    experience: MEETING_EXPERIENCE,
    lossWays: MEETING_LOSS_WAYS,
    lossCurrencies: MEETING_LOSS_CURRENCIES,
    courses: courses.map((c) => ({ id: String(c._id), title: c.title, modules: modulesOf.get(String(c._id)) ?? [] })),
    mentors: mentors.map((m) => ({ id: String(m._id), name: m.name ?? m.email, email: m.email })),
  }
}

/** An outcome as it travels: ids as strings, the date as ISO. */
export function outcomeOut(o: IMeetingOutcome | null | undefined) {
  if (!o) return null
  return {
    stage: o.stage,
    courseId: o.courseId ? String(o.courseId) : '', courseTitle: o.courseTitle ?? '',
    paymentDate: o.paymentDate ?? '', paymentMode: o.paymentMode ?? '',
    followUpKind: o.followUpKind ?? '', followUpDate: o.followUpDate ?? '',
    withMentorId: o.withMentorId ? String(o.withMentorId) : '', withMentorName: o.withMentorName ?? '', withMentorEmail: o.withMentorEmail ?? '',
    moduleId: o.moduleId ? String(o.moduleId) : '', moduleTitle: o.moduleTitle ?? '',
    reason: o.reason ?? '',
    concern: o.concern ?? '',
    remark: o.remark,
    profile: profileOut(o.profile),
    filledByName: o.filledByName ?? '', filledByEmail: o.filledByEmail ?? '', filledVia: o.filledVia,
    filledAt: new Date(o.filledAt).toISOString(),
  }
}

/** The second step as sent → a profile, or a refusal saying what is missing. */
function profileFrom(v: unknown): IClientProfile {
  const p = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const experience = str(p.experience, 20) as IClientProfile['experience']
  if (!(MEETING_EXPERIENCE as readonly string[]).includes(experience)) throw httpError('Pick their trading experience', 400)
  let years: number | null = null
  if (experience !== 'fresher') {
    years = Number(p.years)
    if (p.years === '' || p.years == null || !Number.isFinite(years) || years < 0 || years > 60) throw httpError('Type how many years they have traded', 400)
    years = Math.round(years * 10) / 10
  }
  if (typeof p.hadLosses !== 'boolean') throw httpError('Say whether they have had losses', 400)
  const out: IClientProfile = {
    experience, years, hadLosses: p.hadLosses, lossAmount: null, lossCurrency: '', lossHow: [],
    country: str(p.country, 80), familyInDubai: false, occupation: str(p.occupation, 200),
  }
  if (p.hadLosses) {
    const amount = Number(p.lossAmount)
    if (!Number.isFinite(amount) || amount <= 0) throw httpError('Type how much they lost', 400)
    const currency = str(p.lossCurrency, 3)
    if (!(MEETING_LOSS_CURRENCIES as readonly string[]).includes(currency)) throw httpError('Pick the currency of the loss', 400)
    const how = [...new Set((Array.isArray(p.lossHow) ? p.lossHow : []).map((x) => str(x, 40)))]
    if (!how.length || how.some((x) => !(MEETING_LOSS_WAYS as readonly string[]).includes(x))) throw httpError('Pick how it was lost', 400)
    out.lossAmount = Math.round(amount * 100) / 100
    out.lossCurrency = currency
    out.lossHow = how
  }
  if (!out.country) throw httpError('Type their country of residence', 400)
  if (typeof p.familyInDubai !== 'boolean') throw httpError('Say whether their family is in Dubai', 400)
  out.familyInDubai = p.familyInDubai
  if (!out.occupation) throw httpError('Type their occupation or business', 400)
  return out
}

/** The form as sent → an outcome, or a refusal saying what is missing. */
async function outcomeFrom(body: Record<string, unknown>): Promise<Omit<IMeetingOutcome, 'filledById' | 'filledByName' | 'filledByEmail' | 'filledVia' | 'filledAt'>> {
  const { CourseModel, SectionModel } = await import('@/models/schema.ts')
  const stage = str(body.stage, 40) as IMeetingOutcome['stage']
  if (!(MEETING_OUTCOME_STAGES as readonly string[]).includes(stage)) throw httpError('Pick where the client stands', 400)
  const concern = str(body.concern, 2000)
  if (!concern) throw httpError('Write the client\'s concern', 400)
  const remark = str(body.remark, 2000)
  if (!remark) throw httpError('Write a remark', 400)
  const out: any = { stage, concern, remark, profile: profileFrom(body.profile) }

  const course = async (required: boolean) => {
    const id = oid(body.courseId)
    if (!id) { if (required) throw httpError('Pick the course', 400); return null }
    const c = await CourseModel.findOne({ _id: id }).select('title').lean()
    if (!c) throw httpError('That course is not here', 400)
    out.courseId = c._id
    out.courseTitle = c.title
    return c
  }
  const mentor = async (required: boolean, what: string) => {
    const m = await mentorByEmail(body.withMentorEmail)
    if (!m) { if (required || str(body.withMentorEmail)) throw httpError(`Pick ${what}`, 400); return }
    out.withMentorId = m._id
    out.withMentorName = m.name ?? m.email
    out.withMentorEmail = m.email
  }
  const date = (v: unknown, what: string) => {
    const d = str(v, 10)
    if (!DATE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw httpError(`Pick ${what}`, 400)
    return d
  }

  if (stage === 'interested') {
    await course(true)
    out.paymentDate = date(body.paymentDate, 'the payment date')
    const mode = str(body.paymentMode, 40)
    if (!(MEETING_PAYMENT_MODES as readonly string[]).includes(mode)) throw httpError('Pick how they will pay', 400)
    out.paymentMode = mode
  } else if (stage === 'follow_up') {
    const kind = str(body.followUpKind, 40)
    if (!(MEETING_FOLLOW_UP_KINDS as readonly string[]).includes(kind)) throw httpError('Pick a CSE follow-up or a revision', 400)
    out.followUpKind = kind
    out.followUpDate = date(body.followUpDate, 'the follow-up date')
  } else if (stage === 'meeting_with') {
    await mentor(true, 'the mentor they will meet')
  } else if (stage === 'revision') {
    const c = await course(true)
    const mid = oid(body.moduleId)
    if (mid) {
      const s = await SectionModel.findOne({ _id: mid, courseId: c!._id }).select('title').lean()
      if (!s) throw httpError('That module is not in this course', 400)
      out.moduleId = s._id
      out.moduleTitle = s.title
    }
    await mentor(false, 'a mentor from the list')
  } else {
    const reason = str(body.reason, 60)
    if (!(MEETING_NOT_INTERESTED_REASONS as readonly string[]).includes(reason)) throw httpError('Pick why they are not interested', 400)
    out.reason = reason
  }
  return out
}

/**
 * The mentor says how it went — once: the first to fill it (LMS admin or Tetra Commission) counts, a second is told it
 * was filled. Only their own meeting, and only once it is over.
 */
async function save(input: {
  meetingId: unknown; mentorId: Types.ObjectId
  by: { id?: Types.ObjectId | null; name: string; email: string }; via: 'lms' | 'portal'
  body: Record<string, unknown>; now?: Date
}) {
  const { MentorMeetingModel } = await import('@/models/schema.ts')
  const now = input.now ?? new Date()
  const id = oid(input.meetingId)
  const meeting = id ? await MentorMeetingModel.findOne({ _id: id, mentorId: input.mentorId, askOutcome: true, kind: 'student' }).lean() : null
  if (!meeting) throw httpError('No such meeting of yours', 404)
  if (meeting.cancelledAt) throw httpError('That meeting was cancelled', 409)
  if (meeting.outcome) throw httpError(`Already filled by ${meeting.outcome.filledByName || meeting.outcome.filledByEmail}`, 409)
  if (endOf(meeting).getTime() > now.getTime()) throw httpError('The meeting is not over yet', 409)

  const outcome: IMeetingOutcome = {
    ...(await outcomeFrom(input.body)),
    filledById: input.by.id ?? null,
    filledByName: input.by.name,
    filledByEmail: input.by.email,
    filledVia: input.via,
    filledAt: now,
  }
  // Only while nobody has: two portals at once — the second is told.
  const done = await MentorMeetingModel.updateOne({ _id: meeting._id, outcome: null }, { $set: { outcome } })
  if (done.modifiedCount !== 1) throw httpError('Already filled', 409)
  return { id: String(meeting._id), outcome: outcomeOut(outcome) }
}

/** LMS admin: the signed-in mentor fills it. */
export async function saveOutcomeForUser(user: { id: string; email: string }, meetingId: unknown, body: Record<string, unknown>, now?: Date) {
  if (!Types.ObjectId.isValid(user.id)) throw httpError('No such meeting of yours', 404)
  const { UserModel } = await import('@/models/schema.ts')
  const me = await UserModel.findById(user.id).select('name email').lean()
  const mentorId = new Types.ObjectId(user.id)
  return save({ meetingId, mentorId, by: { id: mentorId, name: me?.name ?? user.email, email: me?.email ?? user.email }, via: 'lms', body, now })
}

/** Tetra Commission: the mentor with this address fills it. */
export async function saveOutcomeForEmail(email: unknown, meetingId: unknown, body: Record<string, unknown>, now?: Date) {
  const mentor = await mentorByEmail(email)
  if (!mentor) throw httpError('No such meeting of yours', 404)
  const mentorId = mentor._id as Types.ObjectId
  return save({ meetingId, mentorId, by: { id: mentorId, name: mentor.name ?? mentor.email, email: mentor.email }, via: 'portal', body, now })
}

/**
 * The outcomes filled from `since` on (inclusive — the caller keeps each once by its id), oldest first: for Tetra
 * Commission to put on its students. `next` is where to read from next time.
 */
export async function outcomesSince(since: unknown, limit = 200) {
  const { MentorMeetingModel, UserModel } = await import('@/models/schema.ts')
  const from = new Date(String(since ?? ''))
  const rows = await MentorMeetingModel.find({
    askOutcome: true,
    'outcome.filledAt': Number.isNaN(from.getTime()) ? { $exists: true } : { $gte: from },
  }).sort({ 'outcome.filledAt': 1 }).limit(Math.min(Math.max(limit, 1), 500)).lean()
  const mentors = await UserModel.find({ _id: { $in: rows.map((r) => r.mentorId) } }).select('name email').lean()
  const mentorOf = new Map(mentors.map((m) => [String(m._id), m]))
  const meetings = rows.map((m) => ({
    id: String(m._id),
    title: m.title,
    category: String(m.category ?? ''),
    startsAt: new Date(m.scheduledStart).toISOString(),
    durationMins: m.durationMins,
    attendees: (m.attendees ?? []).map((a) => ({ name: a.name, email: a.email ?? '' })),
    bookedByEmail: m.bookedByEmail,
    mentor: { name: mentorOf.get(String(m.mentorId))?.name ?? '', email: mentorOf.get(String(m.mentorId))?.email ?? '' },
    outcome: outcomeOut(m.outcome),
  }))
  return { meetings, next: meetings.length ? meetings[meetings.length - 1]!.outcome!.filledAt : (Number.isNaN(from.getTime()) ? null : from.toISOString()) }
}
