/* ─────────────────────────────────────────────────────────────
   Accounts with no password — what they are told, and whether it is true.

   Two real paths mint a user with no passwordHash: the bulk student import
   and external-purchase provisioning. Neither involves an identity provider.
   Until now the login guard answered:

       OAUTH_ACCOUNT — "This account uses social login. Please sign in with
                        Google."

   That named a door this backend does not have. There is no /auth/google
   route, no callback, and findByProvider() is called from nowhere. A student
   in that state was told to do the one thing that cannot work, and never told
   the thing that can.

   The replacement points at forgot-password. This suite exists because that
   is a PROMISE — the login screen now offers a button that mails the link —
   and a promise nothing tests is a promise that quietly stops being true.

   Covers:
     A  login against a passwordless account → 400 NO_PASSWORD_SET
     B  the message names the real remedy and never names a fake one
     C  the guard keys off the MISSING HASH, not off `provider`
     D  the promise, end to end: forgot-password → reset → login works
     E  change-password and email-change say the same thing
     F  two-factor setup says the same thing
     G  an ordinary wrong password is still INVALID_CREDENTIALS, so the
        client's "set my password" button can never appear for it

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_nopassword_suite), dropped on exit. NODE_ENV=test forces the console
   mail sender, so no real email can leave this suite.

   Run: bun src/tests/nopassword.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_nopassword_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.EMAIL_OUTBOX = 'on'
process.env.RATE_LIMIT_AUTH_MAX = '2000'
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

const { createHash } = await import('node:crypto')
void createHash
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, EmailOutboxModel } = await import('@/models/schema.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_nopassword_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

/* ── HTTP helpers ─────────────────────────────────── */
/* A student's SECOND device is held for admin approval, so a sign-in that
   arrives without the lms_device cookie looks like a new browser and is
   refused with DEVICE_PENDING — which would mask every code under test.
   Remember the device per account and send it back, as a browser would. */
const deviceOf = new Map<string, string>()

async function req(method: string, path: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const email  = (body as { email?: string } | null)?.email
  const known  = email ? deviceOf.get(email) : undefined
  const merged = !known || cookie?.includes('lms_device=')
    ? cookie
    : [cookie, known].filter(Boolean).join('; ')
  if (merged) headers['cookie'] = merged
  const res  = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: any = text; try { parsed = JSON.parse(text) } catch {}
  const pairs = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]!)
  if (email) {
    const dev = pairs.find(c => c.startsWith('lms_device='))
    if (dev) deviceOf.set(email, dev)
    else if (known && pairs.length) pairs.push(known)
  }
  return { status: res.status, body: parsed, cookie: pairs.join('; ') }
}
const post  = (p: string, b?: unknown, c?: string) => req('POST',  p, b, c)
const patch = (p: string, b?: unknown, c?: string) => req('PATCH', p, b, c)

const code = (r: { body: any }) => r.body?.error?.code
const msg  = (r: { body: any }) => String(r.body?.error?.message ?? '')

/* Reset links land in the outbox (persisted before any send attempt). */
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

/* Mints a user the way the bulk import does: active, approved, NO hash. */
async function mkPasswordless(email: string, extra: Record<string, unknown> = {}) {
  await UserModel.create({
    name: 'Imported Student',
    email,
    role: 'student',
    isActive: true,
    enrollmentStatus: 'approved',
    ...extra,
  })
  /* create() can still apply schema defaults; make the absence explicit. */
  await UserModel.updateOne({ email }, { $unset: { passwordHash: '' } })
  const row = await UserModel.findOne({ email }).select('+passwordHash').lean()
  return !row?.passwordHash
}

/* Mints a NORMAL account through the public route, for the contrast case. */
async function register(email: string, password = 'Password1') {
  return post('/auth/register', {
    name: 'Normal Student', email, password, organizationSlug: 'dubai',
  })
}

