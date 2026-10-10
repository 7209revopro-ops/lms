/* ─────────────────────────────────────────────────────────────
   Exams, for the commission portal (services/portalExams.service.ts).

   Pinned here, against a real database:

     A. an academy's exams: its own courses' published exams and those of
        courses shared with both academies — never a draft, never the other
        academy's own; the plain exam address; a wrong academy refused;
     B. a student's exams: only the published exams of courses they are on,
        where each stands (not started / in progress / suspended / graded with
        marks and pass — marks only once graded), and a sign-in link made for
        them that opens that exam; no account, an empty list;
     C. over HTTP, only behind the /service secret check.

   Run: bun --no-env-file src/tests/portalexams.suite.ts
   (PORTALEXAMS_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.PORTALEXAMS_DATABASE_URL ?? 'mongodb://localhost:27017/lms_portalexams'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.SMTP_BACKUP_HOST = ''
process.env.SMTP_BACKUP_USER = ''
process.env.SMTP_BACKUP_PASS = ''
process.env.EMAIL_FROM   = ''
process.env.FINANCE_API_URL = ''
delete process.env.WHATSAPP_API_KEY
delete process.env.WHATSAPP_PHONE_NUMBER_ID
process.env.DOTENV_CONFIG_PATH = '/nonexistent/portalexams-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'portalexams-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalexams-suite-refresh-secret-0123456789'
process.env.CLIENT_URL = 'https://learn.example.test'
const CRM_SECRET = 'portalexams-suite-crm-secret-0123456789'
process.env.SALES_CRM_SECRET = CRM_SECRET
process.env.ROOT_ERP_SECRET  = ''

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

const mongoose = (await import('mongoose')).default
const { UserModel, CourseModel, EnrollmentModel, OrganizationModel, ExamModel, ExamAttemptModel, AuthTokenModel } = await import('@/models/schema.ts')
const { listExamsForPortal, studentExamsForPortal } = await import('@/services/portalExams.service.ts')
const { hashSigninCode } = await import('@/services/signinLink.service.ts')
const { PortalError } = await import('@/services/portal.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_portalexams') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.dropDatabase()

const now = new Date()
const idOf = (v: unknown) => String(v)
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try { await run(); return 'ok' } catch (err) {
    return err instanceof PortalError ? `${err.code} ${err.statusCode}` : `threw ${String(err)}`
  }
}

/* ── Two academies; Dubai's course, Bangalore's course, a shared one, and a draft exam ── */
const dubai = (await OrganizationModel.collection.insertOne({ name: 'Delta Dubai', slug: 'dubai', createdAt: now, updatedAt: now })).insertedId
const blr = (await OrganizationModel.collection.insertOne({ name: 'Delta Bangalore', slug: 'bangalore', createdAt: now, updatedAt: now })).insertedId
const course = async (title: string, org: unknown, shared = false) =>
  (await CourseModel.collection.insertOne({ title, slug: title.toLowerCase().replace(/\W+/g, '-'), organizationId: org, sharedAcademies: shared, status: 'published', createdAt: now, updatedAt: now })).insertedId
const dwt = await course('Delta Wave Theory', dubai)
const blrCourse = await course('Bangalore Basics', blr)
const shared = await course('Market Structure', dubai, true)
const draftCourse = await course('Draft Course', dubai)
const q = (n: number) => Array.from({ length: n }, (_, i) => ({ _id: new mongoose.Types.ObjectId(), text: `Q${i + 1}`, type: 'mcq', choices: ['a', 'b'], correctAnswer: '0', order: i, maxMarks: 1 }))
const exam = async (courseId: unknown, title: string, published = true, extra: Record<string, unknown> = {}) =>
  (await ExamModel.collection.insertOne({ courseId, title, durationMinutes: 70, passPercent: 50, questions: q(3), maxViolations: 4, isPublished: published, createdAt: now, updatedAt: now, ...extra })).insertedId
const exDwt = await exam(dwt, 'DWT Final', true, { availableTo: new Date('2026-12-31T00:00:00Z') })
const exBlr = await exam(blrCourse, 'Basics Final')
const exShared = await exam(shared, 'MS Final')
await exam(draftCourse, 'Not yet', false)

step('A. an academy\'s exams')
const d = await listExamsForPortal('dubai')
check('Dubai: its own and the shared one, not the draft or Bangalore\'s', d.exams.map((e) => e.title).sort().join(',') === 'DWT Final,MS Final', d.exams.map((e) => e.title).join(','))
const dw = d.exams.find((e) => e.title === 'DWT Final')
check('…with the course, length, pass mark, questions, window and the plain address',
  dw?.course === 'Delta Wave Theory' && dw.durationMinutes === 70 && dw.passPercent === 50 && dw.questionCount === 3
  && dw.availableTo === '2026-12-31T00:00:00.000Z' && dw.link === `https://learn.example.test/exam/${idOf(dwt)}`, JSON.stringify(dw))
