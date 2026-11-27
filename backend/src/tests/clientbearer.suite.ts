/* ─────────────────────────────────────────────────────────
   The student website's access token as a Bearer header instead of a cookie
   (2026-11-27, X-Auth-Mode: bearer — mobileClient.ts issueSession,
   authCookies.ts setAuthCookies).
     A. sign-in asked that way: the token is in the answer; NO lms_at cookie;
        the refresh cookie and the readable lms_s marker are set
     B. the API: refused with no token, served with the Bearer
     C. refresh asked that way: a new token in the answer, still no cookie
     D. a session from before (lms_at cookie) keeps working, and its first
        bearer refresh takes the access cookie down — so a stale cookie can
        never outrank a fresh token
     E. not asked (a website from before the change): exactly as before
     F. the mobile app is untouched: tokens in the body, no cookie at all,
        even if it sent the header
     G. sign-out: the marker and the refresh cookie go
     H. a signed-out visitor's refresh sets and answers nothing
   Run: bun --no-env-file src/tests/clientbearer.suite.ts
───────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_clientbearer'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.SMTP_BACKUP_USER = ''; process.env.SMTP_BACKUP_PASS = ''
process.env.JWT_ACCESS_SECRET  ??= 'clientbearer-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'clientbearer-refresh-secret-0123456789abcdef'
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
if (mongoose.connection.db!.databaseName !== 'lms_clientbearer') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

/* A browser's cookie jar: a cookie set with an empty value / Max-Age=0 / a past Expires is REMOVED. */
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar | null, opts: { body?: unknown; bearer?: string; mode?: boolean; mobile?: boolean } = {}) {
  const h: Record<string, string> = {}
  if (opts.mobile) { h['x-client'] = 'mobile'; h['x-device-id'] = 'ab'.repeat(32) }
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
const ME = '/auth/me'

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  await M.UserModel.create({ name: 'student', email: 'student@cb.local', passwordHash: await hashPassword(PW), role: 'student',
    isActive: true, isVerified: true, organizationId: org._id, enrollmentStatus: 'approved' })
  const creds = { email: 'student@cb.local', password: PW }
  const isJwt = (t: unknown) => typeof t === 'string' && t.split('.').length === 3

  section('A. sign-in, asked for a Bearer token')
  const jar: Jar = new Map()
  const login = await call('POST', '/auth/login', jar, { body: creds, mode: true })
  const token: string = login.body?.data?.access_token ?? ''
  check('signs in', login.status === 200, why(login))
  check('the access token is in the answer', isJwt(token), JSON.stringify(Object.keys(login.body?.data ?? {})))
  check('no lms_at cookie is set', !jar.has('lms_at'), [...jar.keys()].join(','))
  check('the refresh cookie is set', jar.has('lms_rt'), [...jar.keys()].join(','))
  check('the marker is set, and is not a token', jar.get('lms_s') === '1', String(jar.get('lms_s')))
  check('the refresh token is never in the answer', !JSON.stringify(login.body).includes(jar.get('lms_rt') ?? 'x'.repeat(40)))

  /* One browser throughout: the LMS holds a NEW device for an admin's approval, and that is not what this is about. */
  const sameDevice = (): Jar => new Map([['lms_device', jar.get('lms_device') ?? '']])

  section('B. the API')
  const none = await call('GET', ME, jar)
  check('the cookies alone are not a sign-in (401)', none.status === 401, why(none))
  const withBearer = await call('GET', ME, jar, { bearer: token, mode: true })
  check('served with the Bearer token', withBearer.status === 200 && JSON.stringify(withBearer.body?.data ?? {}).includes('student@cb.local'), why(withBearer))
  const junk = await call('GET', ME, jar, { bearer: token.slice(0, -4) + 'AAAA' })
  check('a tampered token is refused (401)', junk.status === 401, why(junk))

  section('C. refresh, asked for a Bearer token')
  const ref = await call('POST', '/auth/refresh', jar, { mode: true })
  const token2: string = ref.body?.data?.access_token ?? ''
  check('refreshes', ref.status === 200, why(ref))
  check('a token is in the answer', isJwt(token2), JSON.stringify(ref.body?.data))
  check('still no lms_at cookie; the marker stays', !jar.has('lms_at') && jar.get('lms_s') === '1', [...jar.keys()].join(','))
  const after = await call('GET', ME, jar, { bearer: token2 })
  check('the new token is served', after.status === 200, why(after))

  section('D. a session from before the change')
  const old: Jar = sameDevice()
  const oldLogin = await call('POST', '/auth/login', old, { body: creds })
  check('signed in the old way: lms_at cookie', oldLogin.status === 200 && old.has('lms_at'), why(oldLogin))
  const oldMe = await call('GET', ME, old, { mode: true })
  check('the new website with only that cookie is still served', oldMe.status === 200, why(oldMe))
  const oldRef = await call('POST', '/auth/refresh', old, { mode: true })
  check('its first bearer refresh hands a token', oldRef.status === 200 && isJwt(oldRef.body?.data?.access_token), why(oldRef))
  check('and takes the access cookie down', !old.has('lms_at'), [...old.keys()].join(','))
  check('and sets the marker', old.get('lms_s') === '1')

  section('E. not asked — a website from before the change')
  const legacy: Jar = sameDevice()
  const l = await call('POST', '/auth/login', legacy, { body: creds })
  check('both cookies, as before', l.status === 200 && legacy.has('lms_at') && legacy.has('lms_rt'), [...legacy.keys()].join(','))
  check('no token in the answer', l.body?.data?.access_token === undefined && l.body?.data?.tokens === undefined, JSON.stringify(Object.keys(l.body?.data ?? {})))
  const lMe = await call('GET', ME, legacy)
  check('served by the cookie', lMe.status === 200, why(lMe))
  const lRef = await call('POST', '/auth/refresh', legacy)
  check('refresh answers with no data and keeps the cookie', lRef.status === 200 && lRef.body?.data === null && legacy.has('lms_at'), JSON.stringify(lRef.body?.data))

  section('F. the mobile app')
  const mj: Jar = new Map()
  const m = await call('POST', '/auth/login', mj, { body: creds, mobile: true, mode: true })
  check('signs in (or is held for device approval) without a single session cookie', !mj.has('lms_at') && !mj.has('lms_rt') && !mj.has('lms_s'), `${why(m)} ${[...mj.keys()].join(',')}`)
  if (m.status === 200) {
    check('its tokens are in the body, in its own shape', isJwt(m.body?.data?.tokens?.accessToken) && typeof m.body?.data?.tokens?.refreshToken === 'string', JSON.stringify(Object.keys(m.body?.data ?? {})))
    check('and not in the website shape', m.body?.data?.access_token === undefined)
  } else lines.push(`  note  mobile sign-in answered ${why(m)} — body shape not checked`)

  section('G. sign-out')
  const out = await call('POST', '/auth/logout', jar, { bearer: token2, mode: true })
  check('signs out', out.status === 200, why(out))
  check('the marker and the refresh cookie are gone', !jar.has('lms_s') && !jar.has('lms_rt'), [...jar.keys()].join(','))
  const dead = await call('POST', '/auth/refresh', jar, { mode: true })
  check('refresh is refused afterwards (401)', dead.status === 401, why(dead))

  section('H. a signed-out visitor')
  const vj: Jar = new Map()
  const v = await call('POST', '/auth/refresh', vj, { mode: true })
  check('refresh is refused, sets no cookie, hands no token', v.status === 401 && vj.size === 0 && !JSON.stringify(v.body).includes('access_token'), `${why(v)} ${[...vj.keys()].join(',')}`)
  const forged: Jar = new Map([['lms_s', '1']])
  const f = await call('POST', '/auth/refresh', forged, { mode: true })
  check('a forged marker buys a refusal, and is taken down', f.status === 401 && !forged.has('lms_s'), `${why(f)} ${[...forged.keys()].join(',')}`)
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
