/* ─────────────────────────────────────────────────────
   New students → Tetra Commission
   ─────────────────────────────────────────────────────
   Tetra Commission (the commission portal) keeps its own list of Delta
   students, each given to one of its teams in turn. Students enrolled through
   finance already reach it from finance, with their invoice. This sends every
   other new student: website sign-ups, invited students, store and manual
   purchases, admin enrolments.

   A student is sent once they are a real student — approved by an admin, or
   given a course — and only if they were created after sending was first
   switched on (the moment is kept in SystemSetting "commission_students_since"),
   so nobody from before is ever sent. Both academies.

   A sweep rather than a call at each place a student is made: there are seven
   such places and five more that approve, and a hook missed at any one of them
   would drop students silently. Tetra Commission is idempotent on the LMS user
   id and leaves an email it already has alone, so a retry never makes a second
   student. Sending never holds up a sign-up or an enrolment.

   Off unless COMMISSION_API_URL and COMMISSION_S2S_SECRET are set (the secret
   equals LMS_S2S_SECRET on the Tetra Commission server).
───────────────────────────────────────────────────── */
import { EnrollmentModel, UserModel, OrganizationModel, CourseModel, SystemSettingModel } from '@/models/schema.ts'
import { logger } from '@/utils/logger.ts'

const BATCH = 20
const MAX_ATTEMPTS = 8
const TIMEOUT_MS = 20_000
/* A student made a moment ago may still be half-way through the request that
   made them — finance marks its enrolment in that same request — so they wait
   a minute before counting. */
const SETTLE_MS = 60_000
export const SINCE_KEY = 'commission_students_since'

export function commissionConfigured(): boolean {
  return Boolean(process.env['COMMISSION_API_URL'] && process.env['COMMISSION_S2S_SECRET'])
}

/* Refused in a way that will not come right on its own — a bad secret, a malformed student. */
export class CommissionPermanentError extends Error {}
/* Up, but not ready yet: still on code without this route (404), or its secret
   not set (503). Waited for, however long, rather than given up on. */
export class CommissionNotReadyError extends Error {}

export interface CommissionAnswer {
  created:     boolean
  existing:    'lms' | 'email' | null
  studentId:   string
  studentCode: string
  assignment:  'assigned' | 'open_pool'
  mentorName:  string
  teamName:    string
  detail:      string
}

