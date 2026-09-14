/* ─────────────────────────────────────────────────────────────
   A student changes the address on their account.

   The flow is deliberately three steps, and each guard is here because of what
   it prevents:

     · the CURRENT PASSWORD is required, because an email change is the classic
       route from a stolen session to a stolen account — move the address, then
       use forgot-password against it. A borrowed cookie must not be enough.
     · the new address is PARKED, not applied, until a link sent to it comes
       back. Being able to read mail there is the only thing that proves it is
       yours, and it means a typo costs nothing: the old address keeps working
       and the request expires.
     · the OLD address is told immediately, while it is still the live one —
       the owner's single chance to react in time.

   The assertions that matter most are the negative ones: that nothing moves
   before confirmation (B), that the old address stops working after it (D),
   and that a wrong password changes nothing at all (A).

   Run: bun run test:emailchange
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_emailchange'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', true)   // the unique email index is load-bearing here
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, AuthTokenModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_emailchange') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()
await UserModel.syncIndexes()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';')
    const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

const PW = 'CorrectHorse1'
let seq = 0
const addr = (tag: string) => `${tag}-${Date.now()}-${seq++}@ec.local`
const code = (r: { body: any }) => r.body?.error?.code
const msg  = (r: { body: any }) => String(r.body?.error?.message ?? '')

/* The raw token never leaves the mailbox, so the suite reads the row the
   service wrote and re-derives what was mailed. Hashing matches the service's
   own helper — a token is stored hashed, never in the clear. */
const { createHash } = await import('node:crypto')
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

/* Brute force over a small keyspace: issue the token ourselves so the suite
   knows the raw value, by replacing the stored hash with one we can produce.
   This is how the test reads its own mail. */
async function stealToken(userId: string): Promise<string> {
  const raw = `test-token-${Math.random().toString(36).slice(2)}-${seq++}`
  const row = await AuthTokenModel.findOne({ userId, purpose: 'change-email', usedAt: null })
    .sort({ createdAt: -1 })
  if (!row) throw new Error('no change-email token was issued')
  row.tokenHash = sha256(raw)
  await row.save()
  return raw
}

