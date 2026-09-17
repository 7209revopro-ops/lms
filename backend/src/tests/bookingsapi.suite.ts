/* ─────────────────────────────────────────────────────────────
   Admin bookings API — Phase 2 server foundation.

   The console's worst problems were server-side, so these are the server
   behaviours it now depends on:

     A  free-text search runs on the SERVER, so it finds a booking that is not
        on the page the browser happens to hold (it used to filter the loaded
        page only and answer "No bookings found" for a booking that exists)
     B  the delivery filter (online / in-person) likewise
     C  an admin can CANCEL a booking — there was no such path anywhere in the
        product — releasing the seat exactly once, idempotently, and never
        across an academy boundary
     D  date bounds are symmetric, so an early-morning class cannot fall through
        the gap between one day's end and the next day's start

   Boots the REAL Express app against an ISOLATED throwaway database.
   Run: bun src/tests/bookingsapi.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL  = 'mongodb://localhost:27017/lms_bookingsapi_suite'
process.env.NODE_ENV      = 'test'
process.env.PORT          = '0'
process.env.CLIENT_URL    = 'http://client.test'
process.env.ADMIN_URL     = 'http://admin.test'
process.env.EMAIL_LOG_DIR = '.logs/emails-bookingsapi'
process.env.SMTP_HOST = ''
process.env.SMTP_USER = ''
process.env.SMTP_PASS = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID = ''
process.env.R2_ACCESS_KEY_ID = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL = ''

export {}

import { rm } from 'fs/promises'

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
const { UserModel, OrganizationModel, CourseModel, LiveClassModel, ClassBookingModel } =
  await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await rm(process.env.EMAIL_LOG_DIR!, { recursive: true, force: true }).catch(() => {})
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_bookingsapi_suite') {
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
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text(); let b: any = text; try { b = JSON.parse(text) } catch {}
  return { status: res.status, body: b, code: String(b?.error?.code ?? ''), rows: (b?.data ?? []) as any[], meta: b?.meta }
}

const PW = 'Passw0rd!'
const MIN = 60_000

try {

const orgA = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const orgB = await OrganizationModel.create({ name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
const hash = await hashPassword(PW)
const mk = (email: string, role: string, org: any, extra: Record<string, unknown> = {}) =>
  UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role,
    isActive: true, isVerified: true, organizationId: org._id, ...extra })

const admin   = await mk('admin@ba.test',  'admin',      orgA)
const adminB  = await mk('adminb@ba.test', 'admin',      orgB)
const teacher = await mk('teach@ba.test',  'instructor', orgA)

const course = await CourseModel.create({ title: 'Forex', slug: 'forex-ba', description: 'd',
  instructorId: teacher._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: orgA._id })

const mkClass = (title: string, extra: Record<string, unknown> = {}, org = orgA) => LiveClassModel.create({
  title, courseId: course._id, instructorId: teacher._id, organizationId: org._id,
  scheduledStart: new Date(Date.now() + 2 * 24 * 60 * MIN), durationMins: 60, type: 'external',
  isOnline: true, status: 'scheduled', language: 'English', sessionCapacity: 30, bookedCount: 0,
  meetingUrl: 'https://meet.google.com/ba-test', ...extra,
})
const seat = (u: any, lc: any) =>
  ClassBookingModel.create({ userId: u._id, liveClassId: lc._id, status: 'booked', bookedAt: new Date() })

const login = async (email: string): Promise<Jar> => {
  const jar: Jar = new Map()
  const r = await call('POST', '/admin/auth/login', jar, { email, password: PW })
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${r.code}`)
  return jar
}
const adminJar  = await login('admin@ba.test')
const adminBJar = await login('adminb@ba.test')

/* Enough rows that the target is provably NOT on page 1. */
const onlineClass = await mkClass('Advanced Forex')
/* The needle is booked FIRST so that, under the default newest-first ordering,
   it sits at the BOTTOM — i.e. off page 1. That is the case the old
   filter-the-loaded-page search got wrong. */
