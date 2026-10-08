import { Types } from 'mongoose'
import { logger } from '@/utils/logger.ts'
import { enrolledProgramsOf } from '@/utils/enrolledPrograms.ts'
import { NotificationService } from '@/services/notification.service.ts'

/* ─────────────────────────────────────────────────────
   Student ↔ instructor chat — the rules of plan.md §11.2 live here, so the
   routes stay thin and every rule has one implementation.
   ───────────────────────────────────────────────────── */

export class ChatError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message)
    this.name = 'ChatError'
  }
}

const notFound = () => new ChatError('NOT_FOUND', 'Conversation not found', 404)
const MAX_BODY = 2000
const PAGE     = 50
const AFTER_OVERLAP_S = 10
const LIST_PAGE = 50
const notifSvc = new NotificationService()

type Id = string | Types.ObjectId
const oid = (id: Id) => new Types.ObjectId(String(id))
const valid = (id: unknown): id is string => typeof id === 'string' && Types.ObjectId.isValid(id)

export interface ChatMessageDTO {
  id: string; conversationId: string; senderRole: 'student' | 'instructor'
  body: string; createdAt: Date; clientMsgId?: string
}
const toMessage = (m: any): ChatMessageDTO => ({
  id: String(m._id ?? m.id), conversationId: String(m.conversationId), senderRole: m.senderRole,
  body: m.body, createdAt: m.createdAt, ...(m.clientMsgId ? { clientMsgId: m.clientMsgId } : {}),
})

function cleanBody(raw: unknown): string {
  const body = typeof raw === 'string' ? raw.replace(/\r\n/g, '\n').trim() : ''
  if (!body) throw new ChatError('EMPTY_MESSAGE', 'Message cannot be empty')
  if (body.length > MAX_BODY) throw new ChatError('MESSAGE_TOO_LONG', `Messages are limited to ${MAX_BODY} characters`)
  return body
}
function cleanClientId(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 64 ? raw : undefined
}
const preview = (body: string) => body.replace(/\s+/g, ' ').slice(0, 160)

/* ── Who a student may write to (C2) ─────────────────── */

/** Approved programmes ∪ programmes the student is enrolled on. */
export async function studentProgramsOf(student: { _id: unknown; category?: string; categories?: string[] }): Promise<string[]> {
  const approved = student.categories?.length ? student.categories : (student.category ? [student.category] : [])
  return [...new Set([...approved, ...await enrolledProgramsOf(String(student._id))])]
}

async function loadStudent(studentId: Id) {
  const { UserModel } = await import('@/models/schema.ts')
  const s = await UserModel.findById(studentId)
    .select('name role isActive enrollmentStatus organizationId category categories').lean() as any
  if (!s || s.role !== 'student') throw new ChatError('FORBIDDEN', 'Only students can do this', 403)
  return s
}

function instructorFilter(student: any, programs: string[]) {
  return {
    role: 'instructor', isActive: true,
    /* Their own academy only — plan §11.2 C2. null matches a student and an
       instructor who both predate the field, and nobody else. */
    organizationId: student.organizationId ?? null,
    $or: [{ category: { $in: programs } }, { categories: { $in: programs } }],
  }
}

/** The instructors a student may message, each with their conversation if any. */
export async function eligibleInstructors(studentId: Id) {
  const { UserModel, ChatConversationModel } = await import('@/models/schema.ts')
  const student  = await loadStudent(studentId)
  const programs = await studentProgramsOf(student)
  if (programs.length === 0) return []
  const instructors = await UserModel.find(instructorFilter(student, programs))
    .select('name avatarUrl headline category categories').sort({ name: 1 }).lean() as any[]
  const convs = await ChatConversationModel.find({ studentId: student._id, instructorId: { $in: instructors.map(i => i._id) } })
    .select('instructorId lastMessageAt lastMessagePreview lastSenderRole studentUnread').lean() as any[]
  const byInstructor = new Map(convs.map(c => [String(c.instructorId), c]))
  return instructors.map(i => {
    const c = byInstructor.get(String(i._id))
    const teaches = [...new Set([...(i.categories ?? []), ...(i.category ? [i.category] : [])])].filter(p => programs.includes(p))
    return {
      id: String(i._id), name: i.name, avatarUrl: i.avatarUrl, headline: i.headline, programs: teaches,
      conversation: c ? {
        id: String(c._id), lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview,
        lastSenderRole: c.lastSenderRole, unread: c.studentUnread,
      } : null,
    }
  }).sort((a, b) =>
    /* Conversations first, newest on top — like a phone's chat list. */
    (b.conversation ? new Date(b.conversation.lastMessageAt).getTime() : 0)
    - (a.conversation ? new Date(a.conversation.lastMessageAt).getTime() : 0))
}

