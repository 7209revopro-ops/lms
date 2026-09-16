/* ─────────────────────────────────────────────────────────────
   The Join button under attack — a black-box HTTP adversary.

   joinclass.suite proves the gate answers each rule correctly for a caller
   who plays fair. This suite is the caller who does not. It holds only a
   STUDENT session (plus, for a few probes, an admin session and a real
   impersonation session) and tries every trick a browser, a proxy or a
   curl loop can pull on POST /live-classes/:id/join and on the five payloads
   the URL used to ride in.

     A  baseline — the door is really there, and open, for the right caller
     B  wrong HTTP methods on the join path never hand out a URL
     C  id variants: somebody else's class, another academy's class, empty,
        "null", "undefined", a user/org/course id, an unknown 24-hex id,
        trailing slash, query string, URL-encoded junk, body injection
     D  header tricks: X-Organization-Id, X-Forwarded-For, Origin and Referer
        spoofing, the admin cookie on the student route, the admin token
        under the student cookie name, both cookies at once, a Bearer of the
        admin token, and the lms_imp_at impersonation cookie through the real
        POST /admin/users/:id/impersonate-client flow (IMPERSONATION_READ_ONLY)
     E  response hygiene over the WHOLE probe set: no 4xx/5xx body carries
        meet.google.com or googleMeetCode, no 5xx at all, refusals keep the
        envelope and echo no internals, the one 200 is Cache-Control: no-store
     F  the URL is in none of the student-reachable listings for the attacker
        — schedule, upcoming, watch, bookings, course page, notifications —
        including the notification a real link change fans out
     G  load, modest: 20 sequential + 10 concurrent clicks by a booked student
        all succeed with the same URL and no 500; 40 by a non-booker all 403
        and never a URL

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_joinadv_suite), dropped on exit.

   Run: bun run test:joinclass-adv
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_joinadv_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.ADMIN_URL    = 'http://localhost:3001'
process.env.EMAIL_OUTBOX = 'on'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_LOG_DIR = '.logs/emails-joinadv'
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
  UserModel, OrganizationModel, CourseModel, SectionModel, LiveClassModel,
  ClassBookingModel, EnrollmentModel, NotificationModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_joinadv_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const PORT = (server.address() as { port: number }).port
const BASE = `http://127.0.0.1:${PORT}/api/v1`

/* ── the probe log: every response the adversary ever received ──
   Section E sweeps this, so every call() lands here automatically. */
type Probe = { label: string; method: string; path: string; status: number; text: string; headers: Headers }
const probes: Probe[] = []

type Jar = Map<string, string>
async function call(
  method: string, p: string,
  opts: { jar?: Jar; body?: unknown; headers?: Record<string, string>; cookie?: string; label?: string; raw?: string } = {},
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json'
  if (opts.cookie !== undefined) headers['cookie'] = opts.cookie
  else if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, {
    method, headers,
    body: opts.raw !== undefined ? opts.raw : opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: 'manual',
  })
  if (opts.jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let parsed: any = text; try { parsed = JSON.parse(text) } catch {}
  probes.push({ label: opts.label ?? `${method} ${p}`, method, path: p, status: res.status, text, headers: res.headers })
  return { status: res.status, body: parsed, text, headers: res.headers, retryAfter: res.headers.get('retry-after') }
}

const PW   = 'Adversary1234'
const MIN  = 60_000
const MEET = 'https://meet.google.com/adv-test-abc'
const MEET_CODE = 'adv-test-abc'
const MEET_OTHER = 'https://meet.google.com/adv-other-xyz'
const MEET_CODE_OTHER = 'adv-other-xyz'
const code = (r: any) => String(r.body?.error?.code ?? '')
const hasUrl = (r: { text: string; body?: any }) =>
  /meet\.google\.com/i.test(r.text) || /googleMeetCode/.test(r.text)
  || r.text.includes(MEET_CODE) || r.text.includes(MEET_CODE_OTHER)
  || typeof r.body?.data?.url === 'string'
const cookieOf = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')

try {

/* ═══════════ fixtures ═══════════ */
const org   = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const other = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
const hash  = await hashPassword(PW)

const mk = (email: string, role: string, extra: Record<string, unknown> = {}) =>
  UserModel.create({
    name: email.split('@')[0], email, passwordHash: hash, role,
    isActive: true, isVerified: true, organizationId: org._id, ...extra,
  })

const superA   = await mk('root@adv.local',     'super_admin')
const admin    = await mk('admin@adv.local',    'admin')
const teacher  = await mk('teach@adv.local',    'instructor')
const booked   = await mk('booked@adv.local',   'student', { enrollmentStatus: 'approved' })
const nobody   = await mk('nobody@adv.local',   'student', { enrollmentStatus: 'approved' })
const abroad   = await mk('abroad@adv.local',   'student', { enrollmentStatus: 'approved', organizationId: other._id })
const teacher2 = await mk('teach2@adv.local',   'instructor', { organizationId: other._id })

const course = await CourseModel.create({
  title: 'Forex', slug: 'forex-adv', description: 'd', instructorId: teacher._id,
  price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
})
const module1 = await SectionModel.create({ courseId: course._id, title: 'Module 1', order: 1 })
const farCourse = await CourseModel.create({
  title: 'Forex BLR', slug: 'forex-blr', description: 'd', instructorId: teacher2._id,
  price: 0, isFree: true, status: 'published', language: 'English', organizationId: other._id,
})

/* Every student is ENROLLED. That is the exact population the old
   "entitled" check let read the link. */
for (const u of [booked, nobody]) {
  await EnrollmentModel.create({ userId: u._id, courseId: course._id, status: 'active', blockedLessons: [] })
}
await EnrollmentModel.create({ userId: abroad._id, courseId: farCourse._id, status: 'active', blockedLessons: [] })
/* The Bangalore student is also enrolled in the Dubai course — enrolment is
   not the wall, the academy is. */
await EnrollmentModel.create({ userId: abroad._id, courseId: course._id, status: 'active', blockedLessons: [] })

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
  const r = await call('POST', '/auth/login', { jar, body: { email: u.email, password: PW }, label: `login ${u.email}` })
  if (r.status !== 200) throw new Error(`login ${u.email}: ${r.status} ${code(r)}`)
  return jar
}
async function adminLogin(u: any): Promise<Jar> {
  const jar: Jar = new Map()
  const r = await call('POST', '/admin/auth/login', { jar, body: { email: u.email, password: PW }, label: `admin login ${u.email}` })
  if (r.status !== 200) throw new Error(`admin login ${u.email}: ${r.status} ${code(r)}`)
  return jar
}
const join = (jar: Jar, id: string, extra: Parameters<typeof call>[2] = {}) =>
  call('POST', `/live-classes/${id}/join`, { jar, ...extra })