const needle = await mk('zorana.needle@ba.test', 'student', orgA)
await seat(needle, onlineClass)
for (let i = 0; i < 12; i++) await seat(await mk(`filler${i}@ba.test`, 'student', orgA), onlineClass)
const offlineClass = await mkClass('In Person Workshop', { isOnline: false, location: 'Dubai', room: 'A1' })
const offStudent = await mk('offline@ba.test', 'student', orgA)
await seat(offStudent, offlineClass)

/* ═══════════ A — server-side search ═══════════ */
section('A. Search runs on the server, so it finds rows beyond the loaded page')
{
  const p1 = await call('GET', '/admin/bookings?per_page=5&page=1', adminJar)
  check('A1 page 1 is capped at per_page', p1.status === 200 && p1.rows.length === 5, `${p1.status} rows=${p1.rows.length}`)
  const onPage1 = p1.rows.some(r => r.userId?.email === 'zorana.needle@ba.test')
  check('A2 the target student is NOT on page 1 (so the old client filter would miss it)', !onPage1)

  const found = await call('GET', '/admin/bookings?per_page=5&q=zorana', adminJar)
  check('A3 searching by name finds it anyway', found.rows.length === 1 &&
    found.rows[0]?.userId?.email === 'zorana.needle@ba.test', `rows=${found.rows.length}`)

  const byEmail = await call('GET', '/admin/bookings?per_page=5&q=zorana.needle@ba.test', adminJar)
  check('A4 searching by email works too', byEmail.rows.length === 1)

  const byTitle = await call('GET', '/admin/bookings?per_page=50&q=In Person', adminJar)
  check('A5 searching by session title works', byTitle.rows.length === 1 &&
    byTitle.rows[0]?.liveClassId?.title === 'In Person Workshop', `rows=${byTitle.rows.length}`)

  const none = await call('GET', '/admin/bookings?q=nobodyhasthisname', adminJar)
  check('A6 a miss returns an empty set, not everything', none.rows.length === 0)

  /* A regex metacharacter must be escaped, or ".*" matches every student. */
  const dotStar = await call('GET', '/admin/bookings?q=.*', adminJar)
  check('A7 regex metacharacters are escaped, not honoured', dotStar.rows.length === 0, `rows=${dotStar.rows.length}`)
}

/* ═══════════ B — delivery filter ═══════════ */
section('B. The online / in-person filter is server-side')
{
  const off = await call('GET', '/admin/bookings?per_page=50&isOnline=false', adminJar)
  check('B1 in-person returns only the in-person booking',
    off.rows.length === 1 && off.rows[0]?.liveClassId?.title === 'In Person Workshop', `rows=${off.rows.length}`)
  const on = await call('GET', '/admin/bookings?per_page=50&isOnline=true', adminJar)
  check('B2 online excludes it', on.rows.length === 13 &&
    !on.rows.some(r => r.liveClassId?.title === 'In Person Workshop'), `rows=${on.rows.length}`)
}

/* ═══════════ C — admin cancel ═══════════ */
section('C. An admin can cancel a booking, releasing the seat exactly once')
{
  const lc = await mkClass('Cancellable')
  const stu = await mk('cancelme@ba.test', 'student', orgA)
  const b = await seat(stu, lc)
  await LiveClassModel.findByIdAndUpdate(lc._id, { bookedCount: 1 })

  const other = await call('PATCH', `/admin/bookings/${b._id}/cancel`, adminBJar)
  check('C1 an admin from ANOTHER academy gets 404, never a 403 that confirms the id',
    other.status === 404, `${other.status} ${other.code}`)
  check('C2 …and the booking is untouched',
    (await ClassBookingModel.findById(b._id).lean() as any)?.status === 'booked')

  const ok = await call('PATCH', `/admin/bookings/${b._id}/cancel`, adminJar)
  check('C3 the owning academy can cancel', ok.status === 200, `${ok.status} ${ok.code}`)
  check('C4 the booking is cancelled and stamped',
    await (async () => { const d = await ClassBookingModel.findById(b._id).lean() as any
      return d?.status === 'cancelled' && !!d?.cancelledAt })())
  check('C5 the seat is released', (await LiveClassModel.findById(lc._id).lean() as any)?.bookedCount === 0)

  const again = await call('PATCH', `/admin/bookings/${b._id}/cancel`, adminJar)
  check('C6 cancelling twice is refused', again.status === 400 && again.code === 'CANNOT_CANCEL', `${again.status} ${again.code}`)
  check('C7 …and does NOT release a second seat (no negative count)',
    (await LiveClassModel.findById(lc._id).lean() as any)?.bookedCount === 0)

  const ghost = await call('PATCH', '/admin/bookings/64b7f1c2a1b2c3d4e5f60789/cancel', adminJar)
  check('C8 an unknown id is 404', ghost.status === 404, `${ghost.status}`)
}