const b = await listExamsForPortal('BANGALORE')
check('Bangalore: its own and the shared one (marked shared)', b.exams.map((e) => e.title).sort().join(',') === 'Basics Final,MS Final' && b.exams.find((e) => e.title === 'MS Final')?.shared === true, JSON.stringify(b.exams))
check('a wrong academy: refused', (await refusal(() => listExamsForPortal('london'))) === 'VALIDATION_ERROR 400')

step('B. a student\'s exams')
const student = async (email: string) => (await UserModel.collection.insertOne({ email, name: email, role: 'student', isActive: true, organizationId: dubai, createdAt: now, updatedAt: now })).insertedId
const sam = await student('sam@lms.test')
for (const c of [dwt, shared, draftCourse]) await EnrollmentModel.collection.insertOne({ userId: sam, courseId: c, status: 'active', createdAt: now, updatedAt: now })
await ExamAttemptModel.collection.insertOne({ userId: sam, examId: exShared, courseId: shared, status: 'submitted', startedAt: now, submittedAt: now, answers: [], violations: 0, totalMarks: 2, maxMarks: 3, passed: true, gradedAt: now, createdAt: now, updatedAt: now })
const s = await studentExamsForPortal(' Sam@LMS.test ')
check('only the published exams of their courses', s.account === true && s.exams.map((e) => e.title).sort().join(',') === 'DWT Final,MS Final', JSON.stringify(s.exams.map((e) => e.title)))
const notStarted = s.exams.find((e) => e.title === 'DWT Final')
const graded = s.exams.find((e) => e.title === 'MS Final')
check('not started: no marks', notStarted?.status === 'not_started' && notStarted.totalMarks === null && notStarted.passed === null, JSON.stringify(notStarted))
check('graded: the marks and the pass', graded?.status === 'graded' && graded.totalMarks === 2 && graded.maxMarks === 3 && graded.passed === true, JSON.stringify(graded))
const code = String(notStarted?.link ?? '').replace('https://learn.example.test/s/', '')
const token = await AuthTokenModel.findOne({ tokenHash: hashSigninCode(code) }).lean() as any
check('a sign-in link made for them, opening that exam, for 24 hours',
  !!code && String(notStarted?.link).startsWith('https://learn.example.test/s/') && idOf(token?.userId) === idOf(sam) && token?.purpose === 'signin-link'
  && token?.nextPath === `/exam/${idOf(dwt)}` && Math.abs(new Date(token.expiresAt).getTime() - Date.now() - 24 * 3_600_000) < 60_000, JSON.stringify(token))
const ana = await student('ana@lms.test')
await EnrollmentModel.collection.insertOne({ userId: ana, courseId: dwt, status: 'active', createdAt: now, updatedAt: now })
await ExamAttemptModel.collection.insertOne({ userId: ana, examId: exDwt, courseId: dwt, status: 'suspended', suspendedReason: 'Screenshot', startedAt: now, answers: [], violations: 4, totalMarks: 1, maxMarks: 3, createdAt: now, updatedAt: now })
const a = (await studentExamsForPortal('ana@lms.test')).exams[0]
check('suspended, with why — marks hidden until graded', a?.status === 'suspended' && a.suspendedReason === 'Screenshot' && a.totalMarks === null, JSON.stringify(a))
const none = await studentExamsForPortal('nobody@lms.test')
check('no account: an empty list, said so', none.account === false && none.exams.length === 0)
check('no email: refused', (await refusal(() => studentExamsForPortal(''))) === 'VALIDATION_ERROR 400')
void exBlr

step('C. over HTTP')
const express = (await import('express')).default
const portalRoutes = (await import('@/routes/portal.routes.ts')).default
const { errorMiddleware } = await import('@/middleware/error.middleware.ts')
const app = express()
app.use(express.json())
app.use('/service', portalRoutes)
app.use(errorMiddleware)
const server = await new Promise<import('node:http').Server>(resolve => { const sv = app.listen(0, '127.0.0.1', () => resolve(sv)) })
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const get = async (path: string, secret?: string) => {
  const res = await fetch(`${base}${path}`, { headers: secret ? { 'x-portal-secret': secret } : {} })
  return { status: res.status, body: await res.json().catch(() => ({})) as { data?: any; error?: { code?: string } } }
}
check('no secret: refused', (await get('/service/exams?academy=dubai')).status === 401)
const h1 = await get('/service/exams?academy=dubai', CRM_SECRET)
check('an academy\'s exams', h1.status === 200 && h1.body.data?.exams?.length === 2, JSON.stringify(h1.body).slice(0, 200))
const h2 = await get('/service/exams/student?email=sam@lms.test', CRM_SECRET)
check('a student\'s exams — /student is not taken for anything else', h2.status === 200 && h2.body.data?.exams?.length === 2, JSON.stringify(h2.body).slice(0, 200))
const h3 = await get('/service/exams?academy=x', CRM_SECRET)
check('a refusal as its code, not a server fault', h3.status === 400 && h3.body.error?.code === 'VALIDATION_ERROR', JSON.stringify(h3.body))
server.close()

await mongoose.connection.dropDatabase()
await mongoose.disconnect()
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)

export {}
