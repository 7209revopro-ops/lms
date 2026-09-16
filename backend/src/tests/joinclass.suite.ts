/* ─────────────────────────────────────────────────────────────
   The Join button for Google Meet classes — who gets the link, and when.

   Before this, "entitled" meant enrolled in the course: every enrolled student
   could read the Meet URL out of the schedule, the upcoming feed and the watch
   page, booked or not, hours before the class. The URL is now in NO student
   payload. It leaves the server through exactly one door — POST
   /live-classes/:id/join — which checks the booking and the window at the
   moment of the click.

   The window: from the class start to STUDENT_JOIN_GRACE (20) minutes after.
   The admin panel's own Join button (15 min before → end) is a different rule
   on a different payload and is not touched here.

     A  a booked student inside the window gets the URL
     B  a student who did not book gets NOT_BOOKED — and the URL is in none of
        the five payloads they can reach (the requirement that matters most)
     C  before the start: TOO_EARLY with a Retry-After the page can count down
     D  after start + 20 min: JOIN_WINDOW_CLOSED — and the boundaries are exact
     E  a cancelled seat is no seat; a seat marked attended still is
     F  a cancelled or ended class refuses everyone
     G  not a Meet class (internal room, or in-person) → NOT_A_MEET_CLASS
     H  a blocked module refuses the seat holder too
     I  account gates: unapproved enrolment, disabled account, other academy
     J  the booked student's OWN payloads carry the window and the seat, but
        never the URL — the button is drawn from server truth, the link is
        fetched on the click
     K  the admin payload is unchanged — the admin Join button keeps its source
     L  unauthenticated → 401

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_joinclass_suite), dropped on exit.

   Run: bun run test:joinclass
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_joinclass_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_LOG_DIR = '.logs/emails-joinclass'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''
/* Deliberately NOT setting STUDENT_JOIN_GRACE_MINUTES. Every "20 minutes"
   below is asserting the SHIPPED DEFAULT, which is the value production runs
   on; pinning it here would let a wrong default pass unnoticed (a mutation
   changing it to 15 survived for exactly that reason until this was removed).
   If a .env ever sets it, this suite fails loudly, which is the point. */

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
  UserModel, OrganizationModel, CourseModel, SectionModel, LiveClassModel,
  ClassBookingModel, EnrollmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_joinclass_suite') {
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
  return { status: res.status, body: parsed, retryAfter: res.headers.get('retry-after') }
}

const PW   = 'JoinMe1234'
const MIN  = 60_000
const MEET = 'https://meet.google.com/join-test-abc'
const MEET_CODE = 'join-test-abc'
const code = (r: any) => String(r.body?.error?.code ?? '')

