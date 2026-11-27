/* ─────────────────────────────────────────────────────────
   The admin website's access token as a Bearer header instead of a cookie
   (2026-11-27, X-Auth-Mode: bearer — auth.controller.ts wantsBearer,
   authCookies.ts setAdminAuthCookies).
     A. sign-in asked that way: the token is in the answer; NO lms_admin_at
        cookie; the refresh cookie and the lms_admin_s marker are set
     B. the API: refused with no token, served with the Bearer, and the
        refresh cookie alone is not a sign-in
     C. refresh asked that way: a new token in the answer, still no access
        cookie; the new token works
     D. a session from before (lms_admin_at cookie) keeps working, and its
        first bearer refresh takes the access cookie down
     E. not asked (an admin website from before the change): exactly as
        before — both cookies, no token in the answer
     F. sign-out: the marker and the refresh cookie go; refresh is refused
     G. a student is refused either way, and gets no token
   Run: bun --no-env-file src/tests/adminbearer.suite.ts
───────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_adminbearer'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.SMTP_BACKUP_USER = ''; process.env.SMTP_BACKUP_PASS = ''
process.env.JWT_ACCESS_SECRET  ??= 'adminbearer-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'adminbearer-refresh-secret-0123456789abcdef'
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
if (mongoose.connection.db!.databaseName !== 'lms_adminbearer') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

/* A browser's cookie jar: a cookie set with an empty value / Max-Age=0 / a past Expires is REMOVED. */
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar | null, opts: { body?: unknown; bearer?: string; mode?: boolean } = {}) {
  const h: Record<string, string> = {}
  if (opts.body !== undefined) h['content-type'] = 'application/json'
  if (opts.mode) h['x-auth-mode'] = 'bearer'
  if (opts.bearer) h['authorization'] = `Bearer ${opts.bearer}`
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair, ...attrs] = c.split(';'); const i = pair!.indexOf('='); if (i <= 0 || !jar) continue
    const name = pair!.slice(0, i), value = pair!.slice(i + 1)
    const gone = value === '' || attrs.some(a => /^\s*max-age=0\s*$/i.test(a)) ||
      attrs.some(a => { const m = /^\s*expires=(.+)$/i.exec(a); return !!m && Date.parse(m[1]!) <= Date.now() })
    if (gone) jar.delete(name); else jar.set(name, value)
  }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: any) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`
const PW = 'Password-2026'
const ME = '/admin/auth/me'

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string) => M.UserModel.create({
    name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: org._id,
    ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}) })
  await mk('admin@ab.local', 'admin')
  await mk('student@ab.local', 'student')

  section('A. sign-in, asked for a Bearer token')
  const jar: Jar = new Map()
  const login = await call('POST', '/admin/auth/login', jar, { body: { email: 'admin@ab.local', password: PW }, mode: true })
  const token: string = login.body?.data?.access_token ?? ''
  check('signs in', login.status === 200, why(login))
  check('the access token is in the answer', token.split('.').length === 3, JSON.stringify(Object.keys(login.body?.data ?? {})))
  check('no lms_admin_at cookie is set', !jar.has('lms_admin_at'), [...jar.keys()].join(','))
  check('the refresh cookie is set', jar.has('lms_admin_rt'), [...jar.keys()].join(','))
  check('the "a session exists" marker is set, and is not a token', jar.get('lms_admin_s') === '1', String(jar.get('lms_admin_s')))
  check('the refresh token is never in the answer', !JSON.stringify(login.body).includes(jar.get('lms_admin_rt') ?? 'x'.repeat(40)))

  section('B. the API')
  const none = await call('GET', ME, jar)
  check('the cookies alone are not a sign-in (401)', none.status === 401, why(none))
  const withBearer = await call('GET', ME, jar, { bearer: token })
  check('served with the Bearer token', withBearer.status === 200 && JSON.stringify(withBearer.body?.data ?? {}).includes('admin@ab.local'), why(withBearer))
  const bearerOnly = await call('GET', ME, null, { bearer: token })
  check('served with the Bearer token and no cookie at all', bearerOnly.status === 200, why(bearerOnly))
  const junk = await call('GET', ME, jar, { bearer: token.slice(0, -4) + 'AAAA' })
  check('a tampered token is refused (401)', junk.status === 401, why(junk))

  section('C. refresh, asked for a Bearer token')
  const ref = await call('POST', '/admin/auth/refresh', jar, { mode: true })
  const token2: string = ref.body?.data?.access_token ?? ''
  check('refreshes', ref.status === 200, why(ref))
  check('a token is in the answer', token2.split('.').length === 3, JSON.stringify(ref.body?.data))
  check('still no lms_admin_at cookie', !jar.has('lms_admin_at'), [...jar.keys()].join(','))
  check('the marker is still there', jar.get('lms_admin_s') === '1')
  const after = await call('GET', ME, jar, { bearer: token2 })
  check('the new token is served', after.status === 200, why(after))
  const noCookie = await call('POST', '/admin/auth/refresh', new Map(), { mode: true })
  check('no refresh cookie → refused (401), no token', noCookie.status === 401 && !noCookie.body?.data?.access_token, why(noCookie))

  section('D. a session from before the change')
  const old: Jar = new Map()
  const oldLogin = await call('POST', '/admin/auth/login', old, { body: { email: 'admin@ab.local', password: PW } })
  check('signed in the old way: lms_admin_at cookie', oldLogin.status === 200 && old.has('lms_admin_at'), why(oldLogin))
  const oldMe = await call('GET', ME, old, { mode: true })
  check('the new website with only that cookie is still served', oldMe.status === 200, why(oldMe))
  const oldRef = await call('POST', '/admin/auth/refresh', old, { mode: true })
  check('its first bearer refresh hands a token', oldRef.status === 200 && String(oldRef.body?.data?.access_token ?? '').split('.').length === 3, why(oldRef))
  check('and takes the access cookie down', !old.has('lms_admin_at'), [...old.keys()].join(','))
  check('and sets the marker', old.get('lms_admin_s') === '1')

  section('E. not asked — an admin website from before the change')
  const legacy: Jar = new Map()
  const l = await call('POST', '/admin/auth/login', legacy, { body: { email: 'admin@ab.local', password: PW } })
  check('both cookies, as before', l.status === 200 && legacy.has('lms_admin_at') && legacy.has('lms_admin_rt'), [...legacy.keys()].join(','))
  check('no token in the answer', l.body?.data?.access_token === undefined, JSON.stringify(Object.keys(l.body?.data ?? {})))
  const lMe = await call('GET', ME, legacy)
  check('served by the cookie', lMe.status === 200, why(lMe))
  const lRef = await call('POST', '/admin/auth/refresh', legacy)
  check('refresh answers with no data and keeps the cookie', lRef.status === 200 && lRef.body?.data === null && legacy.has('lms_admin_at'), JSON.stringify(lRef.body?.data))

  section('F. sign-out')
  const out = await call('POST', '/admin/auth/logout', jar, { bearer: token2, mode: true })
  check('signs out', out.status === 200, why(out))
  check('the marker and the refresh cookie are gone', !jar.has('lms_admin_s') && !jar.has('lms_admin_rt'), [...jar.keys()].join(','))
  const dead = await call('POST', '/admin/auth/refresh', jar, { mode: true })
  check('refresh is refused afterwards (401)', dead.status === 401, why(dead))

  section('G. a student')
  const sj: Jar = new Map()
  const s = await call('POST', '/admin/auth/login', sj, { body: { email: 'student@ab.local', password: PW }, mode: true })
  check('refused (403)', s.status === 403, why(s))
  check('no token, no marker', !JSON.stringify(s.body).includes('access_token') && !sj.has('lms_admin_s'), [...sj.keys()].join(','))
} catch (err) {
  fail++; lines.push(`  FAIL  the suite threw: ${(err as Error).stack ?? err}`)
} finally {
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
