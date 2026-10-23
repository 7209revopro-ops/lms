/* ─────────────────────────────────────────────────────────────
   Sign-up with an email code, no password (2026-10-23).
     A  a code to any address; a new code replaces the old
     B  new email + right code → account made (verified, no password, pending) and signed in
     C  wrong code: refused; 5 wrong tries burn it; a used code does not work twice
     D  an existing STUDENT: details replaced, signed in — approved stays approved,
        rejected goes back to pending; blank fields keep what was there
     E  staff email refused; no code and no password refused; email-code sign-in unchanged
   Run: bun --no-env-file src/tests/signupcode.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_signupcode'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'; process.env.OTP_DEV_ECHO = '1'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.JWT_ACCESS_SECRET  ??= 'signupcode-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'signupcode-refresh-secret-0123456789abcdef'
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
if (mongoose.connection.db!.databaseName !== 'lms_signupcode') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await M.UserModel.syncIndexes()
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
const codeFor = async (email: string) => (await call('POST', '/auth/register/code', null, { email })).body?.data?.devCode as string
const application = { phone: '+971501234567', homeCountry: 'United Arab Emirates', city: 'Dubai', programs: ['4x-trading'] }

try {
  await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })

  section('A · the code')
  const r1 = await call('POST', '/auth/register/code', null, { email: 'New@Example.com' })
  check('a code to a new address', r1.status === 200 && /^\d{6}$/.test(r1.body?.data?.devCode ?? ''), why(r1))
  const first = r1.body.data.devCode
  const second = await codeFor('new@example.com')
  check('a new code replaces the old one', (await call('POST', '/auth/register', null, { name: 'Neha New', email: 'new@example.com', emailCode: first, signupType: 'full', enrollmentApplication: application })).body?.error?.code === 'INVALID_CODE' || first === second)

  section('B · a new email')
  const jar: Jar = new Map()
  const reg = await call('POST', '/auth/register', jar, { name: 'Neha New', email: 'new@example.com', emailCode: second, signupType: 'full', enrollmentApplication: application })
  check('account made and signed in', reg.status === 201 && jar.has('lms_at'), why(reg))
  const neha = await M.UserModel.findOne({ email: 'new@example.com' }).select('+passwordHash').lean() as any
  check('...verified, no password, pending, full sign-up', neha?.isVerified === true && !neha.passwordHash && neha.enrollmentStatus === 'pending' && neha.signupType === 'full', JSON.stringify({ v: neha?.isVerified, p: !!neha?.passwordHash, s: neha?.enrollmentStatus, t: neha?.signupType }))
  check('...application kept', neha?.enrollmentApplication?.phone === '+971501234567' && neha.enrollmentApplication.city === 'Dubai')
  check('the same code a second time: refused', (await call('POST', '/auth/register', null, { name: 'Neha', email: 'new@example.com', emailCode: second, enrollmentApplication: application })).body?.error?.code === 'INVALID_CODE')

  section('C · wrong codes')
  const good = await codeFor('try@example.com')
  const wrong = good === '000000' ? '111111' : '000000'
  check('a wrong code: refused', (await call('POST', '/auth/register', null, { name: 'Tia Try', email: 'try@example.com', emailCode: wrong, enrollmentApplication: application })).body?.error?.code === 'INVALID_CODE')
  for (let i = 0; i < 4; i++) await call('POST', '/auth/register', null, { name: 'Tia Try', email: 'try@example.com', emailCode: wrong, enrollmentApplication: application })
  check('after 5 wrong tries the right code no longer works', (await call('POST', '/auth/register', null, { name: 'Tia Try', email: 'try@example.com', emailCode: good, enrollmentApplication: application })).body?.error?.code === 'INVALID_CODE')
  check('...and no account was made', !(await M.UserModel.exists({ email: 'try@example.com' })))

  section('D · an existing student')
  const hash = await hashPassword('CorrectHorse1')
  await M.UserModel.create({ name: 'Old Name', email: 'old@example.com', passwordHash: hash, role: 'student', isActive: true, enrollmentStatus: 'approved', enrollmentApplication: { phone: '+971500000000', city: 'Sharjah', occupation: 'Engineer' } })
  const oj: Jar = new Map()
  const up = await call('POST', '/auth/register', oj, { name: 'New Name', email: 'old@example.com', emailCode: await codeFor('old@example.com'), signupType: 'full', enrollmentApplication: { phone: '+971509999999', city: 'Dubai' } })
  check('no "email already exists": signed in instead', up.status === 201 && oj.has('lms_at'), why(up))
  const old = await M.UserModel.findOne({ email: 'old@example.com' }).lean() as any
  check('...details replaced with what was entered', old.name === 'New Name' && old.enrollmentApplication.phone === '+971509999999' && old.enrollmentApplication.city === 'Dubai', JSON.stringify(old.enrollmentApplication))
  check('...a field left blank keeps what was there', old.enrollmentApplication.occupation === 'Engineer')
  check('...approved stays approved', old.enrollmentStatus === 'approved')
  await M.UserModel.create({ name: 'Rejected', email: 'rej@example.com', role: 'student', isActive: true, enrollmentStatus: 'rejected', rejectionReason: 'incomplete' })
  await call('POST', '/auth/register', null, { name: 'Rejected Again', email: 'rej@example.com', emailCode: await codeFor('rej@example.com'), enrollmentApplication: application })
  const rej = await M.UserModel.findOne({ email: 'rej@example.com' }).lean() as any
  check('a rejected application goes back to pending', rej.enrollmentStatus === 'pending' && !rej.rejectionReason, JSON.stringify({ s: rej.enrollmentStatus, r: rej.rejectionReason }))

  section('E · refusals; sign-in')
  await M.UserModel.create({ name: 'Mentor', email: 'mentor@example.com', role: 'instructor', isActive: true })
  check('a staff email is refused', (await call('POST', '/auth/register', null, { name: 'X Y', email: 'mentor@example.com', emailCode: await codeFor('mentor@example.com'), enrollmentApplication: application })).body?.error?.code === 'EMAIL_NOT_STUDENT')
  check('no code and no password: refused', (await call('POST', '/auth/register', null, { name: 'X Y', email: 'z@example.com', enrollmentApplication: application })).status === 422
    || (await call('POST', '/auth/register', null, { name: 'X Y', email: 'z@example.com', enrollmentApplication: application })).status === 400)
  const otp = await call('POST', '/auth/otp/request', null, { email: 'new@example.com' })
  /* The device it signed up on (a brand-new device would wait for an admin — the 2-device rule). */
  const sj: Jar = new Map([...jar].filter(([k]) => k === 'lms_device'))
  const signIn = await call('POST', '/auth/otp/verify', sj, { email: 'new@example.com', code: otp.body?.data?.devCode })
  check('the new (password-less) account signs in with an email code', signIn.status === 200 && sj.has('lms_at'), why(signIn))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
