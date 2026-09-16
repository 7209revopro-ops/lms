/* ─────────────────────────────────────────────────────────────
   Admin-portal forgot / reset password.

   The admin portal now has its own forgot-password flow: POST
   /admin/auth/forgot-password mails a reset link that points at the ADMIN app
   (ADMIN_URL) and is issued only for staff accounts, while the reset step
   (POST /admin/auth/reset-password) shares the portal-agnostic reset service.
   The client flow (/auth/forgot-password → CLIENT_URL) must keep working
   unchanged.

   This suite boots the REAL Express app against an ISOLATED throwaway database
   and reads the captured emails back from EMAIL_LOG_DIR, so it exercises the
   true HTTP + email + token path end to end:

     A  forgot (admin) issues a reset-password token for every staff role and
        the emailed link points at ADMIN_URL
     B  forgot (admin) is enumeration-safe and issues NOTHING for a student, an
        inactive staff account, or an unknown address
     C  forgot (client) still works and its link points at CLIENT_URL
     D  reset (admin) enforces the password policy and the 32-char token floor
     E  reset (admin) with a real emailed token changes the password, lets the
        user sign in, rejects the old password, and is single-use
     F  reset revokes existing sessions; a bad / expired token is refused
     G  issuing a second link invalidates the first

   Run: bun src/tests/adminpasswordreset.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_adminpwreset_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.CLIENT_URL   = 'http://client.test'
process.env.ADMIN_URL    = 'http://admin.test'
process.env.EMAIL_LOG_DIR = '.logs/emails-adminpwreset'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID = ''
process.env.R2_ACCESS_KEY_ID = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL = ''

export {}

import { readdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { randomBytes, createHash } from 'crypto'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, AuthTokenModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

const MAILDIR = process.env.EMAIL_LOG_DIR!
await rm(MAILDIR, { recursive: true, force: true }).catch(() => {})

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_adminpwreset_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, jar?: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar?.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text(); let b: any = text; try { b = JSON.parse(text) } catch {}
  return { status: res.status, body: b, code: String(b?.error?.code ?? ''), msg: String(b?.message ?? b?.error?.message ?? '') }
}

/* Read the newest captured email for a recipient written since a watermark,
   and pull the reset URL / token out of it. The reset mail is now dispatched
   fire-and-forget (so response latency can't leak account existence), so the
   file lands shortly AFTER the HTTP 200 — poll up to `waitMs` for it. Pass a
   short waitMs when asserting that NO mail was sent (throttle path). */
