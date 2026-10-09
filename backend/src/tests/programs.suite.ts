/* ─────────────────────────────────────────────────────────────
   Programs — a live class repeating weekly or monthly until an end date, for the picked students only
   (services/program.service.ts, /admin/programs, /service/programs).

     A. the dates: weekly days, monthly on the 31st (a short month takes its last day), the 60-class cap
     B. an instructor makes one: a class per date ahead, each with a seat for every student
     C. only its students see its classes; another student never does
     D. a student added gets seats on the classes still to come; one taken away loses them and stops seeing it
     E. moved: the classes still to come are cancelled and made again at the new time
     F. another instructor cannot change it; an admin can; stopped → the classes still to come cancelled
     G. the portal makes one with its secret, and lists it by who made it
     H. a student cannot reach /admin/programs
   Run: bun --no-env-file src/tests/programs.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.PROGRAMS_DB_URL || 'mongodb://localhost:27017/lms_programs'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.JWT_ACCESS_SECRET  ??= 'programs-suite-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'programs-suite-refresh-secret-0123456789abcdef'
process.env.ROOT_ERP_SECRET = 'programs-suite-portal-secret-0123456789'

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
const { programDates } = await import('@/services/program.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_programs') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar | null, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0 && jar) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const PW = 'CorrectHorse1', DAY = 864e5
const dubaiDay = (offset: number) => new Date(Date.now() + offset * DAY).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

try {
  section('A · the dates')
  check('weekly Mon + Wed over two weeks: 4 dates', programDates({ repeat: 'weekly', weekdays: [1, 3], startDate: '2026-11-02', endDate: '2026-11-15' }).join() === '2026-11-02,2026-11-04,2026-11-09,2026-11-11')
  check('monthly on the 31st: a short month takes its last day', programDates({ repeat: 'monthly', monthDay: 31, startDate: '2027-01-01', endDate: '2027-04-30' }).join() === '2027-01-31,2027-02-28,2027-03-31,2027-04-30')

  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (name: string, email: string, role: string) => M.UserModel.create({ name, email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: dubai._id, ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}) })
  await mk('MOIZ', 'moiz@pg.local', 'instructor')
  await mk('HAFFIS', 'haf@pg.local', 'instructor')
  await mk('Admin', 'admin@pg.local', 'admin')
  const s1 = await mk('Stu One', 'one@pg.local', 'student')
  await mk('Stu Two', 'two@pg.local', 'student')
  await mk('Stu Three', 'three@pg.local', 'student')
  const login = async (email: string, path = '/admin/auth/login') => { const j: Jar = new Map(); const r = await call('POST', path, j, { email, password: PW }); if (r.status !== 200) throw new Error(`${email} login ${r.status}`); return j }
  const moiz = await login('moiz@pg.local'), haf = await login('haf@pg.local'), admin = await login('admin@pg.local')
  const one = await login('one@pg.local', '/auth/login'), two = await login('two@pg.local', '/auth/login'), three = await login('three@pg.local', '/auth/login')

  const capped = await call('POST', '/admin/programs', moiz, { title: 'Too long', repeat: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], startDate: dubaiDay(1), endDate: dubaiDay(80), time: '19:00', durationMins: 60, isOnline: false, location: 'Room 1', students: ['one@pg.local'] })
  check('more than 60 classes is refused', capped.status === 400 && /60/.test(capped.body?.error?.message ?? capped.body?.message ?? ''), JSON.stringify(capped.body))

  section('B · an instructor makes one')
  const created = await call('POST', '/admin/programs', moiz, { title: 'Weekly review', repeat: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], startDate: dubaiDay(1), endDate: dubaiDay(5), time: '19:00', durationMins: 60, isOnline: false, location: 'Room 2', students: ['one@pg.local', String(s1._id), 'two@pg.local', 'nobody@pg.local'] })
  const prog = created.body?.data
  check('made, with a class per day ahead (5)', created.status === 200 && prog?.classes?.length === 5, `${created.status} ${JSON.stringify(created.body).slice(0, 300)}`)
  check('…the unknown email named back, the student given twice counted once', prog?.missing?.join() === 'nobody@pg.local' && prog?.students?.length === 2)
  check('…at 19:00 Dubai', prog?.classes?.every((c: any) => new Date(c.startsAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) === '19:00'))
  const classIds = (prog?.classes ?? []).map((c: any) => c.id)
  const seats = await M.ClassBookingModel.countDocuments({ liveClassId: { $in: classIds }, status: 'booked' })
  check('…a seat for each student on each class (10)', seats === 10, String(seats))

  section('C · only its students see it')
  const seen = async (j: Jar) => ((await call('GET', '/live-classes', j)).body?.data ?? []).filter((c: any) => classIds.includes(String(c._id ?? c.id))).length
  check('a student on it sees all 5', (await seen(one)) === 5)
  check('a student not on it sees none', (await seen(three)) === 0)

  section('D · students added and taken away')
  const ch = await call('POST', `/admin/programs/${prog.id}/students`, moiz, { add: ['three@pg.local'], remove: ['two@pg.local'] })
  check('changed', ch.status === 200 && ch.body?.data?.students?.map((s: any) => s.email).sort().join() === 'one@pg.local,three@pg.local', JSON.stringify(ch.body).slice(0, 200))
  check('the added one has seats and sees it', (await M.ClassBookingModel.countDocuments({ liveClassId: { $in: classIds }, userId: (await M.UserModel.findOne({ email: 'three@pg.local' }))!._id, status: 'booked' })) === 5 && (await seen(three)) === 5)
  check('the one taken away lost the seats and sees nothing', (await M.ClassBookingModel.countDocuments({ liveClassId: { $in: classIds }, userId: (await M.UserModel.findOne({ email: 'two@pg.local' }))!._id, status: 'booked' })) === 0 && (await seen(two)) === 0)

  section('E · moved')
  const mv = await call('PATCH', `/admin/programs/${prog.id}`, moiz, { time: '20:30' })
  const after = mv.body?.data?.classes ?? []
  const live = after.filter((c: any) => c.status === 'scheduled')
  check('the old ones cancelled, 5 new at 20:30', mv.status === 200 && after.filter((c: any) => c.status === 'cancelled').length === 5 && live.length === 5 && live.every((c: any) => new Date(c.startsAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) === '20:30'), JSON.stringify(after).slice(0, 300))
  check('…the students booked on the new ones', (await M.ClassBookingModel.countDocuments({ liveClassId: { $in: live.map((c: any) => c.id) }, status: 'booked' })) === 10)

  section('F · who may change it, and stopping')
  const other = await call('POST', `/admin/programs/${prog.id}/stop`, haf)
  check('another instructor cannot', other.status === 403, String(other.status))
  check('…nor sees it in their list', ((await call('GET', '/admin/programs', haf)).body?.data ?? []).length === 0)
  const st = await call('POST', `/admin/programs/${prog.id}/stop`, admin)
  check('an admin stops it: every class still to come cancelled', st.status === 200 && st.body?.data?.status === 'stopped' && (st.body?.data?.classes ?? []).every((c: any) => c.status === 'cancelled'), JSON.stringify(st.body).slice(0, 200))

  section('G · the portal')
  const P = { 'x-portal-secret': process.env.ROOT_ERP_SECRET! }
  const pc = await call('POST', '/service/programs', null, { remoteOrgId: String(dubai._id), actorEmail: 'cs@portal.test', actorName: 'CS Person', title: 'Monthly check-in', repeat: 'monthly', monthDay: Number(dubaiDay(2).slice(8)), startDate: dubaiDay(1), endDate: dubaiDay(70), time: '18:00', durationMins: 45, mentorEmail: 'haf@pg.local', isOnline: false, location: 'Office', students: ['one@pg.local'] }, P)
  check('made from the portal, mentor by email, 2–3 monthly classes', pc.status === 200 && pc.body?.data?.source === 'portal' && pc.body?.data?.mentor?.email === 'haf@pg.local' && [2, 3].includes(pc.body?.data?.classes?.length), `${pc.status} ${JSON.stringify(pc.body).slice(0, 300)}`)
  const pl = await call('GET', `/service/programs?remoteOrgId=${dubai._id}&createdByEmail=cs@portal.test`, null, undefined, P)
  check('listed by who made it', pl.status === 200 && pl.body?.data?.length === 1 && pl.body.data[0].createdByName === 'CS Person')
  const bad = await call('GET', `/service/programs?remoteOrgId=${dubai._id}`, null, undefined, { 'x-portal-secret': 'wrong' })
  check('a wrong secret gets nothing', bad.status === 401)

  section('H · not for students')
  const s = await call('GET', '/admin/programs', one)
  check('a student session gets nothing', s.status === 401 || s.status === 403, String(s.status))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
