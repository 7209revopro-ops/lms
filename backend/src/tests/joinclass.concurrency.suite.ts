/* ─────────────────────────────────────────────────────────────
   The Meet join gate under concurrency and races.

   joinclass.suite proves what the gate answers when the world holds still.
   This one shakes it: the same click fired many times at once, and a click
   fired at the SAME INSTANT as the admin action that should refuse it. The
   invariant under test:

     the URL is released only to a caller who holds a live seat AT THE MOMENT
     of the check — and every other answer is a shaped refusal, never a 500,
     never an unhandled rejection.

   A race has two legitimate outcomes (the click landed before the withdrawal,
   or after) and no third. So each race asserts the outcome SET and reports
   the observed split, and then confirms that once the withdrawal is
   acknowledged the very next click is refused — that is what "at the moment"
   means, observably.

     1  25 simultaneous joins by one booked student — all 200, one URL, no
        side effects, nothing created
     2  join ‖ booking → cancelled, ×30 — {200, NOT_BOOKED} only
     3  join ‖ enrolment deleted, ×30 — {200, NOT_ENROLLED} only
     4  join ‖ class → cancelled, ×30 — {200, CLASS_CANCELLED} only
     5  booked and non-booked students, 20 interleaved clicks each — the
        non-booker never gets a URL, the booker always does
     6  40 clicks 100 ms apart straddling joinClosesAt — monotone: a run of
        200s then only JOIN_WINDOW_CLOSED, and the last 200 within 1 s of
        closesAt
     7  join ‖ admin PATCH moving the start 30 min later, ×20 — {200,
        TOO_EARLY} only

   Scenarios 2–4 are driven twice: straight into resolveMeetJoin (no HTTP
   noise between the two racers) and over HTTP through the real route.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_joinconc_suite), dropped on exit.

   Run: bun run test:joinclass-conc
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_joinconc_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.EMAIL_OUTBOX = 'on'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_LOG_DIR = '.logs/emails-joinconc'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''
/* Not pinning STUDENT_JOIN_GRACE_MINUTES — same reasoning as joinclass.suite:
   the boundary scenario asserts the shipped default. */

export {}

/* ── The process-level watch. Registered BEFORE the app is imported so a
   rejection escaping any handler during the races is counted, whoever
   raised it. index.ts is not imported here (app.ts is), so nothing else is
   listening; a hit is ours. */
const unhandled: string[] = []
process.on('unhandledRejection', (reason) => {
  unhandled.push(`unhandledRejection: ${(reason as Error)?.stack ?? String(reason)}`)
})
process.on('uncaughtException', (err) => {
  unhandled.push(`uncaughtException: ${err?.stack ?? String(err)}`)
})

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }
function note(s: string) { lines.push(`        ${s}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, SectionModel, LiveClassModel,
  ClassBookingModel, EnrollmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { resolveMeetJoin, JoinError } = await import('@/services/liveClassJoin.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_joinconc_suite') {
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
  return {
    status: res.status, body: parsed,
    retryAfter: res.headers.get('retry-after'),
    cacheControl: res.headers.get('cache-control'),
  }
}

const PW   = 'RaceMe1234'
const MIN  = 60_000
const MEET = 'https://meet.google.com/race-test-qrs'
const MEET_CODE = 'race-test-qrs'
const code = (r: any) => String(r.body?.error?.code ?? '')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/* One label per outcome, shared by the HTTP and the direct driver, so the
   splits read the same either way. */
type Outcome = { label: string; url?: string; closesAt?: string; status: number; leak: boolean; raw?: string }
const hasLeak = (s: string) => s.includes('meet.google.com') || s.includes(MEET_CODE)

function fromHttp(r: Awaited<ReturnType<typeof call>>): Outcome {
  if (r.status === 200) {
    return { label: '200', url: r.body?.data?.url, closesAt: r.body?.data?.closesAt, status: 200, leak: false }
  }
  const c = code(r) || `HTTP_${r.status}`
  return { label: `${r.status} ${c}`, status: r.status, leak: hasLeak(JSON.stringify(r.body)), raw: JSON.stringify(r.body).slice(0, 200) }
}
async function direct(lcId: string, ctx: any): Promise<Outcome> {
  try {
    const r = await resolveMeetJoin(lcId, ctx)
    return { label: '200', url: r.url, status: 200, leak: false }
  } catch (e) {
    if (e instanceof JoinError) {
      return { label: `${e.status} ${e.code}`, status: e.status, leak: hasLeak(e.message) }
    }
    return { label: `THREW ${(e as Error).message}`, status: 500, leak: false, raw: (e as Error).stack }
  }
}
function tally(outs: Outcome[]): Record<string, number> {
  const t: Record<string, number> = {}
  for (const o of outs) t[o.label] = (t[o.label] ?? 0) + 1
  return t
}
const fmt = (t: Record<string, number>) => Object.entries(t).map(([k, v]) => `${k}×${v}`).join(', ') || '(none)'

/* The race assertion every scenario shares: outcomes drawn only from the
   allowed set, every 200 carries THE url, no refusal leaks it, nothing
   crashed. */
function assertRace(tag: string, outs: Outcome[], allowed: string[]) {
  const t = tally(outs)
  const stray = outs.filter(o => !allowed.includes(o.label))
  check(`${tag} every outcome is one of {${allowed.join(', ')}}`, stray.length === 0,
    `stray: ${fmt(tally(stray))} ${stray[0]?.raw ?? ''}`)
  check(`${tag} no 5xx and nothing thrown`, outs.every(o => o.status < 500),
    fmt(tally(outs.filter(o => o.status >= 500))))
  check(`${tag} every 200 carries exactly the class's URL`,
    outs.filter(o => o.status === 200).every(o => o.url === MEET))
  check(`${tag} no refusal leaks the URL or the Meet code`, outs.every(o => !o.leak))
  note(`${tag} split: ${fmt(t)}`)
  return t
}

