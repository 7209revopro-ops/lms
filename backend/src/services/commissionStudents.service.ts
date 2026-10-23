/* ─────────────────────────────────────────────────────
   Forex students → Tetra Commission
   ─────────────────────────────────────────────────────
   Tetra Commission (the commission portal) keeps its own list of Delta's
   Forex students, each given to one of its teams in turn. Only Forex students
   go there: somebody put on a course whose programme is FOREX Trading
   (`program: '4x-trading'`, the FOREX Trading filter on the admin Courses
   page) — by the website checkout, an admin or a script. A sign-up with no
   course, or a student only on another programme's course, is not sent.
   Students enrolled through finance reach it from finance instead, with their
   invoice (and finance, too, sends only its Forex closes).

   Only a course given after sending was first switched on counts (the moment
   is kept in SystemSetting "commission_students_since"), so nobody enrolled
   before is ever sent. Both academies.

   This job used to send every new student once approved, most of them before
   they had any course. A student it sent then counts as sent here only once
   they have been sent with a Forex course — so one sent with none, and taken
   out of Tetra Commission since, goes back when they are given one. Tetra
   Commission is idempotent on the LMS user id and leaves an email it already
   has alone, so sending somebody it still has changes nothing there, and a
   retry never makes a second student.

   A sweep rather than a call at each place a course is given: there are seven
   such places, and a hook missed at any one of them would drop students
   silently. Sending never holds up an enrolment. The sweep runs every 15
   seconds, so a student is there within half a minute of counting.

   An outage is waited out however long it lasts; only a refusal that cannot
   come right (a bad secret, a malformed student) stops.

   Off unless COMMISSION_API_URL and COMMISSION_S2S_SECRET are set (the secret
   equals LMS_S2S_SECRET on the Tetra Commission server).
───────────────────────────────────────────────────── */
import { EnrollmentModel, UserModel, OrganizationModel, CourseModel, OrderModel, SystemSettingModel } from '@/models/schema.ts'
import { logger } from '@/utils/logger.ts'
import { recheckTetraCsLater } from '@/services/tetraCsRecheck.service.ts'

/* The programme Tetra Commission is for — "FOREX Trading" in the admin. */
export const FOREX_PROGRAMME = '4x-trading'

const BATCH = 20
const TIMEOUT_MS = 20_000
/* A student made a moment ago may still be half-way through the request that
   made them — finance marks its enrolment in that same request — so they wait
   a few seconds before counting. */
const SETTLE_MS = 15_000
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

  const forex = await CourseModel.find({ program: FOREX_PROGRAMME }).select('_id title').lean() as unknown as { _id: unknown; title?: string }[]
  if (!forex.length) return tally
  const titles = new Map(forex.map(c => [String(c._id), c.title ?? '']))

  // Put on a Forex course since sending began, oldest first — each student goes with the first of them.
  const given = await EnrollmentModel.find({ courseId: { $in: forex.map(c => c._id) }, createdAt: { $gte: since, $lte: settled } })
    .select('userId courseId')
    .sort({ createdAt: 1 })
    .lean() as unknown as { userId: unknown; courseId: unknown }[]
  if (!given.length) return tally
  const courseOf = new Map<string, string>()
  for (const e of given) if (!courseOf.has(String(e.userId))) courseOf.set(String(e.userId), titles.get(String(e.courseId)) ?? '')

  const due = await UserModel.find({
    _id:      { $in: given.map(e => e.userId) },
    role:     'student',
    isActive: { $ne: false },
    $or: [
      // Never sent, or waiting for its next try.
      { 'commissionSync.state': { $exists: false } },
      { 'commissionSync.state': 'pending', 'commissionSync.nextAttemptAt': { $lte: now } },
      // Sent by this job before it was Forex only, with no Forex course (see the top).
      { 'commissionSync.state': 'sent', 'commissionSync.course': { $exists: false } },
    ],
  })
    .select('name email organizationId enrollmentApplication commissionSync')
    .sort({ createdAt: 1 })
    .limit(BATCH)
    .lean() as unknown as Student[]

  for (const student of due) {
    // Finance enrolled them, so finance sends them — with the invoice, and once. Its
    // older enrolments carry no invoice on the enrolment, only on the order.
    const viaFinance = (await EnrollmentModel.exists({ userId: student._id, 'paymentAccess.invoiceId': { $exists: true, $nin: [null, ''] } }))
      || (await OrderModel.exists({ userId: student._id, 'externalRef.source': 'finance' }))
    if (viaFinance) {
      await UserModel.updateOne({ _id: student._id }, { $set: { 'commissionSync.state': 'skipped', 'commissionSync.reason': 'Enrolled through finance, which sends them itself' } })
      tally.skipped++
      continue
    }

    const course = courseOf.get(String(student._id)) ?? ''
    try {
      const org = student.organizationId
        ? await OrganizationModel.findById(student.organizationId).select('name').lean() as { name?: string } | null
        : null
      const app = student.enrollmentApplication ?? {}
      const answer = await sendToCommission({
        lmsUserId: String(student._id),
        email:     student.email,
        name:      student.name,
        phone:     app.phone ?? '',
        country:   app.homeCountry || app.addressCountry || app.nationality || '',
        academy:   org?.name ?? '',
        course,
      })
      await UserModel.updateOne({ _id: student._id }, {
        $set: {
          'commissionSync.state':        'sent',
          'commissionSync.course':       course,
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
      // Their CS and team, now that they are there — not in up to ten minutes.
      recheckTetraCsLater(String(student._id))
      logger.info({ userId: String(student._id), course, student: answer.studentCode, team: answer.teamName, existing: answer.existing },
        answer.existing ? 'Forex student already in Tetra Commission — left as they are' : 'Forex student sent to Tetra Commission')
    } catch (err) {
      const permanent = err instanceof CommissionPermanentError
      const notReady  = err instanceof CommissionNotReadyError
      const attempts  = (student.commissionSync?.attempts ?? 0) + 1
      const message   = (err as Error).message?.slice(0, 500)
      // Down, not deployed, or not configured there: waited out, however long.
      const giveUp    = permanent
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
