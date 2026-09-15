/* ─────────────────────────────────────────────────────────────
   An admin edits the Google Meet link. What reaches the student?

   Two questions, both asked about a real situation: a class is created (the
   Meet room is generated automatically), and later an admin opens Edit and
   pastes a different link — their own recurring room, a Zoom URL, whatever.

     1. Does the student get told the link changed?
     2. Which link do they end up with — the generated one or the pasted one?

   The answers are not symmetrical, and the second one depends on WHEN the
   reminder fired relative to the edit. A reminder already sent carries the
   old link forever; nothing goes back to correct it. So this suite pins the
   behaviour in both directions rather than describing it once in a comment:

     A  changing the link notifies the booked student IN-APP, and only
        in-app — no email, and not parked in the daily digest either
     B  the stored link is the pasted one — an edit overwrites the generated
        room rather than being ignored
     C  a reminder that fires AFTER the edit carries the pasted link
     D  a reminder that fired BEFORE the edit still carries the old one, and
        the student is never told — the sharp edge
     E  changing the time still notifies, so A is about the link specifically
        and not about notifications being broken

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_meetlink_suite), dropped on exit.

   Run: bun run test:meetlink
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_meetlink_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''

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
  ClassBookingModel, EmailOutboxModel, NotificationModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { runFiveMinReminders, runAtTimeReminders } = await import('@/jobs/reminders.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_meetlink_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

/* The room the platform generated when the class was made… */
const GENERATED = 'https://meet.google.com/gen-erat-ed1'
/* …and the one an admin pastes over it in the Edit dialog. */
const PASTED    = 'https://meet.google.com/pas-tedx-999'

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

const PW = 'MeetLink1'

async function mailFor(to: string, subject: RegExp, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const rows = await EmailOutboxModel.find({ to }).sort({ createdAt: -1 }).lean() as any[]
    const hit = rows.find(r => subject.test(String(r.subject ?? '')))
    if (hit) return hit
    await new Promise(r => setTimeout(r, 100))
  }
  return null
}

try {

const org = await OrganizationModel.create({
  name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
})
const hash = await hashPassword(PW)
const admin = await UserModel.create({
  name: 'Ops', email: 'ops@ml.local', passwordHash: hash, role: 'admin',
  isActive: true, isVerified: true, organizationId: org._id,
})
const teacher = await UserModel.create({
  name: 'Teach', email: 'teach@ml.local', passwordHash: hash, role: 'instructor',
  isActive: true, organizationId: org._id,
})
const course = await CourseModel.create({
  title: 'Forex', slug: 'forex-ml', description: 'd', instructorId: teacher._id,
  price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
})

const adminJar: Jar = new Map()
{
  const r = await call('POST', '/admin/auth/login', adminJar, { email: admin.email, password: PW })
  check('setup: the admin signs in', r.status === 200, String(r.status))
}

let seq = 0
/** A class carrying the GENERATED room, with one student booked onto it. */
async function classWithSeat(minutesFromNow: number) {
  const n = seq++
  const student = await UserModel.create({
    name: `Student ${n}`, email: `s${n}@ml.local`, passwordHash: hash, role: 'student',
    isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org._id,
  })
  const lc = await LiveClassModel.create({
    title: `Session ${n}`, courseId: course._id, instructorId: teacher._id,
    organizationId: org._id,
    scheduledStart: new Date(Date.now() + minutesFromNow * 60 * 1000),
    durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
    language: 'English', sessionCapacity: 30, bookedCount: 1,
    meetingUrl: GENERATED,
  })
  await ClassBookingModel.create({
    userId: student._id, liveClassId: lc._id, status: 'booked', bookedAt: new Date(),
  })
  return { student, lc }
}

/* ═════════════════ A — does anyone get told? ═════════════════ */
section('A. Changing the meeting link notifies IN-APP, and only in-app')
{
  const { student, lc } = await classWithSeat(120)

  const before = await NotificationModel.countDocuments({ userId: student._id })
  const r = await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { meetingUrl: PASTED })
  check('A1 the edit is accepted', r.status === 200, `status=${r.status}`)

  /* This section used to assert that NOTHING happened, which was an accurate
     record of a gap rather than of a decision: no notification, no email, no
     trace anywhere. Phase 3 of the notification spec closes it — every update
     is logged in the notification centre — so the assertion now describes the
     behaviour that was chosen instead of the one that was inherited.

     The fan-out is fire-and-forget, so poll rather than sleep a guess. */
  let after = before
  for (let i = 0; i < 40 && after === before; i++) {
    await new Promise(x => setTimeout(x, 150))
    after = await NotificationModel.countDocuments({ userId: student._id })
  }
  check('A2 the booked student IS notified in-app', after > before, `${before} -> ${after}`)

  const note = await NotificationModel.findOne({ userId: student._id })
    .sort({ createdAt: -1 }).lean() as any
  check('A3 and the notice says the joining link changed',
    /joining link/i.test(String(note?.title)), String(note?.title))
  check('A4 pointing at the session, so they can pick the new one up',
    String(note?.link).includes(String(lc._id)), String(note?.link))

  /* The half that was decided deliberately: in-app only. A link change must
     not wait for the 6pm digest — by then the class may be over — and it does
     not send its own mail either, which is the call the admin made. */
  const mails = await EmailOutboxModel.countDocuments({ to: student.email })
  check('A5 and NO email is sent', mails === 0, String(mails))

  const { DigestQueueModel } = await import('@/models/schema.ts')
  check('A6 and it is not parked in the daily digest',
    (await DigestQueueModel.countDocuments({ userId: student._id })) === 0,
    String(await DigestQueueModel.countDocuments({ userId: student._id })))
}

