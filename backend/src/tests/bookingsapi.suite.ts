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