export async function sendToCommission(input: {
  lmsUserId: string
  email:     string
  name?:     string
  phone?:    string
  country?:  string
  academy?:  string
  course?:   string
}): Promise<CommissionAnswer> {
  const base = String(process.env['COMMISSION_API_URL'] ?? '').replace(/\/+$/, '')
  const res = await fetch(`${base}/api/v1/integrations/lms/students`, {
    method:  'POST',
    headers: { 'content-type': 'application/json', 'x-lms-secret': String(process.env['COMMISSION_S2S_SECRET'] ?? '') },
    body:    JSON.stringify(input),
    signal:  AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = await res.json().catch(() => ({})) as { data?: CommissionAnswer; error?: { message?: string } | string }
  if (!res.ok) {
    const message = (typeof body.error === 'object' ? body.error?.message : body.error) ?? `Tetra Commission refused with ${res.status}`
    if (res.status === 404 || res.status === 503) throw new CommissionNotReadyError(message)
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new CommissionPermanentError(message)
    throw new Error(message)
  }
  if (!body.data) throw new Error('Tetra Commission returned no result')
  return body.data
}

/* When sending was first switched on — set the first time it is asked, then fixed. */
export async function sendingSince(now = new Date()): Promise<Date> {
  const row = await SystemSettingModel.findOneAndUpdate(
    { key: SINCE_KEY },
    { $setOnInsert: { key: SINCE_KEY, value: now.toISOString() } },
    { upsert: true, new: true },
  ).lean() as { value?: unknown } | null
  const since = new Date(String(row?.value ?? now.toISOString()))
  return Number.isNaN(since.getTime()) ? now : since
}

const backoffMs = (attempts: number) => Math.min(2 ** attempts * 1000, 15 * 60_000)

type Student = {
  _id: unknown; name?: string; email: string; organizationId?: unknown
  enrollmentApplication?: { phone?: string; homeCountry?: string; addressCountry?: string; nationality?: string }
  commissionSync?: { attempts?: number }
}

export async function drainCommissionStudentsOnce(now = new Date()): Promise<{ sent: number; skipped: number; retry: number; failed: number }> {
  const tally = { sent: 0, skipped: 0, retry: 0, failed: 0 }
  if (!commissionConfigured()) return tally

  const since   = await sendingSince(now)
  const settled = new Date(now.getTime() - SETTLE_MS)

  // Given a course since sending began (a student cannot be enrolled before they exist).
  const enrolled = await EnrollmentModel.distinct('userId', { createdAt: { $gte: since, $lte: settled } })

  const due = await UserModel.find({
    role:      'student',
    isActive:  { $ne: false },
    createdAt: { $gte: since, $lte: settled },
    $and: [
      // Never sent, or waiting for its next try.
      { $or: [
        { 'commissionSync.state': { $exists: false } },
        { 'commissionSync.state': 'pending', 'commissionSync.nextAttemptAt': { $lte: now } },
      ] },
      // A real student: approved by an admin, or given a course.
      { $or: [{ enrollmentStatus: 'approved' }, { _id: { $in: enrolled } }] },
    ],
  })
    .select('name email organizationId enrollmentApplication commissionSync')
    .sort({ createdAt: 1 })
    .limit(BATCH)
    .lean() as unknown as Student[]

  for (const student of due) {
    // Finance enrolled them, so finance sends them — with the invoice, and once.
    const viaFinance = await EnrollmentModel.exists({ userId: student._id, 'paymentAccess.invoiceId': { $exists: true, $nin: [null, ''] } })
    if (viaFinance) {
      await UserModel.updateOne({ _id: student._id }, { $set: { commissionSync: { state: 'skipped', reason: 'Enrolled through finance, which sends them itself' } } })
      tally.skipped++
      continue
    }

    try {
      const first = await EnrollmentModel.findOne({ userId: student._id }).sort({ createdAt: 1 }).select('courseId').lean() as { courseId?: unknown } | null
      const [course, org] = await Promise.all([
        first?.courseId ? CourseModel.findById(first.courseId).select('title').lean() as Promise<{ title?: string } | null> : null,
        student.organizationId ? OrganizationModel.findById(student.organizationId).select('name').lean() as Promise<{ name?: string } | null> : null,
      ])
      const app = student.enrollmentApplication ?? {}
      const answer = await sendToCommission({
        lmsUserId: String(student._id),
        email:     student.email,
        name:      student.name,
        phone:     app.phone ?? '',
        country:   app.homeCountry || app.addressCountry || app.nationality || '',
        academy:   org?.name ?? '',
        course:    course?.title ?? '',
      })
      await UserModel.updateOne({ _id: student._id }, {
        $set: {
          'commissionSync.state':        'sent',
          'commissionSync.studentCode':  answer.studentCode,
          'commissionSync.mentorName':   answer.mentorName,
          'commissionSync.alreadyThere': answer.existing === 'email',
          'commissionSync.sentAt':       new Date(),
          // Kept from the first answer: a later re-send finds the student and names no team.
          ...(answer.teamName ? { 'commissionSync.team': answer.teamName } : {}),
        },
        $unset: { 'commissionSync.lastError': 1, 'commissionSync.nextAttemptAt': 1 },
      })
      tally.sent++
      logger.info({ userId: String(student._id), student: answer.studentCode, team: answer.teamName, existing: answer.existing },
        answer.existing === 'email' ? 'Student already in Tetra Commission — left as they are' : 'Student sent to Tetra Commission')
    } catch (err) {
      const permanent = err instanceof CommissionPermanentError
      const notReady  = err instanceof CommissionNotReadyError
      const attempts  = (student.commissionSync?.attempts ?? 0) + 1
      const message   = (err as Error).message?.slice(0, 500)
      const giveUp    = permanent || (!notReady && attempts >= MAX_ATTEMPTS)
      await UserModel.updateOne({ _id: student._id }, {
        $set: {
          'commissionSync.state':         giveUp ? 'failed' : 'pending',
          'commissionSync.attempts':      attempts,
          'commissionSync.lastError':     message,
          'commissionSync.nextAttemptAt': new Date(Date.now() + backoffMs(attempts)),
        },
      })
      tally[giveUp ? 'failed' : 'retry']++
      logger.warn({ userId: String(student._id), attempts, permanent, notReady, err: message }, 'Could not send a student to Tetra Commission')
    }
  }
  return tally
}
