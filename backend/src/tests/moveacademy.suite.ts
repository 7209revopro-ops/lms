/* ─────────────────────────────────────────────────────────────
   Moving a student to another academy (PATCH /admin/users/:id/academy,
   UserService.adminMoveStudentAcademy).

   Over HTTP, against a real database:
     A. a super admin moves a Dubai student to Bangalore: the account and
        every enrolment row move, the course itself stays Dubai's, and the
        move is audited with from / to;
     B. the student's own session follows at once (auth re-reads the record);
     C. refused: an academy admin (403), a staff account (400), the academy
        they are already in (409), an unknown academy (404), no academy (422).
   Run: bun --no-env-file src/tests/moveacademy.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_moveacademy'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.JWT_ACCESS_SECRET  ??= 'moveacademy-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'moveacademy-suite-refresh-secret-0123456789'

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
if (mongoose.connection.db!.databaseName !== 'lms_moveacademy') { console.error('REFUSING TO RUN'); process.exit(1) }
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
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW)
  const make = (name: string, role: string, org?: unknown) =>
    M.UserModel.create({ name, email: `${name}@ma.local`, passwordHash: hash, role, isActive: true, isVerified: true, enrollmentStatus: 'approved', ...(org ? { organizationId: org } : {}) })
  await make('sa', 'super_admin')
  await make('ad', 'admin', dxb._id)
  const mentor = await make('mentor', 'instructor', dxb._id)
  const priya  = await make('priya', 'student', dxb._id)
  const course = await M.CourseModel.create({
    title: 'MBT', slug: 'mbt-dxb', description: 'x', instructorId: mentor._id, organizationId: dxb._id,
    price: 0, currency: 'AED', status: 'published', category: 'Forex', level: 'beginner',
  } as never)
  await M.EnrollmentModel.create({ userId: priya._id, courseId: course._id, organizationId: dxb._id } as never)

  const login = async (email: string, path = '/admin/auth/login') => {
    const j: Jar = new Map(); const r = await call('POST', path, { jar: j, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${email} ${why(r)}`); return j
  }
  const SA = await login('sa@ma.local'), AD = await login('ad@ma.local')
  const ST = await login('priya@ma.local', '/auth/login')   // signed in BEFORE the move

  section('A · a super admin moves a Dubai student to Bangalore')
  const a = await call('PATCH', `/admin/users/${priya._id}/academy`, { jar: SA, body: { organizationId: String(blr._id) } })
  check('200, from Dubai to Bangalore, 1 enrolment', a.status === 200 && a.body?.data?.from?.name === 'Dubai Academy'
    && a.body?.data?.to?.name === 'Bangalore Academy' && a.body?.data?.enrollments === 1, why(a) + JSON.stringify(a.body?.data))
  const u = await M.UserModel.findById(priya._id).select('organizationId').lean() as any
  check('the account is Bangalore\'s', String(u?.organizationId) === String(blr._id))
  const e = await M.EnrollmentModel.findOne({ userId: priya._id }).lean() as any
  check('the enrolment row is Bangalore\'s, same course', String(e?.organizationId) === String(blr._id) && String(e?.courseId) === String(course._id))
  const c = await M.CourseModel.findById(course._id).select('organizationId').lean() as any
  check('the course itself stays Dubai\'s', String(c?.organizationId) === String(dxb._id))
  await new Promise(r => setTimeout(r, 300))
  const trail = await M.AuditLogModel.findOne({ action: 'user.moveAcademy' }).lean() as any
  check('audited: who, which student, from and to', trail?.actorEmail === 'sa@ma.local' && String(trail?.entityId) === String(priya._id)
    && trail?.meta?.fromAcademy === 'Dubai Academy' && trail?.meta?.toAcademy === 'Bangalore Academy', JSON.stringify(trail))

  section('B · the student\'s session follows at once')
  const me = await call('GET', '/auth/me', { jar: ST })
  const org = me.body?.data?.organizationId ?? me.body?.data?.user?.organizationId
  check('a session opened before the move: /auth/me reports Bangalore', String(org) === String(blr._id), why(me) + JSON.stringify(me.body?.data))

  section('C · refused')
  const r1 = await call('PATCH', `/admin/users/${priya._id}/academy`, { jar: AD, body: { organizationId: String(dxb._id) } })
  check('an academy admin: 403', r1.status === 403, why(r1))
  const r2 = await call('PATCH', `/admin/users/${mentor._id}/academy`, { jar: SA, body: { organizationId: String(blr._id) } })
  check('a staff account: 400 NOT_A_STUDENT', r2.status === 400 && r2.body?.error?.code === 'NOT_A_STUDENT', why(r2))
  const r3 = await call('PATCH', `/admin/users/${priya._id}/academy`, { jar: SA, body: { organizationId: String(blr._id) } })
  check('the academy they are already in: 409', r3.status === 409 && r3.body?.error?.code === 'ALREADY_IN_ACADEMY', why(r3))
  const r4 = await call('PATCH', `/admin/users/${priya._id}/academy`, { jar: SA, body: { organizationId: String(new mongoose.Types.ObjectId()) } })
  check('an unknown academy: 404', r4.status === 404 && r4.body?.error?.code === 'ACADEMY_NOT_FOUND', why(r4))
  const r5 = await call('PATCH', `/admin/users/${priya._id}/academy`, { jar: SA, body: {} })
  check('no academy: 422', r5.status === 422, why(r5))
  const still = await M.UserModel.findById(priya._id).select('organizationId').lean() as any
  check('nothing refused changed anything', String(still?.organizationId) === String(blr._id))
  const back = await call('PATCH', `/admin/users/${priya._id}/academy`, { jar: SA, body: { organizationId: String(dxb._id) } })
  check('and moving back works (the undo)', back.status === 200 && back.body?.data?.to?.name === 'Dubai Academy', why(back))
} catch (err) {
  fail++; lines.push(`  FAIL  suite crashed — ${(err as Error).stack ?? err}`)
} finally {
  server.close()
  await mongoose.connection.db!.dropDatabase().catch(() => {})
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
