/* ─────────────────────────────────────────────────────────────
   GET /admin/live-classes/academy-schedule — a mentor sees the other
   mentors' classes, read-only (Timetable → All mentors).

     A. every mentor's classes in the caller's academy — not another
        academy's, not cancelled ones
     B. read-only: no meeting/backup link, stream key, or students in a row
     C. the mentor's own list (/admin/live-classes) stays just theirs
     D. a student session gets nothing
   Run: bun --no-env-file src/tests/academyschedule.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_academyschedule'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.JWT_ACCESS_SECRET  ??= 'academyschedule-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'academyschedule-suite-refresh-secret-0123456789'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_academyschedule') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const PW = 'CorrectHorse1', DAY = 864e5

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (name: string, email: string, role: string, org: unknown) => M.UserModel.create({ name, email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: org, ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}) })
  const moiz = await mk('MOIZ', 'moiz@as.local', 'instructor', dubai._id)
  const haf = await mk('HAFFIS', 'haf@as.local', 'instructor', dubai._id)
  const raj = await mk('RAJ', 'raj@as.local', 'instructor', blr._id)
  await mk('Stu', 'stu@as.local', 'student', dubai._id)
  const course = await M.CourseModel.create({ title: 'MBT', slug: 'mbt-' + Date.now(), description: 'd', instructorId: moiz._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: dubai._id })
  const bcourse = await M.CourseModel.create({ title: 'MBT B', slug: 'mbtb-' + Date.now(), description: 'd', instructorId: raj._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: blr._id })
  const cls = (title: string, by: unknown, org: unknown, courseId: unknown, extra: Record<string, unknown> = {}) => M.LiveClassModel.create({
    title, courseId, instructorId: by, organizationId: org, scheduledStart: new Date(Date.now() + DAY), durationMins: 60, type: 'external',
    meetingUrl: 'https://meet.google.com/secret-room-link', isOnline: true, status: 'scheduled', sessionCapacity: 30, bookedCount: 7, ...extra })
  await cls('Moiz class', moiz._id, dubai._id, course._id)
  await cls('Haffis class', haf._id, dubai._id, course._id, { muxStreamKey: 'sk-secret' })
  await cls('Haffis cancelled', haf._id, dubai._id, course._id, { status: 'cancelled' })
  await cls('Bangalore class', raj._id, blr._id, bcourse._id)

  const jar: Jar = new Map()
  const login = await call('POST', '/admin/auth/login', jar, { email: 'moiz@as.local', password: PW })
  if (login.status !== 200) throw new Error('mentor login ' + login.status)
  const r = await call('GET', '/admin/live-classes/academy-schedule', jar)
  const titles = ((r.body?.data ?? []) as any[]).map(x => x.title).sort()

  section('A · every mentor in the academy')
  check('Moiz sees his own and Haffis\'s class', r.status === 200 && titles.includes('Moiz class') && titles.includes('Haffis class'), `${r.status} ${titles}`)
  check('not another academy\'s', !titles.includes('Bangalore class'))
  check('not a cancelled one', !titles.includes('Haffis cancelled'))
  const haffRow = (r.body?.data ?? []).find((x: any) => x.title === 'Haffis class')
  check('with the mentor\'s name and the booked count', haffRow?.instructor?.name === 'HAFFIS' && haffRow?.bookedCount === 7, JSON.stringify(haffRow?.instructor))

  section('B · read-only')
  const raw = JSON.stringify(r.body?.data ?? [])
  check('no meeting link anywhere', !raw.includes('secret-room-link') && !raw.includes('meetingUrl'))
  check('no stream key', !raw.includes('sk-secret') && !raw.includes('muxStreamKey'))
  check('rows are marked read-only', (r.body?.data ?? []).every((x: any) => x.readOnly === true))

  section('C · the mentor\'s own list is unchanged')
  const own = await call('GET', '/admin/live-classes', jar)
  const ownTitles = ((own.body?.data ?? []) as any[]).map(x => x.title)
  check('still only his classes', own.status === 200 && ownTitles.includes('Moiz class') && !ownTitles.includes('Haffis class'), String(ownTitles))

  section('D · not for students')
  const sjar: Jar = new Map()
  await call('POST', '/auth/login', sjar, { email: 'stu@as.local', password: PW })
  const s = await call('GET', '/admin/live-classes/academy-schedule', sjar)
  check('a student session gets nothing', s.status === 401 || s.status === 403, String(s.status))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
