/* ─────────────────────────────────────────────────────
   Duplicate student accounts — finding them, and merging two into one.

   How a person gets two accounts: the email is the only thing an account is
   unique on, and several ways in never prove the email (an xlsx import, an
   admin adding a student, a guest checkout on /explore). A mistyped
   "gamil.com" there, and the student's own sign-up later, are two people to
   the LMS.

   FINDING — students sharing a phone number (utils/phoneKey.ts, so the way it
   was typed does not matter), each group marked how sure it is from the rest
   of what the accounts say: the same ID number or date of birth, an email one
   typo away, a similar name. A family on one phone is "Not a duplicate" and
   stays hidden (DuplicateDismissal).

   MERGING — a super admin keeps one account (the primary) and closes the
   other (the secondary):
     · everything of the secondary's moves to the primary — every model that
       points at a student, listed in REFS below. A test (accountmerge.suite)
       fails when a model gains a user reference that is not listed, so a new
       feature cannot be silently left behind on the closed account;
     · where both have the one row a student may have (enrolled on the same
       course, booked on the same class), one copy is kept by the rule of that
       model (`prefer`) and the other dropped — kept in the journal;
     · the admin picks, per detail, whose name / phone / photo / registration /
       academy / approval the merged account carries;
     · the secondary is closed (isActive false, mergedInto), its sessions end,
       and signing in with its email lands in the primary
       (UserRepository.findByEmail follows mergedInto).
   Nothing is deleted outright: every change is journaled in AccountMerge as
   it happens, so a merge can be undone — and a merge that stopped halfway is
   visible and undoable too (there are no transactions on this database).
───────────────────────────────────────────────────── */
import mongoose, { Types } from 'mongoose'
import { logger } from '@/utils/logger.ts'
import { phoneKey } from '@/utils/phoneKey.ts'
import { UserError } from '@/services/user.service.ts'

type Lean = Record<string, any>
type Side = 'primary' | 'secondary'

/* ── What points at a student ───────────────────────────
   `with`: the other keys of a unique index on the field — the two accounts
   may each have such a row, and only one survives. `with: []` is a field
   unique on its own (one row per student). `prefer` picks the copy kept;
   absent, the primary's. */
interface ScalarRef { kind: 'scalar'; model: string; path: string; label: string; with?: string[]; prefer?: (p: Lean, s: Lean) => Side }
interface ArrayRef  { kind: 'array';  model: string; path: string; label: string }
interface SubRef    { kind: 'sub';    model: string; path: string; key: string; label: string }
interface ChatRef   { kind: 'chat';   model: 'ChatConversation'; path: 'studentId'; label: string }
type Ref = ScalarRef | ArrayRef | SubRef | ChatRef

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0)
const pickBy = (score: (d: Lean) => number) => (p: Lean, s: Lean): Side => (score(s) > score(p) ? 'secondary' : 'primary')

const BOOKING_RANK: Record<string, number> = { attended: 4, booked: 3, missed: 2, cancelled: 1 }
const ASSIGNMENT_RANK: Record<string, number> = { approved: 3, pending: 2, rejected: 1 }

export const REFS: Ref[] = [
  { kind: 'scalar', model: 'Enrollment', path: 'userId', with: ['courseId'], label: 'Course enrolments',
    prefer: pickBy(d => (d.status === 'completed' ? 1000 : 0) + num(d.progressPercent)) },
  { kind: 'scalar', model: 'LessonProgress', path: 'userId', with: ['lessonId'], label: 'Lesson progress',
    prefer: pickBy(d => (d.isCompleted ? 1e9 : 0) + num(d.watchTimeSecs)) },
  { kind: 'scalar', model: 'ClassBooking', path: 'userId', with: ['liveClassId'], label: 'Class bookings',
    prefer: pickBy(d => BOOKING_RANK[d.status] ?? 0) },
  { kind: 'scalar', model: 'Order', path: 'userId', label: 'Orders and payments' },
  { kind: 'scalar', model: 'QuizAttempt', path: 'userId', label: 'Quiz attempts' },
  { kind: 'scalar', model: 'ExamAttempt', path: 'userId', with: ['examId'], label: 'Exam attempts',
    prefer: pickBy(d => (d.status === 'submitted' ? 1e6 : 0) + num(d.totalMarks)) },
  { kind: 'scalar', model: 'ExamLog', path: 'userId', label: 'Exam activity log' },
  { kind: 'scalar', model: 'AssignmentSubmission', path: 'userId', with: ['assignmentId'], label: 'Assignment submissions',
    prefer: pickBy(d => (d.gradedAt ? 1e6 : 0) + num(d.grade)) },
  { kind: 'scalar', model: 'HomeworkSubmission', path: 'userId', with: ['homeworkId'], label: 'Homework submissions',
    prefer: pickBy(d => (d.gradedAt ? 1e6 : 0) + num(d.grade)) },
  { kind: 'scalar', model: 'ClassAssignment', path: 'studentId', with: ['liveClassId'], label: 'Class assignments',
    prefer: pickBy(d => (ASSIGNMENT_RANK[d.status] ?? 0) * 1000 + num(d.attempt)) },
  { kind: 'scalar', model: 'ClassFeedback', path: 'userId', with: ['liveClassId'], label: 'Class feedback' },
  { kind: 'scalar', model: 'InstructorReview', path: 'studentId', with: ['liveClassId'], label: 'Instructor reviews' },
  { kind: 'scalar', model: 'Review', path: 'userId', with: ['courseId'], label: 'Course reviews' },
  { kind: 'scalar', model: 'ReviewVote', path: 'userId', with: ['reviewId', 'type'], label: 'Review votes' },
  { kind: 'scalar', model: 'Favorite', path: 'userId', with: ['courseId'], label: 'Saved courses' },
  { kind: 'scalar', model: 'LessonNote', path: 'userId', with: ['lessonId'], label: 'Lesson notes' },
  { kind: 'scalar', model: 'VideoBookmark', path: 'userId', label: 'Video bookmarks' },
  { kind: 'scalar', model: 'UserAchievement', path: 'userId', with: ['kind'], label: 'Achievements' },
  { kind: 'scalar', model: 'UserStreak', path: 'userId', with: [], label: 'Learning streak',
    prefer: pickBy(d => num(d.longestStreak) * 1e4 + num(d.totalDaysActive)) },
  { kind: 'scalar', model: 'DiscussionThread', path: 'authorId', label: 'Discussion posts' },
  { kind: 'array',  model: 'DiscussionThread', path: 'upvotedBy', label: 'Discussion upvotes' },
  { kind: 'scalar', model: 'DiscussionComment', path: 'authorId', label: 'Discussion comments' },
  { kind: 'array',  model: 'DiscussionComment', path: 'upvotedBy', label: 'Comment upvotes' },
  { kind: 'scalar', model: 'SupportTicket', path: 'userId', label: 'Support tickets' },
  { kind: 'sub',    model: 'SupportTicket', path: 'messages', key: 'senderId', label: 'Support ticket messages' },
  { kind: 'chat',   model: 'ChatConversation', path: 'studentId', label: 'Chats with instructors' },
  { kind: 'scalar', model: 'ChatMessage', path: 'senderId', label: 'Chat messages' },
  { kind: 'array',  model: 'Program', path: 'studentIds', label: 'Programme rosters' },
  { kind: 'scalar', model: 'Device', path: 'userId', with: ['deviceId'], label: 'Approved devices' },
  { kind: 'scalar', model: 'Notification', path: 'userId', label: 'Notifications' },
  { kind: 'scalar', model: 'PushSubscription', path: 'userId', label: 'Browser push sign-ups' },
  { kind: 'scalar', model: 'PushToken', path: 'userId', label: 'App push sign-ups' },
  { kind: 'scalar', model: 'DigestQueue', path: 'userId', label: 'Queued digest mail' },
  { kind: 'scalar', model: 'CriticalMail', path: 'userId', label: 'Important mail log' },
  { kind: 'scalar', model: 'ImpersonationSession', path: 'targetId', label: 'Staff "view as student" log' },
]

