/* ─────────────────────────────────────────────────────────────
   My Learning: only programmes still to come (2026-10-23).
   GET /enrollments/me lists a programme's hidden course only while the
   programme is active with a class not over yet. Ordinary courses always.
   Run: bun --no-env-file src/tests/mylearningprograms.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_mylearningprograms'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.JWT_ACCESS_SECRET  ??= 'mylearning-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'mylearning-refresh-secret-0123456789abcdef'
export {}
let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_mylearningprograms') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const t = await M.UserModel.create({ name: 'Mentor', email: 'm@ml.local', role: 'instructor', isActive: true, organizationId: org._id })
  const s = await M.UserModel.create({ name: 'Sam', email: 'sam@ml.local', passwordHash: await hashPassword('CorrectHorse1'), role: 'student', isActive: true, isVerified: true, organizationId: org._id, enrollmentStatus: 'approved' })
  const course = (title: string, slug: string) => M.CourseModel.create({ title, slug, description: 'd', instructorId: t._id, price: 0, isFree: true, status: title.startsWith('Program') ? 'draft' : 'published', language: 'English', organizationId: org._id })
  const now = Date.now()
  /* One programme per case, each with its hidden course and one class. */
  const mk = async (name: string, status: string, startInMin: number, classStatus = 'scheduled') => {
    const c = await course(`Program: ${name}`, `program-${name}`)
    const p = await M.ProgramModel.create({ title: name, courseId: c._id, organizationId: org._id, instructorId: t._id, status, repeat: 'weekly', weekdays: [1], time: '10:00', timezone: 'Asia/Dubai', durationMins: 60, startDate: new Date().toISOString().slice(0, 10), endDate: new Date(now + 30 * 864e5).toISOString().slice(0, 10), studentIds: [s._id] } as any)
    await M.LiveClassModel.create({ courseId: c._id, instructorId: t._id, title: name, scheduledStart: new Date(now + startInMin * 60_000), durationMins: 60, type: 'external', status: classStatus, organizationId: org._id, programId: p._id } as any)
    await M.EnrollmentModel.create({ userId: s._id, courseId: c._id, status: 'active', source: 'admin' } as any)
  }
  await mk('upcoming', 'active', 120)
  await mk('happening-now', 'active', -30)
  await mk('stopped', 'stopped', 120)
  await mk('all-over', 'active', -300)
  await mk('only-cancelled', 'active', 120, 'cancelled')
  const normal = await course('MBT', 'mbt')
  await M.EnrollmentModel.create({ userId: s._id, courseId: normal._id, status: 'active', source: 'admin' } as any)

  const jar = new Map<string, string>()
  const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sam@ml.local', password: 'CorrectHorse1' }) })
  for (const c of login.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  const res = await fetch(`${BASE}/enrollments/me`, { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } })
  const body = await res.json() as any
  const titles: string[] = (body.data ?? []).map((e: any) => e.courseId?.title).sort()
  check('the list loads', res.status === 200, String(res.status))
  check('an active programme with a class to come: shown', titles.includes('Program: upcoming'), JSON.stringify(titles))
  check('one whose class is on right now: shown', titles.includes('Program: happening-now'), JSON.stringify(titles))
  check('a stopped programme: hidden', !titles.includes('Program: stopped'))
  check('every class over: hidden', !titles.includes('Program: all-over'))
  check('only cancelled classes left: hidden', !titles.includes('Program: only-cancelled'))
  check('an ordinary course: always shown', titles.includes('MBT'))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