try {

const org   = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const other = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
const hash  = await hashPassword(PW)

const mk = (email: string, role: string, extra: Record<string, unknown> = {}) =>
  UserModel.create({
    name: email.split('@')[0], email, passwordHash: hash, role,
    isActive: true, isVerified: true, organizationId: org._id, ...extra,
  })

const admin    = await mk('admin@jc.local',    'admin')
const teacher  = await mk('teach@jc.local',    'instructor')
const booked   = await mk('booked@jc.local',   'student', { enrollmentStatus: 'approved' })
const nobody   = await mk('nobody@jc.local',   'student', { enrollmentStatus: 'approved' })
const pending  = await mk('pending@jc.local',  'student', { enrollmentStatus: 'pending' })
const disabled = await mk('disabled@jc.local', 'student', { enrollmentStatus: 'approved' })
const abroad   = await mk('abroad@jc.local',   'student', { enrollmentStatus: 'approved', organizationId: other._id })

const course = await CourseModel.create({
  title: 'Forex', slug: 'forex-jc', description: 'd', instructorId: teacher._id,
  price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
})
const module1 = await SectionModel.create({ courseId: course._id, title: 'Module 1', order: 1 })

/* Both students are ENROLLED — that is exactly the case the old "entitled"
   check let through. Only one of them books. */
for (const u of [booked, nobody, pending, disabled, abroad]) {
  await EnrollmentModel.create({ userId: u._id, courseId: course._id, status: 'active', blockedLessons: [] })
}

let seq = 0
async function session(startsInMs: number, extra: Record<string, unknown> = {}) {
  const n = seq++
  return LiveClassModel.create({
    title: `Session ${n}`, courseId: course._id, instructorId: teacher._id,
    organizationId: org._id, scheduledStart: new Date(Date.now() + startsInMs),
    durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
    language: 'English', sessionCapacity: 30, bookedCount: 0, meetingUrl: MEET,
    googleMeetCode: MEET_CODE, ...extra,
  })
}
const seat = (u: any, lc: any, status = 'booked') =>
  ClassBookingModel.create({ userId: u._id, liveClassId: lc._id, status, bookedAt: new Date() })

async function login(u: any): Promise<Jar> {
  const jar: Jar = new Map()
  const r = await call('POST', '/auth/login', jar, { email: u.email, password: PW })
  if (r.status !== 200) throw new Error(`login ${u.email}: ${r.status} ${code(r)}`)
  return jar
}
const join = (jar: Jar, lc: any) => call('POST', `/live-classes/${lc._id}/join`, jar)

const bookedJar = await login(booked)
const nobodyJar = await login(nobody)

/* ═══════════ A — the happy path ═══════════ */
section('A. A booked student inside the window gets the link')
{
  const lc = await session(-1 * MIN)             // started a minute ago
  await seat(booked, lc)
  const r = await join(bookedJar, lc)
  check('A1 the click is accepted', r.status === 200, `${r.status} ${code(r)}`)
  check('A2 and returns the Meet URL', r.body?.data?.url === MEET, JSON.stringify(r.body?.data))
  const noStore = String((await fetch(`${BASE}/live-classes/${lc._id}/join`, {
    method: 'POST', headers: { cookie: [...bookedJar].map(([k, v]) => `${k}=${v}`).join('; ') },
  })).headers.get('cache-control'))
  check('A2b and forbids caching it', /no-store/.test(noStore), noStore)
  check('A3 with when the link closes',
    Math.abs(new Date(r.body?.data?.closesAt).getTime() - (lc.scheduledStart.getTime() + 20 * MIN)) < 2000,
    String(r.body?.data?.closesAt))
}

/* ═══════════ B — the non-booker ═══════════ */
section('B. A student who did not book gets nothing — from anywhere')
{
  const lc = await session(-1 * MIN)
  await seat(booked, lc)

  const r = await join(nobodyJar, lc)
  check('B1 the click is refused', r.status === 403, String(r.status))
  check('B2 as NOT_BOOKED', code(r) === 'NOT_BOOKED', code(r))
  check('B3 and no URL rides along in the refusal', !JSON.stringify(r.body).includes('meet.google.com'))

  /* The requirement that matters most. This student is ENROLLED, so the
     old entitlement let them read the link from every one of these.

     A CANCELLED seat is given first, so /bookings/me returns a row for this
     student with the class populated: the old populate carried the URL on
     every booking status, and an empty list would prove nothing about it. */
  await seat(nobody, lc, 'cancelled')
  const rowOf = (b: any) => Array.isArray(b?.data) && b.data.some((x: any) => x.id === String(lc._id))
  const surfaces: [string, () => Promise<any>, (b: any) => boolean][] = [
    ['GET /live-classes',            () => call('GET', '/live-classes', nobodyJar),                   rowOf],
    ['GET /live-classes/upcoming',   () => call('GET', '/live-classes/upcoming?limit=50', nobodyJar), rowOf],
    ['GET /live-classes/:id/watch',  () => call('GET', `/live-classes/${lc._id}/watch`, nobodyJar),
      b => b?.data?.type === 'external'],
    ['GET /bookings/me',             () => call('GET', '/bookings/me?per_page=100', nobodyJar),
      b => Array.isArray(b?.data) && b.data.some((x: any) =>
        String(x.liveClassId?.id ?? x.liveClassId?._id ?? x.liveClassId) === String(lc._id))],
  ]
  for (const [name, fn, present] of surfaces) {
    const res = await fn()
    const text = JSON.stringify(res.body)
    /* Presence FIRST. A refusal, or a list the class is simply absent from,
       would let the two checks below pass for the wrong reason. */
    check(`B3b ${name} answers 200 with the class in it`, res.status === 200 && present(res.body),
      `status ${res.status}`)
    check(`B4 ${name} carries no Meet URL`, !text.includes('meet.google.com'), `status ${res.status}`)
    check(`B5 ${name} carries no Meet code either`,
      !text.includes(MEET_CODE) && !text.includes('googleMeetCode'), `status ${res.status}`)
  }
  /* One more student-reachable listing, swept for the URL only — what it
     lists depends on the course page's own rules, which are not under test. */
  const bySlug = await call('GET', '/courses/forex-jc/live-classes', nobodyJar)
  check('B4 GET /courses/:slug/live-classes carries no Meet URL either',
    bySlug.status === 200 && !JSON.stringify(bySlug.body).includes('meet.google.com')
      && !JSON.stringify(bySlug.body).includes(MEET_CODE), `status ${bySlug.status}`)

  const listed = (await call('GET', '/live-classes', nobodyJar)).body?.data?.find((x: any) => x.id === String(lc._id))
  check('B6 the schedule still lists the class for them', !!listed, 'row missing')
  check('B7 and says they hold no seat', listed?.isBooked === false, String(listed?.isBooked))
  const upRow = (await call('GET', '/live-classes/upcoming?limit=50', nobodyJar)).body?.data?.find((x: any) => x.id === String(lc._id))
  check('B7b the upcoming feed says so too', upRow?.isBooked === false, String(upRow?.isBooked))
}

/* ═══════════ C — too early ═══════════ */
section('C. Before the start the link is not released, and the page can count down')
{
  const lc = await session(2 * 60 * MIN)          // in two hours
  await seat(booked, lc)
  const r = await join(bookedJar, lc)
  check('C1 refused with 425', r.status === 425, String(r.status))
  check('C2 as TOO_EARLY', code(r) === 'TOO_EARLY', code(r))
  const ra = Number(r.retryAfter)
  check('C3 Retry-After says roughly two hours', ra > 7100 && ra <= 7200, String(r.retryAfter))
  check('C4 and the body repeats it for the page', Math.abs(Number(r.body?.error?.retryAfter) - ra) <= 1,
    String(r.body?.error?.retryAfter))
  check('C5 no URL in the refusal', !JSON.stringify(r.body).includes('meet.google.com'))

  /* Fifteen minutes before is NOT open for students, even though the admin
     panel and resolveLiveStatus call the class "live" from then. */
  const lc2 = await session(14 * MIN)
  await seat(booked, lc2)
  const r2 = await join(bookedJar, lc2)
  check('C6 fourteen minutes before start is still too early', r2.status === 425 && code(r2) === 'TOO_EARLY',
    `${r2.status} ${code(r2)}`)
}

/* ═══════════ D — too late, and the boundaries ═══════════ */
section('D. After start + 20 minutes the link closes — at exactly twenty')
{
  const late = await session(-25 * MIN)
  await seat(booked, late)
  const r = await join(bookedJar, late)
  check('D1 refused with 409', r.status === 409, String(r.status))
  check('D2 as JOIN_WINDOW_CLOSED', code(r) === 'JOIN_WINDOW_CLOSED', code(r))
  check('D3 no URL in the refusal', !JSON.stringify(r.body).includes('meet.google.com'))

  /* Boundaries, with fifteen seconds of slack: the gate reads the wall clock
     across five database round-trips, and late in a 60-suite chain on a busy
     machine those can take seconds. The exact millisecond edges are proven
     on the pure helper in joinclass.property.suite with an injected clock;
     these only need to sit clearly on one side. */
  const justInside = await session(-(20 * MIN - 15_000))
  await seat(booked, justInside)
  const a = await join(bookedJar, justInside)
  check('D4 19m45s after start is still open', a.status === 200, `${a.status} ${code(a)}`)

  const justOutside = await session(-(20 * MIN + 15_000))
  await seat(booked, justOutside)
  const b = await join(bookedJar, justOutside)
  check('D5 20m15s after start is closed', b.status === 409 && code(b) === 'JOIN_WINDOW_CLOSED',
    `${b.status} ${code(b)}`)

  const atStart = await session(8_000)             // starts in eight seconds
  await seat(booked, atStart)
  const c0 = await join(bookedJar, atStart)
  check('D6 eight seconds before start is too early', c0.status === 425, `${c0.status} ${code(c0)}`)
  await new Promise(r => setTimeout(r, 8_500))
  const c1 = await join(bookedJar, atStart)
  check('D7 and it opens at the start, not fifteen minutes before it', c1.status === 200, `${c1.status} ${code(c1)}`)
}

/* ═══════════ E — what counts as a seat ═══════════ */
section('E. A cancelled seat is no seat; an attended one still is')
{
  const lc = await session(-1 * MIN)
  await seat(booked, lc, 'cancelled')
  const r = await join(bookedJar, lc)
  check('E1 a cancelled booking is refused', r.status === 403 && code(r) === 'NOT_BOOKED', `${r.status} ${code(r)}`)

  const lc2 = await session(-1 * MIN)
  await seat(booked, lc2, 'attended')
  const r2 = await join(bookedJar, lc2)
  /* An admin marking somebody present mid-class must not lock them out of
     rejoining after a dropped call. */
  check('E2 a seat already marked attended still gets the link', r2.status === 200 && r2.body?.data?.url === MEET,
    `${r2.status} ${code(r2)}`)
}

/* ═══════════ F — the class itself ═══════════ */
section('F. A cancelled or ended class refuses even the seat holder')
{
  const c = await session(-1 * MIN, { status: 'cancelled' })
  await seat(booked, c)
  const r = await join(bookedJar, c)
  check('F1 cancelled → CLASS_CANCELLED', r.status === 409 && code(r) === 'CLASS_CANCELLED', `${r.status} ${code(r)}`)

  const e = await session(-1 * MIN, { status: 'ended' })
  await seat(booked, e)
  const r2 = await join(bookedJar, e)
  check('F2 ended → CLASS_ENDED', r2.status === 409 && code(r2) === 'CLASS_ENDED', `${r2.status} ${code(r2)}`)
}

/* ═══════════ G — not a Meet class ═══════════ */
section('G. Only an online external class has a link to give')
{
  const internal = await session(-1 * MIN, { type: 'internal', meetingUrl: undefined, googleMeetCode: undefined })
  await seat(booked, internal)
  const r = await join(bookedJar, internal)
  check('G1 an internal room → NOT_A_MEET_CLASS', r.status === 400 && code(r) === 'NOT_A_MEET_CLASS', `${r.status} ${code(r)}`)

  const offline = await session(-1 * MIN, { isOnline: false, location: 'Campus A', room: 'R1' })
  await seat(booked, offline)
  const r2 = await join(bookedJar, offline)
  check('G2 an in-person class → NOT_A_MEET_CLASS', r2.status === 400 && code(r2) === 'NOT_A_MEET_CLASS', `${r2.status} ${code(r2)}`)

  /* The page hides the button on `isOnline === false` alone, so that value
     has to actually reach every payload a button is drawn from — a payload
     that dropped the field would read as online and draw a button the click
     refuses. Same seat holder, same in-person class, four surfaces. */
  const offRow = (await call('GET', '/live-classes', bookedJar)).body?.data?.find((x: any) => x.id === String(offline._id))
  check('G2b the schedule row says isOnline=false', offRow?.isOnline === false, String(offRow?.isOnline))
  const offUp = (await call('GET', '/live-classes/upcoming?limit=50', bookedJar)).body?.data?.find((x: any) => x.id === String(offline._id))
  check('G2c the upcoming feed says isOnline=false', offUp?.isOnline === false, String(offUp?.isOnline))
  const offWatch = await call('GET', `/live-classes/${offline._id}/watch`, bookedJar)
  check('G2d the watch page says isOnline=false', offWatch.body?.data?.isOnline === false, String(offWatch.body?.data?.isOnline))
  const offMine = (await call('GET', '/bookings/me?per_page=100', bookedJar)).body?.data?.find((x: any) =>
    String(x.liveClassId?.id ?? x.liveClassId?._id ?? x.liveClassId) === String(offline._id))
  check('G2e the booking row says isOnline=false', offMine?.liveClassId?.isOnline === false, String(offMine?.liveClassId?.isOnline))

  const bogus = await call('POST', '/live-classes/not-an-id/join', bookedJar)
  check('G3 a malformed id is a 400, not a crash', bogus.status === 400, String(bogus.status))
  const missing = await call('POST', `/live-classes/${new mongoose.Types.ObjectId()}/join`, bookedJar)
  check('G4 an unknown id is a 404', missing.status === 404, String(missing.status))
}

/* ═══════════ H — module blocking ═══════════ */
section('H. A blocked module refuses the seat holder too')
{
  const lc = await session(-1 * MIN, { sectionId: module1._id })
  await seat(booked, lc)
  await EnrollmentModel.updateOne({ userId: booked._id, courseId: course._id }, { $set: { blockedLessons: [module1._id] } })
  const r = await join(bookedJar, lc)
  check('H1 refused as MODULE_BLOCKED', r.status === 403 && code(r) === 'MODULE_BLOCKED', `${r.status} ${code(r)}`)
  await EnrollmentModel.updateOne({ userId: booked._id, courseId: course._id }, { $set: { blockedLessons: [] } })
  const r2 = await join(bookedJar, lc)
  check('H2 and allowed again once unblocked', r2.status === 200, `${r2.status} ${code(r2)}`)
}

/* ═══════════ I — account gates ═══════════ */
section('I. Account gates hold regardless of the seat')
{
  const lc = await session(-1 * MIN)
  for (const u of [pending, disabled, abroad]) await seat(u, lc)

  const pj = await login(pending)
  const r1 = await join(pj, lc)
  check('I1 an unapproved enrolment → ENROLMENT_NOT_APPROVED',
    r1.status === 403 && code(r1) === 'ENROLMENT_NOT_APPROVED', `${r1.status} ${code(r1)}`)

  const dj = await login(disabled)
  await UserModel.updateOne({ _id: disabled._id }, { $set: { isActive: false } })
  const r2 = await join(dj, lc)
  /* An account disabled while its session is live must be refused at once.
     Two things refuse it, in order: `authenticate` re-reads the account on
     every request and answers ACCOUNT_DISABLED before the route runs; the
     route's own fresh read behind it is the second line. Mutation testing
     shows removing the route's read alone changes nothing — that is the
     middleware doing its job, not a gap — so the assertion is on the code,
     which both produce, rather than on which layer produced it. */
  check('I2 an account disabled after sign-in is refused at the click as ACCOUNT_DISABLED',
    r2.status !== 200 && code(r2) === 'ACCOUNT_DISABLED', `${r2.status} ${code(r2)}`)
  await UserModel.updateOne({ _id: disabled._id }, { $set: { isActive: true } })

  const aj = await login(abroad)
  const r3 = await join(aj, lc)
  check('I3 another academy’s student → WRONG_ACADEMY',
    r3.status === 403 && code(r3) === 'WRONG_ACADEMY', `${r3.status} ${code(r3)}`)

  /* A seat outlives the enrolment it was taken with: deleting an enrolment
     does not touch booking rows. Revoking course access has to revoke the
     class, or the softer door hands out what the watch page refuses. */
  const lc2 = await session(-1 * MIN)
  await seat(booked, lc2)
  await EnrollmentModel.deleteOne({ userId: booked._id, courseId: course._id })
  const r4 = await join(bookedJar, lc2)
  check('I4 a seat whose enrolment was deleted → NOT_ENROLLED',
    r4.status === 403 && code(r4) === 'NOT_ENROLLED', `${r4.status} ${code(r4)}`)
  await EnrollmentModel.create({ userId: booked._id, courseId: course._id, status: 'active', blockedLessons: [] })
  const r5 = await join(bookedJar, lc2)
  check('I5 and allowed again once re-enrolled', r5.status === 200, `${r5.status} ${code(r5)}`)

  /* A DROPPED enrolment is no enrolment — at all three doors, so no page ever
     draws a button the click will refuse. (A regression hunt found the list,
     feed and watch page still saying isBooked:true for a dropped student.) */
  await EnrollmentModel.updateOne({ userId: booked._id, courseId: course._id }, { $set: { status: 'dropped' } })
  const r6 = await join(bookedJar, lc2)
  check('I6 a dropped enrolment → NOT_ENROLLED at the click', r6.status === 403 && code(r6) === 'NOT_ENROLLED', `${r6.status} ${code(r6)}`)
  const dRow = (await call('GET', '/live-classes', bookedJar)).body?.data?.find((x: any) => x.id === String(lc2._id))
  check('I7 the schedule row no longer says isBooked', dRow?.isBooked === false, String(dRow?.isBooked))
  const dUp = (await call('GET', '/live-classes/upcoming?limit=50', bookedJar)).body?.data?.find((x: any) => x.id === String(lc2._id))
  check('I8 nor does the upcoming feed', dUp === undefined || dUp?.isBooked === false, String(dUp?.isBooked))
  const dWatch = await call('GET', `/live-classes/${lc2._id}/watch`, bookedJar)
  check('I9 and the watch page refuses NOT_ENROLLED like the click', dWatch.status === 403 && code(dWatch) === 'NOT_ENROLLED',
    `${dWatch.status} ${code(dWatch)}`)
  await EnrollmentModel.updateOne({ userId: booked._id, courseId: course._id }, { $set: { status: 'active' } })
}

/* ═══════════ J — the seat holder's own payloads ═══════════ */
section('J. The booked student’s payloads carry the window and the seat — never the URL')
{
  const lc = await session(30 * MIN)
  await seat(booked, lc)

  const row = (await call('GET', '/live-classes', bookedJar)).body?.data?.find((x: any) => x.id === String(lc._id))
  check('J1 the schedule row says they hold a seat', row?.isBooked === true, String(row?.isBooked))
  check('J2 and gives the window from the server clock',
    row?.joinOpensAt === lc.scheduledStart.toISOString()
      && new Date(row?.joinClosesAt).getTime() === lc.scheduledStart.getTime() + 20 * MIN,
    `${row?.joinOpensAt} .. ${row?.joinClosesAt}`)
  check('J3 but not the URL — even to the seat holder', !JSON.stringify(row).includes('meet.google.com') && !('meetingUrl' in (row ?? {})),
    Object.keys(row ?? {}).join(','))

  /* A seat an admin has marked attended mid-class is still a seat, on the
     list as well as at the gate — or the button vanishes the moment the
     register is taken. */
  const att = await session(31 * MIN)
  await seat(booked, att, 'attended')
  const attRow = (await call('GET', '/live-classes', bookedJar)).body?.data?.find((x: any) => x.id === String(att._id))
  check('J3b a seat marked attended still reads isBooked on the schedule', attRow?.isBooked === true, String(attRow?.isBooked))

  const up = (await call('GET', '/live-classes/upcoming?limit=50', bookedJar)).body?.data?.find((x: any) => x.id === String(lc._id))
  check('J4 the upcoming feed agrees', up?.isBooked === true && !!up?.joinOpensAt && !('meetingUrl' in (up ?? {})),
    JSON.stringify({ isBooked: up?.isBooked, joinOpensAt: up?.joinOpensAt, hasUrl: 'meetingUrl' in (up ?? {}) }))

  const w = await call('GET', `/live-classes/${lc._id}/watch`, bookedJar)
  check('J5 the watch page gets the seat and the window', w.status === 200 && w.body?.data?.isBooked === true && !!w.body?.data?.joinClosesAt,
    `${w.status} ${JSON.stringify(w.body?.data)}`)
  check('J6 and not the URL', !JSON.stringify(w.body).includes('meet.google.com'))
  check('J5b and says the class is online, so the page can tell it from an in-person one',
    w.body?.data?.isOnline === true, String(w.body?.data?.isOnline))

  /* A withdrawn seat must read as no seat on the watch page too, or the page
     draws a button the click will refuse. (A mutant that dropped the status
     filter from the watch query survived until this existed.) */
  const gone = await session(32 * MIN)
  await seat(booked, gone, 'cancelled')
  const wg = await call('GET', `/live-classes/${gone._id}/watch`, bookedJar)
  check('J5c a cancelled seat reads isBooked=false on the watch page',
    wg.status === 200 && wg.body?.data?.isBooked === false, `${wg.status} ${String(wg.body?.data?.isBooked)}`)

  const mine = await call('GET', '/bookings/me?per_page=100', bookedJar)
  check('J7 the booking list carries no URL', mine.status === 200 && !JSON.stringify(mine.body).includes('meet.google.com'),
    String(mine.status))

  /* A fresh booking's response used to echo the URL back too. */
  const fresh = await session(90 * MIN)
  const made = await call('POST', '/bookings', bookedJar, { liveClassId: String(fresh._id) })
  check('J8 booking a seat does not hand back the URL', made.status === 201 && !JSON.stringify(made.body).includes('meet.google.com'),
    `${made.status} ${code(made)}`)
}

/* ═══════════ K — the admin side is untouched ═══════════ */
section('K. The admin payload still carries the URL — the admin Join button keeps its source')
{
  const lc = await session(-1 * MIN)
  const aj: Jar = new Map()
  const li = await call('POST', '/admin/auth/login', aj, { email: admin.email, password: PW })
  check('K1 the admin signs in', li.status === 200, String(li.status))
  const r = await call('GET', `/admin/live-classes/${lc._id}`, aj)
  check('K2 GET /admin/live-classes/:id still includes meetingUrl', r.status === 200 && r.body?.data?.meetingUrl === MEET,
    `${r.status} ${String(r.body?.data?.meetingUrl)}`)
  /* The admin Join button reads the LIST, not the detail. */
  const list = await call('GET', '/admin/live-classes', aj)
  const listRow = (Array.isArray(list.body?.data) ? list.body.data : list.body?.data?.items ?? [])
    .find((x: any) => x.id === String(lc._id))
  check('K3 and so does the admin list row the Join button is drawn from',
    list.status === 200 && listRow?.meetingUrl === MEET, `${list.status} ${String(listRow?.meetingUrl)}`)
}

/* ═══════════ L — unauthenticated ═══════════ */
section('L. No session, no link')
{
  const lc = await session(-1 * MIN)
  const r = await call('POST', `/live-classes/${lc._id}/join`)
  check('L1 401 without a session', r.status === 401, String(r.status))
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
console.log(`\njoinclass.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