/* User references a merge deliberately leaves alone. Staff-side fields (an
   instructor, a grader, an approver — a student is none of these), history
   that records who acted, and the merge's own records. RefreshToken and
   AuthToken are handled by closing the secondary (its sessions and pending
   codes end). Listed so the coverage test can tell "left alone on purpose"
   from "forgotten". */
export const NOT_MOVED = new Set([
  'User.approvedBy', 'User.rejectedBy', 'User.mergedInto',
  'RefreshToken.userId', 'AuthToken.userId', 'AuthToken.issuedBy', 'ClassHandoff.userId', 'ImpersonationHandoff.userId',
  'Device.approvedBy', 'Course.instructorId', 'Review.instructorId', 'InstructorReview.instructorId',
  'LiveClass.instructorId', 'LiveClass.coInstructorIds', 'LiveClass.backupLink.by', 'LiveClass.cancelledBy', 'LiveClass.verifiedBy',
  'AssignmentSubmission.gradedBy', 'ExamAttempt.gradedBy', 'HomeworkSubmission.gradedBy',
  'Announcement.createdBy', 'LearningPath.instructorId', 'ImpersonationSession.actorId', 'ImpersonationSession.revokedBy',
  'AuditLog.actorId', 'SystemSetting.updatedBy', 'MentorAvailability.mentorId', 'MentorTimeOff.mentorId',
  'Program.instructorId', 'Program.coInstructorIds', 'Program.createdById',
  'MentorMeeting.mentorId', 'MentorMeeting.outcome.withMentorId', 'MentorMeeting.outcome.filledById',
  'SessionHomework.assignedBy', 'ChatConversation.instructorId', 'ClassAssignment.instructorId', 'ClassAssignment.reviews.reviewerId',
  'InstructorScheduleMail.instructorId', 'ClassImport.createdBy', 'ClassImport.undoneBy', 'ClassImport.items.instructorId',
  'AccountMerge.primaryId', 'AccountMerge.secondaryId', 'AccountMerge.mergedBy', 'AccountMerge.undoneBy',
  'DuplicateDismissal.userIds', 'DuplicateDismissal.dismissedBy',
])

/* Every `ref: 'User'` path on every registered model, as "Model.path" —
   nested objects and arrays of sub-documents included. */
export function userRefPaths(): string[] {
  const out: string[] = []
  const walk = (model: string, schema: mongoose.Schema, prefix: string) => {
    schema.eachPath((path, type: any) => {
      const full = prefix + path
      const ref = type?.options?.ref
        ?? type?.caster?.options?.ref
        ?? type?.embeddedSchemaType?.options?.ref
        ?? (Array.isArray(type?.options?.type) ? type.options.type[0]?.ref : undefined)
      if (ref === 'User') out.push(`${model}.${full}`)
      if (type?.schema instanceof mongoose.Schema) walk(model, type.schema, full + '.')
    })
  }
  for (const name of mongoose.modelNames()) walk(name, mongoose.model(name).schema, '')
  return [...new Set(out)]
}

/** User references neither moved by a merge nor deliberately left alone. */
export function uncoveredUserRefs(): string[] {
  const handled = new Set(REFS.map(r => (r.kind === 'sub' ? `${r.model}.${r.path}.${r.key}` : `${r.model}.${r.path}`)))
  return userRefPaths().filter(p => !handled.has(p) && !NOT_MOVED.has(p))
}

