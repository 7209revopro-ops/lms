/* ─────────────────────────────────────────────────────────────
   Password flows — "set password" + "forgot password", end to end.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_pwflow_suite), dropped on exit. The real `lms` database is never
   opened, and NODE_ENV=test forces the console mail sender, so no real
   email can leave this suite. Reset links are read back from the
   EmailOutbox rows the send persists.

   Covers, several times and by several routes:
     A  register a student and log in (baseline)
     B  forgot-password ×3 — newest link wins, older links die
     C  a used link cannot be replayed
     D  garbage tokens + weak passwords rejected; validation failures
        do NOT consume the token
     E  expired tokens rejected
     F  the IMPORT path: user created with no password at all, a 7-day
        set-password token minted directly (as the bulk-import script
        will), password set through the public endpoint, login works
     G  the same imported user can also use forgot-password (lost mail)
     H  unknown email / inactive account leak nothing and mint nothing
     I  a successful reset revokes every live session (refresh dies)
     J  stress — 5 fresh users run the full cycle back-to-back

   Run: bun src/tests/passwordflows.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_pwflow_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.EMAIL_OUTBOX = 'on'
process.env.RATE_LIMIT_AUTH_MAX = '2000'
/* Disable the per-account reset-mail throttle here so this suite can exercise
   the "newest link wins" invalidation in isolation with rapid re-requests. The
   throttle itself is covered by adminpasswordreset.suite. */