/* ═══════════ D — symmetric date bounds ═══════════ */
section('D. Both ends of a date range are built the same way')
{
  /* A class at 00:30 UTC on a day: asking for exactly that day must include it.
     The old code built $gte at UTC midnight and $lte at the SERVER's local
     midnight, so east of UTC this row fell through the gap. */
  const day = new Date(Date.now() + 10 * 24 * 60 * MIN)
  const ymd = day.toISOString().slice(0, 10)
  const early = await mkClass('Early Bird', { scheduledStart: new Date(`${ymd}T00:30:00.000Z`) })
  await seat(await mk('early@ba.test', 'student', orgA), early)
  const late = await mkClass('Night Owl', { scheduledStart: new Date(`${ymd}T23:30:00.000Z`) })
  await seat(await mk('late@ba.test', 'student', orgA), late)

  const r = await call('GET', `/admin/bookings?per_page=50&dateFrom=${ymd}&dateTo=${ymd}`, adminJar)
  const titles = r.rows.map(x => x.liveClassId?.title)
  check('D1 a 00:30 class is inside its own day', titles.includes('Early Bird'), JSON.stringify(titles))
  check('D2 a 23:30 class is too', titles.includes('Night Owl'), JSON.stringify(titles))
  check('D3 and nothing outside the day leaks in', r.rows.length === 2, `rows=${r.rows.length}`)
}

/* ═══════════ E — stats describe the FILTER, not the page ═══════════ */
section('E. /bookings/stats reports the whole filtered set, never just the loaded page')
{
  /* By now: 13 on the online class + 1 in-person + 1 cancelled + 2 on the
     date-range day = 17 bookings, of which 1 is cancelled. */
  const all = await call('GET', '/admin/bookings/stats', adminJar)
  check('E1 stats returns 200', all.status === 200, `${all.status}`)
  check('E2 total counts every matching booking, not per_page',
    all.body?.data?.total === 17, JSON.stringify(all.body?.data))
  check('E3 it breaks down by status', all.body?.data?.booked === 16 && all.body?.data?.cancelled === 1,
    JSON.stringify(all.body?.data))

  /* The bug this replaces: the strip was fed the loaded array, so it reported
     the page size. Asking for a tiny page must not change the totals. */
  const paged = await call('GET', '/admin/bookings/stats?per_page=5&page=1', adminJar)
  check('E4 per_page does NOT change the totals', paged.body?.data?.total === 17,
    JSON.stringify(paged.body?.data))

  const searched = await call('GET', '/admin/bookings/stats?q=zorana', adminJar)
  check('E5 stats honour the same search as the list', searched.body?.data?.total === 1,
    JSON.stringify(searched.body?.data))

  const offline = await call('GET', '/admin/bookings/stats?isOnline=false', adminJar)
  check('E6 …and the delivery filter', offline.body?.data?.total === 1, JSON.stringify(offline.body?.data))

  /* Attendance rate is over DECIDED seats, so it does not collapse as future
     bookings pile up. */
  const lc = await mkClass('Attendance Math')
  const a1 = await seat(await mk('att1@ba.test', 'student', orgA), lc)
  await seat(await mk('att2@ba.test', 'student', orgA), lc)
  await seat(await mk('att3@ba.test', 'student', orgA), lc)   // still just booked
  await call('PATCH', `/admin/bookings/${a1._id}/attendance`, adminJar, { status: 'attended' })
  const cls = await call('GET', `/admin/bookings/stats?liveClassId=${lc._id}`, adminJar)
  check('E7 attendance rate uses decided seats only (1 of 1 = 100%), not 1-of-3',
    cls.body?.data?.attendanceRate === 100, JSON.stringify(cls.body?.data))

  const foreign = await call('GET', '/admin/bookings/stats', adminBJar)
  check('E8 another academy sees none of it', foreign.body?.data?.total === 0, JSON.stringify(foreign.body?.data))
}