/* ── The account details an admin picks between ─────── */
export const PICK_GROUPS = {
  name:         { label: 'Name',                fields: ['name'] },
  phone:        { label: 'Phone',               fields: ['phone', 'enrollmentApplication.phone'] },
  photo:        { label: 'Photo',               fields: ['avatarUrl'] },
  registration: { label: 'Registration details', fields: ['enrollmentApplication', 'fullRegistrationSubmittedAt', 'signupType', 'registrationDue'] },
  academy:      { label: 'Academy',             fields: ['organizationId'] },
  approval:     { label: 'Approval',            fields: ['enrollmentStatus', 'approvedBy', 'approvedByEmail', 'approvedByName', 'approvedByRole', 'approvedAt', 'rejectedBy', 'rejectedByEmail', 'rejectedByName', 'rejectedAt', 'rejectionReason'] },
} as const
export type PickGroup = keyof typeof PICK_GROUPS
export type Picks = Partial<Record<PickGroup, Side>>

const USER_FIELDS = 'name email phone avatarUrl role isActive isVerified signupType enrollmentStatus categories category ' +
  'organizationId lastLoginAt createdAt enrollmentApplication fullRegistrationSubmittedAt registrationDue mergedInto secondaryEmails ' +
  'approvedBy approvedByEmail approvedByName approvedByRole approvedAt rejectedBy rejectedByEmail rejectedByName rejectedAt rejectionReason'

const phoneOf = (u: Lean): string => String(u.phone || u.enrollmentApplication?.phone || '').trim()
const get = (o: Lean, path: string): unknown => path.split('.').reduce<any>((v, k) => (v == null ? v : v[k]), o)
const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)
const regFilled = (u: Lean) => Object.values(u.enrollmentApplication ?? {}).filter(filled).length

/* ── Finding ─────────────────────────────────────────── */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]!
}
const letters = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z؀-ۿऀ-෿ ]/g, '').replace(/\s+/g, ' ').trim()
const idOf = (u: Lean) => String(u.enrollmentApplication?.idNumber || u.enrollmentApplication?.emiratesId || '').replace(/[^0-9a-z]/gi, '').toLowerCase()

export type Confidence = 'high' | 'medium' | 'low'
function judge(members: Lean[]): { confidence: Confidence; reasons: string[] } {
  const reasons: string[] = []
  const pairs: [Lean, Lean][] = []
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) pairs.push([members[i]!, members[j]!])
  let high = false, medium = false
  for (const [a, b] of pairs) {
    const ia = idOf(a), ib = idOf(b)
    if (ia && ia === ib) { high = true; reasons.push('Same ID number') }
    const da = a.enrollmentApplication?.dateOfBirth, db = b.enrollmentApplication?.dateOfBirth
    if (da && da === db) { high = true; reasons.push('Same date of birth') }
    const ea = String(a.email), eb = String(b.email)
    if (levenshtein(ea, eb) <= 2 || ea.split('@')[0] === eb.split('@')[0]) { high = true; reasons.push('Email nearly the same') }
    const na = letters(a.name ?? ''), nb = letters(b.name ?? '')
    if (na && nb && (na === nb || na.startsWith(nb) || nb.startsWith(na) || levenshtein(na, nb) <= 2)) { medium = true; reasons.push('Similar name') }
  }
  reasons.unshift('Same phone number')
  return { confidence: high ? 'high' : medium ? 'medium' : 'low', reasons: [...new Set(reasons)] }
}

const groupKey = (ids: string[]) => [...ids].sort().join(':')

export interface DuplicateAccount {
  id: string; name: string; email: string; phone: string; avatarUrl?: string
  isActive: boolean; isVerified: boolean; enrollmentStatus?: string; signupType?: string
  organizationId?: string; lastLoginAt?: Date; createdAt?: Date
}
export interface DuplicateGroup { key: string; phone: string; confidence: Confidence; reasons: string[]; accounts: DuplicateAccount[]; dismissed?: boolean }

const summarize = (u: Lean): DuplicateAccount => ({
  id: String(u._id), name: u.name ?? '', email: u.email ?? '', phone: phoneOf(u),
  ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
  isActive: u.isActive !== false, isVerified: !!u.isVerified,
  enrollmentStatus: u.enrollmentStatus, signupType: u.signupType,
  ...(u.organizationId ? { organizationId: String(u.organizationId) } : {}),
  lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
})

export async function findDuplicateGroups(opts: { organizationId?: string; includeDismissed?: boolean } = {}): Promise<{ groups: DuplicateGroup[]; dismissed: number }> {
  const { UserModel, DuplicateDismissalModel } = await import('@/models/schema.ts')
  const students = await UserModel.find({
    role: 'student', mergedInto: { $exists: false },
    $or: [{ phone: { $nin: [null, ''] } }, { 'enrollmentApplication.phone': { $nin: [null, ''] } }],
  }).select(USER_FIELDS).lean<Lean[]>()

  /* One account can carry two different numbers (its own and the
     application's): it joins the group of each. */
  const byKey = new Map<string, Map<string, Lean>>()
  for (const u of students) {
    const keys = new Set([phoneKey(u.phone), phoneKey(u.enrollmentApplication?.phone)].filter((k): k is string => !!k))
    for (const k of keys) {
      if (!byKey.has(k)) byKey.set(k, new Map())
      byKey.get(k)!.set(String(u._id), u)
    }
  }
  const dismissedKeys = new Set((await DuplicateDismissalModel.find().select('key').lean<{ key: string }[]>()).map(d => d.key))

  const seen = new Set<string>()
  const groups: DuplicateGroup[] = []
  let dismissed = 0
  for (const [k, members] of byKey) {
    if (members.size < 2) continue
    const list = [...members.values()]
    const key = groupKey([...members.keys()])
    if (seen.has(key)) continue
    seen.add(key)
    if (opts.organizationId && !list.some(u => String(u.organizationId ?? '') === opts.organizationId)) continue
    const isDismissed = dismissedKeys.has(key)
    if (isDismissed) { dismissed++; if (!opts.includeDismissed) continue }
    const { confidence, reasons } = judge(list)
    groups.push({
      key, phone: '+' + k, confidence, reasons, ...(isDismissed ? { dismissed: true } : {}),
      accounts: list.sort((a, b) => +new Date(a.createdAt ?? 0) - +new Date(b.createdAt ?? 0)).map(summarize),
    })
  }
  const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 }
  groups.sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.phone.localeCompare(b.phone))
  return { groups, dismissed }
}