async function latestEmail(recipient: string, sinceMs: number, waitMs = 1500): Promise<{ url: string | null; token: string | null }> {
  const safe = recipient.replace(/[^a-z0-9@._-]/gi, '_')
  const deadline = Date.now() + waitMs
  for (;;) {
    let files: string[] = []
    try { files = await readdir(MAILDIR) } catch { /* dir not created yet */ }
    const mine = files.filter(f => f.includes(safe) && Number(f.split('-')[0]) >= sinceMs).sort()
    const last = mine[mine.length - 1]
    if (last) {
      const raw = await readFile(join(MAILDIR, last), 'utf8')
      const url = raw.match(/https?:\/\/[^"'\s<]*\/reset-password\?token=[A-Za-z0-9_-]+/)?.[0] ?? null
      const token = url?.match(/token=([A-Za-z0-9_-]+)/)?.[1] ?? null
      if (token) return { url, token }
    }
    if (Date.now() >= deadline) return { url: null, token: null }
    await new Promise(r => setTimeout(r, 25))
  }
}
const tokenCount = (userId: any) => AuthTokenModel.countDocuments({ userId, purpose: 'reset-password' })

const PW = 'Passw0rd!'
try {

const org = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const hash = await hashPassword(PW)
const mk = (email: string, role: string, extra: Record<string, unknown> = {}) =>
  UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: org._id, ...extra })

const superAdmin = await mk('super@apr.test',  'super_admin')
const admin      = await mk('admin@apr.test',  'admin')
const subAdmin   = await mk('subadmin@apr.test','sub_admin')
const support    = await mk('support@apr.test','support')
const instructor = await mk('instr@apr.test',  'instructor')
const student    = await mk('student@apr.test','student', { enrollmentStatus: 'approved' })
const inactive   = await mk('inactive@apr.test','admin', { isActive: false })
/* Dedicated single-use accounts for the reset sections so the per-account
   throttle (one mail per RESET_THROTTLE_MS) never collides with section A. */
const policyUser  = await mk('policy@apr.test',   'admin')
const resetUser   = await mk('resetme@apr.test',  'instructor')
const sessionUser = await mk('session@apr.test',  'support')
const throttleUser= await mk('throttle@apr.test', 'sub_admin')
const burstUser   = await mk('burst@apr.test',    'admin')
const staff = [
  { u: superAdmin, label: 'super_admin' }, { u: admin, label: 'admin' },
  { u: subAdmin, label: 'sub_admin' }, { u: support, label: 'support' }, { u: instructor, label: 'instructor' },
]

const NEUTRAL = 'If a staff account exists with that email, a reset link has been sent.'

/* ═══════════ A — forgot (admin) issues a staff token to ADMIN_URL ═══════════ */
section('A. Admin forgot-password issues a reset token for every staff role, linked to ADMIN_URL')
for (const { u, label } of staff) {
  const before = await tokenCount(u._id)
  const t0 = Date.now()
  const r = await call('POST', '/admin/auth/forgot-password', undefined, { email: u.email })
  const after = await tokenCount(u._id)
  const mail = await latestEmail(u.email, t0)
  check(`A:${label} → 200 + neutral message`, r.status === 200 && r.msg === NEUTRAL, `${r.status} "${r.msg}"`)
  check(`A:${label} a reset-password token was created`, after === before + 1, `before=${before} after=${after}`)
  check(`A:${label} email link points at ADMIN_URL`, !!mail.url && mail.url.startsWith('http://admin.test/reset-password?token='), `${mail.url}`)
}

/* ═══════════ B — forgot (admin) is enumeration-safe & staff-only ═══════════ */
section('B. Admin forgot-password issues nothing for non-staff / inactive / unknown, and never leaks')
{
  const beforeStu = await tokenCount(student._id)
  const rStu = await call('POST', '/admin/auth/forgot-password', undefined, { email: student.email })
  const afterStu = await tokenCount(student._id)
  check('B1 student → 200 neutral', rStu.status === 200 && rStu.msg === NEUTRAL, `${rStu.status} "${rStu.msg}"`)
  check('B2 student gets NO admin reset token (staff-only)', afterStu === beforeStu, `before=${beforeStu} after=${afterStu}`)

  const beforeIn = await tokenCount(inactive._id)
  const rIn = await call('POST', '/admin/auth/forgot-password', undefined, { email: inactive.email })
  const afterIn = await tokenCount(inactive._id)
  check('B3 inactive staff → 200 neutral', rIn.status === 200 && rIn.msg === NEUTRAL, `${rIn.status}`)
  check('B4 inactive staff gets NO token', afterIn === beforeIn, `before=${beforeIn} after=${afterIn}`)

  const rNone = await call('POST', '/admin/auth/forgot-password', undefined, { email: 'ghost@apr.test' })
  check('B5 unknown email → 200 neutral (no enumeration)', rNone.status === 200 && rNone.msg === NEUTRAL, `${rNone.status} "${rNone.msg}"`)

  check('B6 identical response for staff vs student vs unknown', rStu.msg === NEUTRAL && rNone.msg === NEUTRAL, 'messages differ')

  const rBad = await call('POST', '/admin/auth/forgot-password', undefined, { email: 'not-an-email' })
  check('B7 malformed email → 422 validation', rBad.status === 422, `${rBad.status} ${rBad.code}`)
}

/* ═══════════ C — client forgot still works, links to CLIENT_URL ═══════════ */
section('C. Client forgot-password is unaffected and links to CLIENT_URL')
{
  const before = await tokenCount(student._id)
  const t0 = Date.now()
  const r = await call('POST', '/auth/forgot-password', undefined, { email: student.email })
  const after = await tokenCount(student._id)
  const mail = await latestEmail(student.email, t0)
  check('C1 client forgot for a student → 200', r.status === 200, `${r.status}`)
  check('C2 issues a reset token for the student', after === before + 1, `before=${before} after=${after}`)
  check('C3 email link points at CLIENT_URL (not admin)', !!mail.url && mail.url.startsWith('http://client.test/reset-password?token='), `${mail.url}`)
}

/* ═══════════ D — reset (admin) enforces policy + token floor ═══════════ */
section('D. Admin reset-password enforces the password policy and the 32-char token floor')
{
  const t0 = Date.now()
  await call('POST', '/admin/auth/forgot-password', undefined, { email: policyUser.email })
  const { token } = await latestEmail(policyUser.email, t0)
  const weak = [
    ['too short', 'Ab1'],
    ['no uppercase', 'lowercase123'],
    ['no number', 'NoNumberHere'],
  ] as const
  for (const [why, pwd] of weak) {
    const r = await call('POST', '/admin/auth/reset-password', undefined, { token, password: pwd })
    check(`D:${why} rejected (422)`, r.status === 422, `${r.status} ${r.code}`)
  }
  const shortTok = await call('POST', '/admin/auth/reset-password', undefined, { token: 'abc', password: 'GoodPass1' })
  check('D:token shorter than 32 chars rejected', shortTok.status === 422, `${shortTok.status} ${shortTok.code}`)
  /* The weak attempts must not have consumed the token. */
  const still = await call('POST', '/admin/auth/reset-password', undefined, { token, password: 'FreshPass1' })
  check('D:token survived the rejected attempts and still resets', still.status === 200, `${still.status} ${still.code}`)
}

/* ═══════════ E — reset (admin) full happy path, single-use ═══════════ */
section('E. Admin reset with a real emailed token changes the password and is single-use')
{
  const t0 = Date.now()
  await call('POST', '/admin/auth/forgot-password', undefined, { email: resetUser.email })
  const { token } = await latestEmail(resetUser.email, t0)
  const NEW = 'BrandNew9'
  const r = await call('POST', '/admin/auth/reset-password', undefined, { token, password: NEW })
  check('E1 reset → 200', r.status === 200, `${r.status} ${r.code}`)
  const login = await call('POST', '/admin/auth/login', new Map(), { email: resetUser.email, password: NEW })
  check('E2 admin login with the NEW password → 200', login.status === 200, `${login.status} ${login.code}`)
  const old = await call('POST', '/admin/auth/login', new Map(), { email: resetUser.email, password: PW })
  check('E3 the OLD password no longer works', old.status !== 200, `${old.status} ${old.code}`)
  const reuse = await call('POST', '/admin/auth/reset-password', undefined, { token, password: 'Another9x' })
  check('E4 the reset token is single-use (reuse → 400)', reuse.status === 400 && reuse.code === 'INVALID_RESET_TOKEN', `${reuse.status} ${reuse.code}`)
}

/* ═══════════ F — session revocation + bad/expired tokens ═══════════ */
section('F. Reset revokes live sessions; bad and expired tokens are refused')
{
  /* Establish a session, then reset, then prove the old refresh cookie is dead. */
  const jar: Jar = new Map()
  const li = await call('POST', '/admin/auth/login', jar, { email: sessionUser.email, password: PW })
  check('F1 support signs in (session established)', li.status === 200, `${li.status} ${li.code}`)
  const t0 = Date.now()
  await call('POST', '/admin/auth/forgot-password', undefined, { email: sessionUser.email })
  const { token } = await latestEmail(sessionUser.email, t0)
  const reset = await call('POST', '/admin/auth/reset-password', undefined, { token, password: 'Rotated12' })
  check('F2 reset succeeds', reset.status === 200, `${reset.status}`)
  const refresh = await call('POST', '/admin/auth/refresh', jar)
  check('F3 the pre-reset session is revoked (refresh fails)', refresh.status !== 200, `${refresh.status} ${refresh.code}`)

  const bogus = randomBytes(32).toString('hex')
  const rBogus = await call('POST', '/admin/auth/reset-password', undefined, { token: bogus, password: 'GoodPass1' })
  check('F4 a well-formed but unknown token → 400', rBogus.status === 400 && rBogus.code === 'INVALID_RESET_TOKEN', `${rBogus.status} ${rBogus.code}`)

  /* Directly mint an EXPIRED reset token and confirm it is refused. */
  const rawExp = randomBytes(32).toString('hex')
  await AuthTokenModel.create({ userId: superAdmin._id, tokenHash: createHash('sha256').update(rawExp).digest('hex'), purpose: 'reset-password', expiresAt: new Date(Date.now() - 1000) })
  const rExp = await call('POST', '/admin/auth/reset-password', undefined, { token: rawExp, password: 'GoodPass1' })
  check('F5 an expired token → 400', rExp.status === 400 && rExp.code === 'INVALID_RESET_TOKEN', `${rExp.status} ${rExp.code}`)
}

/* ═══════════ G — per-account throttle bounds inbox flooding ═══════════ */
section('G. A rapid second request is throttled: one live link per account per window')
{
  const t1 = Date.now()
  const r1 = await call('POST', '/admin/auth/forgot-password', undefined, { email: throttleUser.email })
  const first = await latestEmail(throttleUser.email, t1)
  check('G1 first request → 200 + issues a token & email', r1.status === 200 && !!first.token, `${r1.status} token=${first.token?.slice(0, 8)}`)
  const afterFirst = await tokenCount(throttleUser._id)

  const t2 = Date.now()
  const r2 = await call('POST', '/admin/auth/forgot-password', undefined, { email: throttleUser.email })
  const afterSecond = await tokenCount(throttleUser._id)
  const second = await latestEmail(throttleUser.email, t2, 300)   // expect NONE within 300ms
  check('G2 the immediate retry still returns a neutral 200 (no enumeration)', r2.status === 200 && r2.msg === NEUTRAL, `${r2.status} "${r2.msg}"`)
  check('G3 the retry issues NO new token (throttled)', afterSecond === afterFirst, `after1=${afterFirst} after2=${afterSecond}`)
  check('G4 the retry sends NO second email', second.token === null, `unexpected token=${second.token}`)
  const useFirst = await call('POST', '/admin/auth/reset-password', undefined, { token: first.token, password: 'GoodPass1' })
  check('G5 the original link is untouched by the throttled retry and still resets', useFirst.status === 200, `${useFirst.status} ${useFirst.code}`)
}

/* ═══════════ H — a concurrent burst issues at most one mail (atomic claim) ═══════════ */
section('H. A simultaneous burst of forgot requests issues exactly one token + one email')
{
  const K = 8
  const t0 = Date.now()
  const before = await tokenCount(burstUser._id)
  const results = await Promise.all(
    Array.from({ length: K }, () => call('POST', '/admin/auth/forgot-password', undefined, { email: burstUser.email })),
  )
  await new Promise(r => setTimeout(r, 250))   // let the fire-and-forget mail(s) flush
  const issued = (await tokenCount(burstUser._id)) - before
  let files: string[] = []
  try { files = await readdir(MAILDIR) } catch { /* none */ }
  const safe = burstUser.email.replace(/[^a-z0-9@._-]/gi, '_')
  const mails = files.filter(f => f.includes(safe) && Number(f.split('-')[0]) >= t0).length
  check(`H1 all ${K} concurrent requests return a neutral 200`,
    results.every(r => r.status === 200 && r.msg === NEUTRAL), JSON.stringify(results.map(r => r.status)))
  check('H2 exactly ONE reset token issued despite the burst (atomic, no TOCTOU)', issued === 1, `issued=${issued}`)
  check('H3 exactly ONE reset email sent', mails === 1, `mails=${mails}`)
}

} catch (err) {
  fail++
  lines.push(`\n  FATAL  ${(err as Error).stack ?? String(err)}`)
} finally {
  console.log(lines.join('\n'))
  console.log(`\nadminpasswordreset.suite — ${pass} passed, ${fail} failed`)
  await rm(MAILDIR, { recursive: true, force: true }).catch(() => {})
  await mongoose.connection.dropDatabase().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}