/* ═══════════ F — "upcoming" is a tense, not a status ═══════════ */
section('F. booked splits into upcoming vs unmarked by the session start time')
{
  /* Seats on a session that already ran and was never marked, against seats on
     one still to come. Both are status `booked` — the status alone cannot tell
     them apart, which is what made the strip read "Upcoming 8" for a console
     of nothing but un-marked history. */
  const past   = await mkClass('Already Ran', { scheduledStart: new Date(Date.now() - 3 * 24 * 60 * MIN) })
  const future = await mkClass('Still To Come')
  await seat(await mk('split1@ba.test', 'student', orgA), past)
  await seat(await mk('split2@ba.test', 'student', orgA), past)
  await seat(await mk('split3@ba.test', 'student', orgA), future)

  const p = (await call('GET', `/admin/bookings/stats?liveClassId=${past._id}`, adminJar)).body?.data
  check('F1 a past un-marked seat is NOT upcoming', p?.upcoming === 0, JSON.stringify(p))
  check('F2 …it is counted as needing attendance', p?.unmarked === 2, JSON.stringify(p))
  check('F3 …and is still reported under booked', p?.booked === 2, JSON.stringify(p))

  const f = (await call('GET', `/admin/bookings/stats?liveClassId=${future._id}`, adminJar)).body?.data
  check('F4 a future seat IS upcoming', f?.upcoming === 1 && f?.unmarked === 0, JSON.stringify(f))

  /* The invariant the strip is built on: the split partitions `booked`, so no
     seat is double-counted across the two tiles and none falls between them. */
  const tot = (await call('GET', '/admin/bookings/stats', adminJar)).body?.data
  check('F5 upcoming + unmarked === booked, always',
    tot.upcoming + tot.unmarked === tot.booked,
    `${tot.upcoming} + ${tot.unmarked} !== ${tot.booked}`)

  /* Marking attendance moves a seat out of the un-marked bucket — that is the
     whole point of surfacing it. */
  const row = (await call('GET', `/admin/bookings?liveClassId=${past._id}`, adminJar)).body?.data?.[0]
  await call('PATCH', `/admin/bookings/${row._id ?? row.id}/attendance`, adminJar, { status: 'attended' })
  const after = (await call('GET', `/admin/bookings/stats?liveClassId=${past._id}`, adminJar)).body?.data
  check('F6 marking attendance clears it from unmarked', after?.unmarked === 1, JSON.stringify(after))
}