process.env.RESET_THROTTLE_MS = '0'
/* Force the local-disk fallback — never touch the production R2 bucket. */
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''
delete process.env.SIGNUP_REQUIRE_VERIFICATION

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const { createHash, randomBytes } = await import('node:crypto')
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, AuthTokenModel, EmailOutboxModel } = await import('@/models/schema.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_pwflow_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()   // idempotent re-runs

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

/* ── tiny HTTP helper ─────────────────────────────── */
/* Every account here registers and then signs in again. A student's SECOND
   device is held for admin approval, so without the `lms_device` cookie the
   sign-in after registration is a new browser and is refused with
   DEVICE_PENDING. Remember the device per account — keyed off the email in
   the request body — and send it back, as a browser would. */
const deviceOf = new Map<string, string>()

async function post(path: string, body: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const email  = (body as { email?: string } | null)?.email
  const known  = email ? deviceOf.get(email) : undefined
  const merged = !known || cookie?.includes('lms_device=')
    ? cookie
    : [cookie, known].filter(Boolean).join('; ')
  if (merged) headers['cookie'] = merged
  const res  = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await res.text()
  let parsed: any = text; try { parsed = JSON.parse(text) } catch {}
  const setCookies = res.headers.getSetCookie?.() ?? []
  const pairs = setCookies.map(c => c.split(';')[0]!)
  if (email) {
    const dev = pairs.find(c => c.startsWith('lms_device='))
    if (dev) deviceOf.set(email, dev)
    /* A login does not re-issue the device cookie it was just handed, but the
       browser still HOLDS it — and /auth/refresh refuses a session whose
       device it cannot see. Keep it in the jar we hand back. */
    else if (known && pairs.length) pairs.push(known)
  }
  return { status: res.status, body: parsed, cookie: pairs.join('; ') }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/* Reset links land in the outbox (persisted before any send attempt);
   poll briefly, then pull the token out of the html. */
async function latestResetToken(email: string): Promise<string | null> {
  for (let i = 0; i < 30; i++) {
    const row = await EmailOutboxModel.findOne({ to: email, subject: /Reset/i })
      .sort({ createdAt: -1 }).lean()
    const m = row?.html?.match(/reset-password\?token=([a-f0-9]{64})/)
    if (m) return m[1]!
    await new Promise(r => setTimeout(r, 100))
  }
  return null
}
const resetMailCount = (email: string) =>
  EmailOutboxModel.countDocuments({ to: email, subject: /Reset/i })

async function register(email: string, password = 'Password1') {
  return post('/auth/register', { name: 'PW Suite User', email, password, organizationSlug: 'dubai' })
}

/* ═════════════════ A — baseline ═════════════════ */
section('A. Baseline — register + login')
{
  const r = await register('bob@pw.test')
  check('A1 register succeeds', r.status < 300 && r.body?.success === true, `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`)
  const l = await post('/auth/login', { email: 'bob@pw.test', password: 'Password1' })
  check('A2 login with original password', l.status === 200 && l.body?.success === true, `status=${l.status}`)
}

/* ═════════════════ B — forgot ×3, newest wins ═════════════════ */
section('B. Forgot-password three times — only the newest link works')
{
  const tokens: string[] = []
  for (let i = 1; i <= 3; i++) {
    const f = await post('/auth/forgot-password', { email: 'bob@pw.test' })
    check(`B${i}a request #${i} accepted`, f.status === 200 && f.body?.success === true, `status=${f.status}`)
    const t = await latestResetToken('bob@pw.test')
    check(`B${i}b reset mail #${i} contains a 64-hex token`, !!t && (i === 1 || t !== tokens[tokens.length - 1]))
    if (t) tokens.push(t)
  }
  check('B4 three distinct tokens were issued', new Set(tokens).size === 3)

  const stale = await post('/auth/reset-password', { token: tokens[0], password: 'NewPass1x' })
  check('B5 link #1 is dead after link #3 was issued', stale.status === 400 && stale.body?.error?.code === 'INVALID_RESET_TOKEN', `status=${stale.status} code=${stale.body?.error?.code}`)

  const ok = await post('/auth/reset-password', { token: tokens[2], password: 'NewPass1x' })
  check('B6 newest link resets the password', ok.status === 200 && ok.body?.success === true, `status=${ok.status} body=${JSON.stringify(ok.body).slice(0, 200)}`)

  const oldLogin = await post('/auth/login', { email: 'bob@pw.test', password: 'Password1' })
  check('B7 old password no longer logs in', oldLogin.status === 401 || oldLogin.body?.success === false, `status=${oldLogin.status}`)
  const newLogin = await post('/auth/login', { email: 'bob@pw.test', password: 'NewPass1x' })
  check('B8 new password logs in', newLogin.status === 200 && newLogin.body?.success === true, `status=${newLogin.status}`)

  /* keep for C */
  ;(globalThis as any).__usedToken = tokens[2]
}

/* ═════════════════ C — no replay ═════════════════ */
section('C. A used link cannot be replayed')
{
  const again = await post('/auth/reset-password', { token: (globalThis as any).__usedToken, password: 'Another1x' })
  check('C1 replaying the used link fails', again.status === 400 && again.body?.error?.code === 'INVALID_RESET_TOKEN', `status=${again.status}`)
  const l = await post('/auth/login', { email: 'bob@pw.test', password: 'NewPass1x' })
  check('C2 password unchanged by the replay', l.status === 200 && l.body?.success === true)
}

/* ═════════════════ D — garbage + weak passwords ═════════════════ */
section('D. Garbage tokens and weak passwords')
{
  const ghost = await post('/auth/reset-password', { token: randomBytes(32).toString('hex'), password: 'Valid1234' })
  check('D1 never-issued 64-hex token rejected', ghost.status === 400 && ghost.body?.error?.code === 'INVALID_RESET_TOKEN', `status=${ghost.status}`)

  const short = await post('/auth/reset-password', { token: 'abc', password: 'Valid1234' })
  check('D2 malformed short token rejected by validation', short.status >= 400 && short.body?.success === false, `status=${short.status}`)

  await post('/auth/forgot-password', { email: 'bob@pw.test' })
  const fresh = await latestResetToken('bob@pw.test')
  check('D3 fresh token issued for weak-password round', !!fresh)

  const weak1 = await post('/auth/reset-password', { token: fresh, password: 'short1A' })
  check('D4 7-char password rejected', weak1.status >= 400 && weak1.body?.success === false, `status=${weak1.status}`)
  const weak2 = await post('/auth/reset-password', { token: fresh, password: 'alllowercase1' })
  check('D5 password without uppercase rejected', weak2.status >= 400 && weak2.body?.success === false)
  const weak3 = await post('/auth/reset-password', { token: fresh, password: 'NoNumbersHere' })
  check('D6 password without a number rejected', weak3.status >= 400 && weak3.body?.success === false)

  const strong = await post('/auth/reset-password', { token: fresh, password: 'Strong1234' })
  check('D7 same token still works after failed validations (not consumed)', strong.status === 200 && strong.body?.success === true, `status=${strong.status}`)
  const l = await post('/auth/login', { email: 'bob@pw.test', password: 'Strong1234' })
  check('D8 login with the newly set password', l.status === 200 && l.body?.success === true)
}

/* ═════════════════ E — expiry ═════════════════ */
section('E. Expired tokens are rejected')
{
  const user = await UserModel.findOne({ email: 'bob@pw.test' }).lean()
  const raw = randomBytes(32).toString('hex')
  await AuthTokenModel.create({
    userId: user!._id, tokenHash: sha256(raw), purpose: 'reset-password',
    expiresAt: new Date(Date.now() - 1000),
  })
  const r = await post('/auth/reset-password', { token: raw, password: 'Valid1234' })
  check('E1 expired token rejected', r.status === 400 && r.body?.error?.code === 'INVALID_RESET_TOKEN', `status=${r.status}`)
}

/* ═════════════════ F — the import path (set password) ═════════════════ */
section('F. Import path — passwordless user + 7-day set-password token')
{
  const u = await UserModel.create({
    name: 'Imported Student', email: 'imported@pw.test', role: 'student',
    isActive: true, isVerified: true, enrollmentStatus: 'approved',
    category: 'digital-marketing', categories: ['digital-marketing'],
  })
  const before = await post('/auth/login', { email: 'imported@pw.test', password: 'Whatever1' })
  check('F1 imported user cannot log in before setting a password', before.status !== 200 || before.body?.success !== true, `status=${before.status}`)

  /* Mint the token exactly as the bulk-import script will: raw 32 bytes,
     store only the sha-256 hash, 7-day expiry. */
  const raw = randomBytes(32).toString('hex')
  await AuthTokenModel.create({
    userId: u._id, tokenHash: sha256(raw), purpose: 'reset-password',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })
  const set = await post('/auth/reset-password', { token: raw, password: 'Welcome2Delta' })
  check('F2 7-day set-password link works through the public endpoint', set.status === 200 && set.body?.success === true, `status=${set.status} body=${JSON.stringify(set.body).slice(0, 200)}`)

  const l = await post('/auth/login', { email: 'imported@pw.test', password: 'Welcome2Delta' })
  check('F3 imported user logs in with the password they set', l.status === 200 && l.body?.success === true, `status=${l.status}`)
}

/* ═════════════════ G — imported user lost the mail ═════════════════ */
section('G. Imported user can also use forgot-password (lost welcome mail)')
{
  const f = await post('/auth/forgot-password', { email: 'imported@pw.test' })
  check('G1 forgot-password accepted for imported user', f.status === 200 && f.body?.success === true)
  const t = await latestResetToken('imported@pw.test')
  check('G2 reset mail row created with a token', !!t)
  const r = await post('/auth/reset-password', { token: t, password: 'Recovered1' })
  check('G3 recovery link sets a new password', r.status === 200 && r.body?.success === true)
  const l = await post('/auth/login', { email: 'imported@pw.test', password: 'Recovered1' })
  check('G4 login with the recovered password', l.status === 200 && l.body?.success === true)
}

/* ═════════════════ H — leaks ═════════════════ */
section('H. No account-existence leaks, no tokens for inactive accounts')
{
  const ghostBefore = await resetMailCount('nobody@pw.test')
  const f = await post('/auth/forgot-password', { email: 'nobody@pw.test' })
  check('H1 unknown email still answers 200 (no leak)', f.status === 200 && f.body?.success === true, `status=${f.status}`)
  const ghostAfter = await resetMailCount('nobody@pw.test')
  check('H2 …but no reset mail was minted', ghostAfter === ghostBefore)

  await UserModel.create({
    name: 'Blocked One', email: 'blocked@pw.test', role: 'student',
    isActive: false, passwordHash: 'x',
  })
  const before = await resetMailCount('blocked@pw.test')
  const fb = await post('/auth/forgot-password', { email: 'blocked@pw.test' })
  check('H3 inactive account answers 200 (no leak)', fb.status === 200 && fb.body?.success === true)
  const after = await resetMailCount('blocked@pw.test')
  check('H4 …and no reset mail was minted for it', after === before)
}

/* ═════════════════ I — sessions die on reset ═════════════════ */
section('I. A successful reset revokes live sessions')
{
  /* Session A is refreshed once (rotates its token at rotatedAt); session C
     stays untouched — the clean "logged in on another device" case. */
  const loginA = await post('/auth/login', { email: 'bob@pw.test', password: 'Strong1234' })
  check('I1 login issues session cookies', loginA.status === 200 && loginA.cookie.length > 0)

  const pairB = await post('/auth/refresh', {}, loginA.cookie)
  const rotatedAt = Date.now()
  check('I2 refresh works before the reset', pairB.status === 200 && pairB.body?.success === true, `status=${pairB.status}`)

  const loginC = await post('/auth/login', { email: 'bob@pw.test', password: 'Strong1234' })
  check('I3 a second independent session opens', loginC.status === 200 && loginC.cookie.length > 0)

  await post('/auth/forgot-password', { email: 'bob@pw.test' })
  const t = await latestResetToken('bob@pw.test')
  const r = await post('/auth/reset-password', { token: t, password: 'Rotated1x' })
  check('I4 reset succeeds', r.status === 200 && r.body?.success === true)

  const deadC = await post('/auth/refresh', {}, loginC.cookie)
  check('I5 untouched session C is dead after reset', deadC.status === 401 && deadC.body?.success === false, `status=${deadC.status}`)

  const deadB = await post('/auth/refresh', {}, pairB.cookie)
  check('I6 rotated-successor pair B is dead after reset', deadB.status === 401 && deadB.body?.success === false, `status=${deadB.status}`)

  /* Cookie A was consumed by rotation. Inside a 2s grace the API would treat
     replaying it as a benign two-tabs race; past the grace it MUST read as
     token reuse and hard-fail. Wait out the remainder deterministically. */
  const remainder = 2_100 - (Date.now() - rotatedAt)
  if (remainder > 0) await new Promise(res => setTimeout(res, remainder))
  const reuse = await post('/auth/refresh', {}, loginA.cookie)
  check('I7 replaying the rotated cookie outside grace trips reuse detection', reuse.status === 401 && reuse.body?.success === false, `status=${reuse.status} code=${reuse.body?.error?.code}`)

  const l = await post('/auth/login', { email: 'bob@pw.test', password: 'Rotated1x' })
  check('I8 fresh login with the new password still works', l.status === 200 && l.body?.success === true)
}

/* ═════════════════ J — stress, full cycle ×5 ═════════════════ */
section('J. Five fresh users run the whole cycle back-to-back')
{
  let allOk = true
  const details: string[] = []
  for (let i = 1; i <= 5; i++) {
    const email = `cycle${i}@pw.test`
    const reg = await register(email, `Initial${i}A1`)
    const f   = await post('/auth/forgot-password', { email })
    const t   = await latestResetToken(email)
    const r   = t ? await post('/auth/reset-password', { token: t, password: `Cycled${i}B2` }) : { status: 0, body: null as any }
    const l   = await post('/auth/login', { email, password: `Cycled${i}B2` })
    const ok  = reg.status < 300 && f.status === 200 && !!t && r.status === 200 && l.status === 200 && l.body?.success === true
    if (!ok) { allOk = false; details.push(`${email}: reg=${reg.status} f=${f.status} t=${!!t} r=${r.status} l=${l.status}`) }
  }
  check('J1 all five full cycles pass (register → forgot → reset → login)', allOk, details.join(' | '))
}

/* ═════════════════ report + teardown ═════════════════ */
await mongoose.connection.db!.dropDatabase()
server.close()
await mongoose.disconnect()

console.log(lines.join('\n'))
console.log(`\n══════════════════════════════════\n  ${pass} passed, ${fail} failed\n══════════════════════════════════`)
process.exit(fail > 0 ? 1 : 0)
