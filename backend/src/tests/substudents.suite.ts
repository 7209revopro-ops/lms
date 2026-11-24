/* ─────────────────────────────────────────────────────────────
   A department's sub admin manages its students (2026-11-24)

     A. the Students list: their department's students only
     B. add a student: allowed, and put in their department whatever is asked
     C. edit: name, email, phone, sign-in on/off for their own students;
        their own department's programme on or off — nothing else
     D. refused: another department's student, a staff account, the role,
        another department's programme; an instructor is refused as before;
        an admin unchanged
   Run: bun --no-env-file src/tests/substudents.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_substudents'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.JWT_ACCESS_SECRET  ??= 'substudents-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'substudents-suite-refresh-secret-0123456789'

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

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_substudents') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await M.UserModel.createIndexes()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar?: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar?.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (jar) for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (name: string, email: string, role: string, extra: Record<string, unknown> = {}) =>
    M.UserModel.create({ name, email, passwordHash: hash, role, isActive: true, organizationId: org._id, ...extra } as any)
  await mk('Ada Admin', 'ada@ss.local', 'admin')
  await mk('Lee Lead', 'lead@ss.local', 'sub_admin', { program: 'cma' })
  await mk('Ivy Instructor', 'ivy@ss.local', 'instructor', { category: 'cma', categories: ['cma'] })
  const st = (name: string, cats: string[]) => mk(name, `${name.toLowerCase()}@ss.local`, 'student', { enrollmentStatus: 'approved', category: cats[0], categories: cats })
  const ana = await st('Ana', ['cma'])
  const bo  = await st('Bo', ['cma', '4x-trading'])
  const fox = await st('Fox', ['4x-trading'])
  const ivy = await M.UserModel.findOne({ email: 'ivy@ss.local' }).lean() as any

  const jars: Record<string, Jar> = {}
  for (const who of ['ada', 'lead', 'ivy']) {
    jars[who] = new Map()
    const r = await call('POST', '/admin/auth/login', jars[who], { email: `${who}@ss.local`, password: PW })
    check(`(${who} signs in)`, r.status === 200, why(r))
  }

  section('A · the Students list')
  const list = await call('GET', '/admin/users?role=student&per_page=50', jars['lead'])
  const names = (list.body?.data ?? []).map((u: any) => u.name).sort()
  check('their department only: Ana and Bo, not Fox', list.status === 200 && JSON.stringify(names) === JSON.stringify(['Ana', 'Bo']), `${why(list)} ${JSON.stringify(names)}`)

  section('B · add a student')
  const add = await call('POST', '/admin/users', jars['lead'], { name: 'Cy New', email: 'cy@ss.local', password: 'Password123', role: 'student', categories: ['ai'] })
  check('a sub admin adds a student', add.status === 201, why(add))
  const cy = await M.UserModel.findOne({ email: 'cy@ss.local' }).lean() as any
  check('…put in their department, not the one asked for', cy?.role === 'student' && JSON.stringify(cy?.categories) === JSON.stringify(['cma']) && String(cy?.organizationId) === String(org._id), JSON.stringify({ role: cy?.role, categories: cy?.categories }))
  const addAdmin = await call('POST', '/admin/users', jars['lead'], { name: 'Not Allowed', email: 'na@ss.local', password: 'Password123', role: 'admin' })
  check('…but never an admin', addAdmin.status === 403, why(addAdmin))

  section('C · edit their own students')
  const e1 = await call('PATCH', `/admin/users/${ana._id}`, jars['lead'], { name: 'Ana Maria', phone: '+971500000001', email: 'ana.m@ss.local' })
  const a1 = await M.UserModel.findById(ana._id).lean() as any
  check('name, phone and email', e1.status === 200 && a1.name === 'Ana Maria' && a1.phone === '+971500000001' && a1.email === 'ana.m@ss.local', `${why(e1)} ${a1.name}`)
  const e2 = await call('PATCH', `/admin/users/${ana._id}`, jars['lead'], { isActive: false })
  check('block them', e2.status === 200 && (await M.UserModel.findById(ana._id).lean() as any).isActive === false, why(e2))
  const e3 = await call('PATCH', `/admin/users/${ana._id}`, jars['lead'], { isActive: true })
  check('…and unblock', e3.status === 200 && (await M.UserModel.findById(ana._id).lean() as any).isActive === true, why(e3))
  const e4 = await call('PATCH', `/admin/users/${bo._id}`, jars['lead'], { categories: ['4x-trading'] })
  const b1 = await M.UserModel.findById(bo._id).lean() as any
  check('take their own department off (Forex stays)', e4.status === 200 && JSON.stringify(b1.categories) === JSON.stringify(['4x-trading']), `${why(e4)} ${JSON.stringify(b1.categories)}`)

  section('D · refused')
  const r1 = await call('PATCH', `/admin/users/${fox._id}`, jars['lead'], { name: 'Hacked' })
  check("another department's student: 404", r1.status === 404 && (await M.UserModel.findById(fox._id).lean() as any).name === 'Fox', why(r1))
  const r2 = await call('PATCH', `/admin/users/${ivy._id}`, jars['lead'], { name: 'Hacked' })
  check('a staff account: 404', r2.status === 404, why(r2))
  const r3 = await call('PATCH', `/admin/users/${ana._id}`, jars['lead'], { role: 'instructor' })
  check('the role', r3.status === 403 && (await M.UserModel.findById(ana._id).lean() as any).role === 'student', why(r3))
  const r4 = await call('PATCH', `/admin/users/${ana._id}`, jars['lead'], { categories: ['cma', 'ai'] })
  check("adding another department's programme", r4.status === 403, why(r4))
  const r5 = await call('PATCH', `/admin/users/${cy._id}`, jars['lead'], { isVerified: true, program: 'ai' })
  check('any other field', r5.status === 403, why(r5))
  const r6 = await call('PATCH', `/admin/users/${ana._id}`, jars['ivy'], { name: 'Nope' })
  check('an instructor, as before', r6.status === 403, why(r6))
  const r7 = await call('PATCH', `/admin/users/${fox._id}`, jars['ada'], { name: 'Fox Two', categories: ['4x-trading', 'ai'] })
  check('an admin edits anyone, as before', r7.status === 200 && (await M.UserModel.findById(fox._id).lean() as any).name === 'Fox Two', why(r7))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
