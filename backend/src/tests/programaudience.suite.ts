/* ─────────────────────────────────────────────────────────────
   Programs — picking students by commission team, by CS, or all, and telling
   them when the program is made (services/program.service.ts, /admin/programs).
     A. the teams and CS of the academy, with counts: approved, active students
        of this academy only
     B. a whole team, one CS, or everyone — as a list to put on the form
     C. made with a team: every student is told in-app, by email, and on
        WhatsApp course_update_v1 with the days and time; a sign-in button to the
        Class Schedule; nobody else is told
     D. no limit on students: 2,000 on a program are all booked on every class,
        quickly; each class's room grows to fit; adding more later books them too
   Run: bun --no-env-file src/tests/programaudience.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_programaudience'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.JWT_ACCESS_SECRET  ??= 'programaudience-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'programaudience-refresh-secret-0123456789abcdef'
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
const { hashSigninCode } = await import('@/services/signinLink.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_programaudience') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar | null, body?: unknown) {
  const h: Record<string, string> = {}
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0 && jar) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: any) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`
const until = async (want: () => Promise<boolean>, ms = 8000) => { const t0 = Date.now(); for (;;) { if (await want()) return true; if (Date.now() - t0 > ms) return false; await new Promise(r => setTimeout(r, 150)) } }
const PW = 'CorrectHorse1', DAY = 864e5
const dubaiDay = (offset: number) => new Date(Date.now() + offset * DAY).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW)
  let n = 0
  const stu = (team: string | null, cs: string | null, extra: Record<string, unknown> = {}) => M.UserModel.create({
    name: `Stu ${++n}`, email: `s${n}@pa.local`, passwordHash: hash, role: 'student', isActive: true, isVerified: true,
    enrollmentStatus: 'approved', organizationId: dubai._id,
    enrollmentApplication: { phone: `+97150000${String(1000 + n)}` },
    ...(team ? { tetraCs: { team, name: cs ?? '' } } : {}), ...extra,
  })
  await M.UserModel.create({ name: 'Admin', email: 'admin@pa.local', passwordHash: hash, role: 'admin', isActive: true, isVerified: true, organizationId: dubai._id })
  const mentor = await M.UserModel.create({ name: 'MOIZ', email: 'moiz@pa.local', passwordHash: hash, role: 'instructor', isActive: true, isVerified: true, organizationId: dubai._id })
  /* Team Gladiators: Asha (2) + Ravi (1). Team Expandables: Alice (2). */
  const g1 = await stu('Team Gladiators', 'Asha'), g2 = await stu('Team Gladiators', 'Asha'), g3 = await stu('Team Gladiators', 'Ravi')
  const e1 = await stu('Team Expandables', 'Alice'), e2 = await stu('Team Expandables', 'Alice')
  const noTeam = await stu(null, null)
  /* Not pickable: pending, blocked, the other academy's. */
  await stu('Team Gladiators', 'Asha', { enrollmentStatus: 'pending' })
  await stu('Team Gladiators', 'Asha', { isActive: false })
  await stu('Team Gladiators', 'Asha', { organizationId: blr._id })
  void e1; void e2; void g3

  const admin: Jar = new Map()
  const li = await call('POST', '/admin/auth/login', admin, { email: 'admin@pa.local', password: PW })
  if (li.status !== 200) throw new Error('admin login ' + why(li))

  section('A · teams and CS, with counts')
  const a = await call('GET', '/admin/programs/audiences', admin)
  check('200', a.status === 200, why(a))
  const d = a.body?.data
  check('total: 6 approved, active Dubai students', d?.total === 6, JSON.stringify(d?.total))
  check('teams: Expandables 2, Gladiators 3', JSON.stringify(d?.teams) === JSON.stringify([{ team: 'Team Expandables', count: 2 }, { team: 'Team Gladiators', count: 3 }]), JSON.stringify(d?.teams))
  check('CS: Alice 2, Asha 2, Ravi 1 — each with their team', JSON.stringify(d?.cs) === JSON.stringify([
    { name: 'Alice', team: 'Team Expandables', count: 2 }, { name: 'Asha', team: 'Team Gladiators', count: 2 }, { name: 'Ravi', team: 'Team Gladiators', count: 1 }]), JSON.stringify(d?.cs))

  section('B · a team, a CS, everyone')
  const ids = (r: any) => (r.body?.data ?? []).map((x: any) => x.email).sort().join(',')
  const team = await call('GET', '/admin/programs/students?team=' + encodeURIComponent('Team Gladiators'), admin)
  check('team: its 3 pickable students', ids(team) === [g1, g2, g3].map(u => u.email).sort().join(','), ids(team))
  const cs = await call('GET', '/admin/programs/students?cs=Asha&team=' + encodeURIComponent('Team Gladiators'), admin)
  check('CS: their 2', ids(cs) === [g1, g2].map(u => u.email).sort().join(','), ids(cs))
  const all = await call('GET', '/admin/programs/students?all=1', admin)
  check('all: the 6 (no pending, blocked or other academy)', (all.body?.data ?? []).length === 6 && ids(all).includes(noTeam.email), ids(all))

  section('C · made with a team: its students are told')
  const made = await call('POST', '/admin/programs', admin, {
    title: 'Gladiators weekly review', repeat: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], startDate: dubaiDay(1), endDate: dubaiDay(3),
    time: '19:00', durationMins: 60, isOnline: false, location: 'Room 4', instructorId: String(mentor._id),
    students: (team.body?.data ?? []).map((x: any) => x.id),
  })
  check('created', made.status === 200 && made.body?.data?.students?.length === 3, why(made))
  const gl = [g1, g2, g3]
  check('every student gets the in-app notice',
    await until(async () => (await M.NotificationModel.countDocuments({ userId: { $in: gl.map(u => u._id) }, title: 'New program: Gladiators weekly review' })) === 3))
  const note = await M.NotificationModel.findOne({ userId: g1._id, title: /^New program/ }).lean() as any
  check('...saying when it meets, where, and that they are booked', /3 classes, every .* at 07:00 PM GST, at Room 4 — from .* to .*\. You are booked on every one\./.test(String(note?.body)), String(note?.body))
  check('every student gets WhatsApp course_update_v1',
    await until(async () => (await M.WhatsAppOutboxModel.countDocuments({ templateName: 'course_update_v1' })) === 3))
  const wa = await M.WhatsAppOutboxModel.findOne({ templateName: 'course_update_v1', to: /1001$/ }).lean() as any
  check('...name, the program, and the schedule', wa?.params?.[0] === g1.name && wa?.params?.[1] === 'Gladiators weekly review' && /^You have been added to this program\. 3 classes/.test(String(wa?.params?.[2])), JSON.stringify(wa?.params))
  const tok = wa?.buttonParam ? await M.AuthTokenModel.findOne({ tokenHash: hashSigninCode(wa.buttonParam), purpose: 'signin-link' }).lean() as any : null
  check('...its button signs them in to the Class Schedule', tok?.nextPath === '/class-bookings', String(tok?.nextPath))
  check('nobody outside the program is told', (await M.NotificationModel.countDocuments({ userId: { $in: [e1._id, e2._id, noTeam._id] }, title: /^New program/ })) === 0)

  section('C2 · students added later are not messaged (only at creation)')
  const pid = made.body?.data?.id
  const add = await call('POST', `/admin/programs/${pid}/students`, admin, { add: [String(e1._id)] })
  check('added', add.status === 200, why(add))
  await new Promise(r => setTimeout(r, 1200))
  check('no notice for the added student', (await M.NotificationModel.countDocuments({ userId: e1._id, title: /^New program/ })) === 0)

  section('D · no limit on students')
  const many = await M.UserModel.insertMany(Array.from({ length: 2000 }, (_, i) => ({
    name: `Bulk ${i}`, email: `bulk${i}@pa.local`, passwordHash: hash, role: 'student', isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: dubai._id })))
  const t0 = Date.now()
  const big = await call('POST', '/admin/programs', admin, {
    title: 'Everyone', repeat: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], startDate: dubaiDay(1), endDate: dubaiDay(2), time: '19:00', durationMins: 60,
    isOnline: false, location: 'Hall', instructorId: String(mentor._id), students: many.map(u => String(u._id)) })
  const took = Date.now() - t0
  check('2,000 students → created', big.status === 200 && big.body?.data?.students?.length === 2000, why(big))
  check(`...in seconds, not minutes (${(took / 1000).toFixed(1)} s)`, took < 30_000)
  const bigClasses = await M.LiveClassModel.find({ programId: big.body?.data?.id }).lean() as any[]
  check('every class: 2,000 booked, and room for them', bigClasses.length === 2 && bigClasses.every(c => c.bookedCount === 2000 && c.sessionCapacity >= 2000),
    JSON.stringify(bigClasses.map(c => [c.bookedCount, c.sessionCapacity])))
  check('...as 2,000 real bookings per class', (await M.ClassBookingModel.countDocuments({ liveClassId: bigClasses[0]?._id, status: 'booked' })) === 2000)
  check('...and 2,000 enrolments', (await M.EnrollmentModel.countDocuments({ courseId: (await M.ProgramModel.findById(big.body?.data?.id).lean() as any)?.courseId, status: 'active' })) === 2000)
  const more = await M.UserModel.insertMany(Array.from({ length: 300 }, (_, i) => ({
    name: `More ${i}`, email: `more${i}@pa.local`, passwordHash: hash, role: 'student', isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: dubai._id })))
  const grow = await call('POST', `/admin/programs/${big.body?.data?.id}/students`, admin, { add: more.map(u => String(u._id)) })
  check('300 more added later', grow.status === 200 && grow.body?.data?.students?.length === 2300, why(grow))
  const after = await M.LiveClassModel.find({ programId: big.body?.data?.id }).lean() as any[]
  check('...each class now 2,300 booked, room grown', after.every(c => c.bookedCount === 2300 && c.sessionCapacity >= 2300), JSON.stringify(after.map(c => [c.bookedCount, c.sessionCapacity])))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await new Promise(r => setTimeout(r, 500))
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