/* ═══════════ G — ?needsMarking=true is a real filter ═══════════ */
section('G. needsMarking narrows to booked-and-already-run, and never widens')
{
  const ran   = await mkClass('G Ran', { scheduledStart: new Date(Date.now() - 4 * 24 * 60 * MIN) })
  const ahead = await mkClass('G Ahead')
  await seat(await mk('g1@ba.test', 'student', orgA), ran)
  await seat(await mk('g2@ba.test', 'student', orgA), ahead)

  const r = await call('GET', '/admin/bookings?needsMarking=true&dateFrom=2000-01-01&dateTo=2099-01-01', adminJar)
  const got: any[] = r.body?.data ?? []
  check('G1 returns 200', r.status === 200, `${r.status} ${r.code}`)
  check('G2 every row is still booked', got.every(b => b.status === 'booked'),
    JSON.stringify(got.map(b => b.status)))
  check('G3 every row has already started', got.every(b => new Date(b.liveClassId.scheduledStart) < new Date()),
    JSON.stringify(got.map(b => b.liveClassId?.scheduledStart)))
  check('G4 the future seat is excluded', !got.some(b => b.liveClassId?.title === 'G Ahead'),
    JSON.stringify(got.map(b => b.liveClassId?.title)))
  check('G5 the past un-marked seat is included', got.some(b => b.liveClassId?.title === 'G Ran'),
    JSON.stringify(got.map(b => b.liveClassId?.title)))

  /* It has to agree with the tile that offers it — a button whose count does
     not match what clicking it shows is worse than no button. */
  const st = (await call('GET', '/admin/bookings/stats?dateFrom=2000-01-01&dateTo=2099-01-01', adminJar)).body?.data
  const fl = (await call('GET', '/admin/bookings/stats?needsMarking=true&dateFrom=2000-01-01&dateTo=2099-01-01', adminJar)).body?.data
  check('G6 the filtered total equals the unmarked count the tile shows',
    fl.total === st.unmarked, `filtered=${fl.total} tile=${st.unmarked}`)

  /* A contradiction must answer empty, not pick a winner — `attended` and
     `needsMarking` cannot both hold. Silently dropping one would show attended
     rows under a "needs marking" filter. */
  const clash = await call('GET', '/admin/bookings?needsMarking=true&status=attended', adminJar)
  check('G7 needsMarking + a conflicting status is empty, not one-or-the-other',
    clash.status === 200 && (clash.body?.data ?? []).length === 0,
    `${clash.status} n=${(clash.body?.data ?? []).length}`)

  /* The date range and needsMarking both constrain scheduledStart. The narrower
     one must survive: a range entirely in the future can yield nothing. */
  const tomorrow = new Date(Date.now() + 24 * 60 * MIN).toISOString().slice(0, 10)
  const future   = new Date(Date.now() + 9 * 24 * 60 * MIN).toISOString().slice(0, 10)
  const both = await call('GET', `/admin/bookings?needsMarking=true&dateFrom=${tomorrow}&dateTo=${future}`, adminJar)
  check('G8 a future date range intersects with needsMarking instead of overwriting it',
    (both.body?.data ?? []).length === 0, JSON.stringify((both.body?.data ?? []).map((b: any) => b.liveClassId?.title)))

  /* Scope still wins over the new param. */
  const foreign = await call('GET', '/admin/bookings?needsMarking=true&dateFrom=2000-01-01&dateTo=2099-01-01', adminBJar)
  check('G9 another academy sees none of it', (foreign.body?.data ?? []).length === 0,
    JSON.stringify(foreign.body?.data))
}