const bookedJar = await login(booked)
const nobodyJar = await login(nobody)
const abroadJar = await login(abroad)
const adminJar  = await adminLogin(admin)
const rootJar   = await adminLogin(superA)

/* THE class: live right now, one seat (booked), and a Bangalore twin. */
const lc = await session(-1 * MIN)
await seat(booked, lc)
const ID = String(lc._id)
const farClass = await LiveClassModel.create({
  title: 'Far session', courseId: farCourse._id, instructorId: teacher2._id,
  organizationId: other._id, scheduledStart: new Date(Date.now() - 1 * MIN),
  durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
  language: 'English', sessionCapacity: 30, bookedCount: 0, meetingUrl: MEET_OTHER,
  googleMeetCode: MEET_CODE_OTHER,
})
await seat(abroad, farClass)

/* ═══════════ A — baseline ═══════════ */
section('A. Baseline — the door exists, and opens for the right caller')
{
  const r = await join(bookedJar, ID, { label: 'A booked click' })
  check('A1 the booked student inside the window gets 200', r.status === 200, `${r.status} ${code(r)}`)
  check('A2 with the URL', r.body?.data?.url === MEET, JSON.stringify(r.body?.data))
  check('A3 and Cache-Control: no-store', /no-store/.test(String(r.headers.get('cache-control'))),
    String(r.headers.get('cache-control')))
  const n = await join(nobodyJar, ID, { label: 'A non-booker click' })
  check('A4 the non-booker is NOT_BOOKED', n.status === 403 && code(n) === 'NOT_BOOKED', `${n.status} ${code(n)}`)
}

/* ═══════════ B — wrong methods ═══════════ */
section('B. Wrong HTTP methods on the join path never hand out a URL')
{
  /* Tried with the MOST privileged student — the seat holder — so that any
     leak through a verb would actually have something to leak. */
  for (const m of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
    const r = await call(m, `/live-classes/${ID}/join`, { jar: bookedJar, label: `B ${m} join` })
    check(`B1 ${m} /live-classes/:id/join is refused (${r.status})`, r.status >= 400 && r.status < 500,
      `status ${r.status}`)
    check(`B2 ${m} carries no URL`, !hasUrl(r), r.text.slice(0, 120))
  }
  const o = await call('OPTIONS', `/live-classes/${ID}/join`, { jar: bookedJar, label: 'B OPTIONS join' })
  check('B3 OPTIONS answers a bare preflight with no URL', !hasUrl(o) && o.status !== 200 || (o.status === 200 && !hasUrl(o)),
    `${o.status} ${o.text.slice(0, 80)}`)
  /* Method override headers: a proxy trick that turns a GET into a POST on
     some frameworks. Express ignores them unless method-override is mounted. */
  const ov = await call('GET', `/live-classes/${ID}/join`, {
    jar: bookedJar, headers: { 'x-http-method-override': 'POST', 'x-method-override': 'POST' }, label: 'B GET with method override',
  })
  check('B4 X-HTTP-Method-Override on a GET does not become a POST', ov.status >= 400 && !hasUrl(ov), `${ov.status}`)
  /* Non-JSON and junk bodies on the real verb are simply ignored. */
  const form = await call('POST', `/live-classes/${ID}/join`, {
    jar: nobodyJar, raw: 'liveClassId=' + ID + '&userId=' + String(booked._id),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, label: 'B form body',
  })
  check('B5 a form-encoded body naming the seat holder is still NOT_BOOKED', form.status === 403 && code(form) === 'NOT_BOOKED' && !hasUrl(form),
    `${form.status} ${code(form)}`)
  const bad = await call('POST', `/live-classes/${ID}/join`, {
    jar: nobodyJar, raw: '{bad json', headers: { 'content-type': 'application/json' }, label: 'B malformed json',
  })
  check('B6 malformed JSON is a 4xx, not a 500, and no URL', bad.status >= 400 && bad.status < 500 && !hasUrl(bad), `${bad.status}`)
}

