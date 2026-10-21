/* ─────────────────────────────────────────────────────────────
   The student mobile app's sign-in (plan.md §13.4 B1, B2, B5).

     A  password sign-in with X-Client: mobile → tokens in the body, NO cookie
     B  the access token works as a Bearer; a browser's cookie path is unchanged
     C  refresh with the token in the body rotates it; replaying the old one is
        reuse — every session of the account dies, as on the web
     D  sign-out with the token in the body revokes it
     E  the device id: required, whitelisted like a browser, labelled as the app
     F  email-code sign-in returns tokens too
     G  a browser request gets exactly what it always got
     H  GET /app/config — defaults, and env-driven values

   --no-env-file; nothing here reaches mail or WhatsApp.
   Run: bun run test:mobileauth
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_mobileauth_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.MOBILE_MIN_VERSION = '1.2.0'
process.env.MOBILE_LATEST_VERSION = '1.4.1'
process.env.MOBILE_IOS_STORE_URL = 'https://apps.apple.com/app/id000000000'
process.env.MOBILE_MAINTENANCE = ''
process.env.OTP_DEV_ECHO = '1'
process.env.JWT_ACCESS_SECRET  ??= 'mobileauth-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'mobileauth-suite-refresh-secret-0123456789'

export {}

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

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_mobileauth_suite') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await M.DeviceModel.syncIndexes()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

const PHONE_A = 'a'.repeat(64)
const PHONE_B = 'b'.repeat(64)
const UA = (model: string, os: string) => `DeltaLMS/1.0.0 (${model}; ${os})`

async function call(method: string, path: string, o: { body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) }
  if (o.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
  let body: any = null; try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body, cookies: res.headers.getSetCookie?.() ?? [] }
}
const appHeaders = (deviceId?: string, extra: Record<string, string> = {}) => ({
  'x-client': 'mobile', ...(deviceId ? { 'x-device-id': deviceId } : {}), 'user-agent': UA('iPhone 15', 'iOS 18.1'), ...extra,
})
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'
const authCookie = (cs: string[]) => cs.some(c => /^(lms_at|lms_rt|lms_device)=/.test(c))

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mkStudent = (email: string) => M.UserModel.create({
    name: email.split('@')[0], email, passwordHash: hash, role: 'student', isActive: true, isVerified: true,
    enrollmentStatus: 'approved', organizationId: org._id,
  })
  const amal = await mkStudent('amal@app.local')

  /* ═══ A ═══ */
  section('A. Password sign-in from the app')
  const a = await call('POST', '/auth/login', { headers: appHeaders(PHONE_A), body: { email: 'amal@app.local', password: PW } })
  const t1 = a.body?.data?.tokens
  check('A1 200, with both tokens in the body', a.status === 200 && typeof t1?.accessToken === 'string' && typeof t1?.refreshToken === 'string', why(a))
  check('A2 and NO session or device cookie set', !authCookie(a.cookies), a.cookies.join(' | '))
  check('A3 the user comes back as on the web', a.body?.data?.user?.email === 'amal@app.local')

  /* ═══ B ═══ */
  section('B. The access token works as a Bearer')
  const me = await call('GET', '/auth/me', { headers: { authorization: `Bearer ${t1?.accessToken}` } })
  check('B1 GET /auth/me with the Bearer: 200, the right student', me.status === 200 && (me.body?.data?.user?.email ?? me.body?.data?.email) === 'amal@app.local', why(me))
  const noAuth = await call('GET', '/auth/me')
  check('B2 without it: 401', noAuth.status === 401, why(noAuth))
  const junk = await call('GET', '/auth/me', { headers: { authorization: 'Bearer not-a-token' } })
  check('B3 a forged Bearer: 401', junk.status === 401, why(junk))

  /* ═══ C ═══ */
  section('C. Refresh: rotation, and reuse kills every session')
  const r1 = await call('POST', '/auth/refresh', { headers: appHeaders(PHONE_A), body: { refreshToken: t1?.refreshToken } })
  const t2 = r1.body?.data?.tokens
  check('C1 refresh with the body token: a NEW pair', r1.status === 200 && !!t2?.refreshToken && t2.refreshToken !== t1?.refreshToken && t2.accessToken !== t1?.accessToken, why(r1))
  check('C2 no cookie on the refresh either', !authCookie(r1.cookies), r1.cookies.join(' | '))
  const meAfter = await call('GET', '/auth/me', { headers: { authorization: `Bearer ${t2?.accessToken}` } })
  check('C3 the new access token works', meAfter.status === 200, why(meAfter))
  /* The client USES its new pair (t2 → t3), so a later presentation of t1 is a
     real replay, not a lost answer (the server recovers a lost answer while
     its successor is still unused — mobileadversarial.suite section I) — and
     past the 2-second race grace (ROTATION_RACE_GRACE_MS). */
  const t3 = (await call('POST', '/auth/refresh', { headers: appHeaders(PHONE_A), body: { refreshToken: t2?.refreshToken } })).body?.data?.tokens
  await new Promise(r => setTimeout(r, 2_200))
  const replay = await call('POST', '/auth/refresh', { headers: appHeaders(PHONE_A), body: { refreshToken: t1?.refreshToken } })
  check('C4 replaying a spent refresh token whose successor was already used: 401 TOKEN_REUSE', replay.status === 401 && replay.body?.error?.code === 'TOKEN_REUSE', why(replay))
  const afterReuse = await call('POST', '/auth/refresh', { headers: appHeaders(PHONE_A), body: { refreshToken: t3?.refreshToken } })
  check('C5 and reuse revoked the whole family — the newer token is dead too', !!t3?.refreshToken && afterReuse.status === 401 && afterReuse.body?.error?.code !== 'MISSING_REFRESH_TOKEN', why(afterReuse))
  const noBody = await call('POST', '/auth/refresh', { headers: appHeaders(PHONE_A), body: {} })
  check('C6 no refresh token at all: 401 MISSING_REFRESH_TOKEN', noBody.status === 401 && noBody.body?.error?.code === 'MISSING_REFRESH_TOKEN', why(noBody))

  /* ═══ D ═══ */
  section('D. Sign-out with the body token')
  const d = await call('POST', '/auth/login', { headers: appHeaders(PHONE_A), body: { email: 'amal@app.local', password: PW } })
  const td = d.body?.data?.tokens
  const out = await call('POST', '/auth/logout', { headers: appHeaders(PHONE_A), body: { refreshToken: td?.refreshToken } })
  check('D1 200', out.status === 200, why(out))
  const dead = await call('POST', '/auth/refresh', { headers: appHeaders(PHONE_A), body: { refreshToken: td?.refreshToken } })
  check('D2 that refresh token no longer renews anything', dead.status === 401, why(dead))

  /* ═══ E ═══ */
  section('E. The device id: required, whitelisted, labelled as the app')
  const missing = await call('POST', '/auth/login', { headers: appHeaders(undefined), body: { email: 'amal@app.local', password: PW } })
  check('E1 the app without X-Device-Id: 400 DEVICE_ID_REQUIRED', missing.status === 400 && missing.body?.error?.code === 'DEVICE_ID_REQUIRED', why(missing))
  const bad = await call('POST', '/auth/login', { headers: appHeaders('not-hex'), body: { email: 'amal@app.local', password: PW } })
  check('E2 a malformed id: the same 400', bad.status === 400 && bad.body?.error?.code === 'DEVICE_ID_REQUIRED', why(bad))
  const devA = await M.DeviceModel.findOne({ userId: amal._id, deviceId: PHONE_A }).lean() as any
  check('E3 the first phone is the approved main device', devA?.status === 'approved' && devA?.isMain === true, JSON.stringify({ s: devA?.status, m: devA?.isMain }))
  check('E4 labelled as the app, not "Browser on iOS"', devA?.label === 'Delta app · iPhone 15 (iOS 18.1)', devA?.label)
  const second = await call('POST', '/auth/login', { headers: appHeaders(PHONE_B, { 'user-agent': UA('Pixel 8', 'Android 15') }), body: { email: 'amal@app.local', password: PW } })
  check('E5 a second phone waits for an admin: 403 DEVICE_PENDING', second.status === 403 && second.body?.error?.code === 'DEVICE_PENDING', why(second))
  await M.DeviceModel.updateOne({ userId: amal._id, deviceId: PHONE_B }, { $set: { status: 'approved', approvedAt: new Date() } })
  const approved = await call('POST', '/auth/login', { headers: appHeaders(PHONE_B, { 'user-agent': UA('Pixel 8', 'Android 15') }), body: { email: 'amal@app.local', password: PW } })
  check('E6 once approved, it signs in', approved.status === 200 && !!approved.body?.data?.tokens?.accessToken, why(approved))
  const devB = await M.DeviceModel.findOne({ userId: amal._id, deviceId: PHONE_B }).lean() as any
  check('E7 labelled "Delta app · Pixel 8 (Android 15)"', devB?.label === 'Delta app · Pixel 8 (Android 15)', devB?.label)
  const refreshOtherDevice = await call('POST', '/auth/refresh', { headers: appHeaders('c'.repeat(64)), body: { refreshToken: approved.body?.data?.tokens?.refreshToken } })
  check('E8 a refresh token replayed from an unknown device is refused', refreshOtherDevice.status === 401 || refreshOtherDevice.status === 403, why(refreshOtherDevice))

  /* ═══ F ═══ */
  section('F. Email-code sign-in from the app')
  const bilal = await mkStudent('bilal@app.local')
  const req1 = await call('POST', '/auth/otp/request', { headers: appHeaders('d'.repeat(64)), body: { email: 'bilal@app.local' } })
  const code: string = req1.body?.data?.devCode ?? ''
  check('(a code was issued)', /^\d{4,8}$/.test(code), JSON.stringify(req1.body?.data))
  const f = await call('POST', '/auth/otp/verify', { headers: appHeaders('d'.repeat(64)), body: { email: 'bilal@app.local', code } })
  check('F1 the code signs in with tokens in the body, no cookie', f.status === 200 && !!f.body?.data?.tokens?.refreshToken && !authCookie(f.cookies), why(f))

  /* ═══ G ═══ */
  section('G. A browser gets exactly what it always got')
  await mkStudent('webby@app.local'); await mkStudent('spoof@app.local')   // no device yet — a first sign-in
  const web = await call('POST', '/auth/login', { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' }, body: { email: 'webby@app.local', password: PW } })
  check('G1 cookies set as before', web.status === 200 && web.cookies.some(c => c.startsWith('lms_at=')) && web.cookies.some(c => c.startsWith('lms_rt=')), web.cookies.join(' | '))
  check('G2 and no tokens in the body', !web.body?.data?.tokens)
  const spoof = await call('POST', '/auth/login', { headers: { 'x-device-id': 'e'.repeat(64) }, body: { email: 'spoof@app.local', password: PW } })
  check('G3 X-Device-Id without X-Client: ignored — the browser path, cookie minted', spoof.status === 200 && spoof.cookies.some(c => c.startsWith('lms_device=')) && !(await M.DeviceModel.exists({ deviceId: 'e'.repeat(64) })), why(spoof))

  /* ═══ H ═══ */
  section('H. GET /app/config')
  const cfg = await call('GET', '/app/config')
  const c = cfg.body?.data
  check('H1 public, 200', cfg.status === 200, why(cfg))
  check('H2 versions from env', c?.minVersion === '1.2.0' && c?.latestVersion === '1.4.1', JSON.stringify(c))
  check('H3 store URLs (unset → null)', c?.storeUrls?.ios === 'https://apps.apple.com/app/id000000000' && c?.storeUrls?.android === null, JSON.stringify(c?.storeUrls))
  check('H4 maintenance off by default', c?.maintenance === false)
} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  server.close()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