/* ═══════════ H — bulk attendance ═══════════ */
section('H. bulk attendance marks a whole roster without widening scope')
{
  const cls  = await mkClass('Bulk Roster', { scheduledStart: new Date(Date.now() - 2 * 24 * 60 * MIN) })
  const s1 = await seat(await mk('bulk1@ba.test', 'student', orgA), cls)
  const s2 = await seat(await mk('bulk2@ba.test', 'student', orgA), cls)
  const s3 = await seat(await mk('bulk3@ba.test', 'student', orgA), cls)

  /* A seat the student already released. Sweeping it back to `attended` would
     resurrect a cancelled booking and re-consume the capacity given back. */
  await call('PATCH', `/admin/bookings/${s3._id}/cancel`, adminJar)

  /* And a seat belonging to another academy entirely. */
  const clsB  = await mkClass('Other Academy', {}, orgB)
  const sB    = await seat(await mk('bulkb@bb.test', 'student', orgB), clsB)

  const r = await call('PATCH', '/admin/bookings/bulk-attendance', adminJar,
    { ids: [String(s1._id), String(s2._id), String(s3._id), String(sB._id)], status: 'attended' })
  check('H1 returns 200', r.status === 200, `${r.status} ${r.code}`)
  check('H2 only the two eligible seats are marked', r.body?.data?.updated === 2,
    JSON.stringify(r.body?.data))

  const after = await ClassBookingModel.find({ _id: { $in: [s1._id, s2._id, s3._id, sB._id] } }, '_id status').lean()
  const st = (id: any) => (after.find((x: any) => String(x._id) === String(id)) as any)?.status
  check('H3 the two booked seats are attended', st(s1._id) === 'attended' && st(s2._id) === 'attended',
    `${st(s1._id)}/${st(s2._id)}`)
  check('H4 the cancelled seat is NOT resurrected', st(s3._id) === 'cancelled', String(st(s3._id)))
  check('H5 a seat in another academy is untouched', st(sB._id) === 'booked', String(st(sB._id)))

  /* Skipped, not refused: a 403 would confirm the foreign id exists. */
  const onlyForeign = await call('PATCH', '/admin/bookings/bulk-attendance', adminJar,
    { ids: [String(sB._id)], status: 'missed' })
  check('H6 an out-of-scope id is skipped, not refused',
    onlyForeign.status === 200 && onlyForeign.body?.data?.updated === 0,
    `${onlyForeign.status} ${JSON.stringify(onlyForeign.body?.data)}`)

  /* Re-running must not double-count: the seats are no longer `booked`. */
  const again = await call('PATCH', '/admin/bookings/bulk-attendance', adminJar,
    { ids: [String(s1._id), String(s2._id)], status: 'attended' })
  check('H7 re-marking already-decided seats updates nothing', again.body?.data?.updated === 0,
    JSON.stringify(again.body?.data))

  /* The stats bucket the button exists to drain must actually drain. */
  const stats = (await call('GET', `/admin/bookings/stats?liveClassId=${cls._id}`, adminJar)).body?.data
  check('H8 the unmarked bucket is drained', stats?.unmarked === 0, JSON.stringify(stats))

  const bad = await call('PATCH', '/admin/bookings/bulk-attendance', adminJar, { ids: [], status: 'attended' })
  check('H9 an empty selection is rejected by validation', bad.status === 422, `${bad.status}`)
  const badStatus = await call('PATCH', '/admin/bookings/bulk-attendance', adminJar,
    { ids: [String(s1._id)], status: 'cancelled' })
  check('H10 bulk cannot be used to cancel', badStatus.status === 422, `${badStatus.status}`)
}