/* ═══════════ C — id variants ═══════════ */
section('C. Id variants — every spelling of "not your class" is a refusal without a URL')
{
  const idProbes: [string, string, (r: any) => boolean, string][] = [
    /* label, path id, expectation, detail */
    ['another student\'s class',    ID,                                r => r.status === 403 && code(r) === 'NOT_BOOKED', 'NOT_BOOKED'],
    ['a class in another academy',  String(farClass._id),              r => r.status === 403 && ['WRONG_ACADEMY', 'NOT_BOOKED'].includes(code(r)), 'WRONG_ACADEMY'],
    ['"null"',                      'null',                            r => r.status === 400 && code(r) === 'INVALID_ID', 'INVALID_ID 400'],
    ['"undefined"',                 'undefined',                       r => r.status === 400 && code(r) === 'INVALID_ID', 'INVALID_ID 400'],
    ['a user id (admin-only doc)',  String(admin._id),                 r => r.status === 404 && code(r) === 'CLASS_NOT_FOUND', 'CLASS_NOT_FOUND 404'],
    ['the academy id',              String(org._id),                   r => r.status === 404 && code(r) === 'CLASS_NOT_FOUND', 'CLASS_NOT_FOUND 404'],
    ['the course id',               String(course._id),                r => r.status === 404 && code(r) === 'CLASS_NOT_FOUND', 'CLASS_NOT_FOUND 404'],
    ['the booking id',              String((await ClassBookingModel.findOne({ userId: booked._id, liveClassId: lc._id }).lean())!._id),
                                                                       r => r.status === 404 && code(r) === 'CLASS_NOT_FOUND', 'CLASS_NOT_FOUND 404'],
    ['an unknown 24-hex id',        String(new mongoose.Types.ObjectId()), r => r.status === 404 && code(r) === 'CLASS_NOT_FOUND', 'CLASS_NOT_FOUND 404'],
    ['all zeros',                   '000000000000000000000000',        r => r.status === 404 && code(r) === 'CLASS_NOT_FOUND', 'CLASS_NOT_FOUND 404'],
    ['all f',                       'ffffffffffffffffffffffff',        r => r.status === 404 && code(r) === 'CLASS_NOT_FOUND', 'CLASS_NOT_FOUND 404'],
    ['uppercase hex of the real id', ID.toUpperCase(),                 r => r.status === 403 && code(r) === 'NOT_BOOKED', 'NOT_BOOKED (same class, still no seat)'],
    ['trailing slash',              `${ID}/join/`,                     r => r.status === 403 && code(r) === 'NOT_BOOKED', 'NOT_BOOKED'],
    ['double slash before join',    `${ID}//join`,                     r => r.status >= 400 && r.status < 500, '4xx'],
    ['query string',                `${ID}/join?admin=1&userId=${String(booked._id)}&bypass=true#`, r => r.status === 403 && code(r) === 'NOT_BOOKED', 'NOT_BOOKED'],
    ['12-char string (isValid true)', 'abcdefghijkl',                  r => r.status >= 400 && r.status < 500, '4xx'],
    ['25 chars',                    ID + 'a',                          r => r.status === 400 && code(r) === 'INVALID_ID', 'INVALID_ID 400'],
    ['23 chars',                    ID.slice(0, 23),                   r => r.status === 400 && code(r) === 'INVALID_ID', 'INVALID_ID 400'],
    ['NUL-suffixed real id',        `${ID}%00`,                        r => r.status >= 400 && r.status < 500, '4xx'],
    ['space-prefixed real id',      `%20${ID}`,                        r => r.status >= 400 && r.status < 500, '4xx'],
    ['newline-suffixed real id',    `${ID}%0a`,                        r => r.status >= 400 && r.status < 500, '4xx'],
    ['dot-dot traversal',           `%2e%2e%2f${ID}`,                  r => r.status >= 400 && r.status < 500, '4xx'],
    ['encoded slash inside',        `${ID.slice(0, 12)}%2f${ID.slice(12)}`, r => r.status >= 400 && r.status < 500, '4xx'],
    ['JSON-ish id',                 encodeURIComponent(`{"$ne":null}`), r => r.status >= 400 && r.status < 500, '4xx'],
    ['operator-injection id',       encodeURIComponent(`{"$gt":""}`),  r => r.status >= 400 && r.status < 500, '4xx'],
    ['script tag id',               encodeURIComponent('<script>alert(1)</script>'), r => r.status >= 400 && r.status < 500, '4xx'],
    ['a very long id',              'a'.repeat(2048),                  r => r.status >= 400 && r.status < 500, '4xx'],
    ['unicode id',                  encodeURIComponent('ÿÿÿÿÿÿÿÿÿÿÿÿ'), r => r.status >= 400 && r.status < 500, '4xx'],
  ]
  for (const [label, id, expect, want] of idProbes) {
    const path = id.includes('/join') ? `/live-classes/${id}` : `/live-classes/${id}/join`
    const r = await call('POST', path, { jar: nobodyJar, label: `C id ${label}` })
    check(`C1 ${label} → ${want}`, expect(r), `${r.status} ${code(r)}`)
    check(`C2 ${label} carries no URL`, !hasUrl(r), r.text.slice(0, 120))
  }

  /* Empty id — two spellings. */
  const empty1 = await call('POST', '/live-classes//join', { jar: nobodyJar, label: 'C empty id //join' })
  check('C3 an empty id (//join) is a 4xx with no URL', empty1.status >= 400 && empty1.status < 500 && !hasUrl(empty1), `${empty1.status}`)
  const empty2 = await call('POST', '/live-classes/join', { jar: nobodyJar, label: 'C empty id /join' })
  check('C3b /live-classes/join (no id segment) is a 4xx with no URL', empty2.status >= 400 && empty2.status < 500 && !hasUrl(empty2), `${empty2.status}`)
  const empty3 = await call('POST', `/live-classes/${encodeURIComponent(' ')}/join`, { jar: nobodyJar, label: 'C blank id' })
  check('C3c a blank id is a 4xx with no URL', empty3.status >= 400 && empty3.status < 500 && !hasUrl(empty3), `${empty3.status}`)

  /* The Bangalore student against the Dubai class, and the Dubai
     non-booker against the Bangalore class: the academy wall from both
     sides. */
  const far1 = await join(abroadJar, ID, { label: 'C abroad on dubai class' })
  check('C4 the Bangalore student is WRONG_ACADEMY on the Dubai class', far1.status === 403 && code(far1) === 'WRONG_ACADEMY' && !hasUrl(far1),
    `${far1.status} ${code(far1)}`)
  const far2 = await join(nobodyJar, String(farClass._id), { label: 'C dubai on bangalore class' })
  check('C5 the Dubai student is WRONG_ACADEMY on the Bangalore class', far2.status === 403 && code(far2) === 'WRONG_ACADEMY' && !hasUrl(far2),
    `${far2.status} ${code(far2)}`)

  /* Body injection: the route reads NOTHING from the body. Every field a
     naive implementation might honour is sent at once. */
  const inj = await join(nobodyJar, ID, {
    body: {
      liveClassId: ID, userId: String(booked._id), id: String(booked._id), _id: String(booked._id),
      email: booked.email, role: 'super_admin', organizationId: String(org._id),
      status: 'booked', isBooked: true, bypass: true, admin: true, impersonatorId: String(superA._id),
      now: new Date(lc.scheduledStart.getTime() + 60_000).toISOString(),
      window: { opensAt: 0, closesAt: 9e15 }, meetingUrl: 'x', url: 'x',
    }, label: 'C body injection',
  })
  check('C6 a body full of privilege fields changes nothing — NOT_BOOKED', inj.status === 403 && code(inj) === 'NOT_BOOKED' && !hasUrl(inj),
    `${inj.status} ${code(inj)}`)
  const arr = await join(nobodyJar, ID, { raw: '[1,2,3]', headers: { 'content-type': 'application/json' }, label: 'C array body' })
  check('C6b an array body is NOT_BOOKED too', arr.status === 403 && code(arr) === 'NOT_BOOKED', `${arr.status} ${code(arr)}`)
  const jsonId = await call('POST', `/live-classes/${encodeURIComponent(JSON.stringify({ $in: [ID] }))}/join`, { jar: nobodyJar, label: 'C json id' })
  check('C6c a JSON object where the id goes is INVALID_ID, not a query', jsonId.status === 400 && code(jsonId) === 'INVALID_ID', `${jsonId.status} ${code(jsonId)}`)

  /* The legitimate seat holder through the same odd spellings — these are
     the ones where a 200 is CORRECT, and what matters is that the 200 is
     for the class the id names, not something else. */
  const bs = await call('POST', `/live-classes/${ID}/join/`, { jar: bookedJar, label: 'C booked trailing slash' })
  check('C7 trailing slash for the seat holder resolves to the same class', bs.status === 200 ? bs.body?.data?.url === MEET : bs.status < 500,
    `${bs.status} ${code(bs)}`)
  const bq = await call('POST', `/live-classes/${ID}/join?x=1`, { jar: bookedJar, label: 'C booked query' })
  check('C7b a query string for the seat holder resolves to the same class', bq.status === 200 && bq.body?.data?.url === MEET, `${bq.status} ${code(bq)}`)
  const bu = await call('POST', `/live-classes/${ID.toUpperCase()}/join`, { jar: bookedJar, label: 'C booked uppercase' })
  check('C7c uppercase hex for the seat holder is the same class, or a clean refusal', bu.status === 200 ? bu.body?.data?.url === MEET : (bu.status < 500 && !hasUrl(bu)),
    `${bu.status} ${code(bu)}`)
  /* And the seat holder against the Bangalore class — a seat in Dubai is
     not a seat anywhere. */
  const bf = await join(bookedJar, String(farClass._id), { label: 'C booked on bangalore class' })
  check('C8 the Dubai seat holder gets nothing from the Bangalore class', bf.status === 403 && !hasUrl(bf), `${bf.status} ${code(bf)}`)
}