export async function dismissGroup(userIds: string[], by: string): Promise<{ key: string }> {
  const ids = [...new Set(userIds)]
  if (ids.length < 2 || !ids.every(i => Types.ObjectId.isValid(i))) throw new UserError('INVALID_GROUP', 'Pick at least two accounts.', 422)
  const { DuplicateDismissalModel } = await import('@/models/schema.ts')
  const key = groupKey(ids)
  await DuplicateDismissalModel.updateOne({ key }, { $setOnInsert: { key, userIds: ids, dismissedBy: by } }, { upsert: true })
  return { key }
}

export async function undismissGroup(key: string): Promise<void> {
  const { DuplicateDismissalModel } = await import('@/models/schema.ts')
  await DuplicateDismissalModel.deleteOne({ key })
}

/* ── Comparing two accounts ──────────────────────────── */
async function loadPair(primaryId: string, secondaryId: string): Promise<{ p: Lean; s: Lean }> {
  if (!Types.ObjectId.isValid(primaryId) || !Types.ObjectId.isValid(secondaryId)) throw new UserError('INVALID_ID', 'Invalid account id.', 400)
  if (primaryId === secondaryId) throw new UserError('SAME_ACCOUNT', 'Pick two different accounts.', 400)
  const { UserModel } = await import('@/models/schema.ts')
  const [p, s] = await Promise.all([
    UserModel.findById(primaryId).select(USER_FIELDS).lean<Lean>(),
    UserModel.findById(secondaryId).select(USER_FIELDS).lean<Lean>(),
  ])
  if (!p || !s) throw new UserError('USER_NOT_FOUND', 'One of the accounts no longer exists.', 404)
  if (p.role !== 'student' || s.role !== 'student') throw new UserError('NOT_A_STUDENT', 'Only student accounts can be merged.', 400)
  if (p.mergedInto || s.mergedInto) throw new UserError('ALREADY_MERGED', 'One of these accounts was already merged into another.', 409)
  return { p, s }
}

const COUNTED: { key: string; model: string; path: string; label: string; filter?: Record<string, unknown> }[] = [
  { key: 'courses',     model: 'Enrollment',     path: 'userId', label: 'Courses' },
  { key: 'bookings',    model: 'ClassBooking',   path: 'userId', label: 'Class bookings' },
  { key: 'attended',    model: 'ClassBooking',   path: 'userId', label: 'Classes attended', filter: { status: 'attended' } },
  { key: 'orders',      model: 'Order',          path: 'userId', label: 'Orders' },
  { key: 'lessonsDone', model: 'LessonProgress', path: 'userId', label: 'Lessons completed', filter: { isCompleted: true } },
  { key: 'homework',    model: 'HomeworkSubmission', path: 'userId', label: 'Homework' },
  { key: 'tickets',     model: 'SupportTicket',  path: 'userId', label: 'Support tickets' },
  { key: 'chats',       model: 'ChatConversation', path: 'studentId', label: 'Chats' },
]

async function countsFor(id: unknown): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  await Promise.all(COUNTED.map(async c => {
    out[c.key] = await mongoose.model(c.model).countDocuments({ [c.path]: id, ...(c.filter ?? {}) })
  }))
  return out
}

/* Which to keep, unasked: the one whose email was proven (it is the inbox
   the student reads), then the one used to sign in, then the busier one. */
function score(u: Lean, counts: Record<string, number>): number {
  return (u.isVerified ? 1e9 : 0)
    + (u.lastLoginAt ? 1e8 + Math.min(+new Date(u.lastLoginAt) / 1e5, 9e7) : 0)
    + Object.values(counts).reduce((a, b) => a + b, 0) * 1000
    + (u.avatarUrl ? 10 : 0) + regFilled(u)
}

function defaultPicks(p: Lean, s: Lean): Picks {
  const picks: Picks = {}
  for (const g of Object.keys(PICK_GROUPS) as PickGroup[]) {
    let side: Side = 'primary'
    if (g === 'phone')             side = !phoneOf(p) && phoneOf(s) ? 'secondary' : 'primary'
    else if (g === 'registration') side = regFilled(s) > regFilled(p) ? 'secondary' : 'primary'
    else if (g === 'approval')     side = p.enrollmentStatus !== 'approved' && s.enrollmentStatus === 'approved' ? 'secondary' : 'primary'
    else {
      const f = PICK_GROUPS[g].fields[0]
      side = !filled(get(p, f)) && filled(get(s, f)) ? 'secondary' : 'primary'
    }
    picks[g] = side
  }
  return picks
}

export interface CompareAccount extends DuplicateAccount {
  secondaryEmails: string[]
  counts: Record<string, number>
  categories: string[]
  details: Record<PickGroup, string>
}

const detailText = (u: Lean, orgNames: Map<string, string>): Record<PickGroup, string> => ({
  name: u.name ?? '',
  phone: phoneOf(u),
  photo: u.avatarUrl ? 'Has a photo' : 'No photo',
  registration: regFilled(u) ? `${regFilled(u)} details filled${u.enrollmentApplication?.idNumber ? ` · ID ${u.enrollmentApplication.idNumber}` : ''}` : 'Not filled',
  academy: orgNames.get(String(u.organizationId ?? '')) ?? '—',
  approval: u.enrollmentStatus ?? '—',
})

