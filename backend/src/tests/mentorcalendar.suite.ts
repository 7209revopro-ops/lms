/* ─────────────────────────────────────────────────────────────
   /admin/mentor-calendar — every mentor's free hours, classes and booked
   sessions, for instructors too, and sessions booked from here.

     A. an instructor sees every mentor of their academy, with slots,
        classes and sessions — not another academy's mentors
     B. an instructor books a session with another mentor; a clash is refused
     C. an instructor cancels only what they booked; an admin anything
     D. a student session gets nothing
   Run: bun --no-env-file src/tests/mentorcalendar.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.MENTORCAL_DB_URL || 'mongodb://localhost:27017/lms_mentorcalendar'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.JWT_ACCESS_SECRET  ??= 'mentorcalendar-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'mentorcalendar-suite-refresh-secret-0123456789'

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
if (mongoose.connection.db!.databaseName !== 'lms_mentorcalendar') { console.error('REFUSING TO RUN'); process.exit(1) }
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
  const moiz = await mk('MOIZ', 'moiz@mc.local', 'instructor', dubai._id)
  const haf = await mk('HAFFIS', 'haf@mc.local', 'instructor', dubai._id)
  await mk('RAJ', 'raj@mc.local', 'instructor', blr._id)
  await mk('Admin', 'admin@mc.local', 'admin', dubai._id)
  await mk('Stu', 'stu@mc.local', 'student', dubai._id)
  await M.MentorAvailabilityModel.create({ mentorId: haf._id, slots: [{ dayOfWeek: 1, startTime: '10:00', endTime: '13:00' }] })

  const login = async (email: string, path = '/admin/auth/login') => { const j: Jar = new Map(); const r = await call('POST', path, j, { email, password: PW }); if (r.status !== 200) throw new Error(`${email} login ${r.status}`); return j }
  const moizJ = await login('moiz@mc.local'), hafJ = await login('haf@mc.local'), adminJ = await login('admin@mc.local')
  const from = new Date(Date.now()).toISOString(), to = new Date(Date.now() + 7 * DAY).toISOString()
  const cal = (j: Jar) => call('GET', `/admin/mentor-calendar?from=${from}&to=${to}`, j)

  section('A · every mentor of the academy')
  let r = await cal(moizJ)
  const emails = ((r.body?.data?.mentors ?? []) as any[]).map(m => m.email)
  check('Moiz sees himself and Haffis', r.status === 200 && emails.includes('moiz@mc.local') && emails.includes('haf@mc.local'), `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
  check('not another academy\'s mentor', !emails.includes('raj@mc.local'))
  const hafRow = (r.body?.data?.mentors ?? []).find((m: any) => m.email === 'haf@mc.local')
  check('Haffis\'s free hours are there', hafRow?.slots?.[0]?.startTime === '10:00', JSON.stringify(hafRow?.slots))

  section('B · booking with another mentor')
  const start = new Date(Date.now() + 2 * DAY); start.setUTCMinutes(0, 0, 0)
  const book = (j: Jar, title: string) => call('POST', '/admin/mentor-calendar/meetings', j, { mentorEmail: 'haf@mc.local', title, kind: 'staff', scheduledStart: start.toISOString(), durationMins: 30, attendees: [{ name: 'Moiz', email: 'moiz@mc.local' }], inPerson: true, location: 'Room 2' })
  const b1 = await book(moizJ, 'Strategy review')
  const meetingId = b1.body?.data?.meeting?.id
  check('Moiz books a session with Haffis', b1.status === 200 && !!meetingId, `${b1.status} ${JSON.stringify(b1.body).slice(0, 200)}`)
  r = await cal(hafJ)
  const hafMeet = ((r.body?.data?.mentors ?? []).find((m: any) => m.email === 'haf@mc.local')?.meetings ?? [])
  check('it shows on Haffis\'s calendar, booked by Moiz', hafMeet.some((m: any) => m.title === 'Strategy review' && String(m.bookedByEmail).toLowerCase() === 'moiz@mc.local'), JSON.stringify(hafMeet))
  const b2 = await book(adminJ, 'Clash')
  check('a clash at the same time is refused', b2.status >= 400 && b2.status < 500, String(b2.status))

  section('C · who may cancel')
  const c1 = await call('POST', `/admin/mentor-calendar/meetings/${meetingId}/cancel`, hafJ)
  check('Haffis (didn\'t book it) cannot cancel it', c1.status === 403, String(c1.status))
  const c2 = await call('POST', `/admin/mentor-calendar/meetings/${meetingId}/cancel`, moizJ)
  check('Moiz (booked it) can', c2.status === 200 && c2.body?.data?.cancelled === true, String(c2.status))
  const b3 = await book(moizJ, 'Second try')
  const c3 = await call('POST', `/admin/mentor-calendar/meetings/${b3.body?.data?.meeting?.id}/cancel`, adminJ)
  check('an admin cancels anyone\'s', b3.status === 200 && c3.status === 200, `${b3.status} ${c3.status}`)

  section('D · not for students')
  const sj = await login('stu@mc.local', '/auth/login')
  const s = await cal(sj)
  check('a student session gets nothing', s.status === 401 || s.status === 403, String(s.status))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
