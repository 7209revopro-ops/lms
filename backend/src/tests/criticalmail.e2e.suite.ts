/* ─────────────────────────────────────────────────────────────
   Phase 4, end-to-end — the buffer as an admin actually triggers it.

   criticalmail.suite calls parkCriticalMail/flushCriticalMail directly, and
   criticalmail.property.suite fuzzes them. Neither touches the seam where the
   feature is actually wired: the admin's PATCH → notifyBookedStudents →
   park → urgent-flush-or-wait path in liveClass.controller.ts. A bug in that
   call site — the wrong start time handed to isUrgent, the park skipped, the
   urgent flush never called — passes both of the other suites.

   So this one drives the REAL Express app over HTTP with the buffer ON, the
   way an admin clicking Save does.

     A  three corrections through the API produce ONE email and THREE bell
        entries — the bell is never debounced
     B  a cancellation for a class starting in five minutes is mailed FROM THE
        REQUEST, with no flush at all
     C  a reschedule followed by a cancellation mails only the cancellation
     D  past the daily cap, the API's own notices fold into the digest

   Run: bun run test:criticalmail-e2e
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_criticalmaile2e_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_LOG_DIR = '.logs/emails-criticalmail-e2e'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''

/* The shipped buffer, and a low cap so section D is reachable in three edits. */
process.env.CRITICAL_DEBOUNCE_MINS = '10'
process.env.CRITICAL_MAIL_CAP      = '2'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, LiveClassModel,
  ClassBookingModel, EmailOutboxModel, NotificationModel, DigestQueueModel,
  CriticalMailModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { flushCriticalMail } = await import('@/jobs/criticalmail.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_criticalmaile2e_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, jar?: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar?.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let parsed: any = text; try { parsed = JSON.parse(text) } catch {}
  return { status: res.status, body: parsed }
}

const PW = 'E2eCrit123'
const HOUR = 3600_000

/** The fan-out is fire-and-forget; wait for a count to reach `want`. */
async function waitFor(fn: () => Promise<number>, want: number, tries = 45): Promise<number> {
  let last = 0
  for (let i = 0; i < tries; i++) {
    last = await fn()
    if (last >= want) return last
    await new Promise(r => setTimeout(r, 120))
  }
  return last
}
/** Poll until a count DROPS to `want` (waitFor only ever waits for a rise).

    B3 needs this: the mail row appears in the outbox during the send, but the
    row is stamped sent immediately AFTER it — so reading the parked count the
    instant the mail lands catches a row mid-flight. It passed only because an
    unrelated query happened to sit between the two, which is the definition of
    a flaky assertion. */
async function waitDownTo(fn: () => Promise<number>, want: number, tries = 45): Promise<number> {
  let last = await fn()
  for (let i = 0; i < tries && last > want; i++) {
    await new Promise(r => setTimeout(r, 120))
    last = await fn()
  }
  return last
}

/** For "nothing should happen": settle once, then read once. */
async function settled(fn: () => Promise<number>): Promise<number> {
  await new Promise(r => setTimeout(r, 1200))
  return fn()
}

try {

const org = await OrganizationModel.create({
  name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
})
const hash = await hashPassword(PW)
const admin = await UserModel.create({
  name: 'Ops', email: 'ops@e2e.local', passwordHash: hash, role: 'admin',
  isActive: true, isVerified: true, organizationId: org._id,
})
const teacher = await UserModel.create({
  name: 'Teach', email: 'teach@e2e.local', passwordHash: hash, role: 'instructor',
  isActive: true, organizationId: org._id,
})
const course = await CourseModel.create({
  title: 'Forex', slug: 'forex-e2e', description: 'd', instructorId: teacher._id,
  price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
})

const adminJar: Jar = new Map()
{
  const r = await call('POST', '/admin/auth/login', adminJar, { email: admin.email, password: PW })
  check('setup: the admin signs in', r.status === 200, String(r.status))
}

let seq = 0
async function seat(startsInMs: number) {
  const n = seq++
  const student = await UserModel.create({
    name: `Stu ${n}`, email: `s${n}@e2e.local`, passwordHash: hash, role: 'student',
    isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org._id,
  })
  const lc = await LiveClassModel.create({
    title: `Session ${n}`, courseId: course._id, instructorId: teacher._id,
    organizationId: org._id, scheduledStart: new Date(Date.now() + startsInMs),
    durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
    language: 'English', sessionCapacity: 30, bookedCount: 1,
    meetingUrl: 'https://meet.google.com/e2e-crit-001',
  })
  await ClassBookingModel.create({
    userId: student._id, liveClassId: lc._id, status: 'booked', bookedAt: new Date(),
  })
  return { student, lc }
}

const mails  = (u: any) => EmailOutboxModel.countDocuments({ to: u.email })
const notes  = (u: any) => NotificationModel.countDocuments({ userId: u._id })
const queued = (u: any) => DigestQueueModel.countDocuments({ userId: u._id })
const parked = (lc: any) => CriticalMailModel.countDocuments({ liveClassId: lc._id, sentAt: null })

/* ═════════ A — three saves, one email, three bell entries ═════════ */
section('A. Three corrections through the API: ONE email, but THREE bell entries')
{
  const { student, lc } = await seat(72 * HOUR)
  const base = new Date(Date.now() + 72 * HOUR)

  for (const h of [3, 4, 5]) {
    const r = await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, {
      scheduledStart: new Date(base.getTime() + h * HOUR).toISOString(),
    })
    check(`A${h - 2} save ${h - 2} is accepted`, r.status === 200, String(r.status))
  }

  /* The bell is not debounced — a student refreshing the app right after an
     admin's edit must see the session as it now stands. */
  check('A4 all three edits are in the notification centre',
    (await waitFor(() => notes(student), 3)) === 3, String(await notes(student)))

  check('A5 but no email has been sent yet', (await settled(() => mails(student))) === 0,
    String(await mails(student)))
  check('A6 and the three saves left ONE parked mail, not three',
    (await parked(lc)) === 1, String(await parked(lc)))

  const flushed = await flushCriticalMail({ now: new Date(Date.now() + 20 * 60_000) })
  check('A7 the flush sends exactly one email for the three saves', flushed.sent === 1,
    JSON.stringify(flushed))
  check('A8 and it reaches the student', (await waitFor(() => mails(student), 1)) === 1,
    String(await mails(student)))
}

