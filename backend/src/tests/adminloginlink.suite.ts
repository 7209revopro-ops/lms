/* ─────────────────────────────────────────────────────────────
   An admin's one-time login link for a student (POST /admin/users/:id/
   login-link, signinLink.service.ts mintAdminLoginLink, redeemSigninLink).

   Over HTTP, against a real database:
     A. a super admin makes one: a /s/ link, 24 hours, signs in ONCE, the
        class schedule; audited;
     B. the first tap signs the student in; a second tap signs nobody in;
     C. a new link cancels the student's earlier unused hand-made one — a
        WhatsApp sign-in link is left alone and still signs in 3 times;
     D. who: an academy admin for their own student; not another academy's
        (404), not a sub_admin (403), not a staff account (404), not a
        deactivated student (400).
   Run: bun --no-env-file src/tests/adminloginlink.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_adminloginlink'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.CLIENT_URL = 'https://lms.example.test'
process.env.JWT_ACCESS_SECRET  ??= 'loginlink-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'loginlink-suite-refresh-secret-0123456789'

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
const { mintSigninCode, hashSigninCode } = await import('@/services/signinLink.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_adminloginlink') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await M.AuthTokenModel.syncIndexes()
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
const HOUR = 3_600_000
const codeOf = (url: string) => url.split('/s/')[1] ?? ''

try {
  const dxb = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW)
  const staff = (name: string, role: string, org?: unknown) =>
    M.UserModel.create({ name, email: `${name}@ll.local`, passwordHash: hash, role, isActive: true, isVerified: true, ...(org ? { organizationId: org } : {}) })
  await staff('sa', 'super_admin')
  await staff('ad', 'admin', dxb._id)
  await staff('sub', 'sub_admin', dxb._id)
  const mentor = await staff('mentor', 'instructor', dxb._id)
  const student = (name: string, org: unknown, extra: Record<string, unknown> = {}) =>
    M.UserModel.create({ name, email: `${name}@ll.local`, passwordHash: hash, role: 'student', isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org, ...extra })
  const priya = await student('priya', dxb._id)
  const anil  = await student('anil', blr._id)
  const gone  = await student('gone', dxb._id, { isActive: false })

  const login = async (email: string) => { const j: Jar = new Map(); const r = await call('POST', '/admin/auth/login', { jar: j, body: { email, password: PW } }); if (r.status !== 200) throw new Error(`login ${email} ${why(r)}`); return j }
  const SA = await login('sa@ll.local'), AD = await login('ad@ll.local'), SUB = await login('sub@ll.local')

  section('A · a super admin makes one')
  const t0 = Date.now()
  const a = await call('POST', `/admin/users/${priya._id}/login-link`, { jar: SA })
  check('200, a /s/ link on the student site', a.status === 200 && /^https:\/\/lms\.example\.test\/s\/[A-Za-z0-9_-]{20,}$/.test(a.body?.data?.url ?? ''), why(a) + ' ' + a.body?.data?.url)
  const exp = new Date(a.body?.data?.expiresAt ?? 0).getTime()
  check('expires in 24 hours', Math.abs(exp - (t0 + 24 * HOUR)) < 60_000, a.body?.data?.expiresAt)
  const tok = await M.AuthTokenModel.findOne({ tokenHash: hashSigninCode(codeOf(a.body?.data?.url ?? '')) }).lean() as any
  check('stored hashed: one sign-in, made by the admin, opens the class schedule', tok?.purpose === 'signin-link' && tok.maxUses === 1 && !!tok.issuedBy && tok.nextPath === '/class-bookings', JSON.stringify(tok))
  await new Promise(r => setTimeout(r, 300))
  const trail = await M.AuditLogModel.findOne({ action: 'user.loginLink' }).lean() as any
  check('audited', trail?.actorEmail === 'sa@ll.local' && String(trail?.entityId) === String(priya._id), JSON.stringify(trail))

  section('B · signs in once')
  const first: Jar = new Map()
  const r1 = await call('POST', '/auth/signin-link/redeem', { jar: first, body: { token: codeOf(a.body.data.url) } })
  check('first tap: signed in as priya, to the class schedule', r1.status === 200 && r1.body?.data?.signedIn === true && r1.body?.data?.next === '/class-bookings' && first.has('lms_at'), why(r1) + JSON.stringify(r1.body?.data))
  const again: Jar = new Map(first.has('lms_device') ? [['lms_device', first.get('lms_device')!]] : [])
  const r2 = await call('POST', '/auth/signin-link/redeem', { jar: again, body: { token: codeOf(a.body.data.url) } })
  check('second tap: nobody signed in', r2.status === 200 && r2.body?.data?.signedIn === false && !again.has('lms_at'), why(r2) + JSON.stringify(r2.body?.data))

  section('C · a new link cancels the earlier unused one; WhatsApp links untouched')
  const wa = await mintSigninCode(String(priya._id), '/my-bookings')
  const old = await call('POST', `/admin/users/${priya._id}/login-link`, { jar: SA })
  const fresh = await call('POST', `/admin/users/${priya._id}/login-link`, { jar: SA })
  check('two links made', old.status === 200 && fresh.status === 200 && old.body.data.url !== fresh.body.data.url)
  const rOld = await call('POST', '/auth/signin-link/redeem', { jar: new Map(), body: { token: codeOf(old.body.data.url) } })
  check('the earlier one no longer works', rOld.status === 400 && rOld.body?.error?.code === 'SIGNIN_LINK_EXPIRED', why(rOld))
  const usedStill = await M.AuthTokenModel.countDocuments({ tokenHash: hashSigninCode(codeOf(a.body.data.url)) })
  check('a used one is kept (its record stays)', usedStill === 1)
  const device: Jar = new Map(first.has('lms_device') ? [['lms_device', first.get('lms_device')!]] : [])
  const rNew = await call('POST', '/auth/signin-link/redeem', { jar: device, body: { token: codeOf(fresh.body.data.url) } })
  check('the newest one signs in', rNew.status === 200 && rNew.body?.data?.signedIn === true, why(rNew))
  let waOk = 0
  for (let i = 0; i < 3; i++) {
    const j: Jar = new Map(first.has('lms_device') ? [['lms_device', first.get('lms_device')!]] : [])
    const r = await call('POST', '/auth/signin-link/redeem', { jar: j, body: { token: wa } })
    if (r.status === 200 && r.body?.data?.signedIn === true) waOk++
  }
  check('the WhatsApp link still signs in 3 times', waOk === 3, String(waOk))

  section('D · who may make one')
  const own = await call('POST', `/admin/users/${priya._id}/login-link`, { jar: AD })
  check('academy admin, own student: 200', own.status === 200 && !!own.body?.data?.url, why(own))
  const other = await call('POST', `/admin/users/${anil._id}/login-link`, { jar: AD })
  check("academy admin, another academy's student: 404", other.status === 404, why(other))
  const sub = await call('POST', `/admin/users/${priya._id}/login-link`, { jar: SUB })
  check('sub_admin: 403', sub.status === 403, why(sub))
  const st = await call('POST', `/admin/users/${mentor._id}/login-link`, { jar: SA })
  check('a staff account: 404', st.status === 404, why(st))
  const off = await call('POST', `/admin/users/${gone._id}/login-link`, { jar: SA })
  check('a deactivated student: 400', off.status === 400 && off.body?.error?.code === 'STUDENT_BLOCKED', why(off))
  const anon = await call('POST', `/admin/users/${priya._id}/login-link`)
  check('signed out: 401', anon.status === 401, why(anon))
} catch (err) {
  fail++; lines.push(`  FAIL  crashed — ${(err as Error).stack}`)
} finally {
  server.close()
  await mongoose.connection.db?.dropDatabase().catch(() => {})
  await mongoose.disconnect()
  console.log(lines.join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
