/* ─────────────────────────────────────────────────────────────
   "View as student" READ & WRITE (the user, 2026-10-09) — auth.middleware.ts denyImpersonatedWrite.

     A. read-only stays read-only: the admin's default and the portal's default refuse every write
     B. a read & write session started by an admin changes things for the student, and each change is
        audited as user.impersonate.write naming the admin; /auth/me says read & write
     C. even then: password, email, 2FA, sessions, deleting the account, checkout/orders, ID uploads refused
     D. the commission portal's "Act as student" (/service/students/view { mode: 'write' }) does the same,
        naming the CS
   Run: bun --no-env-file src/tests/impersonatewrite.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.IMPWRITE_DATABASE_URL ?? 'mongodb://localhost:27017/lms_impersonatewrite'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.SMTP_BACKUP_USER = ''; process.env.SMTP_BACKUP_PASS = ''
process.env.JWT_ACCESS_SECRET  ??= 'impersonatewrite-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'impersonatewrite-suite-refresh-secret-0123456789'
const SECRET = 'impersonatewrite-suite-portal-secret-0123456789'
process.env.ROOT_ERP_SECRET = SECRET
process.env.PORTAL_SUPPORT_USER_EMAIL = 'desk@lms.test'
process.env.CLIENT_URL = 'https://learn.lms.test/'

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
if (mongoose.connection.db!.databaseName !== 'lms_impersonatewrite') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar | null, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0 && jar) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const code = (r: { body: any }) => r.body?.error?.code ?? r.body?.code
const PW = 'CorrectHorse1'

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (name: string, email: string, role: string) => M.UserModel.create({ name, email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: org._id, ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}) })
  await mk('Super', 'super@lms.test', 'super_admin')
  await mk('Delta Support', 'desk@lms.test', 'support')
  const sam = await mk('Sam Student', 'sam@lms.test', 'student')
  const admin: Jar = new Map()
  if ((await call('POST', '/admin/auth/login', admin, { email: 'super@lms.test', password: PW })).status !== 200) throw new Error('admin login')

  /** A browser inside the student app, through the handoff code. */
  const enter = async (codeOrUrl: string) => {
    const c = codeOrUrl.includes('code=') ? new URL(codeOrUrl).searchParams.get('code')! : codeOrUrl
    const b: Jar = new Map()
    const r = await call('POST', '/auth/impersonation/redeem', b, { code: c })
    if (r.status !== 200) throw new Error(`redeem ${r.status} ${JSON.stringify(r.body)}`)
    return b
  }
  const headline = async (b: Jar, text: string) => call('PATCH', '/auth/me', b, { headline: text })
  const writes = () => M.AuditLogModel.find({ action: 'user.impersonate.write' }).sort({ createdAt: 1 }).lean() as Promise<any[]>

  section('A · read-only stays read-only')
  const r0 = await call('POST', `/admin/users/${sam._id}/impersonate-client`, admin)
  const readB = await enter(r0.body?.data?.code)
  const ro = await headline(readB, 'by read-only')
  check('the admin default: a write refused as read-only', ro.status === 403 && code(ro) === 'IMPERSONATION_READ_ONLY', `${ro.status} ${code(ro)}`)
  const me0 = await call('GET', '/auth/me', readB)
  check('…/auth/me: read-only', me0.body?.data?.impersonation?.readOnly === true && me0.body?.data?.impersonation?.mode === 'read')
  const p0 = await call('POST', '/service/students/view', null, { email: 'sam@lms.test', byName: 'Cara CS', byEmail: 'cara@portal.test' }, { 'x-portal-secret': SECRET })
  const pro = await headline(await enter(p0.body?.data?.url), 'by portal read')
  check('the portal default: read-only too', p0.body?.data?.mode === 'read' && pro.status === 403 && code(pro) === 'IMPERSONATION_READ_ONLY')

  section('B · read & write from the LMS admin')
  const r1 = await call('POST', `/admin/users/${sam._id}/impersonate-client`, admin, { mode: 'write' })
  check('started read & write', r1.status === 200 && r1.body?.data?.mode === 'write' && (await M.ImpersonationSessionModel.findById(r1.body?.data?.impersonationId).lean() as any)?.mode === 'write')
  const writeB = await enter(r1.body?.data?.code)
  const ok = await headline(writeB, 'set by the admin')
  check('a change goes through', ok.status === 200 && (await M.UserModel.findById(sam._id).lean() as any)?.headline === 'set by the admin', `${ok.status} ${JSON.stringify(ok.body).slice(0, 200)}`)
  await new Promise(r => setTimeout(r, 300))
  const w1 = (await writes()).at(-1)
  check('…audited as the admin, on the student', w1?.actorEmail === 'super@lms.test' && String(w1?.entityId) === String(sam._id) && w1?.meta?.path === '/auth/me' && w1?.meta?.method === 'PATCH' && w1?.meta?.status === 200, JSON.stringify(w1))
  const me1 = await call('GET', '/auth/me', writeB)
  check('…/auth/me: read & write', me1.body?.data?.impersonation?.readOnly === false && me1.body?.data?.impersonation?.mode === 'write')
  const fav = await call('POST', '/favorites', writeB, { courseId: String(new mongoose.Types.ObjectId()) })
  check('…another write is not refused as read-only (whatever the route answers)', code(fav) !== 'IMPERSONATION_READ_ONLY' && code(fav) !== 'IMPERSONATION_WRITE_BLOCKED', `${fav.status} ${code(fav)}`)

  section('C · still refused in read & write')
  const blocked: Array<[string, string, unknown]> = [
    ['PATCH', '/auth/me/password', { currentPassword: PW, newPassword: 'NewHorse12345' }],
    ['PATCH', '/auth/me/email', { email: 'new@lms.test' }],
    ['PATCH', '/auth/me/enrollment-docs', {}],
    ['POST', '/auth/2fa/setup', {}],
    ['DELETE', `/auth/sessions/${new mongoose.Types.ObjectId()}`, undefined],
    ['POST', '/auth/logout-all', {}],
    ['POST', '/auth/deactivate', { password: PW }],
    ['DELETE', '/auth/account', { password: PW }],
    ['POST', '/checkout', { courseId: 'x' }],
    ['POST', '/checkout/abzer/create-order', {}],
    ['POST', '/uploads/kyc', {}],
  ]
  for (const [m, p, b] of blocked) {
    const r = await call(m, p, writeB, b)
    check(`${m} ${p}: refused`, r.status === 403 && code(r) === 'IMPERSONATION_WRITE_BLOCKED', `${r.status} ${code(r)}`)
  }
  check('…the password is unchanged', (await call('POST', '/auth/login', new Map(), { email: 'sam@lms.test', password: PW })).status === 200)

  section('D · "Act as student" from the commission portal')
  const p1 = await call('POST', '/service/students/view', null, { email: 'sam@lms.test', byName: 'Cara CS', byEmail: 'cara@portal.test', mode: 'write' }, { 'x-portal-secret': SECRET })
  check('started read & write', p1.status === 200 && p1.body?.data?.mode === 'write')
  const csB = await enter(p1.body?.data?.url)
  const okp = await headline(csB, 'set by the CS')
  await new Promise(r => setTimeout(r, 300))
  const w2 = (await writes()).at(-1)
  check('a change goes through, audited as the CS', okp.status === 200 && w2?.actorEmail === 'cara@portal.test' && w2?.meta?.path === '/auth/me', JSON.stringify(w2))
  const blk = await call('PATCH', '/auth/me/password', csB, { currentPassword: PW, newPassword: 'NewHorse12345' })
  check('…and the password still locked', blk.status === 403 && code(blk) === 'IMPERSONATION_WRITE_BLOCKED')
  const audit = await M.AuditLogModel.findOne({ action: 'user.impersonate.client', 'meta.mode': 'write' }).lean() as any
  check('the start is audited with its mode', audit?.meta?.byEmail === 'cara@portal.test')
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
