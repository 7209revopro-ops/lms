/* ─────────────────────────────────────────────────────────────
   The student app's account features (plan.md §13.12 P4).

     A  Express registration from the app — tokens in the body, no cookie,
        signed in as "pending"; EMAIL_TAKEN for a second try
     B  Full registration — documents uploaded first (signup-doc), then the
        body the app builds (shared/src/register.ts) is accepted and stored
     C  B6 account deletion — a student WITHOUT a password confirms with an
        emailed code; wrong / reused codes refused; everything cascades,
        push tokens included; the password route still works (website)
     D  Changing the password from the app keeps the app signed in
     E  Signed-in devices — the app's own session is marked, and revoking
        it says so
     F  Help & support with a Bearer — create, list, open, reply

   --no-env-file; mail, WhatsApp, Google, R2 blanked; OTP_DEV_ECHO for codes.
   Run: bun run test:mobileaccount
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_mobileaccount_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.GOOGLE_CLIENT_ID = ''; process.env.GOOGLE_CLIENT_SECRET = ''; process.env.GOOGLE_REFRESH_TOKEN = ''
process.env.GOOGLE_MEET_HOST_EMAIL = ''; process.env.GOOGLE_CALENDAR_ID = ''
process.env.R2_ACCOUNT_ID = ''; process.env.R2_ACCESS_KEY_ID = ''; process.env.R2_SECRET_ACCESS_KEY = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.RATE_LIMIT_SIGNUP_UPLOAD_MAX = '900'
process.env.SIGNUP_REQUIRE_VERIFICATION = ''
process.env.OTP_DEV_ECHO = '1'
process.env.PUSH_ENABLED = ''
process.env.JWT_ACCESS_SECRET  ??= 'mobileaccount-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'mobileaccount-suite-refresh-secret-0123456789'

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
const { isR2Configured } = await import('@/services/r2.service.ts')
const S = await import('../../../shared/src/index.ts')
const fs = await import('node:fs')
const path = await import('node:path')

if (isR2Configured()) { console.error('REFUSING TO RUN — R2 credentials reached the suite'); process.exit(1) }
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_mobileaccount_suite') { console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await Promise.all([M.DeviceModel.syncIndexes(), M.PushTokenModel.syncIndexes()])

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'
let devSeq = 0
const newDevice = () => (devSeq++).toString(16).padStart(64, 'a')
const APP = (device: string, extra: Record<string, string> = {}) => ({ 'x-client': 'mobile', 'x-device-id': device, 'user-agent': 'DeltaLMS/1.0.0 (Pixel 8; Android 15)', ...extra })
const uploadedKeys: string[] = []

async function call(method: string, p: string, o: { body?: unknown; headers?: Record<string, string>; bearer?: string; form?: FormData } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) }
  if (o.bearer) headers['authorization'] = `Bearer ${o.bearer}`
  if (o.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${BASE}${p}`, { method, headers, body: o.form ?? (o.body === undefined ? undefined : JSON.stringify(o.body)) })
  let body: any = null; try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body, data: body?.data, cookies: res.headers.getSetCookie?.() ?? [] }
}
/* A student's 2nd+ phone waits for an admin (the device whitelist): sign in,
   approve it as an admin would, sign in again. */
async function appLoginApproved(email: string, password: string, device: string, ua?: string) {
  const headers = APP(device, ua ? { 'user-agent': ua } : {})
  let r = await call('POST', '/auth/login', { headers, body: { email, password } })
  if (!r.data?.tokens) {
    await M.DeviceModel.updateMany({ deviceId: device }, { $set: { status: 'approved', approvedAt: new Date() } })
    r = await call('POST', '/auth/login', { headers, body: { email, password } })
  }
  return r.data?.tokens as { accessToken: string; refreshToken: string } | undefined
}
const hasAuthCookie = (cs: string[]) => cs.some(c => /^lms_(at|rt)=/.test(c))

