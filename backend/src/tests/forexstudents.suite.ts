/* ─────────────────────────────────────────────────────────────
   Every Forex student for the instructors (the user, 2026-11-10: "every forex
   student can see by the mentors also in the cs portal and lms") —
   GET /admin/users?role=student for an instructor:
     A  every Forex student of their own academy — approved into Forex, or on a
        Forex course — never another programme's, never the other academy's;
        whatever the instructor's own programme, whatever programme they ask for;
        search, the No phone and Onboarded filters still work
     B  only the table's columns: no application details, ID documents or
        anything an admin edits (the phone from the application when the account
        has none)
     C  every other list stays refused (instructors, staff, everyone);
        an admin's list as before, every column
   The app, HTTP and database are real.
   Usage (from backend/): FOREXSTUDENTS_DB_URL=mongodb://127.0.0.1:<port>/lms_forexstudents bun --no-env-file src/tests/forexstudents.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.FOREXSTUDENTS_DB_URL || 'mongodb://localhost:27017/lms_forexstudents'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.JWT_ACCESS_SECRET  = 'forexstudents-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET = 'forexstudents-refresh-secret-0123456789abcdef'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '90000'
process.env.ENABLE_CRON = 'false'; process.env.CLIENT_URL = 'https://lms.test'
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'WHATSAPP_API_KEY', 'GOOGLE_CLIENT_ID', 'R2_ACCESS_KEY_ID',
  'VAPID_PUBLIC_KEY', 'ROOT_ERP_API_URL', 'ROOT_ERP_SECRET', 'COMMISSION_API_URL', 'COMMISSION_S2S_SECRET']) process.env[k] = ''
export {}

let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const section = (n: string) => console.log(`\n${n}`)
const j = (v: unknown) => String(JSON.stringify(v)).slice(0, 500)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_forexstudents') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, path: string, jar?: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar?.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0 && jar) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}

try {
  const PW = 'CorrectHorse1', hash = await hashPassword(PW)
  const dubai = await M.OrganizationModel.create({ name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' } as any)
  const blr = await M.OrganizationModel.create({ name: 'Delta Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer' } as any)
  const mk = (o: Record<string, unknown>, org: any = dubai) => M.UserModel.create({ passwordHash: hash, isActive: true, isVerified: true, organizationId: org._id, ...o } as any)
  await mk({ name: 'Fx Mentor', email: 'fx@fs.local', role: 'instructor', category: '4x-trading' })
  await mk({ name: 'Ai Mentor', email: 'ai@fs.local', role: 'instructor', category: 'ai' })
  await mk({ name: 'No Programme Mentor', email: 'none@fs.local', role: 'instructor' })
  await mk({ name: 'Admin', email: 'admin@fs.local', role: 'admin' })
  const approved = await mk({ name: 'Fiona Forex', email: 'fiona@fs.local', role: 'student', enrollmentStatus: 'approved', category: '4x-trading', categories: ['4x-trading'], phone: '+971500000001',
    tetraCs: { name: 'Cee Ess', team: 'Team One', code: 'STU-0001', open: false, at: new Date() } })
  const onCourse = await mk({ name: 'Omar Oncourse', email: 'omar@fs.local', role: 'student', enrollmentStatus: 'approved', category: 'ai', categories: ['ai'],
    enrollmentApplication: { phone: '+971500000002', occupation: 'Engineer', idNumber: 'ID-SECRET-9', passportUrl: 'https://files.test/passport.png' } })
  const aiOnly = await mk({ name: 'Aisha Ai', email: 'aisha@fs.local', role: 'student', enrollmentStatus: 'approved', category: 'ai', categories: ['ai'] })
  const blrFx = await mk({ name: 'Bala Bangalore', email: 'bala@fs.local', role: 'student', enrollmentStatus: 'approved', category: '4x-trading', categories: ['4x-trading'] }, blr)
  const fxCourse = await M.CourseModel.collection.insertOne({ title: 'Forex Pro', slug: 'fx-pro', program: '4x-trading', organizationId: dubai._id } as any)
  await M.EnrollmentModel.collection.insertOne({ userId: onCourse._id, courseId: fxCourse.insertedId, organizationId: dubai._id, status: 'active', createdAt: new Date() } as any)

  const login = async (e: string): Promise<Jar> => {
    const jar: Jar = new Map(); const r = await call('POST', '/admin/auth/login', jar, { email: e, password: PW })
    if (r.status !== 200) throw new Error(`login ${e}: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }
  const fx = await login('fx@fs.local'), ai = await login('ai@fs.local'), none = await login('none@fs.local'), admin = await login('admin@fs.local')
  const names = (r: any) => (r.body?.data ?? []).map((u: any) => u.name).sort().join(', ')
  const FOREX = [approved.name, onCourse.name].sort().join(', ')

  section('A  every Forex student of their academy')
  let r = await call('GET', '/admin/users?role=student&per_page=100', fx)
  check('a Forex instructor: approved into Forex or on a Forex course — not the AI-only one, not Bangalore\'s', r.status === 200 && names(r) === FOREX && r.body.meta.total_count === 2, j(r.body))
  r = await call('GET', '/admin/users?role=student&per_page=100', ai)
  check('an AI instructor: the Forex students too (not their own programme\'s)', r.status === 200 && names(r) === FOREX, j(r.body))
  r = await call('GET', '/admin/users?role=student&per_page=100', none)
  check('an instructor with no programme: the same', r.status === 200 && names(r) === FOREX, j(r.body))
  r = await call('GET', '/admin/users?role=student&per_page=100&category=ai', fx)
  check('asking for another programme: still Forex only', r.status === 200 && names(r) === FOREX && !names(r).includes(aiOnly.name), j(r.body))
  r = await call('GET', '/admin/users?role=student&per_page=100&search=fiona', fx)
  check('…the search', r.status === 200 && names(r) === approved.name, j(r.body))
  r = await call('GET', '/admin/users?role=student&per_page=100&no_phone=true', fx)
  check('…No phone (the application\'s phone counts)', r.status === 200 && names(r) === '', j(r.body))
  check('never the other academy\'s', !names(r).includes(blrFx.name))

  section('B  only the table\'s columns')
  r = await call('GET', '/admin/users?role=student&per_page=100', fx)
  const fiona = (r.body?.data ?? []).find((u: any) => u.name === approved.name)
  const omar = (r.body?.data ?? []).find((u: any) => u.name === onCourse.name)
  check('name, email, phone, programmes, status, joined, CS · Team', !!fiona && fiona.email === 'fiona@fs.local' && fiona.phone === '+971500000001' && fiona.isActive === true
    && fiona.tetraCs?.name === 'Cee Ess' && Array.isArray(fiona.categories) && !!fiona.createdAt && !!fiona.id, j(fiona))
  check('…the Forex course shown as enrolled', Array.isArray(omar?.enrolledPrograms) && omar.enrolledPrograms.includes('4x-trading'), j(omar))
  check('no application details or ID documents — the application\'s phone only', JSON.stringify(omar?.enrollmentApplication) === '{"phone":"+971500000002"}' && !JSON.stringify(r.body).includes('ID-SECRET-9') && !JSON.stringify(r.body).includes('passport'), j(omar))
  check('nothing an admin edits (organization, verified, role ids…)', fiona && !('organizationId' in fiona) && !('isVerified' in fiona) && !('customRoleId' in fiona), j(fiona))

  section('C  nothing else')
  r = await call('GET', '/admin/users?role=instructor', fx)
  check('the instructors list: refused', r.status === 403, j(r.body))
  r = await call('GET', '/admin/users', fx)
  check('everyone: refused', r.status === 403, j(r.body))
  r = await call('GET', '/admin/users?role=admin', ai)
  check('staff: refused', r.status === 403, j(r.body))
  r = await call('GET', '/admin/users?role=student&per_page=100', admin)
  check('an admin: every student of the academy, as before', r.status === 200 && names(r) === [approved.name, onCourse.name, aiOnly.name].sort().join(', '), j(r.body))
  const omarAdmin = (r.body?.data ?? []).find((u: any) => u.name === onCourse.name)
  check('…every column (their application too)', omarAdmin?.enrollmentApplication?.occupation === 'Engineer', j(omarAdmin))
} catch (err) {
  fail++
  console.error(err)
} finally {
  server.close()
  await mongoose.disconnect()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