/* ═══════════ D — header tricks ═══════════ */
section('D. Header tricks — nothing in a header moves the gate')
{
  /* X-Organization-Id is the super admin's org switcher. From a student it
     must be inert: the Bangalore student naming the Dubai academy is still
     a Bangalore student. */
  const xo = await join(abroadJar, ID, { headers: { 'x-organization-id': String(org._id) }, label: 'D X-Organization-Id' })
  check('D1 X-Organization-Id from another academy\'s student is ignored → WRONG_ACADEMY',
    xo.status === 403 && code(xo) === 'WRONG_ACADEMY' && !hasUrl(xo), `${xo.status} ${code(xo)}`)
  const xo2 = await join(nobodyJar, ID, { headers: { 'x-organization-id': String(org._id) }, label: 'D X-Organization-Id own org' })
  check('D1b X-Organization-Id naming the caller\'s own academy does not conjure a seat',
    xo2.status === 403 && code(xo2) === 'NOT_BOOKED', `${xo2.status} ${code(xo2)}`)
  const xo3 = await join(nobodyJar, ID, { headers: { 'x-organization-id': 'not-an-id' }, label: 'D X-Organization-Id junk' })
  check('D1c a junk X-Organization-Id is not a 500', xo3.status < 500 && !hasUrl(xo3), `${xo3.status}`)

  /* X-Forwarded-For: trust proxy is on, so the header IS read — for the ip.
     It must not be read for anything else. */
  /* (A NUL byte in a header value is refused by the HTTP client itself
     before it leaves, so it cannot be probed from here.) */
  for (const xff of ['127.0.0.1', '10.0.0.1', '::1', 'localhost', '127.0.0.1, 10.0.0.1', 'evil', 'a'.repeat(4000)]) {
    const r = await join(nobodyJar, ID, { headers: { 'x-forwarded-for': xff, 'x-real-ip': xff }, label: `D XFF ${xff.slice(0, 20)}` })
    check(`D2 X-Forwarded-For "${xff.slice(0, 20)}" → still NOT_BOOKED`, r.status === 403 && code(r) === 'NOT_BOOKED' && !hasUrl(r),
      `${r.status} ${code(r)}`)
  }
  const xhost = await join(nobodyJar, ID, { headers: { 'x-forwarded-host': 'admin.internal', 'x-forwarded-proto': 'https', 'host': 'admin.internal' }, label: 'D forwarded host' })
  check('D2b X-Forwarded-Host / Host spoofing → still NOT_BOOKED', xhost.status === 403 && code(xhost) === 'NOT_BOOKED', `${xhost.status} ${code(xhost)}`)

  /* Origin: an origin outside the allow-list is a CORS refusal — even for
     the seat holder, and the refusal must carry no URL. */
  const evil = await join(bookedJar, ID, { headers: { origin: 'https://evil.example' }, label: 'D evil origin' })
  check('D3 an Origin outside the allow-list is refused even for the seat holder', evil.status === 403 && code(evil) === 'CORS_ERROR' && !hasUrl(evil),
    `${evil.status} ${code(evil)}`)
  const nullOrigin = await join(bookedJar, ID, { headers: { origin: 'null' }, label: 'D null origin' })
  check('D3b Origin: null is refused', nullOrigin.status === 403 && !hasUrl(nullOrigin), `${nullOrigin.status} ${code(nullOrigin)}`)
  const lookalike = await join(bookedJar, ID, { headers: { origin: 'http://localhost:3000.evil.example' }, label: 'D lookalike origin' })
  check('D3c a look-alike origin is refused', lookalike.status === 403 && !hasUrl(lookalike), `${lookalike.status} ${code(lookalike)}`)
  const okOrigin = await join(bookedJar, ID, { headers: { origin: 'http://localhost:3000' }, label: 'D allowed origin' })
  check('D3d the real client origin still works for the seat holder', okOrigin.status === 200 && okOrigin.body?.data?.url === MEET, `${okOrigin.status} ${code(okOrigin)}`)
  const okOriginNobody = await join(nobodyJar, ID, { headers: { origin: 'http://localhost:3000' }, label: 'D allowed origin non-booker' })
  check('D3e and not for the non-booker', okOriginNobody.status === 403 && code(okOriginNobody) === 'NOT_BOOKED', `${okOriginNobody.status}`)
  /* Referer is never an authority. Spoofing the admin panel's changes nothing. */
  const ref = await join(nobodyJar, ID, { headers: { referer: 'http://localhost:3001/live-classes', origin: 'http://localhost:3001' }, label: 'D admin referer' })
  check('D4 Referer/Origin of the admin panel does not promote a student', ref.status === 403 && code(ref) === 'NOT_BOOKED' && !hasUrl(ref),
    `${ref.status} ${code(ref)}`)

  /* The admin cookie on the student route. authenticate() reads lms_at,
     lms_imp_at and a Bearer — the admin cookie must be invisible to it. */
  const adminCookie = adminJar.get('lms_admin_at')
  check('D5 setup: the admin session has an lms_admin_at cookie', !!adminCookie)
  const ac = await join(new Map(), ID, { cookie: `lms_admin_at=${adminCookie}`, label: 'D admin cookie alone' })
  check('D5a lms_admin_at alone on the student route is 401', ac.status === 401 && !hasUrl(ac), `${ac.status} ${code(ac)}`)
  const rc = await join(new Map(), ID, { cookie: `lms_admin_at=${rootJar.get('lms_admin_at')}`, label: 'D super admin cookie alone' })
  check('D5b the super admin\'s lms_admin_at alone is 401 too', rc.status === 401 && !hasUrl(rc), `${rc.status} ${code(rc)}`)
  const renamed = await join(new Map(), ID, { cookie: `lms_at=${adminCookie}`, label: 'D admin token as lms_at' })
  check('D5c the admin token under the lms_at name is INVALID_TOKEN (audience)', renamed.status === 401 && !hasUrl(renamed), `${renamed.status} ${code(renamed)}`)
  const bearer = await join(new Map(), ID, { headers: { authorization: `Bearer ${adminCookie}` }, label: 'D admin token as bearer' })
  check('D5d the admin token as a Bearer is 401', bearer.status === 401 && !hasUrl(bearer), `${bearer.status} ${code(bearer)}`)
  const rootBearer = await join(new Map(), ID, { headers: { authorization: `Bearer ${rootJar.get('lms_admin_at')}` }, label: 'D root token as bearer' })
  check('D5e the super admin token as a Bearer is 401', rootBearer.status === 401 && !hasUrl(rootBearer), `${rootBearer.status} ${code(rootBearer)}`)

  /* Both cookies at once: the student cookie is the one judged, the admin
     cookie beside it adds nothing. */
  const both = await join(new Map(), ID, { cookie: `${cookieOf(nobodyJar)}; lms_admin_at=${rootJar.get('lms_admin_at')}`, label: 'D both cookies non-booker' })
  check('D6 non-booker lms_at + super admin lms_admin_at → NOT_BOOKED, not promoted', both.status === 403 && code(both) === 'NOT_BOOKED' && !hasUrl(both),
    `${both.status} ${code(both)}`)
  const bothBooked = await join(new Map(), ID, { cookie: `${cookieOf(bookedJar)}; lms_admin_at=${rootJar.get('lms_admin_at')}`, label: 'D both cookies booked' })
  check('D6b seat holder lms_at + admin cookie → the same 200, nothing more', bothBooked.status === 200 && bothBooked.body?.data?.url === MEET,
    `${bothBooked.status} ${code(bothBooked)}`)
  const bothAbroad = await join(new Map(), ID, { cookie: `${cookieOf(abroadJar)}; lms_admin_at=${rootJar.get('lms_admin_at')}`, label: 'D both cookies abroad' })
  check('D6c abroad lms_at + super admin cookie → still WRONG_ACADEMY', bothAbroad.status === 403 && code(bothAbroad) === 'WRONG_ACADEMY', `${bothAbroad.status} ${code(bothAbroad)}`)
  /* Two lms_at cookies in one header: the first wins in cookie-parser, and
     whichever wins, the result is one of the two honest answers. */
  const twice = await join(new Map(), ID, { cookie: `${cookieOf(nobodyJar)}; ${cookieOf(bookedJar)}`, label: 'D two lms_at cookies' })
  check('D6d two lms_at cookies resolve to one honest session (no 500)', twice.status < 500 && (twice.status === 200 ? twice.body?.data?.url === MEET : !hasUrl(twice)),
    `${twice.status} ${code(twice)}`)
  /* Bearer of a student + cookie of another: the cookie wins by design. */
  const mixed = await join(new Map(), ID, { cookie: cookieOf(nobodyJar), headers: { authorization: `Bearer ${bookedJar.get('lms_at')}` }, label: 'D cookie + bearer' })
  check('D6e non-booker cookie + seat holder Bearer → the cookie is judged (NOT_BOOKED)', mixed.status === 403 && code(mixed) === 'NOT_BOOKED',
    `${mixed.status} ${code(mixed)}`)

  /* Tampered student token: flip a character of the signature. */
  const tok = bookedJar.get('lms_at')!
  const flipped = tok.slice(0, -2) + (tok.endsWith('A') ? 'B' : 'A') + tok.slice(-1)
  const tam = await join(new Map(), ID, { cookie: `lms_at=${flipped}`, label: 'D tampered token' })
  check('D7 a tampered seat-holder token is 401', tam.status === 401 && !hasUrl(tam), `${tam.status} ${code(tam)}`)
  const junkCookie = await join(new Map(), ID, { cookie: 'lms_at=; lms_imp_at=; lms_admin_at=', label: 'D empty cookies' })
  check('D7b empty cookie values are 401', junkCookie.status === 401 && !hasUrl(junkCookie), `${junkCookie.status} ${code(junkCookie)}`)

  /* ── the impersonation cookie, through the real flow ── */
  const created = await call('POST', `/admin/users/${booked._id}/impersonate-client`, { jar: rootJar, label: 'D impersonate-client' })
  check('D8 setup: the super admin starts a client impersonation of the seat holder', created.status === 200 && !!created.body?.data?.code,
    `${created.status} ${code(created)}`)
  const impJar: Jar = new Map()
  const redeemed = await call('POST', '/auth/impersonation/redeem', { jar: impJar, body: { code: created.body?.data?.code }, label: 'D redeem' })
  check('D8a and the browser redeems it into an lms_imp_at cookie', redeemed.status === 200 && impJar.has('lms_imp_at'),
    `${redeemed.status} ${code(redeemed)} ${[...impJar.keys()].join(',')}`)
  const me = await call('GET', '/auth/me', { jar: impJar, label: 'D imp /auth/me' })
  check('D8b the impersonation session acts as the seat holder', me.status === 200 && String(me.body?.data?.email ?? me.body?.data?.user?.email) === booked.email,
    `${me.status} ${JSON.stringify(me.body?.data).slice(0, 120)}`)
  const impJoin = await join(impJar, ID, { label: 'D imp join' })
  check('D8c POST join while impersonating the seat holder → 403 IMPERSONATION_READ_ONLY',
    impJoin.status === 403 && code(impJoin) === 'IMPERSONATION_READ_ONLY' && !hasUrl(impJoin), `${impJoin.status} ${code(impJoin)}`)
  /* The impersonator's own admin cookie next to the impersonation cookie —
     the usual browser state — must not upgrade it. */
  const impPlusAdmin = await join(new Map(), ID, { cookie: `${cookieOf(impJar)}; lms_admin_at=${rootJar.get('lms_admin_at')}`, label: 'D imp + admin cookie' })
  check('D8d impersonation cookie + super admin cookie → still IMPERSONATION_READ_ONLY',
    impPlusAdmin.status === 403 && code(impPlusAdmin) === 'IMPERSONATION_READ_ONLY', `${impPlusAdmin.status} ${code(impPlusAdmin)}`)
  /* And the seat holder's REAL lms_at beside the impersonation cookie: the
     impersonation wins by design, so the click is still read-only. */
  const impPlusReal = await join(new Map(), ID, { cookie: `${cookieOf(bookedJar)}; ${cookieOf(impJar)}`, label: 'D imp + real lms_at' })
  check('D8e impersonation cookie + the seat holder\'s own lms_at → IMPERSONATION_READ_ONLY (imp wins)',
    impPlusReal.status === 403 && code(impPlusReal) === 'IMPERSONATION_READ_ONLY', `${impPlusReal.status} ${code(impPlusReal)}`)
  /* While impersonating, the READ surfaces are open — and must carry no URL
     for the impersonator either. */
  for (const [name, p] of [
    ['GET /live-classes', '/live-classes'], ['GET /live-classes/upcoming', '/live-classes/upcoming?limit=50'],
    ['GET /live-classes/:id/watch', `/live-classes/${ID}/watch`], ['GET /bookings/me', '/bookings/me?per_page=100'],
  ] as const) {
    const r = await call('GET', p, { jar: impJar, label: `D imp ${name}` })
    check(`D9 ${name} while impersonating: 200 and no URL`, r.status === 200 && !hasUrl(r), `${r.status} ${code(r)} ${r.text.slice(0, 80)}`)
  }
  const impGarbage = await join(new Map(), ID, { cookie: `${cookieOf(bookedJar)}; lms_imp_at=not-a-jwt`, label: 'D junk imp cookie' })
  check('D9b a junk lms_imp_at beside a real lms_at is 401, not a silent downgrade to the real session',
    impGarbage.status === 401 && !hasUrl(impGarbage), `${impGarbage.status} ${code(impGarbage)}`)
}

