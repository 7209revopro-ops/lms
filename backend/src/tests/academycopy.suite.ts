/* ─────────────────────────────────────────────────────────────
   No enrolling a student in the OTHER academy's copy of a course their own
   academy runs (utils/academyCourseCopy.ts; POST /admin/users/:id/enrollments
   and POST /admin/users with courses[]).

     A. Dubai student → Bangalore copy of a course Dubai also runs: 409
        WRONG_ACADEMY_COPY naming the Dubai copy; nothing written;
     B. Dubai student → their own Dubai course: allowed;
     C. Dubai student → a course only Bangalore runs (AI Academy): allowed;
     D. Bangalore student → Dubai course whose Bangalore copy is a draft: allowed;
     E. creating a Dubai student with the Bangalore copy ticked: 409, no account.
   Run: bun --no-env-file src/tests/academycopy.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_academycopy'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.GOOGLE_CLIENT_ID = ''; process.env.GOOGLE_REFRESH_TOKEN = ''; process.env.CLT_BASE_URL = ''
process.env.JWT_ACCESS_SECRET  ??= 'academycopy-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'academycopy-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_academycopy') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null; try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'

try {
  const dxb = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const sa = await M.UserModel.create({ name: 'SA', email: 'sa@ac.local', passwordHash: hash, role: 'super_admin', isActive: true, isVerified: true })
  const course = (title: string, org: any, status = 'published') => M.CourseModel.create({ title, slug: `${title}-${org.slug}-${Math.random()}`.replace(/\W+/g, '-'), description: 'd',
    instructorId: sa._id, price: 0, isFree: true, status, language: 'English', organizationId: org._id })
  const mbtD = await course('MARKET BREAK-OUT TRADING PROGRAM', dxb), mbtB = await course('MARKET BREAK-OUT TRADING PROGRAM', blr)
  const aiB  = await course('AI Academy - Malayalam', blr)
  const dwtD = await course('DELTA WAVE THEORY TRADING PROGRAMME', dxb); await course('DELTA WAVE THEORY TRADING PROGRAMME', blr, 'draft')
  const stu = (tag: string, org: any) => M.UserModel.create({ name: tag, email: `${tag}@ac.local`, passwordHash: hash, role: 'student', isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org._id })
  const manoj = await stu('manoj', dxb), nazeem = await stu('nazeem', blr)
  const jar: Jar = new Map()
  const login = await call('POST', '/admin/auth/login', { jar, body: { email: sa.email, password: PW } })
  if (login.status !== 200) throw new Error('login ' + why(login))
  const enrol = (u: any, c: any) => call('POST', `/admin/users/${u._id}/enrollments`, { jar, body: { courseId: String(c._id) } })

  section('A · Dubai student → Bangalore copy')
  const a = await enrol(manoj, mbtB)
  check('409 WRONG_ACADEMY_COPY', a.status === 409 && a.body?.error?.code === 'WRONG_ACADEMY_COPY', why(a))
  check('message names the Dubai copy', /Dubai Academy/.test(a.body?.error?.message ?? ''), a.body?.error?.message)
  check('nothing written', !(await M.EnrollmentModel.exists({ userId: manoj._id, courseId: mbtB._id })))

  section('B · own academy course')
  const b = await enrol(manoj, mbtD)
  check('enrolled', b.status === 201, why(b))

  section('C · a course only the other academy runs (AI Academy)')
  const c = await enrol(manoj, aiB)
  check('enrolled', c.status === 201, why(c))

  section("D · own academy's copy is a draft")
  const d = await enrol(nazeem, dwtD)
  check('enrolled', d.status === 201, why(d))

  section('E · creating a Dubai student with the Bangalore copy ticked')
  const e = await call('POST', '/admin/users', { jar, body: { name: 'New One', email: 'new1@ac.local', password: PW, role: 'student',
    organizationId: String(dxb._id), categories: ['4x-trading'], courses: [{ courseId: String(mbtB._id), blockedLessons: [] }] } })
  check('409 WRONG_ACADEMY_COPY', e.status === 409 && e.body?.error?.code === 'WRONG_ACADEMY_COPY', why(e))
  check('no account created', !(await M.UserModel.exists({ email: 'new1@ac.local' })))
  const e2 = await call('POST', '/admin/users', { jar, body: { name: 'New Two', email: 'new2@ac.local', password: PW, role: 'student',
    organizationId: String(dxb._id), categories: ['4x-trading'], courses: [{ courseId: String(mbtD._id), blockedLessons: [] }] } })
  check('with the Dubai copy: created and enrolled', e2.status === 201 && !!(await M.EnrollmentModel.exists({ courseId: mbtD._id, userId: (await M.UserModel.findOne({ email: 'new2@ac.local' }))?._id })), why(e2))
} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
