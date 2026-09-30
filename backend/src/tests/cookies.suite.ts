/* ─────────────────────────────────────────────────────────────
   M-21 — session cookies are scoped to the host that issued them.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_cookie_suite), dropped on exit. The real `lms` database is never opened.

   The finding: both cookies were pinned to `.deltainstitutions.com` in
   production, so every subdomain could read them. A foothold on any unrelated
   sibling host — a marketing page, a status page, a forgotten staging box —
   handed over a live admin session.

   Two properties are tested, and the SECOND is the one that decides whether
   this can ship without a maintenance window:

     1. New cookies carry no Domain, so they belong to one host only.
     2. The legacy apex-scoped twin is DELETED in the same response. Without
        that, a browser holds two cookies of the same name; the Cookie header
        carries both, the server reads the older one, and for the refresh
        cookie that means presenting an already-rotated token — which trips
        reuse detection and invalidates every session the account has.

   Run: bun run test:cookies
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_cookie_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
delete process.env.COOKIE_DOMAIN
delete process.env.LEGACY_COOKIE_DOMAIN

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
const { UserModel, OrganizationModel, RefreshTokenModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { DEVICE_COOKIE } = await import('@/utils/authCookies.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_cookie_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

/* ── A Set-Cookie reader that keeps the ATTRIBUTES, not just the value.
      Everything here turns on Domain and Max-Age, which a normal cookie jar
      throws away. ───────────────────────────────────────────────────────── */
interface Cookie { name: string; value: string; domain?: string; path?: string; maxAge?: number; deleted: boolean }

function parseSetCookies(res: Response): Cookie[] {
  return (res.headers.getSetCookie?.() ?? []).map(raw => {
    const [pair, ...attrs] = raw.split(';')
    const eq   = pair!.indexOf('=')
    const name = pair!.slice(0, eq)
    const value = pair!.slice(eq + 1)
    const attr = (key: string) => {
      const found = attrs.find(a => a.trim().toLowerCase().startsWith(key + '='))
      return found ? found.split('=').slice(1).join('=').trim() : undefined
    }
    const expires = attr('expires')
    const maxAge  = attr('max-age')
    /* A deletion is an empty value plus an expiry in the past. Express writes
       `Expires=Thu, 01 Jan 1970 00:00:00 GMT`. */
    const deleted = value === '' &&
      ((maxAge !== undefined && Number(maxAge) <= 0) ||
       (expires !== undefined && new Date(expires).getTime() <= Date.now()))
    return { name, value, domain: attr('domain'), path: attr('path'), maxAge: maxAge === undefined ? undefined : Number(maxAge), deleted }
  })
}

/** Decodes a JWT's payload WITHOUT verifying the signature — fine for a test
 *  that already trusts the token came straight from this server's own
 *  Set-Cookie header a moment ago; it only wants to read the `exp` claim. */
function decodeJwtExp(token: string): number | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))
    return typeof payload.exp === 'number' ? payload.exp : undefined
  } catch { return undefined }
}

/** `domain: null` means "must have NO Domain attribute" — distinct from
 *  omitting it, which means "any domain". Conflating the two is how the first
 *  run of this suite reported two false failures. */
const find = (cookies: Cookie[], name: string, opts: { deleted?: boolean; domain?: string | null } = {}) =>
  cookies.filter(c =>
    c.name === name &&
    (opts.deleted === undefined || c.deleted === opts.deleted) &&
    (opts.domain === undefined || (opts.domain === null ? c.domain === undefined : c.domain === opts.domain)))

const PW = 'CorrectHorse1'
const LEGACY = '.deltainstitutions.com'

/* ── One browser, not five.

      A student is allowed two approved devices; a third is held for admin
      approval and is issued NO session cookie at all. This suite signs the
      same student in once per section, and without the `lms_device` cookie
      every one of those looks like a different browser — so from the third
      login onwards there is no `lms_at` to inspect, and the Domain assertions
      fail for a reason that has nothing to do with cookie scope.

      Keeping the device cookie and sending it back is exactly what a browser
      does. ─────────────────────────────────────────────────────────────── */