try {

/* ═════════════════ A — the refusal ═════════════════ */
section('A. Login against an account that has no password')
{
  const clean = await mkPasswordless('imported@np.test')
  check('A1 the fixture really has no passwordHash', clean)

  const r = await post('/auth/login', { email: 'imported@np.test', password: 'anything123' })
  check('A2 refused with 400', r.status === 400, `status=${r.status}`)
  check('A3 code is NO_PASSWORD_SET', code(r) === 'NO_PASSWORD_SET', String(code(r)))
}

/* ═════════════════ B — is the message true? ═════════════════ */
section('B. The message names a remedy that exists, and none that does not')
{
  const r = await post('/auth/login', { email: 'imported@np.test', password: 'anything123' })

  /* The whole point of the change. If someone reinstates the old copy, or
     bolts a "sign in with Google" line back on without building the route,
     this is the assertion that stops it. */
  check('B1 never claims a social / Google sign-in',
    !/google|social|oauth/i.test(msg(r)), msg(r))

  /* And it must say what to do, not merely what went wrong. The client
     surfaces a button, but the message has to stand on its own for anyone
     hitting the API directly or reading it in a log. */
  check('B2 points at forgot-password', /forgot password/i.test(msg(r)), msg(r))
}

/* ═════════════════ C — keyed off the hash, not the provider ═════════════════ */
section('C. The guard reads the missing hash, not `provider`')
{
  /* An account that DOES carry provider fields but no hash must land in the
     same place — otherwise the guard is really a provider check wearing a
     new name, and an imported student with no provider would fall through
     to "Invalid email or password" and be stuck with no way forward. */
  await mkPasswordless('withprovider@np.test', { provider: 'google', providerId: 'g-1' })
  const withProv = await post('/auth/login', { email: 'withprovider@np.test', password: 'anything123' })
  check('C1 provider fields present, no hash → NO_PASSWORD_SET',
    code(withProv) === 'NO_PASSWORD_SET', String(code(withProv)))

  /* The mirror case is the load-bearing one: NO provider at all. */
  const noProv = await post('/auth/login', { email: 'imported@np.test', password: 'anything123' })
  check('C2 no provider at all, no hash → the same code',
    code(noProv) === 'NO_PASSWORD_SET', String(code(noProv)))
  check('C3 and the same message either way', msg(noProv) === msg(withProv))
}

/* ═════════════════ D — the promise, end to end ═════════════════ */
section('D. The remedy actually works for a passwordless account')
{
  /* This is the assertion the login button rests on. forgot-password must
     mint a token for an account with no hash — not skip it as "nothing to
     reset" — and reset-password must WRITE the first hash rather than
     assume it is replacing one. */
  const f = await post('/auth/forgot-password', { email: 'imported@np.test' })
  check('D1 forgot-password accepts a passwordless account', f.status === 200, `status=${f.status}`)

  const token = await latestResetToken('imported@np.test')
  check('D2 a real reset link was mailed', !!token && token.length === 64, String(token).slice(0, 12))

  const r = await post('/auth/reset-password', { token, password: 'BrandNew1x' })
  check('D3 reset sets the very first password', r.status === 200 && r.body?.success === true,
    `status=${r.status} body=${JSON.stringify(r.body).slice(0, 160)}`)

  const hashed = await UserModel.findOne({ email: 'imported@np.test' }).select('+passwordHash').lean()
  check('D4 a hash now exists on the row', !!hashed?.passwordHash)

  const l = await post('/auth/login', { email: 'imported@np.test', password: 'BrandNew1x' })
  check('D5 the student can now log in', l.status === 200 && l.body?.success === true, `status=${l.status}`)

  /* And the refusal is gone — the account has left that state for good. */
  const again = await post('/auth/login', { email: 'imported@np.test', password: 'wrongone1' })
  check('D6 NO_PASSWORD_SET no longer applies', code(again) !== 'NO_PASSWORD_SET', String(code(again)))
}

/* ═════════════════ E — the other two guards ═════════════════ */
section('E. change-password and email-change answer the same way')
{
  await mkPasswordless('guards@np.test')
  const { signAccessToken } = await import('@/utils/jwt.ts')
  const row = await UserModel.findOne({ email: 'guards@np.test' }).lean()
  const at  = await signAccessToken({ id: String(row!._id), role: 'student', email: 'guards@np.test' })
  const jar = `lms_at=${at}`

  const cp = await patch('/auth/me/password',
    { currentPassword: 'anything', newPassword: 'Whatever1x' }, jar)
  check('E1 change-password → NO_PASSWORD_SET', code(cp) === 'NO_PASSWORD_SET', `status=${cp.status} code=${code(cp)}`)
  check('E2 and names no fake sign-in',
    code(cp) === 'NO_PASSWORD_SET' && !/google|social|oauth/i.test(msg(cp)), msg(cp))

  const ec = await patch('/auth/me/email',
    { newEmail: 'moved@np.test', currentPassword: 'anything' }, jar)
  check('E3 email-change → NO_PASSWORD_SET', code(ec) === 'NO_PASSWORD_SET', `status=${ec.status} code=${code(ec)}`)
  check('E4 and names no fake sign-in',
    code(ec) === 'NO_PASSWORD_SET' && !/google|social|oauth/i.test(msg(ec)), msg(ec))
}

/* ═════════════════ F — two-factor setup ═════════════════ */
section('F. Two-factor setup says the same thing')
{
  const { signAccessToken } = await import('@/utils/jwt.ts')
  const row = await UserModel.findOne({ email: 'guards@np.test' }).lean()
  const at  = await signAccessToken({ id: String(row!._id), role: 'student', email: 'guards@np.test' })

  const r = await post('/auth/2fa/setup', { password: 'anything' }, `lms_at=${at}`)
  check('F1 2FA setup → NO_PASSWORD_SET', code(r) === 'NO_PASSWORD_SET', `status=${r.status} code=${code(r)}`)
  check('F2 and names no fake sign-in',
    code(r) === 'NO_PASSWORD_SET' && !/google|social|oauth/i.test(msg(r)), msg(r))
}

/* ═════════════════ G — the contrast case ═════════════════ */
section('G. An ordinary bad password is NOT this error')
{
  /* The client shows "Email me a link to set my password" on the CODE alone.
     If an ordinary failed sign-in ever answered NO_PASSWORD_SET, every
     mistyped password would offer to reset an account the typist may not
     own. Both halves matter: the real account and the unknown one. */
  await register('normal@np.test', 'Password1')

  const wrong = await post('/auth/login', { email: 'normal@np.test', password: 'NotThePass9' })
  check('G1 wrong password on a real account is not NO_PASSWORD_SET',
    code(wrong) !== 'NO_PASSWORD_SET', String(code(wrong)))
  check('G2 it is INVALID_CREDENTIALS', code(wrong) === 'INVALID_CREDENTIALS', String(code(wrong)))

  const ghost = await post('/auth/login', { email: 'nobody@np.test', password: 'Password1' })
  check('G3 an unknown address is not NO_PASSWORD_SET',
    code(ghost) !== 'NO_PASSWORD_SET', String(code(ghost)))

  /* An unknown address and a known one with the wrong password must be
     indistinguishable, or this becomes an account-enumeration oracle. */
  check('G4 unknown and wrong-password are indistinguishable',
    code(ghost) === code(wrong) && msg(ghost) === msg(wrong),
    `${code(ghost)}/${code(wrong)}`)
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\nnopassword.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