/* ═════════════════ B — which link is stored ═════════════════ */
section('B. The pasted link replaces the generated one')
{
  const { lc } = await classWithSeat(120)
  await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { meetingUrl: PASTED })

  const row = await LiveClassModel.findById(lc._id).lean() as any
  check('B1 the stored link is the one the admin pasted', row?.meetingUrl === PASTED,
    String(row?.meetingUrl))
  check('B2 the generated room is gone', row?.meetingUrl !== GENERATED, String(row?.meetingUrl))
}

/* ═════════════════ C — reminders sent AFTER the edit ═════════════════ */
section('C. A reminder that fires after the edit carries the pasted link')
{
  /* This is the good case, and the one most people assume is the only case:
     the reminder reads meetingUrl when it runs, so it picks up the edit. */
  const { student, lc } = await classWithSeat(5)
  await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { meetingUrl: PASTED })

  await runFiveMinReminders()
  const mail = await mailFor(student.email, /Starts in 5 Minutes/i)
  check('C1 the 5-minute email is sent', !!mail)
  check('C2 it carries the PASTED link', String(mail?.html ?? '').includes(PASTED),
    String(mail?.html ?? '').slice(0, 200))
  check('C3 and not the generated one', !String(mail?.html ?? '').includes(GENERATED))
}

/* ═════════════════ D — reminders sent BEFORE the edit ═════════════════ */
section('D. A reminder already sent keeps the OLD link, and nobody is told')
{
  /* The sharp edge. The student was mailed before the admin changed anything,
     so they are holding a link to a room that is no longer the class — and
     because A proved no notification fires, nothing ever tells them. */
  const { student, lc } = await classWithSeat(5)

  await runFiveMinReminders()
  const first = await mailFor(student.email, /Starts in 5 Minutes/i)
  check('D1 the first email went with the generated link',
    String(first?.html ?? '').includes(GENERATED), String(first?.html ?? '').slice(0, 160))

  /* Admin swaps the room after the mail is out. */
  await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { meetingUrl: PASTED })
  await new Promise(x => setTimeout(x, 1200))

  const mails = await EmailOutboxModel.countDocuments({ to: student.email })
  check('D2 no follow-up email corrects it', mails === 1, `${mails} emails`)

  /* The at-time reminder is the student's next chance, and it DOES read the
     new value — so the room they are told to join changes between one mail
     and the next, with no explanation in either. */
  await LiveClassModel.updateOne({ _id: lc._id },
    { $set: { scheduledStart: new Date(Date.now() - 60 * 1000) } })
  await runAtTimeReminders()
  const second = await mailFor(student.email, /Class Has Started/i)
  check('D3 the later email carries the NEW link',
    String(second?.html ?? '').includes(PASTED), String(second?.html ?? '').slice(0, 160))
  check('D4 so the student received two different rooms, uncorrected',
    String(first?.html ?? '').includes(GENERATED) && String(second?.html ?? '').includes(PASTED))
}

/* ═════════════════ E — the contrast ═════════════════ */
section('E. Changing the TIME does notify — so A is about the link, not a broken fan-out')
{
  const { student, lc } = await classWithSeat(300)
  const before = await NotificationModel.countDocuments({ userId: student._id })

  const moved = new Date(Date.now() + 400 * 60 * 1000).toISOString()
  const r = await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { scheduledStart: moved })
  check('E1 the reschedule is accepted', r.status === 200, String(r.status))

  /* Poll: notifyBookedStudents is deliberately fire-and-forget. */
  let after = before
  for (let i = 0; i < 40 && after === before; i++) {
    await new Promise(x => setTimeout(x, 150))
    after = await NotificationModel.countDocuments({ userId: student._id })
  }
  check('E2 a reschedule DOES notify the booked student', after > before, `${before} -> ${after}`)
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
console.log(`\nmeetlinkchange.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
