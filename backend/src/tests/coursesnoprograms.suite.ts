/* ─────────────────────────────────────────────────────────────
   Courses page without programmes (2026-10-24).
     GET /admin/courses?programs=exclude leaves out programmes' hidden "Program: …" courses;
     without it they are still listed (class pickers need them); the course counts never include them.
   Run: bun --no-env-file src/tests/coursesnoprograms.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_coursesnoprograms'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.JWT_ACCESS_SECRET  ??= 'nopro-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'nopro-refresh-secret-0123456789abcdef'
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
if (mongoose.connection.db!.databaseName !== 'lms_coursesnoprograms') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  await M.UserModel.create({ name: 'Admin', email: 'a@np.local', passwordHash: await hashPassword('CorrectHorse1'), role: 'super_admin', isActive: true, isVerified: true, organizationId: org._id })
  const t = await M.UserModel.create({ name: 'Mentor', email: 'm@np.local', role: 'instructor', isActive: true, organizationId: org._id })
  const mk = (title: string, slug: string, status: string) => M.CourseModel.create({ title, slug, description: 'd', instructorId: t._id, price: 10, isFree: false, status, language: 'English', organizationId: org._id })
  await mk('MBT', 'mbt', 'published'); await mk('DWT', 'dwt', 'draft')
  const pc = await mk('Program: Live trade', 'program-live-trade', 'draft')
  await M.ProgramModel.create({ title: 'Live trade', courseId: pc._id, organizationId: org._id, instructorId: t._id, status: 'active', repeat: 'weekly', weekdays: [5], time: '16:00', timezone: 'Asia/Dubai', durationMins: 120, startDate: '2026-10-24', endDate: '2026-11-24', studentIds: [] } as any)
  const jar = new Map<string, string>()
  const login = await fetch(`${BASE}/admin/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@np.local', password: 'CorrectHorse1' }) })
  for (const c of login.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  const get = async (p: string) => (await (await fetch(`${BASE}${p}`, { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } })).json()) as any
  const without = (await get('/admin/courses?programs=exclude&per_page=50')).data.map((c: any) => c.title)
  check('the Courses page: no programme courses', without.length === 2 && !without.includes('Program: Live trade'), JSON.stringify(without))
  const withP = (await get('/admin/courses?per_page=50')).data.map((c: any) => c.title)
  check('other callers still get them (class pickers)', withP.includes('Program: Live trade') && withP.length === 3, JSON.stringify(withP))
  const stats = (await get('/admin/stats')).data
  check('the counts leave them out: 2 total, 1 published, 1 draft', stats?.totalCourses === 2 && stats.publishedCourses === 1 && stats.draftCourses === 1, JSON.stringify({ t: stats?.totalCourses, p: stats?.publishedCourses, d: stats?.draftCourses }))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