try {
  const org = await OrganizationModel.create({
    name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const hash = await hashPassword(PW)

  const mkStudent = async (e: string, extra: Record<string, unknown> = {}) => UserModel.create({
    name: 'Student', email: e, passwordHash: hash, role: 'student',
    isActive: true, isVerified: false, enrollmentStatus: 'approved',
    organizationId: org._id, ...extra,
  })

  /* Every sign-in here has to look like the SAME browser.

     Device identity is the `lms_device` cookie, and a fresh jar per login
     presents none — so the whitelist mints a new device each time, holds the
     second one for admin approval, and the sign-in answers 403. That is the
     whitelist working correctly on a test that was lying about who was
     knocking; carrying the cookie forward is what makes these assertions about
     the EMAIL rather than about devices. */
  let deviceCookie: string | undefined
  const login = async (e: string, pw = PW): Promise<{ jar: Jar; status: number }> => {
    const jar: Jar = new Map()
    if (deviceCookie) jar.set('lms_device', deviceCookie)
    const r = await call('POST', '/auth/login', { jar, body: { email: e, password: pw } })
    const issued = jar.get('lms_device')
    if (issued) deviceCookie = issued
    return { jar, status: r.status }
  }

  const oldAddr = addr('old')
  const newAddr = addr('new')
  const student = await mkStudent(oldAddr)
  const id = String(student._id)
  const { jar, status: loginStatus } = await login(oldAddr)

  /* ═══════════════════════════════════════════════ */
  section('A · a borrowed session is not enough — the password is the gate')
  {
    check('the student can sign in to begin with', loginStatus === 200, String(loginStatus))

    const wrong = await call('PATCH', '/auth/me/email', {
      jar, body: { newEmail: newAddr, currentPassword: 'NotTheirPassword1' },
    })
    check('a wrong password is refused', wrong.status === 401, String(wrong.status))
    check('and says so precisely', code(wrong) === 'WRONG_PASSWORD', code(wrong))

    const after = await UserModel.findById(id).lean() as any
    check('NOTHING was parked — a failed attempt leaves no trace',
      !after?.pendingEmail, String(after?.pendingEmail))
    check('and no token was issued',
      await AuthTokenModel.countDocuments({ userId: id, purpose: 'change-email' }) === 0)

    const anon = await call('PATCH', '/auth/me/email', {
      body: { newEmail: newAddr, currentPassword: PW },
    })
    check('an unauthenticated caller cannot ask at all', anon.status === 401, String(anon.status))
  }

  /* ═══════════════════════════════════════════════ */
  section('B · asking parks the address — it does not apply it')
  {
    const r = await call('PATCH', '/auth/me/email', {
      jar, body: { newEmail: newAddr, currentPassword: PW },
    })
    check('the request is accepted', r.status === 200, `${r.status} ${code(r)}`)
    check('and reports what is now pending', r.body?.data?.pendingEmail === newAddr,
      String(r.body?.data?.pendingEmail))

    const after = await UserModel.findById(id).lean() as any
    check('the LIVE address is untouched', after?.email === oldAddr, String(after?.email))
    check('the new one is only parked', after?.pendingEmail === newAddr, String(after?.pendingEmail))

    /* The whole point of parking: a student who mistypes is not locked out. */
    const stillWorks = await login(oldAddr)
    check('the old address still signs in while the change is pending',
      stillWorks.status === 200, String(stillWorks.status))

    const notYet = await login(newAddr)
    check('and the new one does NOT yet', notYet.status === 401, String(notYet.status))

    /* Visible to the UI, so it can say "waiting for confirmation at …". */
    const me = await call('GET', '/auth/me', { jar })
    check('/auth/me exposes the pending address', me.body?.data?.user?.pendingEmail === newAddr,
      String(me.body?.data?.user?.pendingEmail))
    check('and still reports the live one as the account email',
      me.body?.data?.user?.email === oldAddr, String(me.body?.data?.user?.email))
  }

  /* ═══════════════════════════════════════════════ */
  section('C · confirming moves it, and the link needs no session')
  {
    const token = await stealToken(id)

    /* Deliberately no cookie jar: the link is opened from a mailbox, which is
       commonly a different browser or device from the signed-in session. */
    const r = await call('POST', '/auth/confirm-email-change', { body: { token } })
    check('confirming works with no session at all', r.status === 200, `${r.status} ${code(r)}`)
    check('and reports the new address', r.body?.data?.email === newAddr, String(r.body?.data?.email))

    const after = await UserModel.findById(id).lean() as any
    check('the account now carries the new address', after?.email === newAddr, String(after?.email))
    check('and the pending field is cleared', !after?.pendingEmail, String(after?.pendingEmail))
    check('the account counts as verified — the link proved the mailbox',
      after?.isVerified === true, String(after?.isVerified))
  }

  /* ═══════════════════════════════════════════════ */
  section('D · the switch is real: new works, old does not')
  {
    const withNew = await login(newAddr)
    check('the new address signs in', withNew.status === 200, String(withNew.status))

    const withOld = await login(oldAddr)
    check('the OLD address no longer does', withOld.status === 401, String(withOld.status))
  }

  /* ═══════════════════════════════════════════════ */
  section('E · a token is single-use')
  {
    const third = addr('third')
    await call('PATCH', '/auth/me/email', { jar, body: { newEmail: third, currentPassword: PW } })
    const token = await stealToken(id)

    const first = await call('POST', '/auth/confirm-email-change', { body: { token } })
    check('the first use works', first.status === 200, String(first.status))

    const again = await call('POST', '/auth/confirm-email-change', { body: { token } })
    check('the second is refused', again.status === 400, String(again.status))
    check('as an invalid token, not a server error', code(again) === 'INVALID_TOKEN', code(again))

    const after = await UserModel.findById(id).lean() as any
    check('and the address is the one the FIRST use set', after?.email === third, String(after?.email))

    const bogus = await call('POST', '/auth/confirm-email-change', { body: { token: 'not-a-real-token' } })
    check('a made-up token is refused too', bogus.status === 400 && code(bogus) === 'INVALID_TOKEN',
      `${bogus.status} ${code(bogus)}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('F · an address somebody else owns is refused')
  {
    const rival = addr('rival')
    await mkStudent(rival)

    const now = await UserModel.findById(id).lean() as any
    const r = await call('PATCH', '/auth/me/email', {
      jar, body: { newEmail: rival, currentPassword: PW },
    })
    check('taking a registered address is refused', r.status === 409, String(r.status))
    check('and says which problem it is', code(r) === 'EMAIL_TAKEN', code(r))

    const after = await UserModel.findById(id).lean() as any
    check('nothing was parked', !after?.pendingEmail, String(after?.pendingEmail))
    check('and the live address is unchanged', after?.email === now?.email, String(after?.email))
  }

  /* ═══════════════════════════════════════════════ */
  section('G · and refused again at CONFIRM — the hour in between is a race')
  {
    const contested = addr('contested')
    await call('PATCH', '/auth/me/email', { jar, body: { newEmail: contested, currentPassword: PW } })
    const token = await stealToken(id)

    /* Somebody else registers it while the link is sitting in the mailbox.
       Checking only at request time would let the confirm write a duplicate —
       or blow up on the unique index with a message nobody can act on. */
    await mkStudent(contested)

    const r = await call('POST', '/auth/confirm-email-change', { body: { token } })
    check('the confirm is refused', r.status === 409, String(r.status))
    check('with the same clear reason', code(r) === 'EMAIL_TAKEN', code(r))

    const after = await UserModel.findById(id).lean() as any
    check('the account keeps the address it had', after?.email !== contested, String(after?.email))
    check('and the dead request is cleared away', !after?.pendingEmail, String(after?.pendingEmail))
  }

  /* ═══════════════════════════════════════════════ */
  section('H · cancelling kills the outstanding link')
  {
    const abandoned = addr('abandoned')
    await call('PATCH', '/auth/me/email', { jar, body: { newEmail: abandoned, currentPassword: PW } })
    const token = await stealToken(id)

    const before = await UserModel.findById(id).lean() as any
    check('it is parked first', before?.pendingEmail === abandoned, String(before?.pendingEmail))

    const cancel = await call('DELETE', '/auth/me/email', { jar })
    check('cancelling answers', cancel.status === 200, String(cancel.status))

    const after = await UserModel.findById(id).lean() as any
    check('the pending address is gone', !after?.pendingEmail, String(after?.pendingEmail))

    /* Checked HERE, before anything tries the link.

       The deletion is defence in depth, not the load-bearing guard — clearing
       pendingEmail already makes a confirm fail on its own, and a mutation run
       proved that by removing the deleteMany and leaving every other assertion
       in this section green. Worse, claim() consumes a valid token even on the
       attempt that then fails, so asserting AFTER the confirm would measure the
       failed attempt rather than the cancel.

       "We also delete the token" is only true while something checks it. */
    check('the outstanding token was deleted, not just orphaned',
      await AuthTokenModel.countDocuments({ userId: id, purpose: 'change-email', usedAt: null }) === 0,
      String(await AuthTokenModel.countDocuments({ userId: id, purpose: 'change-email', usedAt: null })))

    const used = await call('POST', '/auth/confirm-email-change', { body: { token } })
    check('the link issued earlier no longer works', used.status === 400, String(used.status))
    const now = await UserModel.findById(id).lean() as any
    check('and the address did not move', now?.email !== abandoned, String(now?.email))

  }

  /* ═══════════════════════════════════════════════ */
  section('I · the obvious mistakes get useful answers')
  {
    const me = await UserModel.findById(id).lean() as any
    const same = await call('PATCH', '/auth/me/email', {
      jar, body: { newEmail: me.email, currentPassword: PW },
    })
    check('asking for the address you already have is refused',
      same.status === 400 && code(same) === 'SAME_EMAIL', `${same.status} ${code(same)}`)

    const malformed = await call('PATCH', '/auth/me/email', {
      jar, body: { newEmail: 'not-an-email', currentPassword: PW },
    })
    check('a malformed address is rejected by validation, not stored',
      malformed.status === 422 || malformed.status === 400, String(malformed.status))

    /* Case and whitespace must not create a second identity for one mailbox. */
    const messy = addr('Messy').toUpperCase()
    const r = await call('PATCH', '/auth/me/email', {
      jar, body: { newEmail: `  ${messy}  `, currentPassword: PW },
    })
    check('a shouty, padded address is accepted', r.status === 200, `${r.status} ${code(r)}`)
    check('and stored folded to lower case',
      r.body?.data?.pendingEmail === messy.toLowerCase(), String(r.body?.data?.pendingEmail))
    await call('DELETE', '/auth/me/email', { jar })
  }

  /* ═══════════════════════════════════════════════ */
  section('J · an account with no password cannot use this route')
  {
    /* Social logins have no password to confirm with. Letting them through
       would mean a session alone could move the address — exactly what
       section A exists to prevent. */
    const social = await mkStudent(addr('social'), {
      provider: 'google', providerId: 'g-123',
    })
    await UserModel.updateOne({ _id: social._id }, { $unset: { passwordHash: '' } })

    const sJar: Jar = new Map()
    const { AuthService } = await import('@/services/auth.service.ts')
    void AuthService
    /* No password means no password login, so the session is minted directly —
       the point under test is the service's guard, not how they signed in. */
    const { signAccessToken } = await import('@/utils/jwt.ts')
    const at = await signAccessToken({ id: String(social._id), role: 'student', email: social.email })
    sJar.set('lms_at', at)

    const r = await call('PATCH', '/auth/me/email', {
      jar: sJar, body: { newEmail: addr('nope'), currentPassword: 'anything' },
    })
    check('an account with no password is refused', r.status === 400, String(r.status))
    check('and told why, with what to do instead', code(r) === 'NO_PASSWORD_SET', code(r))
    /* The old code was OAUTH_ACCOUNT and the old message said "This account uses
       social login. Please sign in with Google." There is no Google sign-in in
       this backend -- no /auth/google route, no callback, findByProvider() is
       never called -- so that sentence sent students to a door that does not
       exist. The provider fields above are set only to prove the guard keys off
       the MISSING HASH and not off `provider`. */
    check('and never names a sign-in method that does not exist',
      !/google|social/i.test(msg(r)), msg(r))
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
