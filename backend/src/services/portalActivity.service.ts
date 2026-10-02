/* ─────────────────────────────────────────────────────
   The help desk and class assignments, for the commission portal
   ─────────────────────────────────────────────────────
   Tetra Commission (the commission portal) tells each student's CS when the
   student opens a Help & Support ticket or writes on one, sends a class
   assignment, or has one approved or rejected — and shows the student's
   tickets and assignments on their page there. It asks; nothing here changes
   how a ticket or an assignment works.

     GET  /service/student-activity?since=…    what happened after `since`
     POST /service/support-tickets { email }   one student's tickets, in full
     POST /service/class-assignments { email } one student's class assignments

   Both academies: the portal's students may be in either. Read-only.
───────────────────────────────────────────────────── */
import { SupportTicketModel, ClassAssignmentModel, UserModel, CourseModel, LiveClassModel } from '@/models/schema.ts'
import { PortalError } from '@/services/portal.service.ts'

/* How far back a portal that has been away may ask: past this, what it missed stays missed. */
const MAX_LOOKBACK_MS = 31 * 24 * 60 * 60_000
/* At most this many events in one answer, oldest first — `until` then says where they stop. */
const MAX_EVENTS = 1000
const MAX_TICKETS = 50
const MAX_ASSIGNMENTS = 100
/* The student's words in an event: enough for an email, not a whole essay. */
const EXCERPT = 1000

export type PortalActivityType = 'ticket_opened' | 'ticket_reply' | 'assignment_submitted' | 'assignment_reviewed'

export interface PortalActivity {
  /** Never changes for the same happening, so a caller can ask with an overlap and drop what it has seen. */
  key:     string
  type:    PortalActivityType
  at:      string
  student: { lmsUserId: string; email: string; name: string }
  ticket?: { id: string; subject: string; category: string; status: string; message: string }
  assignment?: {
    id: string; title: string; note: string; files: number
    course: string; className: string; classAt: string; mentor: string
    attempt: number; status: string; decision?: 'approved' | 'rejected'; reason?: string
  }
}

type Msg = { _id?: unknown; senderId?: unknown; senderRole: 'student' | 'admin'; body: string; createdAt?: Date }
type TicketRow = { _id: unknown; userId: unknown; subject: string; category: string; status: string; messages?: Msg[]; createdAt?: Date; lastMessageAt?: Date; lastSenderRole?: string }
type Review = { status: 'approved' | 'rejected'; reason?: string; attempt: number; reviewedAt?: Date }
type AssignmentRow = {
  _id: unknown; studentId: unknown; liveClassId: unknown; courseId: unknown; instructorId: unknown
  title: string; note?: string; files?: { name: string }[]; status: string; attempt: number
  reviews?: Review[]; lastReason?: string; submittedAt?: Date; reviewedAt?: Date
}

const bad = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : '')
const idOf = (v: unknown) => String(v ?? '')
const excerpt = (s: unknown) => {
  const t = String(s ?? '').trim()
  return t.length > EXCERPT ? `${t.slice(0, EXCERPT)}…` : t
}

function oneEmail(raw: unknown): string {
  const email = typeof raw === 'string' ? raw.toLowerCase().trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('email must be one address')
  return email
}

/** Names for the ids an answer mentions — people, courses, classes — each looked up once. */
async function lookups(rows: { users?: unknown[]; courses?: unknown[]; classes?: unknown[] }) {
  const ids = (list?: unknown[]) => [...new Set((list ?? []).map(idOf).filter(Boolean))]
  const [users, courses, classes] = await Promise.all([
    ids(rows.users).length ? UserModel.find({ _id: { $in: ids(rows.users) } }).select('name email').lean() : [],
    ids(rows.courses).length ? CourseModel.find({ _id: { $in: ids(rows.courses) } }).select('title').lean() : [],
    ids(rows.classes).length ? LiveClassModel.find({ _id: { $in: ids(rows.classes) } }).select('title scheduledStart').lean() : [],
  ]) as unknown as [
    { _id: unknown; name?: string; email?: string }[],
    { _id: unknown; title?: string }[],
    { _id: unknown; title?: string; scheduledStart?: Date }[],
  ]
  return {
    user:   new Map(users.map(u => [idOf(u._id), { name: u.name ?? '', email: String(u.email ?? '').toLowerCase() }])),
    course: new Map(courses.map(c => [idOf(c._id), c.title ?? ''])),
    klass:  new Map(classes.map(c => [idOf(c._id), { title: c.title ?? '', at: iso(c.scheduledStart) }])),
  }
}