/* ── Loading a conversation, per viewer (404 for anyone else) ── */

async function convFor(convId: unknown, match: Record<string, unknown>) {
  if (!valid(convId)) throw notFound()
  const { ChatConversationModel } = await import('@/models/schema.ts')
  const c = await ChatConversationModel.findOne({ _id: oid(convId), ...match }).lean() as any
  if (!c) throw notFound()
  return c
}
export const conversationForStudent    = (convId: unknown, studentId: Id)    => convFor(convId, { studentId: oid(studentId) })
export const conversationForInstructor = (convId: unknown, instructorId: Id) => convFor(convId, { instructorId: oid(instructorId) })
export const conversationForOversight  = (convId: unknown, orgId?: string)   => convFor(convId, orgId && valid(orgId) ? { organizationId: oid(orgId) } : {})

/* ── Messages: latest page, or incremental `after`, or older `before` ── */

export async function messagesOf(conv: any, q: { after?: unknown; before?: unknown; limit?: unknown }) {
  const { ChatMessageModel } = await import('@/models/schema.ts')
  const limit = Math.min(Math.max(Number(q.limit) || PAGE, 1), 100)
  const filter: Record<string, unknown> = { conversationId: conv._id }
  let rows: any[]
  if (valid(q.after)) {
    /* An _id is minted when the message is built, not when it commits, so two
       sends racing can commit out of id order: a poll that already holds the
       newer one would step over the older one forever. Re-reading a short
       window behind the cursor closes that gap; the client merges by id. */
    const floor = Types.ObjectId.createFromTime(Math.floor(oid(q.after).getTimestamp().getTime() / 1000) - AFTER_OVERLAP_S)
    rows = await ChatMessageModel.find({ ...filter, _id: { $gt: floor } }).sort({ _id: 1 }).limit(limit).lean()
  } else {
    if (valid(q.before)) filter['_id'] = { $lt: oid(q.before) }
    rows = (await ChatMessageModel.find(filter).sort({ _id: -1 }).limit(limit).lean()).reverse()
  }
  return rows.map(toMessage)
}

/* ── Sending ─────────────────────────────────────────── */

async function insertMessage(conv: any, senderId: Id, role: 'student' | 'instructor', body: string, clientMsgId?: string) {
  const { ChatMessageModel } = await import('@/models/schema.ts')
  try {
    const m = await ChatMessageModel.create({ conversationId: conv._id, senderId: oid(senderId), senderRole: role, body, clientMsgId })
    return { message: m.toObject(), duplicate: false }
  } catch (err: any) {
    /* A retried send (same clientMsgId) answers with the original — C7. */
    if (err?.code === 11000 && clientMsgId) {
      const existing = await ChatMessageModel.findOne({ conversationId: conv._id, clientMsgId }).lean()
      if (existing) return { message: existing, duplicate: true }
    }
    throw err
  }
}

export async function sendAsStudent(studentId: Id, input: { instructorId?: unknown; body?: unknown; clientMsgId?: unknown }) {
  const { UserModel, ChatConversationModel } = await import('@/models/schema.ts')
  const body        = cleanBody(input.body)
  const clientMsgId = cleanClientId(input.clientMsgId)
  if (!valid(input.instructorId)) throw new ChatError('NOT_FOUND', 'Instructor not found', 404)

  const student = await loadStudent(studentId)
  if (!student.isActive || student.enrollmentStatus !== 'approved') {
    throw new ChatError('NOT_APPROVED', 'Your enrolment must be approved before you can message instructors', 403)
  }
  const programs   = await studentProgramsOf(student)
  const instructor = programs.length
    ? await UserModel.findOne({ _id: oid(input.instructorId), ...instructorFilter(student, programs) }).select('name').lean() as any
    : null
  /* Same answer whether the instructor does not exist or is not yours to
     message — an id is never confirmed (plan §10 R4). */
  if (!instructor) throw new ChatError('NOT_FOUND', 'Instructor not found', 404)

  const key = { studentId: student._id, instructorId: instructor._id }
  let conv: any
  for (let attempt = 0; attempt < 2 && !conv; attempt++) {
    try {
      conv = await ChatConversationModel.findOneAndUpdate(key, {
        $setOnInsert: {
          ...key, organizationId: student.organizationId,
          lastMessageAt: new Date(), lastMessagePreview: '', lastSenderRole: 'student',
        },
      }, { upsert: true, new: true }).lean()
    } catch (err: any) {
      /* Two first messages racing: one upsert wins the unique index, the
         other retries and finds it. */
      if (err?.code !== 11000 || attempt === 1) throw err
    }
  }

  const { message, duplicate } = await insertMessage(conv, student._id, 'student', body, clientMsgId)
  if (!duplicate) {
    await ChatConversationModel.updateOne({ _id: conv._id }, {
      $set: { lastMessageAt: message.createdAt, lastMessagePreview: preview(body), lastSenderRole: 'student' },
      $inc: { instructorUnread: 1 },
    })
  }
  return { conversationId: String(conv._id), message: toMessage(message) }
}