/* ═════════ B — the urgent bypass, through the API ═════════ */
section('B. A cancellation for a class starting in five minutes is mailed from the request')
{
  const { student, lc } = await seat(5 * 60_000)

  const r = await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { status: 'cancelled' })
  check('B1 the cancellation is accepted', r.status === 200, String(r.status))

  /* No flush is called here on purpose. A ten-minute buffer on a class that
     starts in five would deliver the notice after the student had already
     travelled in. */
  check('B2 the email goes out without any flush',
    (await waitFor(() => mails(student), 1)) === 1, String(await mails(student)))
  const left = await waitDownTo(() => parked(lc), 0)
  const leftovers = await CriticalMailModel.find({ liveClassId: lc._id, sentAt: null }).lean() as any[]
  check('B3 and nothing is left parked', left === 0,
    JSON.stringify(leftovers.map(r => ({ kind: r.kind, sup: r.supersededAt, claimed: r.claimedAt }))))
}

/* ═════════ C — a cancellation overtakes a pending reschedule ═════════ */
section('C. A reschedule then a cancellation: only the cancellation is mailed')
{
  const { student, lc } = await seat(96 * HOUR)

  await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, {
    scheduledStart: new Date(Date.now() + 120 * HOUR).toISOString(),
  })
  await waitFor(() => notes(student), 1)
  await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { status: 'cancelled' })
  await waitFor(() => notes(student), 2)

  const flushed = await flushCriticalMail({ now: new Date(Date.now() + 20 * 60_000) })
  check('C1 exactly one email, not two', flushed.sent === 1, JSON.stringify(flushed))

  const row = await EmailOutboxModel.findOne({ to: student.email }).sort({ createdAt: -1 }).lean() as any
  check('C2 and it is the cancellation, not the stale new time',
    /cancel/i.test(String(row?.subject)), String(row?.subject))
  check('C3 both edits are still visible in the bell',
    (await notes(student)) === 2, String(await notes(student)))
}

/* ═════════ D — the cap, reached through the API ═════════ */
section('D. Past the daily cap, the API’s own notices fold into the digest')
{
  /* One student, three separate sessions, all cancelled. The cap is 2. */
  const n = seq++
  const student = await UserModel.create({
    name: `Capped ${n}`, email: `cap${n}@e2e.local`, passwordHash: hash, role: 'student',
    isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org._id,
  })
  const classes: any[] = []
  for (let i = 0; i < 3; i++) {
    const lc = await LiveClassModel.create({
      title: `Capped ${n}-${i}`, courseId: course._id, instructorId: teacher._id,
      organizationId: org._id, scheduledStart: new Date(Date.now() + (200 + i) * HOUR),
      durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
      language: 'English', sessionCapacity: 30, bookedCount: 1,
      meetingUrl: 'https://meet.google.com/e2e-crit-002',
    })
    await ClassBookingModel.create({
      userId: student._id, liveClassId: lc._id, status: 'booked', bookedAt: new Date(),
    })
    classes.push(lc)
  }

  for (const lc of classes) {
    await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { status: 'cancelled' })
  }
  check('D1 all three cancellations are in the bell',
    (await waitFor(() => notes(student), 3)) === 3, String(await notes(student)))

  const flushed = await flushCriticalMail({ now: new Date(Date.now() + 20 * 60_000) })
  check('D2 two are mailed and one folds', flushed.sent >= 2 && flushed.folded >= 1,
    JSON.stringify(flushed))
  check('D3 the student is mailed exactly the cap', (await mails(student)) === 2,
    String(await mails(student)))
  /* The one over the cap is not lost — it is in the bell already, and now in
     tonight's digest as well. */
  check('D4 and the overflow is in the digest, not gone',
    (await queued(student)) === 1, String(await queued(student)))
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\ncriticalmail.e2e.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