/**
 * What students did after `since` — opened or wrote on a ticket, sent a class
 * assignment, had one approved or rejected — every student, oldest first. The
 * student's own words only: support's replies and the automatic welcome are
 * not something the student did.
 */
export async function studentActivityForPortal(input: { since: unknown; now?: Date }): Promise<{ events: PortalActivity[]; until: string }> {
  const now = input.now ?? new Date()
  const since = typeof input.since === 'string' ? new Date(input.since) : new Date(NaN)
  if (Number.isNaN(since.getTime())) throw bad('since must be a date and time (ISO 8601)')
  const from = new Date(Math.max(since.getTime(), now.getTime() - MAX_LOOKBACK_MS))
  const inWindow = (d: unknown) => {
    const t = d ? new Date(d as string).getTime() : NaN
    return t > from.getTime() && t <= now.getTime()
  }

  const [tickets, assignments] = await Promise.all([
    // A new ticket, or a new message on an old one, moves lastMessageAt.
    SupportTicketModel.find({ lastMessageAt: { $gt: from } })
      .select('userId subject category status messages createdAt').lean(),
    ClassAssignmentModel.find({ $or: [{ submittedAt: { $gt: from } }, { reviewedAt: { $gt: from } }] })
      .select('studentId liveClassId courseId instructorId title note files status attempt reviews submittedAt').lean(),
  ]) as unknown as [TicketRow[], AssignmentRow[]]

  const names = await lookups({
    users: [...tickets.map(t => t.userId), ...assignments.flatMap(a => [a.studentId, a.instructorId])],
    courses: assignments.map(a => a.courseId),
    classes: assignments.map(a => a.liveClassId),
  })
  const events: PortalActivity[] = []
  const add = (e: Omit<PortalActivity, 'student'>, userId: unknown) => {
    const who = names.user.get(idOf(userId))
    if (!who?.email) return   // nobody to tell anybody about
    events.push({ ...e, student: { lmsUserId: idOf(userId), email: who.email, name: who.name } })
  }

  for (const t of tickets) {
    const messages = t.messages ?? []
    const ticket = (message: unknown) => ({ id: idOf(t._id), subject: t.subject, category: t.category, status: t.status, message: excerpt(message) })
    // The student's first message is the ticket itself; their later ones are replies.
    const opening = messages.findIndex(m => m.senderRole === 'student')
    if (inWindow(t.createdAt)) {
      add({ key: `ticket-opened:${idOf(t._id)}`, type: 'ticket_opened', at: iso(t.createdAt), ticket: ticket(messages[opening]?.body) }, t.userId)
    }
    messages.forEach((m, i) => {
      if (i === opening || m.senderRole !== 'student' || !inWindow(m.createdAt)) return
      add({ key: `ticket-reply:${idOf(t._id)}:${idOf(m._id)}`, type: 'ticket_reply', at: iso(m.createdAt), ticket: ticket(m.body) }, t.userId)
    })
  }

  for (const a of assignments) {
    const klass = names.klass.get(idOf(a.liveClassId))
    const assignment = (attempt: number) => ({
      id: idOf(a._id), title: a.title, note: excerpt(a.note), files: (a.files ?? []).length,
      course: names.course.get(idOf(a.courseId)) ?? '', className: klass?.title ?? '', classAt: klass?.at ?? '',
      mentor: names.user.get(idOf(a.instructorId))?.name ?? '', attempt, status: a.status,
    })
    // submittedAt is the latest send: a revision moves it and adds one to the attempt.
    if (inWindow(a.submittedAt)) {
      add({ key: `assignment-submitted:${idOf(a._id)}:${a.attempt}`, type: 'assignment_submitted', at: iso(a.submittedAt), assignment: assignment(a.attempt) }, a.studentId)
    }
    for (const r of a.reviews ?? []) {
      if (!inWindow(r.reviewedAt)) continue
      add({
        key: `assignment-reviewed:${idOf(a._id)}:${r.attempt}`, type: 'assignment_reviewed', at: iso(r.reviewedAt),
        assignment: { ...assignment(r.attempt), decision: r.status, ...(r.reason ? { reason: excerpt(r.reason) } : {}) },
      }, a.studentId)
    }
  }

  events.sort((x, y) => x.at.localeCompare(y.at) || x.key.localeCompare(y.key))
  if (events.length > MAX_EVENTS) {
    const page = events.slice(0, MAX_EVENTS)
    return { events: page, until: page[page.length - 1]!.at }
  }
  return { events, until: now.toISOString() }
}