/**
 * Why this conversation can no longer take new messages, or null when it can.
 * The same rule both ways (C3): a student may only write to an instructor who
 * still teaches them, so an instructor may not keep writing into a chat the
 * student can no longer answer.
 */
export async function replyBlockedReason(conv: any): Promise<{ code: string; message: string } | null> {
  const { UserModel } = await import('@/models/schema.ts')
  const student = await UserModel.findById(conv.studentId)
    .select('role isActive enrollmentStatus organizationId category categories').lean() as any
  if (!student?.isActive || student.role !== 'student') {
    return { code: 'STUDENT_INACTIVE', message: 'This student’s account is no longer active' }
  }
  if (student.enrollmentStatus !== 'approved') {
    return { code: 'STUDENT_NOT_APPROVED', message: 'This student’s enrolment is no longer approved' }
  }
  const programs = await studentProgramsOf(student)
  const still = programs.length
    ? await UserModel.exists({ _id: conv.instructorId, ...instructorFilter(student, programs) })
    : null
  if (!still) return { code: 'NOT_YOUR_STUDENT', message: 'This student is no longer in a programme you teach — the chat is read-only' }
  return null
}

export async function replyAsInstructor(instructorId: Id, convId: unknown, input: { body?: unknown; clientMsgId?: unknown }) {
  const { UserModel, ChatConversationModel } = await import('@/models/schema.ts')
  const body        = cleanBody(input.body)
  const clientMsgId = cleanClientId(input.clientMsgId)
  const conv        = await conversationForInstructor(convId, instructorId)

  const why = await replyBlockedReason(conv)
  if (why) throw new ChatError(why.code, why.message, 409)

  const { message, duplicate } = await insertMessage(conv, instructorId, 'instructor', body, clientMsgId)
  if (!duplicate) {
    const before = await ChatConversationModel.findOneAndUpdate({ _id: conv._id }, {
      $set: { lastMessageAt: message.createdAt, lastMessagePreview: preview(body), lastSenderRole: 'instructor' },
      $inc: { studentUnread: 1 },
    }, { new: false }).lean() as any
    /* One bell notification per unread run, not per message — a burst of
       five replies is one "new messages" ping until the student reads it. */
    if (before && before.studentUnread === 0) {
      const me = await UserModel.findById(instructorId).select('name').lean() as any
      void notifSvc.create(String(conv.studentId), {
        kind: 'chat-message', title: `New message from ${me?.name ?? 'your instructor'}`,
        body: preview(body), link: `/messages?c=${String(conv._id)}`,
      }).catch(err => logger.warn({ err, convId: String(conv._id) }, 'chat notification failed'))
    }
  }
  return { message: toMessage(message) }
}

/* ── Read state ──────────────────────────────────────── */

export async function markRead(conv: any, role: 'student' | 'instructor') {
  const { ChatConversationModel } = await import('@/models/schema.ts')
  const now = new Date()
  await ChatConversationModel.updateOne({ _id: conv._id }, role === 'student'
    ? { $set: { studentUnread: 0, studentLastReadAt: now } }
    : { $set: { instructorUnread: 0, instructorLastReadAt: now } })
  return { readAt: now }
}

export async function unreadTotal(userId: Id, role: 'student' | 'instructor'): Promise<number> {
  const { ChatConversationModel } = await import('@/models/schema.ts')
  const [field, counter] = role === 'student' ? ['studentId', '$studentUnread'] : ['instructorId', '$instructorUnread']
  const [row] = await ChatConversationModel.aggregate([
    { $match: { [field]: oid(userId) } },
    { $group: { _id: null, n: { $sum: counter } } },
  ])
  return row?.n ?? 0
}

/* ── Lists ───────────────────────────────────────────── */

const PERSON = 'name avatarUrl email tetraCs'
const toConv = (c: any, viewer: 'student' | 'instructor' | 'oversight') => ({
  id: String(c._id),
  /* Staff also see the student's email and their CS and CS team in Tetra Commission. */
  student:    c.studentId    ? { id: String(c.studentId._id ?? c.studentId), name: c.studentId.name, avatarUrl: c.studentId.avatarUrl, ...(viewer !== 'student' ? { email: c.studentId.email, tetraCs: c.studentId.tetraCs ?? null } : {}) } : null,
  instructor: c.instructorId ? { id: String(c.instructorId._id ?? c.instructorId), name: c.instructorId.name, avatarUrl: c.instructorId.avatarUrl } : null,
  lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview, lastSenderRole: c.lastSenderRole,
  unread: viewer === 'student' ? c.studentUnread : viewer === 'instructor' ? c.instructorUnread : 0,
  ...(viewer === 'oversight' ? { studentUnread: c.studentUnread, instructorUnread: c.instructorUnread } : {}),
})