export async function compareAccounts(ids: string[]): Promise<{ accounts: CompareAccount[]; suggestedPrimaryId: string; countLabels: Record<string, string> }> {
  if (ids.length !== 2) throw new UserError('INVALID_GROUP', 'Pick exactly two accounts to compare.', 422)
  const { p, s } = await loadPair(ids[0]!, ids[1]!)
  const { OrganizationModel } = await import('@/models/schema.ts')
  const orgNames = new Map((await OrganizationModel.find().select('name').lean<Lean[]>()).map(o => [String(o._id), o.name as string]))
  const [cp, cs] = await Promise.all([countsFor(p._id), countsFor(s._id)])
  const accounts = [[p, cp], [s, cs]].map(([u, c]) => ({
    ...summarize(u as Lean), counts: c as Record<string, number>,
    secondaryEmails: ((u as Lean).secondaryEmails ?? []).map((e: Lean) => e.email),
    categories: (u as Lean).categories ?? [], details: detailText(u as Lean, orgNames),
  }))
  const suggestedPrimaryId = score(s, cs) > score(p, cp) ? String(s._id) : String(p._id)
  return { accounts, suggestedPrimaryId, countLabels: Object.fromEntries(COUNTED.map(c => [c.key, c.label])) }
}

/* ── Planning a merge ────────────────────────────────── */
interface Step {
  ref: Ref
  move: Types.ObjectId[]                 // rows to point at the primary
  dropSecondary: Lean[]                  // the secondary's losing copies
  dropPrimary: Lean[]                    // the primary's losing copies (the secondary's copy is moved instead)
  pull: Types.ObjectId[]                 // arrays holding both ids: the secondary's comes out
  chatInto: { from: Lean; into: Lean }[] // two conversations with one instructor: messages join the primary's
}

async function planStep(ref: Ref, P: Types.ObjectId, S: Types.ObjectId): Promise<Step> {
  const M = mongoose.model(ref.model)
  const step: Step = { ref, move: [], dropSecondary: [], dropPrimary: [], pull: [], chatInto: [] }
  if (ref.kind === 'array') {
    step.pull = await M.find({ [ref.path]: { $all: [S, P] } }).distinct('_id')
    step.move = await M.find({ [ref.path]: S, _id: { $nin: step.pull } }).distinct('_id')
    return step
  }
  if (ref.kind === 'sub') {
    step.move = await M.find({ [`${ref.path}.${ref.key}`]: S }).distinct('_id')
    return step
  }
  if (ref.kind === 'chat') {
    for (const sc of await M.find({ studentId: S }).lean<Lean[]>()) {
      const pc = await M.findOne({ studentId: P, instructorId: sc.instructorId }).lean<Lean>()
      if (pc) step.chatInto.push({ from: sc, into: pc })
      else step.move.push(sc._id)
    }
    return step
  }
  if (!ref.with) {
    step.move = await M.find({ [ref.path]: S }).distinct('_id')
    return step
  }
  for (const sd of await M.find({ [ref.path]: S }).lean<Lean[]>()) {
    const q: Record<string, unknown> = { [ref.path]: P }
    for (const k of ref.with) q[k] = sd[k]
    const pd = await M.findOne(q).lean<Lean>()
    if (!pd) { step.move.push(sd._id); continue }
    if ((ref.prefer?.(pd, sd) ?? 'primary') === 'primary') step.dropSecondary.push(sd)
    else { step.dropPrimary.push(pd); step.move.push(sd._id) }
  }
  return step
}

export interface PlanItem { model: string; label: string; moved: number; dropped: number; kept: string[] }

function describe(steps: Step[]): PlanItem[] {
  return steps
    .map(st => ({
      model: st.ref.model, label: st.ref.label,
      moved: st.move.length + st.chatInto.length,
      dropped: st.dropSecondary.length + st.dropPrimary.length + st.pull.length,
      kept: [
        ...(st.dropSecondary.length ? [`${st.dropSecondary.length} kept from the account you keep`] : []),
        ...(st.dropPrimary.length ? [`${st.dropPrimary.length} kept from the account being closed (further along)`] : []),
        ...(st.chatInto.length ? [`${st.chatInto.length} chat${st.chatInto.length === 1 ? '' : 's'} joined into one`] : []),
      ],
    }))
    .filter(i => i.moved || i.dropped)
}

/* Reads only — every model at once; the steps are then applied one by one, in REFS order. */
function planAll(P: Types.ObjectId, S: Types.ObjectId): Promise<Step[]> {
  return Promise.all(REFS.map(ref => planStep(ref, P, S)))
}

function normalisePicks(p: Lean, s: Lean, picks?: Picks): Picks {
  const out = defaultPicks(p, s)
  for (const [g, side] of Object.entries(picks ?? {})) {
    if (g in PICK_GROUPS && (side === 'primary' || side === 'secondary')) out[g as PickGroup] = side
  }
  return out
}

/* What the primary account will say after the merge: the picked side's value
   of each detail; programmes (categories) are both accounts' together. */
function userUpdate(p: Lean, s: Lean, picks: Picks): { $set: Record<string, unknown>; $unset: Record<string, ''>; touched: string[] } {
  const $set: Record<string, unknown> = {}
  const $unset: Record<string, ''> = {}
  const order: PickGroup[] = ['name', 'photo', 'registration', 'academy', 'approval', 'phone']   // phone last: it writes into the registration block
  for (const g of order) {
    if (picks[g] !== 'secondary') continue
    if (g === 'phone') {
      const v = phoneOf(s)
      $set['phone'] = v
      if (p.enrollmentApplication || $set['enrollmentApplication']) {
        if ($set['enrollmentApplication']) ($set['enrollmentApplication'] as Lean).phone = v
        else $set['enrollmentApplication.phone'] = v
      }
      continue
    }
    for (const f of PICK_GROUPS[g].fields) {
      const v = get(s, f)
      if (v === undefined || v === null) $unset[f] = ''
      else $set[f] = f === 'enrollmentApplication' ? { ...(v as Lean) } : v
    }
  }
  const cats = [...new Set([...(p.categories ?? []), ...(s.categories ?? [])])]
  if (cats.length !== (p.categories ?? []).length) $set['categories'] = cats
  if (!p.category && s.category) $set['category'] = s.category
  const touched = [...new Set([...Object.keys($set), ...Object.keys($unset)].map(f => f.split('.')[0]!))]
  return { $set, $unset, touched }
}