let deviceCookie: string | null = null

async function post(path: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  const merged = cookie?.includes(`${DEVICE_COOKIE}=`)
    ? cookie
    : [cookie, deviceCookie].filter(Boolean).join('; ')
  if (merged) headers['cookie'] = merged
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: any = text; try { parsed = JSON.parse(text) } catch {}
  const cookies = parseSetCookies(res)
  const dev = cookies.find(c => c.name === DEVICE_COOKIE && !c.deleted)
  if (dev) deviceCookie = `${DEVICE_COOKIE}=${dev.value}`
  return { status: res.status, body: parsed, cookies }
}

try {
  const org  = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string) =>
    UserModel.create({ name: email, email, passwordHash: hash, role, isActive: true, organizationId: org._id })

  await mk('student@t.local', 'student')
  await mk('admin@t.local',   'admin')

  section('A — with nothing configured, cookies are HOST-ONLY  ← the fix')
  {
    const r = await post('/auth/login', { email: 'student@t.local', password: PW })
    check('login still succeeds', r.status === 200, `got ${r.status}`)

    const at = find(r.cookies, 'lms_at', { deleted: false })[0]
    const rt = find(r.cookies, 'lms_rt', { deleted: false })[0]
    check('the access cookie is issued', !!at)
    check('the refresh cookie is issued', !!rt)
    check('the access cookie carries NO Domain', at?.domain === undefined, `domain=${at?.domain}`)
    check('the refresh cookie carries NO Domain', rt?.domain === undefined, `domain=${rt?.domain}`)
    check('the refresh cookie keeps its narrow path', rt?.path === '/api/v1/auth', `path=${rt?.path}`)
    check('nothing is evicted when no legacy scope is configured',
      r.cookies.filter(c => c.deleted).length === 0,
      r.cookies.filter(c => c.deleted).map(c => c.name).join(','))
  }

  section('B — the host-only cookie actually WORKS  ← the functionality guarantee')
  {
    const r = await post('/auth/login', { email: 'student@t.local', password: PW })
    const jar = r.cookies.filter(c => !c.deleted).map(c => `${c.name}=${c.value}`).join('; ')
    const me = await fetch(`${BASE}/auth/me`, { headers: { cookie: jar } })
    check('the session it issues authenticates a request', me.status === 200, `got ${me.status}`)

    /* And the refresh cookie rotates, which is what the eviction below exists
       to protect: a rotated token presented twice invalidates everything. */
    const refreshed = await post('/auth/refresh', undefined, jar)
    check('refresh rotates on that cookie', refreshed.status === 200, `got ${refreshed.status}`)
    check('rotation issues a fresh host-only refresh cookie',
      find(refreshed.cookies, 'lms_rt', { deleted: false })[0]?.domain === undefined)
  }

  section('C — the legacy apex cookie is EVICTED in the same response  ← no forced sign-out')
  {
    process.env.LEGACY_COOKIE_DOMAIN = LEGACY
    const r = await post('/auth/login', { email: 'student@t.local', password: PW })

    const newAt = find(r.cookies, 'lms_at', { deleted: false })[0]
    const delAt = find(r.cookies, 'lms_at', { deleted: true })[0]
    const delRt = find(r.cookies, 'lms_rt', { deleted: true })[0]

    check('a live host-only access cookie is still issued', !!newAt && newAt.domain === undefined)
    check('the apex-scoped access cookie is deleted', !!delAt && delAt.domain === LEGACY,
      `domain=${delAt?.domain}`)
    check('the apex-scoped refresh cookie is deleted', !!delRt && delRt.domain === LEGACY,
      `domain=${delRt?.domain}`)
    check('the deletion targets the refresh cookie\'s own path — a mismatched path deletes nothing',
      delRt?.path === '/api/v1/auth', `path=${delRt?.path}`)
    check('the deletion is scoped: it never targets the host-only cookie just set',
      find(r.cookies, 'lms_at', { deleted: true, domain: null }).length === 0)
  }

  section('D — a configured shared scope is honoured, and never self-destructs')
  {
    /* The escape hatch. If the apps are ever split across hosts that must share
       one session, COOKIE_DOMAIN restores the old behaviour without a code
       change — and must NOT then delete what it just set. */
    process.env.COOKIE_DOMAIN        = LEGACY
    process.env.LEGACY_COOKIE_DOMAIN = LEGACY
    const r = await post('/auth/login', { email: 'student@t.local', password: PW })

    check('cookies carry the configured Domain',
      find(r.cookies, 'lms_at', { deleted: false })[0]?.domain === LEGACY)
    check('NOTHING is deleted when the legacy scope equals the current one',
      r.cookies.filter(c => c.deleted).length === 0,
      r.cookies.filter(c => c.deleted).map(c => `${c.name}@${c.domain}`).join(','))

    delete process.env.COOKIE_DOMAIN
  }

  section('E — logout clears BOTH scopes  ← otherwise "sign out" does not sign out')
  {
    process.env.LEGACY_COOKIE_DOMAIN = LEGACY
    const login = await post('/auth/login', { email: 'student@t.local', password: PW })
    const jar = login.cookies.filter(c => !c.deleted).map(c => `${c.name}=${c.value}`).join('; ')
    const out = await post('/auth/logout', undefined, jar)

    check('logout succeeds', out.status === 200, `got ${out.status}`)
    check('the host-only access cookie is cleared',
      find(out.cookies, 'lms_at', { deleted: true, domain: null }).length === 1)
    check('the apex-scoped access cookie is cleared too',
      find(out.cookies, 'lms_at', { deleted: true, domain: LEGACY }).length === 1)
    check('the apex-scoped refresh cookie is cleared too',
      find(out.cookies, 'lms_rt', { deleted: true, domain: LEGACY }).length === 1)
    check('every lms_at header in the response is a deletion — none re-issues a session',
      find(out.cookies, 'lms_at').every(c => c.deleted))
  }

  section('F — the admin portal gets the same treatment, on its own cookie names')
  {
    process.env.LEGACY_COOKIE_DOMAIN = LEGACY
    const r = await post('/admin/auth/login', { email: 'admin@t.local', password: PW })
    check('admin login succeeds', r.status === 200, `got ${r.status}`)

    check('the admin access cookie is host-only',
      find(r.cookies, 'lms_admin_at', { deleted: false })[0]?.domain === undefined)
    check('the admin refresh cookie is host-only',
      find(r.cookies, 'lms_admin_rt', { deleted: false })[0]?.domain === undefined)
    check('the apex-scoped admin access cookie is evicted',
      find(r.cookies, 'lms_admin_at', { deleted: true, domain: LEGACY }).length === 1)
    check('the apex-scoped admin refresh cookie is evicted on ITS path',
      find(r.cookies, 'lms_admin_rt', { deleted: true, domain: LEGACY })[0]?.path === '/api/v1/admin/auth',
      find(r.cookies, 'lms_admin_rt', { deleted: true, domain: LEGACY })[0]?.path)

    const jar = r.cookies.filter(c => !c.deleted).map(c => `${c.name}=${c.value}`).join('; ')
    const users = await fetch(`${BASE}/admin/users`, { headers: { cookie: jar } })
    check('the host-only admin cookie authenticates the admin API', users.status === 200, `got ${users.status}`)
  }

  section('G — client and admin sessions stay independent')
  {
    const c = await post('/auth/login',       { email: 'student@t.local', password: PW })
    const a = await post('/admin/auth/login', { email: 'admin@t.local',   password: PW })
    const names = new Set([...c.cookies, ...a.cookies].map(x => x.name))
    check('four distinct cookie names across the two portals',
      ['lms_at', 'lms_rt', 'lms_admin_at', 'lms_admin_rt'].every(n => names.has(n)),
      [...names].join(','))
    check('the client login never touches an admin cookie',
      c.cookies.every(x => !x.name.startsWith('lms_admin')))
  }

  section('H — "Remember me" actually shortens the session when unchecked')
  {
    /* Three independent things used to each read JWT_REFRESH_EXPIRES_IN on
       their own and only agreed by coincidence: the refresh JWT's own `exp`
       claim, the lms_rt cookie's Max-Age, and the RefreshToken DB row's
       expiresAt (its TTL index). This proves all three now move together off
       one shared value (refreshTtl.ts) instead of the cookie being the only
       thing (or nothing at all) that changes. */
    const remembered = await post('/auth/login', { email: 'student@t.local', password: PW, remember: true })
    const notRemembered = await post('/auth/login', { email: 'student@t.local', password: PW, remember: false })

    /* Read the DB row right after the un-remembered login that created it —
       not after the two logins below it, which would leave `.sort({
       createdAt: -1 })` picking up one of THEIR (30-day) rows instead. */
    const student = await UserModel.findOne({ email: 'student@t.local' }).lean()
    const row = await RefreshTokenModel.findOne({ userId: student!._id }).sort({ createdAt: -1 }).lean()
    check('the DB row backing the un-remembered session also expires in ~1 day',
      !!row && Math.abs(row.expiresAt.getTime() - (Date.now() + 86_400 * 1000)) < 60_000,
      row ? String(row.expiresAt) : 'no row found')

    const omitted = await post('/auth/login', { email: 'student@t.local', password: PW })

    const rtRemembered    = find(remembered.cookies, 'lms_rt', { deleted: false })[0]
    const rtNotRemembered = find(notRemembered.cookies, 'lms_rt', { deleted: false })[0]
    const rtOmitted       = find(omitted.cookies, 'lms_rt', { deleted: false })[0]

    const THIRTY_DAYS_S = 30 * 86_400
    const ONE_DAY_S     = 1  * 86_400

    check('remember:true issues a ~30-day cookie',
      !!rtRemembered?.maxAge && Math.abs(rtRemembered.maxAge - THIRTY_DAYS_S) < 60,
      String(rtRemembered?.maxAge))
    check('omitting remember defaults to the same ~30 days as remember:true',
      !!rtOmitted?.maxAge && Math.abs(rtOmitted.maxAge - THIRTY_DAYS_S) < 60,
      String(rtOmitted?.maxAge))
    check('remember:false shortens the cookie to ~1 day, not 30',
      !!rtNotRemembered?.maxAge && Math.abs(rtNotRemembered.maxAge - ONE_DAY_S) < 60,
      String(rtNotRemembered?.maxAge))

    /* The JWT's own exp claim, decoded straight off the cookie value — must
       agree with the cookie's Max-Age, not just happen to look similar. */
    const expRemembered    = decodeJwtExp(rtRemembered?.value ?? '')
    const expNotRemembered = decodeJwtExp(rtNotRemembered?.value ?? '')
    const nowS = Math.floor(Date.now() / 1000)
    check('the remembered refresh JWT itself expires in ~30 days, matching its cookie',
      !!expRemembered && Math.abs((expRemembered - nowS) - THIRTY_DAYS_S) < 60,
      String(expRemembered ? expRemembered - nowS : expRemembered))
    check('the un-remembered refresh JWT itself expires in ~1 day, matching its cookie',
      !!expNotRemembered && Math.abs((expNotRemembered - nowS) - ONE_DAY_S) < 60,
      String(expNotRemembered ? expNotRemembered - nowS : expNotRemembered))

    /* Every OTHER issuance path ignores `remember` entirely and keeps the
       full session — confirmed against registration, which never even sees
       this field. */
    const reg = await post('/auth/register', {
      name: 'Fresh Student', email: `fresh-${Date.now()}@t.local`, password: 'CorrectHorse1',
    })
    const rtReg = find(reg.cookies, 'lms_rt', { deleted: false })[0]
    check('registration (no remember field at all) still gets the full ~30-day session',
      !!rtReg?.maxAge && Math.abs(rtReg.maxAge - THIRTY_DAYS_S) < 60, String(rtReg?.maxAge))
  }

} finally {
  delete process.env.COOKIE_DOMAIN
  delete process.env.LEGACY_COOKIE_DOMAIN
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