/** One student's Help & Support tickets, newest first, with the conversation. */
export async function supportTicketsForPortal(input: { email: unknown }) {
  const email = oneEmail(input.email)
  const user = await UserModel.findOne({ email }).select('_id').lean() as { _id: unknown } | null
  if (!user) return { email, exists: false, tickets: [] }
  const rows = await SupportTicketModel.find({ userId: user._id })
    .sort({ lastMessageAt: -1 }).limit(MAX_TICKETS)
    .select('subject category status messages createdAt lastMessageAt lastSenderRole').lean() as unknown as TicketRow[]
  return {
    email,
    exists: true,
    tickets: rows.map(t => ({
      id: idOf(t._id),
      subject: t.subject,
      category: t.category,
      status: t.status,
      openedAt: iso(t.createdAt),
      lastMessageAt: iso(t.lastMessageAt),
      lastFrom: t.lastSenderRole === 'student' ? 'student' : 'support',
      // Support's people are "support" here: who on the desk answered is the LMS's business.
      messages: (t.messages ?? []).map(m => ({
        from: m.senderRole === 'student' ? 'student' : m.senderId ? 'support' : 'automatic',
        body: m.body,
        at: iso(m.createdAt),
      })),
    })),
  }
}

/** One student's class assignments, newest first: what they sent for which class, and how it was reviewed. */
export async function classAssignmentsForPortal(input: { email: unknown }) {
  const email = oneEmail(input.email)
  const user = await UserModel.findOne({ email }).select('_id').lean() as { _id: unknown } | null
  if (!user) return { email, exists: false, assignments: [] }
  const rows = await ClassAssignmentModel.find({ studentId: user._id })
    .sort({ submittedAt: -1 }).limit(MAX_ASSIGNMENTS)
    .select('liveClassId courseId instructorId title note files status attempt reviews lastReason submittedAt reviewedAt').lean() as unknown as AssignmentRow[]
  const names = await lookups({ users: rows.map(a => a.instructorId), courses: rows.map(a => a.courseId), classes: rows.map(a => a.liveClassId) })
  return {
    email,
    exists: true,
    assignments: rows.map(a => {
      const klass = names.klass.get(idOf(a.liveClassId))
      return {
        id: idOf(a._id),
        title: a.title,
        note: a.note ?? '',
        // Names only: the files themselves stay behind the LMS's own access checks.
        files: (a.files ?? []).map(f => f.name),
        course: names.course.get(idOf(a.courseId)) ?? '',
        className: klass?.title ?? '',
        classAt: klass?.at ?? '',
        mentor: names.user.get(idOf(a.instructorId))?.name ?? '',
        status: a.status,
        attempt: a.attempt,
        submittedAt: iso(a.submittedAt),
        reviewedAt: iso(a.reviewedAt),
        reason: a.status === 'rejected' ? a.lastReason ?? '' : '',
        reviews: (a.reviews ?? []).map(r => ({ status: r.status, reason: r.reason ?? '', attempt: r.attempt, at: iso(r.reviewedAt) })),
      }
    }),
  }
}