try {

const org   = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const hash  = await hashPassword(PW)

const mk = (email: string, role: string, extra: Record<string, unknown> = {}) =>
  UserModel.create({
    name: email.split('@')[0], email, passwordHash: hash, role,
    isActive: true, isVerified: true, organizationId: org._id, ...extra,
  })

const admin   = await mk('admin@race.local',   'admin')
const teacher = await mk('teach@race.local',   'instructor')
const booked  = await mk('booked@race.local',  'student', { enrollmentStatus: 'approved' })
const nobody  = await mk('nobody@race.local',  'student', { enrollmentStatus: 'approved' })

const course = await CourseModel.create({
  title: 'Forex', slug: 'forex-race', description: 'd', instructorId: teacher._id,
  price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
})
await SectionModel.create({ courseId: course._id, title: 'Module 1', order: 1 })

for (const u of [booked, nobody]) {
  await EnrollmentModel.create({ userId: u._id, courseId: course._id, status: 'active', blockedLessons: [] })
}

let seq = 0
async function session(startsInMs: number, extra: Record<string, unknown> = {}) {
  const n = seq++
  return LiveClassModel.create({
    title: `Race ${n}`, courseId: course._id, instructorId: teacher._id,
    organizationId: org._id, scheduledStart: new Date(Date.now() + startsInMs),
    durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
    language: 'English', sessionCapacity: 30, bookedCount: 1, meetingUrl: MEET,
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
const ctxOf = (u: any) => ({
  userId: String(u._id), name: u.name, email: u.email, role: 'student',
  organizationId: String(org._id), enrollmentStatus: 'approved', isActive: true,
})

const bookedJar = await login(booked)
const nobodyJar = await login(nobody)
const adminJar: Jar = new Map()
{
  const li = await call('POST', '/admin/auth/login', adminJar, { email: admin.email, password: PW })
  if (li.status !== 200) throw new Error(`admin login: ${li.status} ${code(li)}`)
}

/* Snapshot every collection's count, so "no side effects" can be asserted
   against the whole database rather than the two rows we happen to know. */
async function counts(): Promise<Record<string, number>> {
  const db = mongoose.connection.db!
  const out: Record<string, number> = {}
  for (const c of await db.listCollections().toArray()) {
    out[c.name] = await db.collection(c.name).countDocuments()
  }
  return out
}
function diffCounts(a: Record<string, number>, b: Record<string, number>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter(k => (a[k] ?? 0) !== (b[k] ?? 0)).map(k => `${k}: ${a[k] ?? 0} → ${b[k] ?? 0}`)
}

/* ═══════════ 1 — the stampede ═══════════ */
section('1. 25 simultaneous joins by one booked student')
{
  const lc = await session(-1 * MIN)
  const seatRow = await seat(booked, lc)
  /* A warm-up click, so the 25 measure the steady state and not a first
     dynamic import or a cold connection. Nothing below depends on it. */
  await join(bookedJar, lc)
  const before = await counts()
  const bookingBefore = await ClassBookingModel.findById(seatRow._id).lean() as any
  const classBefore   = await LiveClassModel.findById(lc._id).lean() as any

  const t0 = Date.now()
  const results = await Promise.all(Array.from({ length: 25 }, () => join(bookedJar, lc)))
  const elapsed = Date.now() - t0
  const outs = results.map(fromHttp)
  const t = assertRace('1', outs, ['200'])
  check('1 all 25 are 200', t['200'] === 25, fmt(t))
  const urls = new Set(results.map(r => r.body?.data?.url))
  check('1 one identical URL across all 25', urls.size === 1 && urls.has(MEET), [...urls].join(','))
  const closes = new Set(results.map(r => r.body?.data?.closesAt))
  check('1 one identical closesAt across all 25', closes.size === 1
    && new Date([...closes][0]).getTime() === lc.scheduledStart.getTime() + 20 * MIN, [...closes].join(','))
  check('1 every response forbids caching', results.every(r => /no-store/.test(String(r.cacheControl))))

  const after = await counts()
  const d = diffCounts(before, after)
  check('1 no document was created or removed anywhere by 25 releases', d.length === 0, d.join('; '))
  const bookingAfter = await ClassBookingModel.findById(seatRow._id).lean() as any
  const classAfter   = await LiveClassModel.findById(lc._id).lean() as any
  check('1 the booking row is byte-for-byte unchanged',
    JSON.stringify(bookingAfter) === JSON.stringify(bookingBefore),
    `${JSON.stringify(bookingBefore)} vs ${JSON.stringify(bookingAfter)}`)
  check('1 the class row is byte-for-byte unchanged (bookedCount, status, start)',
    JSON.stringify(classAfter) === JSON.stringify(classBefore),
    `${JSON.stringify(classBefore)} vs ${JSON.stringify(classAfter)}`)
  note(`1 25 concurrent joins served in ${elapsed} ms`)
}

/* ── The race harness ──
   `fire` runs the click and the withdrawal at once; `undo` restores the
   world for the next repeat. A tiny random stagger (0–8 ms, either way) is
   put on the withdrawal so the repeats do not all land in the same order —
   without it the split is usually 30/0 and proves little. After each race the
   withdrawal is acknowledged, so a FURTHER click must be refused: that is the
   "at the moment of the check" invariant made observable. */
async function race(
  tag: string, repeats: number,
  click: () => Promise<Outcome>,
  withdraw: () => Promise<unknown>,
  undo: () => Promise<unknown>,
  refusal: string,
  /* [min, max] ms by which the WITHDRAWAL is delayed relative to the click;
     negative delays the click instead. The direct gate is one query away from
     its booking read, so ±8 ms is enough to see both orders; an HTTP click
     spends tens of ms in auth and its own user re-read before the gate runs,
     so the withdrawal must be held back longer for the click ever to win. */
  staggerRange: [number, number] = [-8, 8],
): Promise<Record<string, number>> {
  const outs: Outcome[] = []
  let afterFactViolations = 0, afterFactChecked = 0
  const [lo, hi] = staggerRange
  for (let i = 0; i < repeats; i++) {
    const stagger = lo + Math.floor(Math.random() * (hi - lo + 1))
    const clickP = stagger < 0 ? sleep(-stagger).then(click) : click()
    const withP  = stagger > 0 ? sleep(stagger).then(withdraw) : withdraw()
    const [o] = await Promise.all([clickP, withP])
    outs.push(o)
    /* The withdrawal's write is acknowledged. Anything that reads now must
       see it. */
    const again = await click()
    afterFactChecked++
    if (again.label !== refusal) afterFactViolations++
    await undo()
  }
  const t = assertRace(tag, outs, ['200', refusal])
  check(`${tag} once the withdrawal is acknowledged the next click is always ${refusal} (${afterFactChecked}/${afterFactChecked})`,
    afterFactViolations === 0, `${afterFactViolations} clicks got through after the fact`)
  return t
}

/* ═══════════ 2 — seat withdrawn under the click ═══════════ */
section('2. Join racing the booking being cancelled (×30, direct gate then HTTP)')
{
  const lc = await session(-1 * MIN)
  const s = await seat(booked, lc)
  const cancel  = () => ClassBookingModel.updateOne({ _id: s._id }, { $set: { status: 'cancelled' } })
  const restore = () => ClassBookingModel.updateOne({ _id: s._id }, { $set: { status: 'booked' } })

  await race('2a direct', 30, () => direct(String(lc._id), ctxOf(booked)), cancel, restore, '403 NOT_BOOKED')
  await race('2b http',   30, async () => fromHttp(await join(bookedJar, lc)), cancel, restore, '403 NOT_BOOKED', [0, 60])
}

/* ═══════════ 3 — enrolment deleted under the click ═══════════ */
section('3. Join racing the enrolment being deleted (×30, direct gate then HTTP)')
{
  const lc = await session(-1 * MIN)
  await seat(booked, lc)
  const del     = () => EnrollmentModel.deleteOne({ userId: booked._id, courseId: course._id })
  const restore = () => EnrollmentModel.create({ userId: booked._id, courseId: course._id, status: 'active', blockedLessons: [] })

  await race('3a direct', 30, () => direct(String(lc._id), ctxOf(booked)), del, restore, '403 NOT_ENROLLED')
  await race('3b http',   30, async () => fromHttp(await join(bookedJar, lc)), del, restore, '403 NOT_ENROLLED', [0, 60])
}

/* ═══════════ 4 — class cancelled under the click ═══════════ */
section('4. Join racing the class being cancelled (×30, direct gate then HTTP)')
{
  const lc = await session(-1 * MIN)
  await seat(booked, lc)
  const cancel  = () => LiveClassModel.updateOne({ _id: lc._id }, { $set: { status: 'cancelled' } })
  const restore = () => LiveClassModel.updateOne({ _id: lc._id }, { $set: { status: 'scheduled' } })

  await race('4a direct', 30, () => direct(String(lc._id), ctxOf(booked)), cancel, restore, '409 CLASS_CANCELLED')
  await race('4b http',   30, async () => fromHttp(await join(bookedJar, lc)), cancel, restore, '409 CLASS_CANCELLED', [0, 60])
}

/* ═══════════ 5 — two students, one seat ═══════════ */
section('5. A booker and a non-booker, 20 interleaved clicks each')
{
  const lc = await session(-1 * MIN)
  await seat(booked, lc)
  /* Interleaved: booker, non-booker, booker, … all in flight together. */
  const fired: Promise<{ who: string; out: Outcome }>[] = []
  for (let i = 0; i < 20; i++) {
    fired.push(join(bookedJar, lc).then(r => ({ who: 'booked', out: fromHttp(r) })))
    fired.push(join(nobodyJar, lc).then(r => ({ who: 'nobody', out: fromHttp(r) })))
  }
  const all = await Promise.all(fired)
  const b = all.filter(x => x.who === 'booked').map(x => x.out)
  const n = all.filter(x => x.who === 'nobody').map(x => x.out)
  const tb = assertRace('5 booker', b, ['200'])
  const tn = assertRace('5 non-booker', n, ['403 NOT_BOOKED'])
  check('5 the booker got the URL all 20 times', tb['200'] === 20, fmt(tb))
  check('5 the non-booker got it 0 of 20 times', (tn['200'] ?? 0) === 0 && tn['403 NOT_BOOKED'] === 20, fmt(tn))
  check('5 no URL in any of the non-booker\'s 20 responses', n.every(o => !o.url && !o.leak))
}

/* ═══════════ 6 — straddling the close ═══════════ */
section('6. 40 clicks 100 ms apart across joinClosesAt')
{
  /* The window closes ~1.5 s from now: start = now − 20 min + 1.5 s. */
  const lc = await session(-(20 * MIN) + 1_500)
  await seat(booked, lc)
  const closesAt = lc.scheduledStart.getTime() + 20 * MIN
  note(`6 closesAt is ${closesAt - Date.now()} ms away at scenario start`)

  /* Serial, one every 100 ms: each click's check happens strictly after the
     previous one's answer, so any non-monotone sequence is the gate's clock
     misbehaving and not two requests overtaking each other on the wire. */
  const seqOut: { firedAt: number; doneAt: number; out: Outcome }[] = []
  const t0 = Date.now()
  for (let i = 0; i < 40; i++) {
    const slot = t0 + i * 100
    const wait = slot - Date.now()
    if (wait > 0) await sleep(wait)
    const firedAt = Date.now()
    const r = await join(bookedJar, lc)
    seqOut.push({ firedAt, doneAt: Date.now(), out: fromHttp(r) })
  }
  const outs = seqOut.map(x => x.out)
  const t = assertRace('6', outs, ['200', '409 JOIN_WINDOW_CLOSED'])
  const labels = outs.map(o => o.label)
  const firstClosed = labels.indexOf('409 JOIN_WINDOW_CLOSED')
  const lastOpen    = labels.lastIndexOf('200')
  check('6 at least one click landed on each side of the boundary', firstClosed > 0 && lastOpen >= 0,
    `firstClosed=${firstClosed} lastOpen=${lastOpen} (${labels.join(' ')})`)
  check('6 monotone: no 200 after the first JOIN_WINDOW_CLOSED', firstClosed === -1 || lastOpen < firstClosed,
    labels.map((l, i) => `${i}:${l === '200' ? 'O' : 'X'}`).join(' '))
  if (lastOpen >= 0) {
    const lo = seqOut[lastOpen]!
    /* The last 200 was fired before closesAt (its check read now ≤ closesAt)
       and, at 100 ms spacing, not more than a second before it. */
    check('6 the last 200 was fired within 1 s of closesAt',
      Math.abs(lo.firedAt - closesAt) <= 1_000, `fired ${lo.firedAt - closesAt} ms relative to closesAt`)
    check('6 the last 200 was fired no later than closesAt', lo.firedAt <= closesAt, `${lo.firedAt - closesAt} ms after`)
  }
  if (firstClosed >= 0) {
    const fc = seqOut[firstClosed]!
    /* The first refusal's check happened after closesAt, so its response
       cannot have completed before it. */
    check('6 the first JOIN_WINDOW_CLOSED completed after closesAt', fc.doneAt >= closesAt, `${fc.doneAt - closesAt} ms`)
  }
  check('6 every 200 reports the closesAt the class implies',
    outs.filter(o => o.status === 200).every(o => new Date(String(o.closesAt)).getTime() === closesAt),
    outs.filter(o => o.status === 200).map(o => o.closesAt).join(','))
  note(`6 sequence: ${labels.map(l => l === '200' ? 'O' : 'X').join('')}  (O=200, X=closed)  last 200 at ${lastOpen >= 0 ? seqOut[lastOpen]!.firedAt - closesAt : 'n/a'} ms, first closed at ${firstClosed >= 0 ? seqOut[firstClosed]!.firedAt - closesAt : 'n/a'} ms`)
}

/* ═══════════ 7 — the start moved under the click ═══════════ */
section('7. Join racing an admin PATCH that moves the start 30 min later (×20)')
{
  const lc = await session(-1 * MIN)
  await seat(booked, lc)
  const originalStart = lc.scheduledStart
  const laterStart    = new Date(originalStart.getTime() + 30 * MIN)

  const patch = async () => {
    const r = await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, {
      scheduledStart: laterStart.toISOString(), rescheduleReason: 'race test',
    })
    if (r.status !== 200) throw new Error(`admin PATCH failed: ${r.status} ${code(r)} ${JSON.stringify(r.body).slice(0, 200)}`)
  }
  const restore = () => LiveClassModel.updateOne({ _id: lc._id }, { $set: { scheduledStart: originalStart } })

  /* The PATCH is a real admin request through validation, audit and the
     notification fan-out, so the race is between two HTTP requests. */
  const outs: Outcome[] = []
  const retryAfters: number[] = []
  let afterFactViolations = 0
  for (let i = 0; i < 20; i++) {
    /* Both racers are HTTP here and the PATCH is the heavier one, so the
       click is the one held back, by up to 60 ms, to see both orders. */
    const stagger = -Math.floor(Math.random() * 61)
    const clickP = (stagger < 0 ? sleep(-stagger) : Promise.resolve()).then(() => join(bookedJar, lc))
    const patchP = (stagger > 0 ? sleep(stagger) : Promise.resolve()).then(patch)
    const [r] = await Promise.all([clickP, patchP])
    outs.push(fromHttp(r))
    if (r.status === 425) retryAfters.push(Number(r.retryAfter))
    const again = await join(bookedJar, lc)
    if (!(again.status === 425 && code(again) === 'TOO_EARLY')) afterFactViolations++
    await restore()
  }
  const t = assertRace('7', outs, ['200', '425 TOO_EARLY'])
  check('7 once the PATCH is acknowledged the next click is always TOO_EARLY (20/20)', afterFactViolations === 0,
    `${afterFactViolations} got through`)
  check('7 every TOO_EARLY carries a Retry-After of roughly 29–30 minutes',
    retryAfters.every(ra => ra > 28 * 60 && ra <= 30 * 60), retryAfters.join(','))
  const cur = await LiveClassModel.findById(lc._id).lean() as any
  check('7 the class is back on its original start after the last restore',
    new Date(cur.scheduledStart).getTime() === originalStart.getTime())
  void t
}

/* ═══════════ the process ═══════════ */
section('P. Nothing escaped a handler')
{
  /* Give any straggling fan-out (the PATCH notifications) a moment to settle
     before reading the counter. */
  await sleep(300)
  check('P1 no unhandledRejection or uncaughtException during the races', unhandled.length === 0,
    unhandled.slice(0, 3).join('\n'))
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
console.log(`\njoinclass.concurrency.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