/* ═══════════ I — ordering by the SESSION, not the booking ═══════════ */
section('I. sort=scheduledStart orders by the session and pages stably')
{
  const late = await mkClass('I Late',   { scheduledStart: new Date(Date.now() + 30 * 24 * 60 * MIN) })
  const mid  = await mkClass('I Mid',    { scheduledStart: new Date(Date.now() + 20 * 24 * 60 * MIN) })
  const soon = await mkClass('I Soon',   { scheduledStart: new Date(Date.now() + 10 * 24 * 60 * MIN) })

  /* Booked in ASCENDING start order with explicit, distinct bookedAt stamps, so
     newest-first bookedAt is the exact reverse of session order. Explicit stamps
     because three creates can land in the same millisecond, and the order among
     ties is undefined — which would make this test flaky rather than wrong. */
  const seatAt = async (email: string, lc: any, minutesAgo: number) =>
    ClassBookingModel.create({
      userId: (await mk(email, 'student', orgA))._id, liveClassId: lc._id,
      status: 'booked', bookedAt: new Date(Date.now() - minutesAgo * MIN),
    })
  await seatAt('ord1@ba.test', soon, 30)
  await seatAt('ord2@ba.test', mid,  20)
  await seatAt('ord3@ba.test', late, 10)

  const titles = async (url: string) =>
    ((await call('GET', url, adminJar)).body?.data ?? [])
      .map((b: any) => b.liveClassId?.title).filter((x: any) => String(x ?? '').startsWith('I '))

  const asc = await titles('/admin/bookings?sort=scheduledStart&dateFrom=2000-01-01&dateTo=2099-01-01&per_page=200')
  check('I1 ascending puts the soonest session first',
    JSON.stringify(asc) === JSON.stringify(['I Soon', 'I Mid', 'I Late']), JSON.stringify(asc))

  const desc = await titles('/admin/bookings?sort=-scheduledStart&dateFrom=2000-01-01&dateTo=2099-01-01&per_page=200')
  check('I2 descending reverses it',
    JSON.stringify(desc) === JSON.stringify(['I Late', 'I Mid', 'I Soon']), JSON.stringify(desc))

  /* The point of the whole exercise: bookedAt order is NOT session order, which
     is why day-grouping the bookedAt-ordered page scattered a day across pages. */
  const byBooked = await titles('/admin/bookings?sort=-bookedAt&dateFrom=2000-01-01&dateTo=2099-01-01&per_page=200')
  check('I3 it genuinely differs from bookedAt ordering',
    JSON.stringify(byBooked) !== JSON.stringify(asc), JSON.stringify(byBooked))

  /* Many seats on ONE session all share a start time. Without an _id tiebreaker
     Mongo may order those ties differently per page, so a paginated walk drops
     some rows and repeats others — which is exactly what the CSV export does. */
  const tied = await mkClass('I Tied', { scheduledStart: new Date(Date.now() + 15 * 24 * 60 * MIN) })
  for (let i = 0; i < 12; i++) await seat(await mk(`tie${i}@ba.test`, 'student', orgA), tied)

  const walk: string[] = []
  for (let page = 1; page <= 6; page++) {
    const r = await call('GET', `/admin/bookings?sort=scheduledStart&liveClassId=${tied._id}&page=${page}&per_page=2`, adminJar)
    for (const b of (r.body?.data ?? [])) walk.push(String(b._id ?? b.id))
  }
  check('I4 a paged walk returns every seat exactly once', walk.length === 12, `got ${walk.length}`)
  check('I5 …with no duplicates across page boundaries',
    new Set(walk).size === 12, `${new Set(walk).size} unique of ${walk.length}`)

  /* Repeating the same walk must give the same order, or pagination is a lie. */
  const walk2: string[] = []
  for (let page = 1; page <= 6; page++) {
    const r = await call('GET', `/admin/bookings?sort=scheduledStart&liveClassId=${tied._id}&page=${page}&per_page=2`, adminJar)
    for (const b of (r.body?.data ?? [])) walk2.push(String(b._id ?? b.id))
  }
  check('I6 the order is deterministic across identical requests',
    JSON.stringify(walk) === JSON.stringify(walk2), 'order changed between runs')

  /* The sorted path is a different code path — it must not lose the populate or
     the scope that the ordinary path applies. */
  const one = ((await call('GET', `/admin/bookings?sort=scheduledStart&liveClassId=${tied._id}&per_page=1`, adminJar)).body?.data ?? [])[0]
  check('I7 the sorted path still populates the student and the session',
    !!one?.userId?.email && !!one?.liveClassId?.title, JSON.stringify(one ?? null).slice(0, 160))
  const foreignSorted = await call('GET', '/admin/bookings?sort=scheduledStart&dateFrom=2000-01-01&dateTo=2099-01-01', adminBJar)
  check('I8 …and still scopes to the caller academy',
    ((foreignSorted.body?.data ?? []) as any[]).every(b => !String(b.liveClassId?.title ?? '').startsWith('I ')),
    JSON.stringify((foreignSorted.body?.data ?? []).map((b: any) => b.liveClassId?.title)))

  const totalMeta = (await call('GET', `/admin/bookings?sort=scheduledStart&liveClassId=${tied._id}&per_page=2`, adminJar)).body?.meta
  check('I9 the total counts the whole filter, not the page', totalMeta?.total_count === 12,
    JSON.stringify(totalMeta))
}

} catch (err) {
  fail++
  lines.push(`\n  FATAL  ${(err as Error).stack ?? String(err)}`)
} finally {
  console.log(lines.join('\n'))
  console.log(`\nbookingsapi.suite — ${pass} passed, ${fail} failed`)
  await rm(process.env.EMAIL_LOG_DIR!, { recursive: true, force: true }).catch(() => {})
  await mongoose.connection.dropDatabase().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}
