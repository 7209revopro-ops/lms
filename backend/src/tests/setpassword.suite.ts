/* ─────────────────────────────────────────────────────────────
   An admin sets a student's password (POST /admin/users/:id/set-password).
     A. an admin sets it: the student signs in with the new one, not the old;
        every session is ended; they are emailed it (urgent); it is audited,
        never with the password
     B. who may: a sub-admin for students of its own programme only; not
        support or a mentor; not another academy's admin
     C. only a student's; at least 8 characters
   Run: bun --no-env-file src/tests/setpassword.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_setpassword'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.SMTP_BACKUP_USER = ''; process.env.SMTP_BACKUP_PASS = ''
process.env.EMAIL_OUTBOX = 'on'
process.env.JWT_ACCESS_SECRET  ??= 'setpassword-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'setpassword-refresh-secret-0123456789abcdef'
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
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_setpassword') { console.error('REFUSING TO RUN'); process.exit(1) }
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
const OLD = 'OldPassword1', NEW = 'BrandNew-2026'

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(OLD)
  const mk = (email: string, role: string, extra: Record<string, unknown> = {}) => M.UserModel.create({
    name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: dubai._id,
    ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}), ...extra })
  await mk('admin@sp.local', 'admin')
  await mk('fxsub@sp.local', 'sub_admin', { program: 'forex' })
  await mk('support@sp.local', 'support')
  await mk('mentor@sp.local', 'instructor')
  await mk('blradmin@sp.local', 'admin', { organizationId: blr._id })
  const fx = await mk('fx@sp.local', 'student', { category: '4x-trading', categories: ['4x-trading'] })
  const dm = await mk('dm@sp.local', 'student', { category: 'digital-marketing', categories: ['digital-marketing'] })
  const staff = await mk('staff@sp.local', 'admin')
  const login = async (email: string, pw = OLD, path = '/admin/auth/login') => { const j: Jar = new Map(); const r = await call('POST', path, j, { email, password: pw }); return { jar: j, status: r.status } }
  const admin = (await login('admin@sp.local')).jar

  section('A · an admin sets a student\'s password')
  const before = await login('fx@sp.local', OLD, '/auth/login')
  check('the student is signed in with the old password', before.status === 200)
  const r = await call('POST', `/admin/users/${fx._id}/set-password`, admin, { password: NEW })
  check('200', r.status === 200 && r.body?.data?.email === 'fx@sp.local', why(r))
  /* Accepted = past the password check. A 403 DEVICE_PENDING here is the two-device limit (each test login looks
     like a new device), not the password; a wrong password is 401. */
  { const j: Jar = new Map(); const l = await call('POST', '/auth/login', j, { email: 'fx@sp.local', password: NEW })
    check('the new password is accepted', l.status === 200 || l.body?.error?.code === 'DEVICE_PENDING', why(l)) }
  check('the old one does not', (await login('fx@sp.local', OLD, '/auth/login')).status === 401)
  const refresh = await call('POST', '/auth/refresh', before.jar)
  check('the earlier session is ended (its refresh is refused)', refresh.status === 401 || refresh.status === 403, why(refresh))
  const mail = await M.EmailOutboxModel.findOne({ to: 'fx@sp.local', subject: 'Your new Delta password' }).lean() as any
  check('they are emailed the new password, as urgent mail', !!mail && mail.priority === 10 && String(mail.html).includes(NEW), JSON.stringify({ p: mail?.priority }))
  const aud = await M.AuditLogModel.findOne({ action: 'user.setPassword' }).lean() as any
  check('audited — without the password', !!aud && !JSON.stringify(aud).includes(NEW))

  section('B · who may')
  const sub = (await login('fxsub@sp.local')).jar
  const s1 = await call('POST', `/admin/users/${fx._id}/set-password`, sub, { password: 'SubSet-12345' })
  check('a Forex sub-admin: a Forex student — yes', s1.status === 200, why(s1))
  const s2 = await call('POST', `/admin/users/${dm._id}/set-password`, sub, { password: 'SubSet-12345' })
  check('...a Digital Marketing student — no', s2.status === 404 || s2.status === 403, why(s2))
  const sup = await call('POST', `/admin/users/${fx._id}/set-password`, (await login('support@sp.local')).jar, { password: 'Support-12345' })
  check('support — no', sup.status === 403, why(sup))
  const men = await call('POST', `/admin/users/${fx._id}/set-password`, (await login('mentor@sp.local')).jar, { password: 'Mentor-12345' })
  check('a mentor — no', men.status === 403, why(men))
  const other = await call('POST', `/admin/users/${fx._id}/set-password`, (await login('blradmin@sp.local')).jar, { password: 'Other-12345' })
  check('another academy\'s admin — no', other.status === 403 || other.status === 404, why(other))

  section('C · what')
  const st = await call('POST', `/admin/users/${staff._id}/set-password`, admin, { password: 'Staff-123456' })
  check('a staff account — refused', st.status === 400 && st.body?.error?.code === 'NOT_A_STUDENT', why(st))
  const short = await call('POST', `/admin/users/${fx._id}/set-password`, admin, { password: 'short' })
  check('under 8 characters — refused', short.status === 400 || short.status === 422, why(short))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await new Promise(r => setTimeout(r, 300))
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
