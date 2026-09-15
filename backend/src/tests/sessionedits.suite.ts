/* ─────────────────────────────────────────────────────────────
   Phase 3 — every class edit is logged, and tiered correctly.

   The Class-Update Notification spec: "Every update — Critical, Standard, and
   None/internal — is logged in the student's in-app notification centre.
   Email only fires for Critical (immediate) and Standard (digest)."

   Before this, only cancel / reschedule / instructor produced anything at all.
   Change the title, the length, the room — or the joining link — and a student
   holding a booking was told nothing, anywhere.

   Three tiers now land on a session edit, and this suite separates them:

     A  a MINOR edit notifies in-app AND queues for the daily digest
     B  it sends no immediate email — that is what "Standard" means
     C  several minor fields in one save produce ONE notice naming them all,
        not one notice per field
     D  the MEETING LINK notifies in-app immediately, with no email and no
        digest row — a 6pm mention of a link change can arrive after the class
     E  a CRITICAL edit still emails immediately, and does not go to the digest
     F  a save that changes nothing notifies nobody — re-saving a form sends
        every field back, so "was it in the body" would fire on every save
     G  staff-only fields (mentor notes) are not announced to students
     H  the audience is students booked on THIS session, never the roster
     I  a student who cancelled their booking has left, and is not told

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_sessionedits_suite), dropped on exit.

   Run: bun run test:sessionedits
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_sessionedits_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.EMAIL_LOG_DIR = '.logs/emails-sessionedits'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'

/* Phase 4 off here. This suite is about WHICH TIER an edit lands in, and
   section E asserts that a Critical edit still mails immediately. Phase 4's
   10-minute buffer would turn that into a statement about the flush timer
   instead. The buffer and the per-student cap are covered by
   criticalmail.suite.ts. */
process.env.CRITICAL_DEBOUNCE_MINS = '0'
process.env.CRITICAL_MAIL_CAP      = '0'
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
  ClassBookingModel, EmailOutboxModel, NotificationModel, DigestQueueModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_sessionedits_suite') {
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

const PW   = 'Edits1234'
const MEET = 'https://meet.google.com/edi-tsab-c12'

/** The fan-out is fire-and-forget; wait for a count to reach `want`. */
async function waitFor(fn: () => Promise<number>, want: number, tries = 40): Promise<number> {
  let last = 0
  for (let i = 0; i < tries; i++) {
    last = await fn()
    if (last >= want) return last
    await new Promise(r => setTimeout(r, 120))
  }
  return last
}
/** For "nothing should happen": settle once, then read once. */
async function settled(fn: () => Promise<number>): Promise<number> {
  await new Promise(r => setTimeout(r, 1000))
  return fn()
}

try {

const org = await OrganizationModel.create({
  name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
})
const hash = await hashPassword(PW)
const admin = await UserModel.create({
  name: 'Ops', email: 'ops@se.local', passwordHash: hash, role: 'admin',
  isActive: true, isVerified: true, organizationId: org._id,
})
const teacher = await UserModel.create({
  name: 'Teach', email: 'teach@se.local', passwordHash: hash, role: 'instructor',
  isActive: true, organizationId: org._id,
})
const teacher2 = await UserModel.create({
  name: 'Other Teach', email: 'teach2@se.local', passwordHash: hash, role: 'instructor',
  isActive: true, organizationId: org._id,
})
const course = await CourseModel.create({
  title: 'Forex', slug: 'forex-se', description: 'd', instructorId: teacher._id,
  price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
})

const adminJar: Jar = new Map()
{
  const r = await call('POST', '/admin/auth/login', adminJar, { email: admin.email, password: PW })
  check('setup: the admin signs in', r.status === 200, String(r.status))
}

let seq = 0
/** A session with one student booked on it, plus one enrolled-but-NOT-booked. */
async function sessionWithSeat() {
  const n = seq++
  const booked = await UserModel.create({
    name: `Booked ${n}`, email: `b${n}@se.local`, passwordHash: hash, role: 'student',
    isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org._id,
  })
  const bystander = await UserModel.create({
    name: `Bystander ${n}`, email: `x${n}@se.local`, passwordHash: hash, role: 'student',
    isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org._id,
  })
  const lc = await LiveClassModel.create({
    title: `Session ${n}`, courseId: course._id, instructorId: teacher._id,
    organizationId: org._id, scheduledStart: new Date(Date.now() + 72 * 3600 * 1000),
    durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
    language: 'English', sessionCapacity: 30, bookedCount: 1, meetingUrl: MEET,
    location: 'Campus A', room: 'R1',
  })
  await ClassBookingModel.create({
    userId: booked._id, liveClassId: lc._id, status: 'booked', bookedAt: new Date(),
  })
  return { booked, bystander, lc }
}

const notes  = (u: any) => NotificationModel.countDocuments({ userId: u._id })
const queued = (u: any) => DigestQueueModel.countDocuments({ userId: u._id })
const mails  = (u: any) => EmailOutboxModel.countDocuments({ to: u.email })

/* ═════════════════ A/B — a minor edit ═════════════════ */
section('A/B. A minor edit is logged in-app and queued for the digest — no immediate mail')
{
  const { booked, lc } = await sessionWithSeat()
  const r = await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { durationMins: 90 })
  check('A1 the edit is accepted', r.status === 200, String(r.status))

  check('A2 the student is notified in-app', (await waitFor(() => notes(booked), 1)) === 1,
    String(await notes(booked)))
  check('A3 and a digest row is queued', (await waitFor(() => queued(booked), 1)) === 1,
    String(await queued(booked)))

  const note = await NotificationModel.findOne({ userId: booked._id }).sort({ createdAt: -1 }).lean() as any
  check('A4 the notice names what changed', /length/i.test(String(note?.body)), String(note?.body))

  /* Standard tier means the daily digest, not its own mail. */
  check('B1 no immediate email is sent', (await settled(() => mails(booked))) === 0,
    String(await mails(booked)))
}