/* ═══════════ F — the leak closure, for the attacker ═══════════ */
section('F. The URL is in none of the listings the attacker can reach')
{
  /* A cancelled seat first, so /bookings/me has a row with the class
     populated — an empty list proves nothing. */
  await seat(nobody, lc, 'cancelled')
  const rowOf = (b: any) => Array.isArray(b?.data) && b.data.some((x: any) => x.id === ID)
  const surfaces: [string, string, (b: any) => boolean][] = [
    ['GET /live-classes',                 '/live-classes',                     rowOf],
    ['GET /live-classes?per_page=100',    '/live-classes?per_page=100&page=1', rowOf],
    ['GET /live-classes/upcoming',        '/live-classes/upcoming?limit=50',   rowOf],
    ['GET /live-classes/:id/watch',       `/live-classes/${ID}/watch`,         b => b?.data?.type === 'external'],
    ['GET /bookings/me',                  '/bookings/me?per_page=100',
      b => Array.isArray(b?.data) && b.data.some((x: any) => String(x.liveClassId?.id ?? x.liveClassId?._id ?? x.liveClassId) === ID)],
    ['GET /courses/:slug/live-classes',   '/courses/forex-adv/live-classes',   () => true],
  ]
  for (const [name, p, present] of surfaces) {
    const r = await call('GET', p, { jar: nobodyJar, label: `F ${name}` })
    check(`F1 ${name} answers 200 with the class in it`, r.status === 200 && present(r.body), `status ${r.status}`)
    check(`F2 ${name} carries no Meet URL or code`, !hasUrl(r) && !r.text.includes('meetingUrl'), r.text.slice(0, 100))
  }
  /* Field-name probes: a client cannot ask for the field back. */
  for (const q of ['?fields=meetingUrl', '?select=meetingUrl,googleMeetCode', '?include=meetingUrl', '?populate=liveClassId.meetingUrl', '?meetingUrl=1']) {
    const r = await call('GET', `/live-classes${q}`, { jar: nobodyJar, label: `F select ${q}` })
    check(`F3 GET /live-classes${q} does not project the URL in`, r.status < 500 && !hasUrl(r) && !r.text.includes('meetingUrl'), `${r.status}`)
    const w = await call('GET', `/live-classes/${ID}/watch${q}`, { jar: nobodyJar, label: `F watch select ${q}` })
    check(`F3b GET /live-classes/:id/watch${q} does not either`, w.status < 500 && !hasUrl(w) && !w.text.includes('meetingUrl'), `${w.status}`)
  }
  /* Notifications: a real link change fans out an in-app notice to the seat
     holder. The notice must point at the class, not carry the link. */
  const NEW_MEET = 'https://meet.google.com/adv-changed-qrs'
  const before = await NotificationModel.countDocuments({ userId: booked._id })
  const patched = await call('PATCH', `/admin/live-classes/${ID}`, { jar: adminJar, body: { meetingUrl: NEW_MEET }, label: 'F admin patch link' })
  check('F4 setup: the admin changes the meeting link', patched.status === 200, `${patched.status} ${code(patched)}`)
  let after = before
  for (let i = 0; i < 40 && after === before; i++) {
    await new Promise(x => setTimeout(x, 150))
    after = await NotificationModel.countDocuments({ userId: booked._id })
  }
  check('F4a and the seat holder is notified in-app', after > before, `${before} -> ${after}`)
  for (const [who, jar] of [['seat holder', bookedJar], ['non-booker', nobodyJar], ['impersonator', undefined]] as const) {
    if (!jar) continue
    const n = await call('GET', '/notifications?per_page=100', { jar, label: `F notifications ${who}` })
    check(`F5 GET /notifications for the ${who} is 200`, n.status === 200, `${n.status}`)
    check(`F5a and carries no Meet URL or code`, !hasUrl(n) && !/adv-changed-qrs/.test(n.text) && !n.text.includes('meetingUrl'), n.text.slice(0, 120))
    const un = await call('GET', '/notifications/unread-count', { jar, label: `F unread ${who}` })
    check(`F5b GET /notifications/unread-count for the ${who} carries no URL`, un.status === 200 && !hasUrl(un), `${un.status}`)
  }
  const notes = await call('GET', '/notifications?per_page=100', { jar: bookedJar, label: 'F notifications seat holder again' })
  const rows = Array.isArray(notes.body?.data) ? notes.body.data : notes.body?.data?.items ?? []
  check('F5c the seat holder\'s link-change notice points at the class, not the link',
    rows.some((x: any) => String(x.link ?? '').includes(ID)) && !rows.some((x: any) => /meet\.google/i.test(JSON.stringify(x))),
    JSON.stringify(rows.slice(0, 2)).slice(0, 200))
  /* The changed link is what the seat holder now gets on the click — and
     the non-booker still gets nothing. */
  const fresh = await join(bookedJar, ID, { label: 'F click after change' })
  check('F6 the click now hands the seat holder the CHANGED link', fresh.status === 200 && fresh.body?.data?.url === NEW_MEET, `${fresh.status} ${String(fresh.body?.data?.url)}`)
  const still = await join(nobodyJar, ID, { label: 'F non-booker after change' })
  check('F6a and the non-booker is still NOT_BOOKED', still.status === 403 && code(still) === 'NOT_BOOKED' && !/adv-changed/.test(still.text), `${still.status}`)
  /* Put the fixture back for the load section. */
  await LiveClassModel.updateOne({ _id: lc._id }, { $set: { meetingUrl: MEET, googleMeetCode: MEET_CODE } })

  /* The admin list and detail DO carry the URL — but only behind the admin
     cookie. The student cookie on those routes is a refusal with no URL. */
  const adminList = await call('GET', '/admin/live-classes', { jar: nobodyJar, label: 'F student on admin list' })
  check('F7 a student on GET /admin/live-classes is refused with no URL', adminList.status >= 401 && adminList.status < 500 && !hasUrl(adminList), `${adminList.status}`)
  const adminDetail = await call('GET', `/admin/live-classes/${ID}`, { jar: nobodyJar, label: 'F student on admin detail' })
  check('F7a a student on GET /admin/live-classes/:id is refused with no URL', adminDetail.status >= 401 && adminDetail.status < 500 && !hasUrl(adminDetail), `${adminDetail.status}`)
  const adminDetailBoth = await call('GET', `/admin/live-classes/${ID}`, { cookie: `${cookieOf(nobodyJar)}; lms_admin_at=${adminJar.get('lms_admin_at')}`, label: 'F both cookies on admin detail' })
  check('F7b (control) the admin cookie beside it DOES open the admin detail — the two doors are distinct', adminDetailBoth.status === 200 && hasUrl(adminDetailBoth), `${adminDetailBoth.status}`)
  const studentAsAdminHeader = await call('GET', `/admin/live-classes/${ID}`, { cookie: `lms_admin_at=${nobodyJar.get('lms_at')}`, label: 'F student token as admin cookie' })
  check('F7c the student token under the lms_admin_at name is refused on the admin detail', studentAsAdminHeader.status === 401 && !hasUrl(studentAsAdminHeader), `${studentAsAdminHeader.status} ${code(studentAsAdminHeader)}`)
}

