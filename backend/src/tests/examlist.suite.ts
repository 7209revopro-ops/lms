/* ─────────────────────────────────────────────────────────────
   The Exams page's list (2026-11-09): GET /admin/exams — only courses that have an exam, the caller's academy,
   with how the attempts stand (submitted, passed, failed, to grade, started and not submitted).
   Run: EXAMLIST_DB_URL=mongodb://127.0.0.1:<port>/lms_examlist bun --no-env-file src/tests/examlist.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.EXAMLIST_DB_URL || 'mongodb://localhost:27017/lms_examlist'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.JWT_ACCESS_SECRET  ??= 'examlist-suite-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'examlist-suite-refresh-secret-0123456789abcdef'

export {}

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_examlist') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
const jar = new Map<string, string>()
async function call(method: string, p: string, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer' })
  const hash = await hashPassword('CorrectHorse1')
  const admin = await M.UserModel.create({ name: 'ADMIN', email: 'admin@el.local', passwordHash: hash, role: 'admin', isActive: true, isVerified: true, organizationId: dubai._id })
  const mkCourse = (title: string, org: unknown) => M.CourseModel.create({ title, slug: title.toLowerCase().replace(/\W+/g, '-') + Date.now(), description: 'd', instructorId: admin._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org })
  const withExam = await mkCourse('DSLP', dubai._id)
  await mkCourse('MSNR', dubai._id)
  const blrCourse = await mkCourse('Bangalore DWT', blr._id)
  const q = [{ text: 'Q1', type: 'mcq', options: ['a', 'b'], correctIndex: 0, order: 0, maxMarks: 1 }]
  const exam = await M.ExamModel.create({ courseId: withExam._id, title: 'DSLP final', durationMinutes: 60, passPercent: 50, questions: q, isPublished: true })
  await M.ExamModel.create({ courseId: blrCourse._id, title: 'Bangalore exam', durationMinutes: 30, passPercent: 50, questions: q })
  const stu = (n: number) => M.UserModel.create({ name: `S${n}`, email: `s${n}@el.local`, passwordHash: hash, role: 'student', isActive: true, isVerified: true, organizationId: dubai._id })
  const att = async (n: number, status: string, passed?: boolean) => M.ExamAttemptModel.create({ userId: (await stu(n))._id, examId: exam._id, courseId: withExam._id, status, startedAt: new Date(), ...(status === 'submitted' ? { submittedAt: new Date() } : {}), ...(passed !== undefined ? { passed } : {}), answers: [], violations: 0 })
  await att(1, 'submitted', true); await att(2, 'submitted', true); await att(3, 'submitted', false); await att(4, 'submitted'); await att(5, 'in_progress'); await att(6, 'suspended')

  const login = await call('POST', '/admin/auth/login', { email: 'admin@el.local', password: 'CorrectHorse1' })
  if (login.status !== 200) throw new Error('login ' + login.status + ' ' + JSON.stringify(login.body))
  const r = await call('GET', '/admin/exams')
  const list: any[] = r.body?.data ?? []
  check('only courses with an exam, this academy only (DSLP; not MSNR, not Bangalore)', r.status === 200 && list.length === 1 && list[0].courseTitle === 'DSLP', `${r.status} ${JSON.stringify(list.map((x) => x.courseTitle))}`)
  const a = list[0]?.attempts ?? {}
  check('the exam: title, questions, time, published', list[0]?.title === 'DSLP final' && list[0].questions === 1 && list[0].durationMinutes === 60 && list[0].isPublished === true, JSON.stringify(list[0]))
  check('attempts: 4 submitted, 2 passed, 1 failed, 1 to grade, 2 started not submitted', a.submitted === 4 && a.passed === 2 && a.failed === 1 && a.needsGrading === 1 && a.inProgress + a.suspended === 2, JSON.stringify(a))
} catch (err) {
  fail++; console.log('  FAIL  threw', err)
} finally {
  server.close()
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