/* ═════════════════ C — several fields, one notice ═════════════════ */
section('C. Several minor fields in one save produce ONE notice naming them all')
{
  const { booked, lc } = await sessionWithSeat()
  await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, {
    title: 'Renamed Session', durationMins: 45, room: 'R9',
  })

  const n = await waitFor(() => notes(booked), 1)
  check('C1 exactly one notification, not one per field', n === 1, String(n))

  const note = await NotificationModel.findOne({ userId: booked._id }).sort({ createdAt: -1 }).lean() as any
  const body = String(note?.body ?? '')
  check('C2 and it names each changed field',
    /title/i.test(body) && /length/i.test(body) && /room/i.test(body), body)

  check('C3 one digest row too, not three', (await queued(booked)) === 1, String(await queued(booked)))
}

/* ═════════════════ D — the meeting link ═════════════════ */
section('D. A link change is in-app only — no email, no digest')
{
  const { booked, lc } = await sessionWithSeat()
  await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, {
    meetingUrl: 'https://meet.google.com/new-linkx-99',
  })

  check('D1 notified in-app', (await waitFor(() => notes(booked), 1)) === 1, String(await notes(booked)))
  const note = await NotificationModel.findOne({ userId: booked._id }).sort({ createdAt: -1 }).lean() as any
  check('D2 the notice is about the joining link', /joining link/i.test(String(note?.title)),
    String(note?.title))

  /* Both negatives matter. Mail was a deliberate no; the digest would be
     worse than nothing, since 6pm can be after the class. */
  /* The point of an in-app notice about a link is that the student can reach
     the new link from it. A notice that lands in the bell but points at the
     bookings list makes them hunt for the session themselves. */
  check('D3 and it points at the session, so the new link is one tap away',
    String(note?.link) === `/live-classes/${lc._id}/watch`, String(note?.link))

  check('D4 no email', (await settled(() => mails(booked))) === 0, String(await mails(booked)))
  check('D5 and no digest row', (await queued(booked)) === 0, String(await queued(booked)))
}

/* ═════════════════ E — Critical is unchanged ═════════════════ */
section('E. A critical edit still emails immediately and skips the digest')
{
  const { booked, lc } = await sessionWithSeat()
  await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, {
    instructorId: String(teacher2._id),
  })

  check('E1 an email goes out at once', (await waitFor(() => mails(booked), 1)) >= 1,
    String(await mails(booked)))
  check('E2 and nothing is parked in the digest', (await queued(booked)) === 0,
    String(await queued(booked)))
}

/* ═════════════════ F — a no-op save ═════════════════ */
section('F. Re-saving without changing anything notifies nobody')
{
  /* The admin form posts every field back on every save. Detecting "was the
     field present" rather than "did the value change" would fire on each one
     and bury the edits that matter. */
  const { booked, lc } = await sessionWithSeat()
  const current = await LiveClassModel.findById(lc._id).lean() as any

  await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, {
    title:           current.title,
    durationMins:    current.durationMins,
    meetingUrl:      current.meetingUrl,
    sessionCapacity: current.sessionCapacity,
    room:            current.room,
    location:        current.location,
  })

  check('F1 no notification for a no-op save', (await settled(() => notes(booked))) === 0,
    String(await notes(booked)))
  check('F2 and no digest row', (await queued(booked)) === 0, String(await queued(booked)))
}

/* ═════════════════ G — staff-only fields ═════════════════ */
section('G. Staff-only fields are not announced to students')
{
  const { booked, lc } = await sessionWithSeat()
  await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, {
    mentorNotes: 'Remember to cover order blocks',
  })

  check('G1 a mentor-notes edit tells students nothing',
    (await settled(() => notes(booked))) === 0, String(await notes(booked)))
}

/* ═════════════════ H — the audience ═════════════════ */
section('H. Only students BOOKED on this session are told')
{
  const { booked, bystander, lc } = await sessionWithSeat()
  await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { room: 'R42' })

  check('H1 the booked student is notified', (await waitFor(() => notes(booked), 1)) === 1,
    String(await notes(booked)))
  check('H2 an enrolled student with no booking is NOT',
    (await settled(() => notes(bystander))) === 0, String(await notes(bystander)))
  check('H3 and gets no digest row either', (await queued(bystander)) === 0,
    String(await queued(bystander)))
}

/* ═════════════════ I — a cancelled booking ═════════════════ */
section('I. A student who cancelled their booking is not told about edits')
{
  /* The booking row survives cancellation with status:'cancelled'. Selecting
     by liveClassId alone would keep mailing people who already left. */
  const { booked, lc } = await sessionWithSeat()
  await ClassBookingModel.updateOne({ userId: booked._id, liveClassId: lc._id },
    { $set: { status: 'cancelled' } })

  await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { room: 'R77' })

  check('I1 no notification for a cancelled booking',
    (await settled(() => notes(booked))) === 0, String(await notes(booked)))
  check('I2 and no digest row', (await queued(booked)) === 0, String(await queued(booked)))
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
console.log(`\nsessionedits.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