/* A tiny real JPEG and PDF — the server checks the bytes, not just the type. */
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
async function upload(buf: Buffer, type: string, name: string, kind: 'kyc' | 'photo', device: string) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buf)], { type }), name)
  form.append('kind', kind)
  const r = await call('POST', '/uploads/signup-doc', { headers: APP(device), form })
  if (r.data?.key) uploadedKeys.push(r.data.key)
  return r
}

try {
  await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  await M.OrganizationModel.create({ name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })

  /* ═══ A ═══ */
  section('A. Express registration from the app')
  const exForm = { ...S.EMPTY_FORM, name: 'Amal Rahman', email: 'Amal@App.Local ', password: 'Secret123', organizationSlug: 'dubai' as const, homeCountry: 'United Arab Emirates', terms: true }
  check('A0 the app\'s own check passes the form', Object.keys(S.validateExpress(exForm)).length === 0)
  const devA = newDevice()
  const ex = await call('POST', '/auth/register', { headers: APP(devA), body: S.expressBody(exForm) })
  check('A1 201 with tokens in the body', ex.status === 201 && !!ex.data?.tokens?.accessToken && !!ex.data?.tokens?.refreshToken, why(ex))
  check('A2 and no session cookie', !hasAuthCookie(ex.cookies), ex.cookies.join(' | '))
  check('A3 the student is signed in as pending (browse only)', ex.data?.user?.role === 'student' && ex.data?.user?.enrollmentStatus === 'pending', JSON.stringify(ex.data?.user))
  const exUser = await M.UserModel.findOne({ email: 'amal@app.local' }).lean()
  check('A4 stored: express, Dubai, email lower-cased', exUser?.signupType === 'express' && !!exUser?.organizationId, JSON.stringify({ t: exUser?.signupType }))
  const again = await call('POST', '/auth/register', { headers: APP(newDevice()), body: S.expressBody(exForm) })
  check('A5 the same email again: 409 EMAIL_TAKEN (the app offers Sign in)', again.status === 409 && again.body?.error?.code === 'EMAIL_TAKEN', why(again))
  const noDevice = await call('POST', '/auth/register', { headers: { 'x-client': 'mobile' }, body: S.expressBody({ ...exForm, email: 'x@app.local' }) })
  check('A6 the app without its device id: 400 DEVICE_ID_REQUIRED', noDevice.status === 400 && noDevice.body?.error?.code === 'DEVICE_ID_REQUIRED', why(noDevice))

  /* ═══ B ═══ */
  section('B. Full registration with documents')
  const devB = newDevice()
  const passport = await upload(PDF, 'application/pdf', 'passport.pdf', 'kyc', devB)
  const idDoc = await upload(JPEG, 'image/jpeg', 'eid.jpg', 'kyc', devB)
  const photo = await upload(JPEG, 'image/jpeg', 'me.jpg', 'photo', devB)
  check('B1 three uploads before the account exists: 201 each, kyc keys and a photo URL', passport.status === 201 && idDoc.status === 201 && photo.status === 201 && /^kyc\//.test(passport.data?.url) && /^kyc\//.test(idDoc.data?.url) && typeof photo.data?.url === 'string',
    `${why(passport)} / ${why(idDoc)} / ${why(photo)}`)
  const fake = await upload(Buffer.from('not really a pdf'), 'application/pdf', 'x.pdf', 'kyc', devB)
  check('B2 a file whose bytes lie about its type: refused', fake.status === 400, why(fake))
  const full: import('../../../shared/src/register.ts').RegisterForm = {
    ...S.EMPTY_FORM, name: 'Bilal Khan', email: 'bilal@app.local', password: 'Secret123', confirmPassword: 'Secret123',
    organizationSlug: 'bangalore', homeCountry: 'India', terms: true, phone: '+919876543210', emergencyContact: '+919812345678',
    gender: 'Male', dateOfBirth: '1995-06-15', nationality: 'Indian', occupation: 'Engineer', idType: 'Aadhaar Card',
    idNumber: S.formatIdNumber('Aadhaar Card', '123456789012'), countryAttendance: 'India', villa: 'Flat 4B', city: 'Bangalore',
    addressCountry: 'India', experienceLevel: 'Beginner', preferredStartDate: S.isoDate(new Date(Date.now() + 7 * 864e5)),
    hearAboutUs: 'Friend / Referral', referralName: 'Sam', programs: ['ai-fundamentals'], paymentMethod: 'Card / Full',
    hasPhoto: true, hasPassport: true, hasIdDoc: true,
  }
  check('B3 the app\'s own four steps pass', [0, 1, 2, 3].every(s => Object.keys(S.validateStep(s, full, v => /^\+\d{8,15}$/.test(v))).length === 0))
  const reg = await call('POST', '/auth/register', { headers: APP(devB), body: S.fullBody(full, { passportUrl: passport.data?.url, idDocUrl: idDoc.data?.url, photoUrl: photo.data?.url }) })
  check('B4 201 with tokens', reg.status === 201 && !!reg.data?.tokens?.accessToken, why(reg))
  const bilal = await M.UserModel.findOne({ email: 'bilal@app.local' }).lean() as any
  const ea = bilal?.enrollmentApplication ?? {}
  check('B5 stored as a full application, Bangalore, every field as sent', bilal?.signupType === 'full' && ea.idNumber === '1234 5678 9012' && ea.referralName === 'Sam' && ea.programs?.[0] === 'ai-fundamentals' && ea.passportUrl === passport.data?.url && ea.idDocUrl === idDoc.data?.url,
    JSON.stringify({ t: bilal?.signupType, ea }))
  check('B6 the photo is the avatar too', bilal?.avatarUrl === photo.data?.url, `${bilal?.avatarUrl} vs ${photo.data?.url}`)
  const forged = await call('POST', '/auth/register', { headers: APP(newDevice()), body: S.fullBody({ ...full, email: 'forged@app.local' }, { passportUrl: 'https://evil.example/p.pdf', idDocUrl: idDoc.data?.url, photoUrl: photo.data?.url }) })
  const forgedFields = S.refusedFields(forged.body?.error?.details)
  check('B7 a document that is not ours: 422, and the app maps it to "Passport Copy", step 2', forged.status === 422 && forgedFields[0]?.label === 'Passport Copy' && forgedFields[0]?.step === 1, `${why(forged)} ${JSON.stringify(forgedFields)}`)

  /* ═══ C ═══ */
  section('C. Deleting an account from the app (B6)')
  const coded = await M.UserModel.create({ name: 'Code Only', email: 'codeonly@app.local', role: 'student', isActive: true, isVerified: true, enrollmentStatus: 'approved' })
  const otpReq = await call('POST', '/auth/otp/request', { headers: APP(newDevice()), body: { email: 'codeonly@app.local' } })
  const devC = newDevice()
  const login = await call('POST', '/auth/otp/verify', { headers: APP(devC), body: { email: 'codeonly@app.local', code: otpReq.data?.devCode } })
  const cT = login.data?.tokens?.accessToken
  check('C0 a passwordless student signs in with an email code', !!cT, why(login))
  await M.PushTokenModel.create({ userId: coded._id, token: 'ExponentPushToken[codeonlyphonexxxxxxxx]', platform: 'android' })
  const noPw = await call('DELETE', '/auth/account', { bearer: cT, headers: APP(devC), body: { password: 'anything' } })
  check('C1 they have no password to confirm with: 400 PASSWORD_REQUIRED (why the code exists)', noPw.status === 400 && noPw.body?.error?.code === 'PASSWORD_REQUIRED', why(noPw))
  const neither = await call('DELETE', '/auth/account', { bearer: cT, headers: APP(devC), body: {} })
  check('C2 neither password nor code: 422', neither.status === 422, why(neither))
  const codeReq = await call('POST', '/auth/account/delete-code', { bearer: cT, headers: APP(devC) })
  const code = codeReq.data?.devCode as string | undefined
  check('C3 a delete code is emailed (dev echo here)', codeReq.status === 200 && /^\d{6}$/.test(code ?? ''), why(codeReq))
  const unauth = await call('POST', '/auth/account/delete-code', {})
  check('C4 asking for a code needs a session', unauth.status === 401, why(unauth))
  const wrong = await call('DELETE', '/auth/account', { bearer: cT, headers: APP(devC), body: { code: code === '000000' ? '111111' : '000000' } })
  check('C5 a wrong code: 400 INVALID_OTP, account kept', wrong.status === 400 && wrong.body?.error?.code === 'INVALID_OTP' && !!(await M.UserModel.findById(coded._id)), why(wrong))
  /* A sign-in code is not a delete code. */
  const otp2 = await call('POST', '/auth/otp/request', { headers: APP(devC), body: { email: 'codeonly@app.local' } })
  const crossed = await call('DELETE', '/auth/account', { bearer: cT, headers: APP(devC), body: { code: otp2.data?.devCode } })
  check('C6 a SIGN-IN code cannot delete the account', crossed.status === 400 && !!(await M.UserModel.findById(coded._id)), why(crossed))
  const ok = await call('DELETE', '/auth/account', { bearer: cT, headers: APP(devC), body: { code } })
  check('C7 the right code: 200, the account is gone', ok.status === 200 && !(await M.UserModel.findById(coded._id)), why(ok))
  check('C8 and so are its push tokens, sessions and devices', await M.PushTokenModel.countDocuments({ userId: coded._id }) === 0 && await M.RefreshTokenModel.countDocuments({ userId: coded._id, isRevoked: false }) === 0 && await M.DeviceModel.countDocuments({ userId: coded._id }) === 0)
  check('C9 the app gets no cookie-clearing headers it cannot use', !ok.cookies.some(c => /^lms_/.test(c)), ok.cookies.join(' | '))
  const after = await call('GET', '/auth/me', { bearer: cT, headers: APP(devC) })
  check('C10 its old access token no longer works', after.status === 401 || after.status === 404, why(after))
  const hash = await hashPassword(PW)
  const pwUser = await M.UserModel.create({ name: 'Has Password', email: 'haspw@app.local', passwordHash: hash, role: 'student', isActive: true, isVerified: true, enrollmentStatus: 'approved' })
  const pwLogin = await call('POST', '/auth/login', { headers: { 'content-type': 'application/json' }, body: { email: 'haspw@app.local', password: PW } })
  const cookie = pwLogin.cookies.map(c => c.split(';')[0]).join('; ')
  const webDel = await call('DELETE', '/auth/account', { headers: { cookie }, body: { password: PW } })
  check('C11 the website\'s password deletion is unchanged (cookie session, { password })', webDel.status === 200 && !(await M.UserModel.findById(pwUser._id)), why(webDel))

  /* ═══ D ═══ */
  section('D. Changing the password from the app')
  const devD = newDevice()
  const d0 = await appLoginApproved('bilal@app.local', 'Secret123', devD)
  const oldRefresh = d0?.refreshToken
  const ch = await call('PATCH', '/auth/me/password', { bearer: d0?.accessToken, headers: APP(devD), body: { currentPassword: 'Secret123', newPassword: 'Newpass456' } })
  const fresh = ch.data?.tokens
  check('D1 200 with a FRESH session in the body (the app stays signed in)', ch.status === 200 && !!fresh?.accessToken && fresh.refreshToken !== oldRefresh, why(ch))
  const me = await call('GET', '/auth/me', { bearer: fresh?.accessToken, headers: APP(devD) })
  check('D2 the new access token works', me.status === 200, why(me))
  const oldR = await call('POST', '/auth/refresh', { headers: APP(devD), body: { refreshToken: oldRefresh } })
  check('D3 the old refresh token is dead', oldR.status === 401, why(oldR))

  /* ═══ E ═══ */
  section('E. Signed-in devices')
  const devE1 = devD
  const devE2 = newDevice()
  const secondT = await appLoginApproved('bilal@app.local', 'Newpass456', devE2, 'DeltaLMS/1.0.0 (iPhone 15; iOS 18.1)')
  const list = await call('GET', '/auth/sessions', { bearer: fresh?.accessToken, headers: APP(devE1, { 'x-refresh-token': fresh?.refreshToken }) })
  const rows = (list.data ?? []) as { id: string; isCurrent: boolean; userAgent?: string }[]
  check('E1 both sessions listed, exactly one marked as this phone', list.status === 200 && rows.length >= 2 && rows.filter(r => r.isCurrent).length === 1, JSON.stringify(rows.map(r => r.isCurrent)))
  const noHeader = await call('GET', '/auth/sessions', { bearer: fresh?.accessToken, headers: APP(devE1) })
  check('E2 without the header nothing is marked (never a wrong guess)', (noHeader.data ?? []).every((r: any) => !r.isCurrent))
  const other = rows.find(r => !r.isCurrent)!
  const revOther = await call('DELETE', `/auth/sessions/${other.id}`, { bearer: fresh?.accessToken, headers: APP(devE1, { 'x-refresh-token': fresh?.refreshToken }) })
  check('E3 signing out the other device: revokedCurrent false', revOther.status === 200 && revOther.data?.revokedCurrent === false, why(revOther))
  const otherRefresh = await call('POST', '/auth/refresh', { headers: APP(devE2), body: { refreshToken: secondT?.refreshToken } })
  check('E4 and that device\'s session is dead', otherRefresh.status === 401, why(otherRefresh))
  const mine = rows.find(r => r.isCurrent)!
  const revMine = await call('DELETE', `/auth/sessions/${mine.id}`, { bearer: fresh?.accessToken, headers: APP(devE1, { 'x-refresh-token': fresh?.refreshToken }) })
  check('E5 signing out THIS phone: revokedCurrent true (the app then signs out)', revMine.status === 200 && revMine.data?.revokedCurrent === true, why(revMine))

  /* ═══ F ═══ */
  section('F. Help & support from the app')
  const devF = newDevice()
  const fT = (await appLoginApproved('bilal@app.local', 'Newpass456', devF))?.accessToken
  const created = await call('POST', '/support', { bearer: fT, headers: APP(devF), body: { subject: 'Cannot see my class', category: 'course', message: 'Tuesday class is missing.' } })
  check('F1 a request is created with a Bearer', (created.status === 201 || created.status === 200) && !!created.data?.id, why(created))
  const listT = await call('GET', '/support/me', { bearer: fT, headers: APP(devF) })
  check('F2 it is in My requests', listT.status === 200 && listT.data?.some((x: any) => x.id === created.data?.id), why(listT))
  const one = await call('GET', `/support/${created.data?.id}`, { bearer: fT, headers: APP(devF) })
  check('F3 opening it (a shared admin/student route) works with the app\'s Bearer', one.status === 200 && one.data?.messages?.[0]?.senderRole === 'student' && one.data.messages[0].body === 'Tuesday class is missing.', JSON.stringify(one.data).slice(0, 400))
  const rep = await call('POST', `/support/${created.data?.id}/messages`, { bearer: fT, headers: APP(devF), body: { body: 'It is the 10 am one.' } })
  check('F4 a reply is added', rep.status === 200 && rep.data?.messages?.length === one.data?.messages?.length + 1 && rep.data.messages.at(-1).senderRole === 'student' && rep.data.messages.at(-1).body === 'It is the 10 am one.', why(rep))
} catch (err) {
  check('suite crashed', false, (err as Error).stack ?? String(err))
} finally {
  for (const key of uploadedKeys) {
    for (const root of [path.resolve('uploads'), path.resolve('public', 'uploads')]) {
      const f = path.join(root, key)
      if (f.startsWith(root) && fs.existsSync(f)) fs.rmSync(f)
    }
  }
  server.close()
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