export async function previewMerge(primaryId: string, secondaryId: string, picks?: Picks): Promise<{
  items: PlanItem[]; picks: Picks; result: Record<PickGroup, string>; categories: string[]
}> {
  const { p, s } = await loadPair(primaryId, secondaryId)
  const chosen = normalisePicks(p, s, picks)
  const items = describe(await planAll(p._id, s._id))
  const { OrganizationModel } = await import('@/models/schema.ts')
  const orgNames = new Map((await OrganizationModel.find().select('name').lean<Lean[]>()).map(o => [String(o._id), o.name as string]))
  const dp = detailText(p, orgNames), ds = detailText(s, orgNames)
  const result = Object.fromEntries((Object.keys(PICK_GROUPS) as PickGroup[]).map(g => [g, chosen[g] === 'secondary' ? ds[g] : dp[g]])) as Record<PickGroup, string>
  return { items, picks: chosen, result, categories: [...new Set([...(p.categories ?? []), ...(s.categories ?? [])])] }
}

/* ── Merging ─────────────────────────────────────────── */
type Op =
  | { op: 'set'; model: string; path: string; ids: Types.ObjectId[]; from: unknown; to: unknown }
  | { op: 'delete'; model: string; doc: Lean }
  | { op: 'pull'; model: string; path: string; ids: Types.ObjectId[]; value: Types.ObjectId; at?: { id: Types.ObjectId; pos: number }[] }
  | { op: 'replaceIn'; model: string; path: string; ids: Types.ObjectId[]; from: Types.ObjectId; to: Types.ObjectId }
  | { op: 'replaceSub'; model: string; path: string; key: string; ids: Types.ObjectId[]; from: Types.ObjectId; to: Types.ObjectId }
  | { op: 'patch'; model: string; id: Types.ObjectId; before: Lean }

const LOCK_MS = 10 * 60_000

async function lock(ids: string[]): Promise<() => Promise<void>> {
  const { MutexModel } = await import('@/models/schema.ts')
  const keys = [...ids].sort().map(i => `account-merge:${i}`)
  const taken: string[] = []
  try {
    for (const key of keys) {
      await MutexModel.deleteOne({ key, expiresAt: { $lt: new Date() } })
      await MutexModel.create({ key, expiresAt: new Date(Date.now() + LOCK_MS) })
      taken.push(key)
    }
  } catch (err: any) {
    await MutexModel.deleteMany({ key: { $in: taken } })
    if (err?.code === 11000) throw new UserError('MERGE_IN_PROGRESS', 'One of these accounts is being merged right now. Try again in a minute.', 409)
    throw err
  }
  return async () => { await MutexModel.deleteMany({ key: { $in: taken } }) }
}

async function applyStep(st: Step, P: Types.ObjectId, S: Types.ObjectId, journal: (ops: Op[]) => Promise<void>): Promise<void> {
  const ref = st.ref
  const M = mongoose.model(ref.model)
  /* Drops first: a unique index will not let the moved copy in beside the old one. */
  for (const doc of [...st.dropSecondary, ...st.dropPrimary]) {
    await journal([{ op: 'delete', model: ref.model, doc }])
    await M.collection.deleteOne({ _id: doc._id })
  }
  if (ref.kind === 'array') {
    if (st.pull.length) {
      /* Where in each list it stood, so an undo puts it back in its place. */
      const at = (await M.find({ _id: { $in: st.pull } }).select(ref.path).lean<Lean[]>())
        .map(d => ({ id: d._id, pos: (get(d, ref.path) as unknown[]).findIndex(x => String(x) === String(S)) }))
      await journal([{ op: 'pull', model: ref.model, path: ref.path, ids: st.pull, value: S, at }])
      await M.collection.updateMany({ _id: { $in: st.pull } }, { $pull: { [ref.path]: S } } as never)
    }
    if (st.move.length) {
      await journal([{ op: 'replaceIn', model: ref.model, path: ref.path, ids: st.move, from: S, to: P }])
      await M.collection.updateMany({ _id: { $in: st.move } }, { $set: { [`${ref.path}.$[e]`]: P } }, { arrayFilters: [{ e: S }] })
    }
    return
  }
  if (ref.kind === 'sub') {
    if (st.move.length) {
      await journal([{ op: 'replaceSub', model: ref.model, path: ref.path, key: ref.key, ids: st.move, from: S, to: P }])
      await M.collection.updateMany({ _id: { $in: st.move } }, { $set: { [`${ref.path}.$[m].${ref.key}`]: P } }, { arrayFilters: [{ [`m.${ref.key}`]: S }] })
    }
    return
  }
  if (ref.kind === 'chat') {
    const Msg = mongoose.model('ChatMessage')
    for (const { from, into } of st.chatInto) {
      const msgIds = await Msg.find({ conversationId: from._id }).distinct('_id')
      if (msgIds.length) {
        await journal([{ op: 'set', model: 'ChatMessage', path: 'conversationId', ids: msgIds, from: from._id, to: into._id }])
        await Msg.collection.updateMany({ _id: { $in: msgIds } }, { $set: { conversationId: into._id } })
      }
      const fields = ['lastMessageAt', 'lastMessagePreview', 'lastSenderRole', 'studentUnread', 'instructorUnread']
      await journal([{ op: 'patch', model: ref.model, id: into._id, before: Object.fromEntries(fields.map(f => [f, into[f]])) }])
      const newer = +new Date(from.lastMessageAt ?? 0) > +new Date(into.lastMessageAt ?? 0) ? from : into
      await M.collection.updateOne({ _id: into._id }, { $set: {
        lastMessageAt: newer.lastMessageAt, lastMessagePreview: newer.lastMessagePreview ?? '', lastSenderRole: newer.lastSenderRole,
        studentUnread: num(into.studentUnread) + num(from.studentUnread), instructorUnread: num(into.instructorUnread) + num(from.instructorUnread),
      } })
      await journal([{ op: 'delete', model: ref.model, doc: from }])
      await M.collection.deleteOne({ _id: from._id })
    }
  }
  if (st.move.length) {
    await journal([{ op: 'set', model: ref.model, path: ref.path, ids: st.move, from: S, to: P }])
    await M.collection.updateMany({ _id: { $in: st.move }, [ref.path]: S }, { $set: { [ref.path]: P } })
  }
}