/* ═══════════ G — load, modest ═══════════ */
section('G. Repeated clicks — the seat holder always gets the same link, the non-booker never gets one')
{
  const seqResults: any[] = []
  for (let i = 0; i < 20; i++) seqResults.push(await join(bookedJar, ID, { label: `G seq ${i}` }))
  check('G1 20 sequential clicks by the seat holder all succeed', seqResults.every(r => r.status === 200), seqResults.map(r => r.status).join(','))
  check('G1a all with the same URL', seqResults.every(r => r.body?.data?.url === MEET), [...new Set(seqResults.map(r => String(r.body?.data?.url)))].join(','))
  check('G1b all with the same closesAt', new Set(seqResults.map(r => r.body?.data?.closesAt)).size === 1)
  check('G1c all Cache-Control: no-store', seqResults.every(r => /no-store/.test(String(r.headers.get('cache-control')))))

  const conc = await Promise.all(Array.from({ length: 10 }, (_, i) => join(bookedJar, ID, { label: `G conc ${i}` })))
  check('G2 10 concurrent clicks by the seat holder all succeed', conc.every(r => r.status === 200), conc.map(r => r.status).join(','))
  check('G2a all with the same URL', conc.every(r => r.body?.data?.url === MEET))
  check('G2b no 500 anywhere', [...seqResults, ...conc].every(r => r.status < 500))

  /* The non-booker, 40 times: 20 sequential then two waves of 10. */
  const burst: any[] = []
  for (let i = 0; i < 20; i++) burst.push(await join(nobodyJar, ID, { label: `G burst seq ${i}` }))
  for (let w = 0; w < 2; w++) burst.push(...await Promise.all(Array.from({ length: 10 }, (_, i) => join(nobodyJar, ID, { label: `G burst conc ${w}-${i}` }))))
  check('G3 40 clicks by the non-booker are all 403', burst.length === 40 && burst.every(r => r.status === 403), [...new Set(burst.map(r => r.status))].join(','))
  check('G3a all NOT_BOOKED', burst.every(r => code(r) === 'NOT_BOOKED'), [...new Set(burst.map(code))].join(','))
  check('G3b and never a URL', burst.every(r => !hasUrl(r)))
  check('G3c and never rate-limited into a different answer (no 429)', burst.every(r => r.status !== 429))

  /* Seat holder and non-booker interleaved concurrently: no cross-talk. */
  const mixed = await Promise.all(Array.from({ length: 10 }, (_, i) => i % 2 === 0
    ? join(bookedJar, ID, { label: `G mixed booked ${i}` }).then(r => ({ who: 'booked', r }))
    : join(nobodyJar, ID, { label: `G mixed nobody ${i}` }).then(r => ({ who: 'nobody', r }))))
  check('G4 interleaved concurrent clicks: the seat holder always 200 with the URL',
    mixed.filter(x => x.who === 'booked').every(x => x.r.status === 200 && x.r.body?.data?.url === MEET))
  check('G4a and the non-booker always 403 with none',
    mixed.filter(x => x.who === 'nobody').every(x => x.r.status === 403 && !hasUrl(x.r)))

  /* After all that, the seat holder still gets in — nothing was locked. */
  const last = await join(bookedJar, ID, { label: 'G last' })
  check('G5 the seat holder still gets the link after the burst', last.status === 200 && last.body?.data?.url === MEET, `${last.status} ${code(last)}`)
}