/* Every conversation the student has — including one with an instructor who is
   no longer eligible (C3: still readable, just not writable). */
export async function conversationsForStudent(studentId: Id) {
  const { ChatConversationModel } = await import('@/models/schema.ts')
  const rows = await ChatConversationModel.find({ studentId: oid(studentId) })
    .sort({ lastMessageAt: -1 }).limit(500)
    .populate('studentId', PERSON).populate('instructorId', 'name avatarUrl').lean()
  return rows.map(c => toConv(c, 'student'))
}

/* A page of an inbox, newest first. The cursor is "<lastMessageAt ISO>_<id>"
   so two conversations touched in the same millisecond never skip each other.
   `q` searches the student's name or email server-side, so a search reaches
   past the first page. */
type ListQuery = { cursor?: unknown; q?: unknown; limit?: unknown }
async function pageOf(filter: Record<string, unknown>, lq: ListQuery, viewer: 'instructor' | 'oversight') {
  const { ChatConversationModel, UserModel } = await import('@/models/schema.ts')
  const limit = Math.min(Math.max(Number(lq.limit) || LIST_PAGE, 1), 200)
  const and: Record<string, unknown>[] = [filter]
  const needle = typeof lq.q === 'string' ? lq.q.trim().slice(0, 80) : ''
  if (needle) {
    const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const who = async (field: 'studentId' | 'instructorId') =>
      (await UserModel.find({ _id: { $in: await ChatConversationModel.distinct(field, filter) }, $or: [{ name: rx }, { email: rx }] })
        .select('_id').limit(1000).lean()).map(h => h._id)
    /* Oversight also finds a conversation by its instructor's name. */
    and.push(viewer === 'oversight'
      ? { $or: [{ studentId: { $in: await who('studentId') } }, { instructorId: { $in: await who('instructorId') } }] }
      : { studentId: { $in: await who('studentId') } })
  }
  if (typeof lq.cursor === 'string') {
    const [iso, id] = lq.cursor.split('_')
    const at = new Date(iso ?? '')
    if (!Number.isNaN(at.getTime()) && valid(id)) {
      and.push({ $or: [{ lastMessageAt: { $lt: at } }, { lastMessageAt: at, _id: { $lt: oid(id) } }] })
    }
  }
  const rows = await ChatConversationModel.find({ $and: and })
    .sort({ lastMessageAt: -1, _id: -1 }).limit(limit + 1)
    .populate('studentId', PERSON).populate('instructorId', 'name avatarUrl').lean() as any[]
  const more = rows.length > limit
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    items: page.map(c => toConv(c, viewer)),
    nextCursor: more && last ? `${new Date(last.lastMessageAt).toISOString()}_${String(last._id)}` : null,
  }
}

export const conversationsForInstructor = (instructorId: Id, lq: ListQuery = {}) =>
  pageOf({ instructorId: oid(instructorId) }, lq, 'instructor')

export function conversationsForOversight(q: { orgId?: string; instructorId?: unknown } & ListQuery) {
  const filter: Record<string, unknown> = {}
  if (q.orgId && valid(q.orgId)) filter['organizationId'] = oid(q.orgId)
  if (valid(q.instructorId)) filter['instructorId'] = oid(q.instructorId)
  return pageOf(filter, q, 'oversight')
}

/** Instructors who have at least one conversation — the oversight filter. */
export async function oversightInstructors(orgId?: string) {
  const { ChatConversationModel, UserModel } = await import('@/models/schema.ts')
  const match: Record<string, unknown> = orgId && valid(orgId) ? { organizationId: oid(orgId) } : {}
  const ids = await ChatConversationModel.distinct('instructorId', match)
  const people = await UserModel.find({ _id: { $in: ids } }).select('name avatarUrl').sort({ name: 1 }).lean() as any[]
  return people.map(p => ({ id: String(p._id), name: p.name, avatarUrl: p.avatarUrl }))
}

/** The peer's read time, for ✓✓ on the viewer's own messages. */
export const peerLastReadAt = (conv: any, viewer: 'student' | 'instructor') =>
  viewer === 'student' ? conv.instructorLastReadAt ?? null : conv.studentLastReadAt ?? null