/* The kept account's secondary emails after the merge: its own, the closed
   account's (from merges into it before), and the closed account's address
   itself — never the kept account's own address, each once. */
function secondaryEmailsAfter(p: Lean, s: Lean, mergeId: Types.ObjectId): Lean[] {
  const out = new Map<string, Lean>()
  for (const e of [...(p.secondaryEmails ?? []), ...(s.secondaryEmails ?? [])]) if (e?.email) out.set(e.email, e)
  out.set(String(s.email), { email: String(s.email), source: 'merge', mergeId, addedAt: new Date() })
  out.delete(String(p.email))
  return [...out.values()]
}

export async function mergeAccounts(input: {
  primaryId: string; secondaryId: string; picks?: Picks; confirmEmail: string
  /** Save the closed account's email on the kept one as a secondary email (default yes). */
  keepSecondaryEmail?: boolean
  by: { id: string; email?: string }
}): Promise<{ mergeId: string; primaryId: string; secondaryEmail: string; keptSecondaryEmail: boolean; items: PlanItem[] }> {
  const { p, s } = await loadPair(input.primaryId, input.secondaryId)
  if (String(input.confirmEmail ?? '').toLowerCase().trim() !== String(s.email).toLowerCase()) {
    throw new UserError('CONFIRM_MISMATCH', `Type ${s.email} to confirm which account is closed.`, 422)
  }
  const release = await lock([String(p._id), String(s._id)])
  const { UserModel, AccountMergeModel, AuthTokenModel } = await import('@/models/schema.ts')
  let mergeId = ''
  try {
    /* Read again under the lock: another admin may have merged one a moment ago. */
    const { p: P0, s: S0 } = await loadPair(String(p._id), String(s._id))
    const picks = normalisePicks(P0, S0, input.picks)
    const upd = userUpdate(P0, S0, picks)
    const P = P0._id as Types.ObjectId, S = S0._id as Types.ObjectId
    const recId = new Types.ObjectId()
    const keepEmail = input.keepSecondaryEmail !== false
    if (keepEmail) {
      upd.$set['secondaryEmails'] = secondaryEmailsAfter(P0, S0, recId)
      if (!upd.touched.includes('secondaryEmails')) upd.touched.push('secondaryEmails')
    }

    const primaryBefore = Object.fromEntries(upd.touched.map(f => [f, P0[f] ?? null]))
    const secondaryBefore = { isActive: S0.isActive !== false, mergedInto: null, mergedAt: null }
    const rec = await AccountMergeModel.create({
      _id: recId, primaryId: P, secondaryId: S, primaryEmail: P0.email, secondaryEmail: S0.email, picks, keptSecondaryEmail: keepEmail,
      before: { primary: primaryBefore, secondary: secondaryBefore },
      mergedBy: input.by.id, mergedByEmail: input.by.email, status: 'running',
    })
    mergeId = String(rec._id)
    const journal = async (ops: Op[]) => { await AccountMergeModel.updateOne({ _id: rec._id }, { $push: { ops: { $each: ops } } }) }

    const steps = await planAll(P, S)
    for (const st of steps) await applyStep(st, P, S, journal)

    /* The primary's details as picked. An academy taken from the secondary
       moves the enrolment rows with it, as "Move to academy" does. */
    if (Object.keys(upd.$set).length || Object.keys(upd.$unset).length) {
      await UserModel.collection.updateOne({ _id: P }, {
        ...(Object.keys(upd.$set).length ? { $set: upd.$set } : {}),
        ...(Object.keys(upd.$unset).length ? { $unset: upd.$unset } : {}),
      })
    }
    if (picks.academy === 'secondary' && S0.organizationId && String(S0.organizationId) !== String(P0.organizationId ?? '')) {
      const E = mongoose.model('Enrollment')
      const rows = await E.find({ userId: P, organizationId: { $ne: S0.organizationId } }).select('organizationId').lean<Lean[]>()
      for (const r of rows) {
        await journal([{ op: 'patch', model: 'Enrollment', id: r._id, before: { organizationId: r.organizationId ?? null } }])
        await E.collection.updateOne({ _id: r._id }, { $set: { organizationId: S0.organizationId } })
      }
    }

    /* Close the secondary: no sign-in, no session, no pending code or link. */
    await UserModel.collection.updateOne({ _id: S }, { $set: { isActive: false, mergedInto: P, mergedAt: new Date() } })
    const { RefreshTokenRepository } = await import('@/repositories/user.repository.ts')
    await new RefreshTokenRepository().revokeAllForUser(String(S), 'security')
    await AuthTokenModel.deleteMany({ userId: S, usedAt: { $exists: false } })
    /* Earlier merges into the secondary now point at the primary, so their emails still land somewhere open. */
    const earlier = await UserModel.find({ mergedInto: S }).distinct('_id')
    if (earlier.length) {
      await journal([{ op: 'set', model: 'User', path: 'mergedInto', ids: earlier, from: S, to: P }])
      await UserModel.collection.updateMany({ _id: { $in: earlier } }, { $set: { mergedInto: P } })
    }

    const items = describe(steps)
    await AccountMergeModel.updateOne({ _id: rec._id }, {
      $set: { status: 'done', summary: items.map(i => ({ model: i.model, label: i.label, moved: i.moved, dropped: i.dropped })) },
    })
    logger.info({ mergeId, primaryId: String(P), secondaryId: String(S), by: input.by.id }, 'student accounts merged')
    return { mergeId, primaryId: String(P), secondaryEmail: S0.email, keptSecondaryEmail: keepEmail, items }
  } catch (err) {
    if (mergeId) {
      await AccountMergeModel.updateOne({ _id: mergeId }, { $set: { status: 'failed', error: String((err as Error)?.message ?? err) } }).catch(() => {})
      logger.error({ err, mergeId }, 'account merge failed part-way — undo it from the merge history')
    }
    throw err
  } finally {
    await release()
  }
}