/* ═══════════ E — response hygiene over the whole probe set ═══════════
   Run LAST so it sweeps every response above, including the load section. */
section('E. Response hygiene across every probe')
{
  const refusals = probes.filter(p => p.status >= 400)
  const oks      = probes.filter(p => p.status >= 200 && p.status < 300)
  const fives    = probes.filter(p => p.status >= 500)
  check(`E1 no probe ever produced a 5xx (${probes.length} probes)`, fives.length === 0,
    fives.map(f => `${f.label} ${f.status}`).slice(0, 5).join(' | '))
  const leaking = refusals.filter(p => /meet\.google\.com/i.test(p.text) || /googleMeetCode/.test(p.text) || p.text.includes(MEET_CODE) || p.text.includes(MEET_CODE_OTHER))
  check(`E2 no 4xx/5xx body carries meet.google.com or googleMeetCode (${refusals.length} refusals)`, leaking.length === 0,
    leaking.map(l => `${l.label} ${l.status}`).slice(0, 5).join(' | '))
  /* Every 200 that carried the URL is on the join path, and on that path
     only with no-store. */
  const urlOks = oks.filter(p => /meet\.google\.com/i.test(p.text))
  const offPath = urlOks.filter(p => !/^\/live-classes\/[^/]+\/join\/?(\?.*)?$/.test(p.path) && !p.path.startsWith('/admin/'))
  check(`E3 every 2xx that carries the URL is the join door or the admin panel (${urlOks.length} such)`, offPath.length === 0,
    offPath.map(o => `${o.label} ${o.path}`).slice(0, 5).join(' | '))
  const joinOks = urlOks.filter(p => p.path.includes('/join'))
  check('E3a every join 200 is Cache-Control: no-store', joinOks.length > 0 && joinOks.every(p => /no-store/.test(String(p.headers.get('cache-control')))),
    joinOks.filter(p => !/no-store/.test(String(p.headers.get('cache-control')))).map(p => p.label).slice(0, 3).join(' | '))
  /* Refusals keep the envelope and say nothing about the inside. */
  const badShape = refusals.filter(p => {
    if (p.method === 'HEAD' || p.method === 'OPTIONS') return false
    try { const b = JSON.parse(p.text); return !(b.success === false && typeof b.error?.code === 'string' && typeof b.error?.message === 'string') }
    catch { return p.text.length > 0 }
  })
  check('E4 every refusal keeps the { success:false, error:{code,message} } envelope', badShape.length === 0,
    badShape.map(b => `${b.label} ${b.status} ${b.text.slice(0, 60)}`).slice(0, 4).join(' | '))
  const INTERNAL = /stack|\bat [A-Za-z_$][\w$]*\s*\(|node_modules|mongoose|MongoServerError|CastError|BSONError|ObjectId\(|\.ts:\d+|ECONNREFUSED|TypeError|ReferenceError|Cannot read prop|is not a function|undefined is not|C:\\|\/src\//i
  const echoing = refusals.filter(p => INTERNAL.test(p.text))
  check('E5 no refusal echoes internals (stack, paths, driver or class names)', echoing.length === 0,
    echoing.map(e => `${e.label} ${e.status} ${e.text.slice(0, 80)}`).slice(0, 4).join(' | '))
  /* The attacker's input is never reflected raw — a script id, a NUL, an
     operator object. Reflection is not a leak of the link, but it is how
     the next bug gets in. */
  const reflecting = refusals.filter(p => /<script>|\$ne|\$gt|\$in|\u0000/.test(p.text))
  check('E6 no refusal reflects the attacker\'s raw input', reflecting.length === 0,
    reflecting.map(r => `${r.label} ${r.text.slice(0, 80)}`).slice(0, 4).join(' | '))
  /* Refusal codes are one of the documented gate codes or a generic 4xx —
     nothing unnamed slipped through. */
  const KNOWN = new Set(['NOT_A_MEET_CLASS', 'CLASS_CANCELLED', 'CLASS_ENDED', 'ACCOUNT_DISABLED', 'ENROLMENT_NOT_APPROVED', 'WRONG_ACADEMY',
    'NOT_BOOKED', 'NOT_ENROLLED', 'MODULE_BLOCKED', 'TOO_EARLY', 'JOIN_WINDOW_CLOSED', 'INVALID_ID', 'CLASS_NOT_FOUND', 'NOT_FOUND',
    'MISSING_TOKEN', 'INVALID_TOKEN', 'TOKEN_EXPIRED', 'CORS_ERROR', 'IMPERSONATION_READ_ONLY', 'FORBIDDEN', 'INVALID_JSON', 'VALIDATION_ERROR',
    'INSUFFICIENT_ROLE', 'INSUFFICIENT_PERMISSIONS', 'INVALID_ORGANIZATION', 'PAYLOAD_TOO_LARGE'])
  const unknownCodes = refusals.filter(p => p.path.includes('/join')).map(p => { try { return JSON.parse(p.text)?.error?.code } catch { return undefined } })
    .filter(c => typeof c === 'string' && !KNOWN.has(c))
  check('E7 every join refusal uses a documented code', unknownCodes.length === 0, [...new Set(unknownCodes)].join(','))
  /* Security headers ride on refusals too. */
  const noSniff = refusals.filter(p => p.headers.get('x-content-type-options') !== 'nosniff')
  check('E8 refusals carry X-Content-Type-Options: nosniff', noSniff.length === 0, noSniff.map(n => n.label).slice(0, 3).join(' | '))
  const powered = probes.filter(p => p.headers.has('x-powered-by'))
  check('E9 no response names the framework (X-Powered-By)', powered.length === 0)
  /* Timing: a refusal for a non-existent class and one for an existing
     class the caller has no seat in should not differ by an order of
     magnitude — a wide gap would let an attacker enumerate class ids. A
     loose bound on a shared machine: the slower must be under 20x the faster
     across 8 samples each, medians compared. */
  const time = async (id: string) => { const t = performance.now(); await join(nobodyJar, id, { label: `E timing ${id.slice(0, 6)}` }); return performance.now() - t }
  const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
  const tReal: number[] = [], tGhost: number[] = []
  const ghost = String(new mongoose.Types.ObjectId())
  for (let i = 0; i < 8; i++) { tReal.push(await time(ID)); tGhost.push(await time(ghost)) }
  const ratio = Math.max(med(tReal), med(tGhost)) / Math.max(1, Math.min(med(tReal), med(tGhost)))
  check('E10 refusing an unknown id and refusing a real one take the same order of time', ratio < 20,
    `real ${med(tReal).toFixed(1)}ms ghost ${med(tGhost).toFixed(1)}ms`)
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
console.log(`\njoinclass.adversarial.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
