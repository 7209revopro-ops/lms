/* ─────────────────────────────────────────────────────────────
   An admin sets a student's phone (Add / Edit student) → it lands where
   WhatsApp reads it (enrollmentApplication.phone) as well as on the account;
   '' clears both. Run: bun --no-env-file src/tests/studentphone.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_studentphone'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'; process.env.WHATSAPP_API_KEY = ''
process.env.JWT_ACCESS_SECRET  ??= 'phone-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'phone-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
const lines: string[] = []
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; lines.push(`  PASS  ${l}`) } else { fail++; lines.push(`  FAIL  ${l}${d ? '  — ' + d : ''}`) } }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_studentphone') process.exit(1)
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
const jar = new Map<string, string>()
async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(`${BASE}${p}`, { method, headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let b: any = null; try { b = await res.json() } catch { /* */ }
  return { status: res.status, body: b }
}
const why = (r: any) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''} ${JSON.stringify(r.body?.error?.details ?? '')}`
try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  await M.UserModel.create({ name: 'SA', email: 'sa@sp.local', passwordHash: await hashPassword('CorrectHorse1'), role: 'super_admin', isActive: true, isVerified: true })
  const l = await call('POST', '/admin/auth/login', { email: 'sa@sp.local', password: 'CorrectHorse1' })
  if (l.status !== 200) throw new Error('login ' + why(l))
  const c = await call('POST', '/admin/users', { name: 'New Student', email: 'ns@sp.local', password: 'CorrectHorse1', role: 'student', categories: ['4x-trading'], organizationId: String(org._id), phone: '+971 50 123 4567' })
  check('create with phone: 201', c.status === 201, why(c))
  let u = await M.UserModel.findOne({ email: 'ns@sp.local' }).lean() as any
  check('…on the account and where WhatsApp reads it', u?.phone === '+971 50 123 4567' && u?.enrollmentApplication?.phone === '+971 50 123 4567', JSON.stringify({ p: u?.phone, a: u?.enrollmentApplication }))
  const e = await call('PATCH', `/admin/users/${u._id}`, { phone: '+919526288116' })
  u = await M.UserModel.findById(u._id).lean() as any
  check('edit: both updated', e.status === 200 && u.phone === '+919526288116' && u.enrollmentApplication?.phone === '+919526288116', why(e))
  const x = await call('PATCH', `/admin/users/${u._id}`, { phone: '' })
  u = await M.UserModel.findById(u._id).lean() as any
  check("edit with '': both cleared", x.status === 200 && !u.phone && !u.enrollmentApplication?.phone, why(x) + JSON.stringify(u.enrollmentApplication))
} catch (err) { fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}`) }
finally { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close() }
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