/* ── Undoing ─────────────────────────────────────────────
   The journal backwards: moved rows go back, dropped rows come back, the two
   accounts say what they said. Rows the student made AFTER the merge stay on
   the primary — except where they sit inside something that moves back
   (a message in a ticket that was the secondary's goes back with it). What
   cannot go back (a dropped row whose place is now taken) is reported, not
   forced. */
export async function undoMerge(mergeId: string, by: string): Promise<{ notes: string[] }> {
  if (!Types.ObjectId.isValid(mergeId)) throw new UserError('INVALID_ID', 'Invalid merge id.', 400)
  const { AccountMergeModel, UserModel } = await import('@/models/schema.ts')
  const rec = await AccountMergeModel.findById(mergeId).lean<Lean>()
  if (!rec) throw new UserError('MERGE_NOT_FOUND', 'That merge does not exist.', 404)
  if (rec.status === 'undone') throw new UserError('ALREADY_UNDONE', 'This merge was already undone.', 409)
  if (rec.status === 'running') {
    const stale = Date.now() - +new Date(rec.updatedAt ?? rec.createdAt) > LOCK_MS
    if (!stale) throw new UserError('MERGE_IN_PROGRESS', 'This merge is still running.', 409)
  }
  const release = await lock([String(rec.primaryId), String(rec.secondaryId)])
  const notes: string[] = []
  try {
    const ops = [...(rec.ops as Op[])].reverse()
    for (const o of ops) {
      const M = mongoose.model(o.model)
      try {
        if (o.op === 'set') {
          await M.collection.updateMany({ _id: { $in: o.ids }, [o.path]: o.to }, { $set: { [o.path]: o.from } })
        } else if (o.op === 'delete') {
          await M.collection.insertOne(o.doc)
        } else if (o.op === 'pull') {
          for (const id of o.ids) {
            const pos = o.at?.find(x => String(x.id) === String(id))?.pos ?? -1
            await M.collection.updateOne({ _id: id, [o.path]: { $ne: o.value } },
              { $push: { [o.path]: pos >= 0 ? { $each: [o.value], $position: pos } : o.value } } as never)
          }
        } else if (o.op === 'replaceIn') {
          await M.collection.updateMany({ _id: { $in: o.ids } }, { $set: { [`${o.path}.$[e]`]: o.from } }, { arrayFilters: [{ e: o.to }] })
        } else if (o.op === 'replaceSub') {
          await M.collection.updateMany({ _id: { $in: o.ids } }, { $set: { [`${o.path}.$[m].${o.key}`]: o.from } }, { arrayFilters: [{ [`m.${o.key}`]: o.to }] })
        } else if (o.op === 'patch') {
          const $set: Lean = {}, $unset: Lean = {}
          for (const [k, v] of Object.entries(o.before)) (v === null || v === undefined ? ($unset[k] = '') : ($set[k] = v))
          await M.collection.updateOne({ _id: o.id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) })
        }
      } catch (err: any) {
        const what = o.op === 'delete' ? `a ${o.model} row` : `${o.model} (${o.op})`
        notes.push(err?.code === 11000
          ? `Could not bring back ${what}: the account has made the same one since.`
          : `Could not restore ${what}: ${String(err?.message ?? err)}`)
      }
    }
    const restore = async (id: unknown, before: Lean) => {
      const $set: Lean = {}, $unset: Lean = {}
      for (const [k, v] of Object.entries(before ?? {})) (v === null || v === undefined ? ($unset[k] = '') : ($set[k] = v))
      if (Object.keys($set).length || Object.keys($unset).length) {
        await UserModel.collection.updateOne({ _id: id as Types.ObjectId }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) })
      }
    }
    await restore(rec.primaryId, rec.before?.primary)
    await restore(rec.secondaryId, rec.before?.secondary)
    await AccountMergeModel.updateOne({ _id: rec._id }, { $set: { status: 'undone', undoneAt: new Date(), undoneBy: by, ...(notes.length ? { undoNotes: notes } : {}) } })
    logger.info({ mergeId, by, notes: notes.length }, 'account merge undone')
    return { notes }
  } finally {
    await release()
  }
}

export async function listMerges(params: { page: number; perPage: number }): Promise<{ docs: Lean[]; total: number }> {
  const { AccountMergeModel } = await import('@/models/schema.ts')
  const [docs, total] = await Promise.all([
    AccountMergeModel.find().sort({ createdAt: -1 }).skip((params.page - 1) * params.perPage).limit(params.perPage)
      .select('primaryId secondaryId primaryEmail secondaryEmail picks keptSecondaryEmail summary status error mergedByEmail undoneAt undoNotes createdAt').lean<Lean[]>(),
    AccountMergeModel.countDocuments(),
  ])
  return {
    docs: docs.map(d => ({
      id: String(d._id), primaryId: String(d.primaryId), secondaryId: String(d.secondaryId),
      primaryEmail: d.primaryEmail, secondaryEmail: d.secondaryEmail, keptSecondaryEmail: !!d.keptSecondaryEmail, summary: d.summary ?? [],
      status: d.status, error: d.error, mergedByEmail: d.mergedByEmail, undoneAt: d.undoneAt,
      undoNotes: d.undoNotes, createdAt: d.createdAt,
    })),
    total,
  }
}
