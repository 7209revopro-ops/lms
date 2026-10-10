/* ─────────────────────────────────────────────────────────────
   A student whose enrolment is 'completed' (finished the recorded lessons)
   can still book the course's live classes; a dropped one cannot; a blocked
   module still refuses. Run: bun --no-env-file src/tests/completedbooking.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_completedbooking'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.JWT_ACCESS_SECRET  ??= 'completed-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'completed-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
const lines: string[] = []
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; lines.push(`  PASS  ${l}`) } else { fail++; lines.push(`  FAIL  ${l}${d ? '  — ' + d : ''}`) } }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_completedbooking') process.exit(1)
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar, body?: unknown) {
  const res = await fetch(`${BASE}${p}`, { method, headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let b: any = null; try { b = await res.json() } catch { /* */ }
  return { status: res.status, body: b }
}
const why = (r: any) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`
const PW = 'CorrectHorse1'

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const teacher = await M.UserModel.create({ name: 'T', email: 't@cb.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const course = await M.CourseModel.create({ title: 'MBT', slug: 'mbt-cb', description: 'A course description long enough.', instructorId: teacher._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id })
  const sec = await M.SectionModel.create({ courseId: course._id, title: 'MBT 2', order: 2 })
  const mkClass = () => M.LiveClassModel.create({ title: 'MBT 2 · Live', courseId: course._id, sectionId: sec._id, instructorId: teacher._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() + 3 * 86_400_000), durationMins: 60, type: 'external', meetingUrl: 'https://meet.google.com/abc-defg-hij', isOnline: true, status: 'scheduled', sessionCapacity: 30, bookedCount: 0 })
  const stu = async (tag: string, enrol: Record<string, unknown>) => {
    const u = await M.UserModel.create({ name: tag, email: `${tag}@cb.local`, passwordHash: hash, role: 'student', isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org._id })
    await M.EnrollmentModel.create({ userId: u._id, courseId: course._id, source: 'purchase', ...enrol })
    const jar: Jar = new Map()
    const l = await call('POST', '/auth/login', jar, { email: u.email, password: PW })
    if (l.status !== 200) throw new Error('login ' + why(l))
    return jar
  }
  const done    = await stu('sooraj',  { status: 'completed', progressPercent: 100, completedAt: new Date() })
  const active  = await stu('active',  { status: 'active' })
  const dropped = await stu('dropped', { status: 'dropped' })
  const blocked = await stu('blocked', { status: 'completed', progressPercent: 100, blockedLessons: [sec._id] })

  const live = await mkClass()
  const r1 = await call('POST', '/bookings', done, { liveClassId: String(live._id) })
  check('completed enrolment: booked', r1.status === 201 || r1.status === 200, why(r1))
  const r2 = await call('POST', '/bookings', active, { liveClassId: String(live._id) })
  check('active enrolment: booked', r2.status === 201 || r2.status === 200, why(r2))
  const r3 = await call('POST', '/bookings', dropped, { liveClassId: String(live._id) })
  check('dropped enrolment: refused NOT_ENROLLED', r3.status === 403 && r3.body?.error?.code === 'NOT_ENROLLED', why(r3))
  const r4 = await call('POST', '/bookings', blocked, { liveClassId: String(live._id) })
  check('completed but module blocked: refused MODULE_BLOCKED', r4.status === 403 && r4.body?.error?.code === 'MODULE_BLOCKED', why(r4))
} catch (err) { fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}`) }
finally { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close() }
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
