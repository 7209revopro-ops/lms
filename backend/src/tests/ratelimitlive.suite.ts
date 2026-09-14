/* ─────────────────────────────────────────────────────────────
   The rate limiter, driven for real.

   The key-generator suite asserts which bucket a request is FILED under. This
   one asserts what a person actually experiences: it fires real HTTP at a real
   server until it is refused, and checks who else got refused with them.

   That distinction is the whole production incident. The keys were always
   computed correctly; what nobody could see was that with no relay header
   every visitor shares ONE bucket, so fifteen sign-ins across the entire
   platform locked everybody out — and a student who had made a single attempt
   read "Too many requests. Please try again in 15 minutes."

   Section B is the one that matters: two different visitors, a tight budget,
   and the second one must still get in.

   Run: bun run test:ratelimitlive
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_ratelimitlive'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
/* Deliberately TIGHT, so the limiter is reached in a handful of requests
   rather than by hammering a real server hundreds of times. */
process.env.RATE_LIMIT_AUTH_MAX    = '5'
process.env.RATE_LIMIT_REFRESH_MAX = '40'
process.env.RATE_LIMIT_API_MAX     = '9000'
process.env.PROXY_SHARED_SECRET    = 'live-relay-secret'

export {}

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
const { UserModel, OrganizationModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_ratelimitlive') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
const SECRET = 'live-relay-secret'

/** One sign-in attempt, optionally claiming to come from a given visitor. */
async function attempt(email: string, password: string, fromIp?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (fromIp) {
    headers['x-lms-proxy-secret'] = SECRET
    headers['x-lms-client-ip']    = fromIp
  }
  const res  = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers, body: JSON.stringify({ email, password }),
  })
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, code: body?.error?.code as string | undefined }
}

const PW = 'CorrectHorse1'

/* Every attempt below uses an address that does NOT exist.

   A real account locks after a handful of wrong passwords — a separate, correct
   protection that answers 423 ACCOUNT_LOCKED — and the first version of this
   suite tripped it, which made a per-ACCOUNT guard look like a per-IP one. An
   account that was never created cannot be locked, so 401 until 429 isolates
   the limiter and nothing else. */
let ghostSeq = 0
const ghost = () => `ghost-${Date.now()}-${ghostSeq++}@rl.local`

try {
  const org = await OrganizationModel.create({
    name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const hash = await hashPassword(PW)
  /* Kept so the app has a real account behind it; the attempts below use
     addresses that do not exist, on purpose. */
  const student = await UserModel.create({
    name: 'Student', email: `live-${Date.now()}@rl.local`, passwordHash: hash,
    role: 'student', isActive: true, isVerified: true,
    enrollmentStatus: 'approved', organizationId: org._id,
  })

  /* ═══════════════════════════════════════════════ */
  section('A · the limiter actually fires')
  {
    /* Wrong password on purpose: every attempt is a 401 until the budget runs
       out, so a 429 is unambiguous rather than tangled up with a success. */
    const seen: number[] = []
    for (let i = 0; i < 8; i++) {
      seen.push((await attempt(ghost(), 'WrongPassword9', '203.0.113.10')).status)
    }
    check('the first attempts are judged on the password, not the budget',
      seen.slice(0, 5).every(s => s === 401), seen.join(','))
    check('and the sixth is refused for the budget', seen[5] === 429, seen.join(','))
    check('as RATE_LIMITED',
      (await attempt(ghost(), 'WrongPassword9', '203.0.113.10')).code === 'RATE_LIMITED')
  }

  /* ═══════════════════════════════════════════════ */
  section('B · one exhausted visitor must not lock out another')
  {
    /* The production symptom, reproduced and then disproved. The first visitor
       is already spent from section A; a DIFFERENT visitor arrives. */
    const other = await attempt(ghost(), 'WrongPassword9', '198.51.100.22')
    check('a different visitor still gets through to the password check',
      other.status === 401, `${other.status} ${other.code}`)
    check('and is NOT told the platform is busy', other.code !== 'RATE_LIMITED', String(other.code))

    /* And they can spend their own budget without touching anyone else's. */
    const theirs: number[] = []
    for (let i = 0; i < 6; i++) {
      theirs.push((await attempt(ghost(), 'WrongPassword9', '198.51.100.22')).status)
    }
    check('they have a full budget of their own', theirs.filter(s => s === 401).length >= 4,
      theirs.join(','))

    /* A third visitor, after two are exhausted, still gets in. */
    const third = await attempt(ghost(), 'WrongPassword9', '192.0.2.55')
    check('a third visitor is unaffected by both', third.status === 401,
      `${third.status} ${third.code}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('C · with NO relay, everyone shares one bucket — the bug itself')
  {
    /* No secret, no header: exactly what production does today. Every caller
       collapses onto the proxy address, so one exhausted budget is everybody's
       exhausted budget. Asserted so the difference the fix makes is measured
       rather than described. */
    const unrelayed: number[] = []
    for (let i = 0; i < 8; i++) {
      unrelayed.push((await attempt(ghost(), 'WrongPassword9')).status)
    }
    check('an unrelayed caller is limited too', unrelayed.includes(429), unrelayed.join(','))

    /* A second unrelayed caller claiming a totally different address gets
       nothing for it — the header is worthless unsigned. */
    const forged = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lms-client-ip': '203.0.113.99' },
      body: JSON.stringify({ email: ghost(), password: 'WrongPassword9' }),
    })
    check('and forging the header without the secret does NOT buy a fresh budget',
      forged.status === 429, String(forged.status))

    /* Meanwhile a properly relayed visitor is untouched by any of it. */
    const clean = await attempt(ghost(), 'WrongPassword9', '192.0.2.77')
    check('while a properly relayed visitor still has their own',
      clean.status === 401, `${clean.status} ${clean.code}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('D · staying signed in does not spend sign-in attempts')
  {
    /* The other half of the incident: refresh used to sit in this same bucket,
       so an ordinary session renewal every 15 minutes competed with password
       guessing. This visitor has already burned their sign-in budget. */
    const spent = '203.0.113.10'
    const login = await attempt(ghost(), 'WrongPassword9', spent)
    check('their sign-in budget is indeed spent', login.status === 429, String(login.status))

    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'x-lms-proxy-secret': SECRET, 'x-lms-client-ip': spent },
    })
    let body: any = null
    try { body = await res.json() } catch { /* empty */ }
    /* No valid refresh cookie here, so 401 is the right answer — the point is
       that it is NOT 429. A session must still be renewable by somebody whose
       sign-in budget is gone. */
    check('but refresh is still reachable — a different bucket entirely',
      res.status !== 429, `${res.status} ${body?.error?.code}`)
    check('and fails on the missing token, as it should',
      res.status === 401, `${res.status} ${body?.error?.code}`)
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
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
