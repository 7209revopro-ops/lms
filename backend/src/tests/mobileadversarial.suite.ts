/* ─────────────────────────────────────────────────────────────
   The student app's API, attacked (plan.md §13 — QA round, 2026-10-21).
   The other mobile suites prove the happy paths; this one is what a hostile,
   buggy or unlucky client does.

     A  "X-Client: mobile" from a browser cannot turn a cookie session into
        tokens a script can read
     B  concurrent refreshes (two app screens at once) — none breaks the family
     C  device ids and Bearer tokens that are malformed, foreign or the wrong
        audience
     D  oversized and malformed bodies are refused with 4xx, never a 500
     E  pending, blocked and deleted students: what they can and cannot do
        (a pending student can still DELETE their account — store rule)
     F  join / sign-in links of another student, opened in a signed-in app
     G  sessions: another user's session id, another user's refresh token as
        X-Refresh-Token
     H  what a deleted student leaves behind — every staff screen that lists
        their chats, support tickets and assignments still answers 200

   --no-env-file; mail, WhatsApp, Google, R2 and push blanked.
   Run: bun run test:mobileadversarial
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_mobileadversarial_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.GOOGLE_CLIENT_ID = ''; process.env.GOOGLE_CLIENT_SECRET = ''; process.env.GOOGLE_REFRESH_TOKEN = ''
process.env.GOOGLE_MEET_HOST_EMAIL = ''; process.env.GOOGLE_CALENDAR_ID = ''
process.env.R2_ACCOUNT_ID = ''; process.env.R2_ACCESS_KEY_ID = ''; process.env.R2_SECRET_ACCESS_KEY = ''
process.env.PUSH_ENABLED = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.OTP_DEV_ECHO = '1'
process.env.JWT_ACCESS_SECRET  ??= 'mobileadversarial-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'mobileadversarial-suite-refresh-secret-0123456789'

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
const chat = await import('@/services/chat.service.ts')
const { mintJoinCode } = await import('@/services/joinLink.service.ts')

if (['GOOGLE_CLIENT_ID', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_CALENDAR_ID', 'SMTP_HOST', 'WHATSAPP_API_KEY'].some(k => process.env[k])) {
  console.error('REFUSING TO RUN — an outbound credential reached the suite'); process.exit(1)
}
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_mobileadversarial_suite') { console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await Promise.all([M.DeviceModel.syncIndexes(), M.PushTokenModel.syncIndexes(), M.ChatConversationModel.syncIndexes(), M.ChatMessageModel.syncIndexes()])

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'
let devSeq = 0
const dev = () => (devSeq++).toString(16).padStart(64, 'c')
const APP = (device: string, extra: Record<string, string> = {}) => ({ 'x-client': 'mobile', 'x-device-id': device, 'user-agent': 'DeltaLMS/1.0.0 (Pixel 8; Android 15)', ...extra })

async function call(method: string, p: string, o: { body?: unknown; headers?: Record<string, string>; bearer?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) }
  if (o.bearer) headers['authorization'] = `Bearer ${o.bearer}`
  if (o.body !== undefined || o.raw !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${BASE}${p}`, { method, headers, body: o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body)) })
  let body: any = null; try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body, data: body?.data, cookies: res.headers.getSetCookie?.() ?? [] }
}
const cookieOf = (cs: string[]) => cs.map(c => c.split(';')[0]).join('; ')
/* A student's 2nd+ phone waits for an admin (device whitelist): sign in, approve
   it as an admin would, sign in again. */
async function appLogin(email: string, device: string) {
  let r = await call('POST', '/auth/login', { headers: APP(device), body: { email, password: PW } })
  if (!r.data?.tokens && r.body?.error?.code === 'DEVICE_PENDING') {
    await M.DeviceModel.updateMany({ deviceId: device }, { $set: { status: 'approved', approvedAt: new Date() } })
    r = await call('POST', '/auth/login', { headers: APP(device), body: { email, password: PW } })
  }
  return r.data?.tokens as { accessToken: string; refreshToken: string } | undefined
}
const is4xx = (s: number) => s >= 400 && s < 500

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  let seq = 0
  const mk = (role: string, extra: Record<string, unknown> = {}) => M.UserModel.create({
    name: `${role} ${seq}`, email: `adv${seq++}@app.local`, passwordHash: hash, role, isActive: true, isVerified: true,
    organizationId: org._id, ...extra,
  })
  const fx = { category: '4x-trading', categories: ['4x-trading'] }
  const amal   = await mk('student', { ...fx, enrollmentStatus: 'approved' })
  const bilal  = await mk('student', { ...fx, enrollmentStatus: 'approved' })
  const pend   = await mk('student', { ...fx, enrollmentStatus: 'pending' })
  const mentor = await mk('instructor', { category: '4x-trading', name: 'Sam Mentor' })
  const boss   = await mk('super_admin', { name: 'Boss' })
  const course = await M.CourseModel.create({ title: 'Forex', slug: 'forex', instructorId: mentor._id, organizationId: org._id, status: 'published', price: 0, isFree: true, language: 'en' })
  const lc = await M.LiveClassModel.create({ courseId: course._id, instructorId: mentor._id, organizationId: org._id, title: 'Live', scheduledStart: new Date(Date.now() + 2 * 864e5), durationMins: 60, type: 'external', status: 'scheduled' })

  /* ═══ A ═══ */
  section('A. A browser claiming to be the app')
  const web = await call('POST', '/auth/login', { body: { email: amal.email, password: PW } })
  const webCookie = cookieOf(web.cookies)
  check('A0 a browser sign-in gets cookies, no tokens in the body', /lms_at=/.test(webCookie) && !web.data?.tokens, why(web))
  const spoofRefresh = await call('POST', '/auth/refresh', { headers: { cookie: webCookie, 'x-client': 'mobile', 'x-device-id': dev() }, body: {} })
  check('A1 refresh with "X-Client: mobile" and only the httpOnly cookie: 401 — the cookie is never swapped for readable tokens', spoofRefresh.status === 401 && !spoofRefresh.data?.tokens, why(spoofRefresh))
  const spoofCase = await call('POST', '/auth/refresh', { headers: { cookie: webCookie, 'x-client': 'MOBILE', 'x-device-id': dev() }, body: {} })
  check('A2 the same with different capitalisation: still 401', spoofCase.status === 401, why(spoofCase))
  const webStill = await call('POST', '/auth/refresh', { headers: { cookie: webCookie } })
  check('A3 and the browser session itself is unharmed', webStill.status === 200, why(webStill))

  /* ═══ B ═══ */
  section('B. Concurrent refreshes from one app')
  const dB = dev()
  const t0 = await appLogin(bilal.email, dB)
  const burst = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/auth/refresh', { headers: APP(dB), body: { refreshToken: t0?.refreshToken } })))
  const ok = burst.filter(r => r.status === 200)
  check('B1 five simultaneous refreshes with the same token (two screens racing): every one succeeds (race grace), none 500', ok.length === 5 && burst.every(r => r.status !== 500), burst.map(r => r.status).join(','))
  const newest = ok.at(-1)?.data?.tokens
  const me = await call('GET', '/auth/me', { bearer: newest?.accessToken })
  check('B2 and the session is still alive afterwards', me.status === 200, why(me))
  await new Promise(r => setTimeout(r, 2_300))
  /* A replay 2–60 s later, while the client's pair is unused, is exactly what a
     lost answer looks like — so it is recovered, and the client's own pair is
     retired. The moment the real client uses that pair, the theft shows and
     every session dies (theft detected at the next refresh, as section I). */
  const late = await call('POST', '/auth/refresh', { headers: APP(dB), body: { refreshToken: t0?.refreshToken } })
  check('B3 the original token replayed 2.3 s later: recovered like a lost answer (200)', late.status === 200, why(late))
  const exposed = await call('POST', '/auth/refresh', { headers: APP(dB), body: { refreshToken: newest?.refreshToken } })
  const replayerDead = await call('POST', '/auth/refresh', { headers: APP(dB), body: { refreshToken: late.data?.tokens?.refreshToken } })
  check('B4 then the real client refreshes with its own pair: 401 TOKEN_REUSE, and the replayer is signed out too', exposed.status === 401 && exposed.body?.error?.code === 'TOKEN_REUSE' && replayerDead.status === 401, `${why(exposed)} / ${why(replayerDead)}`)

  /* ═══ C ═══ */
  section('C. Bad device ids and tokens')
  for (const [label, id] of [['upper-case hex', 'A'.repeat(64)], ['63 chars', 'a'.repeat(63)], ['not hex', 'z'.repeat(64)], ['an injection', `${'a'.repeat(60)}' OR`]] as const) {
    const r = await call('POST', '/auth/login', { headers: APP(id), body: { email: amal.email, password: PW } })
    check(`C1 device id that is ${label}: 400 DEVICE_ID_REQUIRED`, r.status === 400 && r.body?.error?.code === 'DEVICE_ID_REQUIRED', why(r))
  }
  const forged = await call('GET', '/auth/me', { bearer: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.' })
  check('C2 an unsigned ("alg: none") token: 401', forged.status === 401, why(forged))
  const adminLogin = await call('POST', '/admin/auth/login', { body: { email: boss.email, password: PW } })
  const adminAt = (adminLogin.cookies.find(c => c.startsWith('lms_admin_at=')) ?? '').split(';')[0]!.split('=')[1]
  const crossAud = await call('GET', '/enrollments/me', { bearer: adminAt })
  check('C3 an ADMIN-portal access token used as the app\'s Bearer on a student route: refused', !!adminAt && is4xx(crossAud.status), why(crossAud))

  /* ═══ D ═══ */
  section('D. Malformed and oversized bodies')
  const dA = dev()
  const aT = await appLogin(amal.email, dA)
  const A = { bearer: aT?.accessToken }
  const sent = await call('POST', '/chat/messages', { ...A, body: { instructorId: String(mentor._id), body: 'hi', clientMsgId: crypto.randomUUID() } })
  const conv = sent.data?.conversationId
  const lesson = await M.LessonModel.create({ courseId: course._id, sectionId: (await M.SectionModel.create({ courseId: course._id, title: 'S', order: 1 }))._id, title: 'L', type: 'video', order: 1, durationMins: 1, contentUrl: 'https://x.invalid/v.mp4' })
  await M.EnrollmentModel.create({ userId: amal._id, courseId: course._id, status: 'active', source: 'admin' })
  const probes: [string, string, string, unknown][] = [
    ['chat message of 2001 characters', 'POST', '/chat/messages', { instructorId: String(mentor._id), body: 'x'.repeat(2001), clientMsgId: crypto.randomUUID() }],
    ['chat message that is only spaces', 'POST', '/chat/messages', { instructorId: String(mentor._id), body: '    ', clientMsgId: crypto.randomUUID() }],
    ['chat to an instructor id that is not an id', 'POST', '/chat/messages', { instructorId: '../../admin', body: 'hi', clientMsgId: crypto.randomUUID() }],
    ['note of 50 001 characters', 'PUT', `/lessons/${lesson._id}/my-note`, { body: 'x'.repeat(50001) }],
    ['watch-time of -5 seconds', 'POST', `/lessons/${lesson._id}/watch-time`, { secs: -5 }],
    ['watch-time that is text', 'POST', `/lessons/${lesson._id}/watch-time`, { secs: 'lots' }],
    ['support message of 5001 characters', 'POST', '/support', { subject: 'Hello there', message: 'x'.repeat(5001) }],
    ['support subject of 2 characters', 'POST', '/support', { subject: 'Hi', message: 'x' }],
    ['push token of 300 characters', 'POST', '/push-tokens', { token: `ExponentPushToken[${'a'.repeat(290)}]`, platform: 'android' }],
    ['quiz answers that are not a list', 'POST', `/quizzes/lessons/${lesson._id}/submit`, { answers: 'all of them' }],
    ['delete-account code of 5 digits', 'DELETE', '/auth/account', { code: '12345' }],
    ['a mongo operator as the password', 'DELETE', '/auth/account', { password: { $ne: '' } }],
  ]
  for (const [label, method, p, body] of probes) {
    const r = await call(method, p, { ...A, body })
    check(`D1 ${label}: refused with 4xx (not a 500, not accepted)`, is4xx(r.status), why(r))
  }
  const junk = await call('POST', '/chat/messages', { ...A, raw: '{"instructorId": "x", body: broken' })
  check('D2 a body that is not JSON at all: 4xx, not a 500', is4xx(junk.status), why(junk))
  check('D3 the account survived the operator-as-password probe', !!(await M.UserModel.findById(amal._id)))
  const xss = await call('POST', '/chat/messages', { ...A, body: { instructorId: String(mentor._id), body: '<img src=x onerror=alert(1)>', clientMsgId: crypto.randomUUID() } })
  const page = await call('GET', `/chat/conversations/${conv}/messages`, A)
  check('D4 markup in a message is stored and returned as plain text (the app renders it as text)', xss.status === 201 && page.data?.messages?.some((m: any) => m.body === '<img src=x onerror=alert(1)>'), why(xss))

  /* ═══ E ═══ */
  section('E. Pending, blocked and deleted students')
  const pT = await appLogin(pend.email, dev())
  const P = { bearer: pT?.accessToken }
  const pBook = await call('POST', '/bookings', { ...P, body: { liveClassId: String(lc._id) } })
  check('E1 a pending student cannot book (403)', pBook.status === 403, why(pBook))
  const pChat = await call('POST', '/chat/messages', { ...P, body: { instructorId: String(mentor._id), body: 'hi', clientMsgId: crypto.randomUUID() } })
  check('E2 a pending student cannot start a chat (4xx, with a reason)', is4xx(pChat.status) && !!pChat.body?.error?.message, why(pChat))
  const pList = await call('GET', '/enrollments/me', P)
  check('E3 but can still browse their learning list', pList.status === 200, why(pList))
  const pDel = await call('DELETE', '/auth/account', { ...P, body: { password: PW } })
  check('E4 and CAN delete their account (store rule: every account deletable)', pDel.status === 200 && !(await M.UserModel.findById(pend._id)), why(pDel))
  const blocked = await mk('student', { ...fx, enrollmentStatus: 'approved' })
  const bT = await appLogin(blocked.email, dev())
  await M.UserModel.updateOne({ _id: blocked._id }, { $set: { isActive: false } })
  const bMe = await call('GET', '/auth/me', { bearer: bT?.accessToken })
  check('E5 a student blocked mid-session: their still-valid access token is refused at once', is4xx(bMe.status), why(bMe))
  const bLogin = await call('POST', '/auth/login', { headers: APP(dev()), body: { email: blocked.email, password: PW } })
  check('E6 and they cannot sign in again', is4xx(bLogin.status) && !bLogin.data?.tokens, why(bLogin))

  /* ═══ F ═══ */
  section('F. Another student\'s links')
  await M.ClassBookingModel.create({ userId: amal._id, liveClassId: lc._id, status: 'booked' })
  const bilalT = await appLogin(bilal.email, dev())
  const code = await mintJoinCode(String(amal._id), String(lc._id))
  const steal = await call('POST', '/auth/join-link/redeem', { headers: APP(dev()), bearer: bilalT?.accessToken, body: { token: code } })
  check('F1 Amal\'s join link opened in Bilal\'s signed-in app: 403 JOIN_LINK_OTHER_ACCOUNT', steal.status === 403 && steal.body?.error?.code === 'JOIN_LINK_OTHER_ACCOUNT', why(steal))
  check('F2 and no session for Amal was handed to Bilal\'s phone', !steal.data?.tokens)
  const bilalMe = await call('GET', '/auth/me', { bearer: bilalT?.accessToken })
  check('F3 Bilal stays signed in as Bilal', bilalMe.status === 200 && (bilalMe.data?.user?.email ?? bilalMe.data?.email) === bilal.email, why(bilalMe))
  const bogus = await call('POST', '/auth/join-link/redeem', { headers: APP(dev()), body: { token: 'x'.repeat(24) } })
  check('F4 a made-up code: 4xx, no tokens', is4xx(bogus.status) && !bogus.data?.tokens, why(bogus))

  /* ═══ G ═══ */
  section('G. Sessions that are not yours')
  const dG = dA  // Amal's existing phone (a third would hit her device limit)
  const gT = aT
  const bilalSessions = await call('GET', '/auth/sessions', { bearer: bilalT?.accessToken })
  const bilalSession = bilalSessions.data?.[0]?.id
  const kill = await call('DELETE', `/auth/sessions/${bilalSession}`, { bearer: gT?.accessToken, headers: APP(dG, { 'x-refresh-token': gT?.refreshToken ?? '' }) })
  check('G1 Amal revoking Bilal\'s session id: 404 (no existence leak, nothing revoked)', kill.status === 404, why(kill))
  const stillBilal = await call('GET', '/auth/me', { bearer: bilalT?.accessToken })
  check('G2 Bilal is unaffected', stillBilal.status === 200, why(stillBilal))
  const theirs = await call('GET', '/auth/sessions', { bearer: gT?.accessToken, headers: APP(dG, { 'x-refresh-token': bilalT?.refreshToken ?? 'x' }) })
  check('G3 Bilal\'s refresh token sent as Amal\'s X-Refresh-Token marks none of Amal\'s sessions as current', theirs.status === 200 && (theirs.data ?? []).every((s: any) => !s.isCurrent), JSON.stringify(theirs.data?.map((s: any) => s.isCurrent)))

  /* ═══ H ═══ */
  section('H. What a deleted student leaves for staff screens')
  const gone = await mk('student', { ...fx, enrollmentStatus: 'approved', name: 'Leaving Student' })
  const goneT = await appLogin(gone.email, dev())
  const G = { bearer: goneT?.accessToken }
  const gSent = await call('POST', '/chat/messages', { ...G, body: { instructorId: String(mentor._id), body: 'bye', clientMsgId: crypto.randomUUID() } })
  await chat.replyAsInstructor(String(mentor._id), gSent.data?.conversationId, { body: 'ok', clientMsgId: crypto.randomUUID() })
  await call('POST', '/support', { ...G, body: { subject: 'Leaving soon', message: 'please close my account' } })
  await M.ClassBookingModel.create({ userId: gone._id, liveClassId: lc._id, status: 'attended' })
  const del = await call('DELETE', '/auth/account', { ...G, body: { password: PW } })
  check('H0 the student deletes their account', del.status === 200, why(del))
  const mentorLogin = await call('POST', '/admin/auth/login', { body: { email: mentor.email, password: PW } })
  const MC = { headers: { cookie: cookieOf(mentorLogin.cookies) } }
  const BC = { headers: { cookie: cookieOf(adminLogin.cookies) } }
  const inbox = await call('GET', '/chat/staff/conversations', MC)
  const orphan = (inbox.data?.items ?? []).find((c: any) => c.id === String(gSent.data?.conversationId))
  check('H1 the mentor\'s inbox still loads (200); the conversation shows no student instead of crashing', inbox.status === 200 && !!orphan && orphan.student === null, `${why(inbox)} ${JSON.stringify(orphan)}`)
  const thread = await call('GET', `/chat/staff/conversations/${gSent.data?.conversationId}/messages`, MC)
  check('H2 opening it still works', thread.status === 200, why(thread))
  const replyGone = await call('POST', `/chat/staff/conversations/${gSent.data?.conversationId}/messages`, { ...MC, body: { body: 'still there?', clientMsgId: crypto.randomUUID() } })
  check('H3 replying to a deleted student is refused with a reason (409), not a 500', replyGone.status === 409, why(replyGone))
  const supportList = await call('GET', '/support/admin', BC)
  check('H4 the support queue still loads (200)', supportList.status === 200, why(supportList))
  const review = await call('GET', '/class-assignments/review', MC)
  check('H5 the assignment review queue still loads (200)', review.status === 200, why(review))
  const info = await call('GET', `/admin/mentor-calendar/classes/${lc._id}`, MC)
  check('H6 the class Info (students booked/joined) still loads (200)', info.status === 200, why(info))
  const oversight = await call('GET', '/chat/oversight/conversations', BC)
  check('H7 the super admin\'s chat oversight still loads (200)', oversight.status === 200, why(oversight))

  /* ═══ I ═══ */
  section('I. A refresh whose answer never arrived (phone in a lift, 15-s timeout)')
  const lostUser = await mk('student', { ...fx, enrollmentStatus: 'approved' })
  const dL = dev()
  const refresh = (t?: string) => call('POST', '/auth/refresh', { headers: APP(dL), body: { refreshToken: t } })
  const L0 = await appLogin(lostUser.email, dL)
  const lost = await refresh(L0?.refreshToken)           // the server rotated — the phone never heard
  await new Promise(r => setTimeout(r, 2_300))           // past the 2-s race grace
  const recovered = await refresh(L0?.refreshToken)
  check('I1 the phone retries with the token it still holds: 200, a fresh pair — not a sign-out everywhere', lost.status === 200 && recovered.status === 200 && !!recovered.data?.tokens?.accessToken, why(recovered))
  const meL = await call('GET', '/auth/me', { bearer: recovered.data?.tokens?.accessToken })
  check('I2 and the recovered session works', meL.status === 200, why(meL))
  const missed = await refresh(lost.data?.tokens?.refreshToken)
  check('I3 the pair the phone never received is never usable — presenting it means it was intercepted: 401 TOKEN_REUSE', missed.status === 401 && missed.body?.error?.code === 'TOKEN_REUSE', why(missed))

  const twinUser = await mk('student', { ...fx, enrollmentStatus: 'approved' })
  const dT = dev()
  const T0 = await appLogin(twinUser.email, dT)
  await call('POST', '/auth/refresh', { headers: APP(dT), body: { refreshToken: T0?.refreshToken } })
  await new Promise(r => setTimeout(r, 2_300))
  const twins = await Promise.all([1, 2].map(() => call('POST', '/auth/refresh', { headers: APP(dT), body: { refreshToken: T0?.refreshToken } })))
  check('I4 two requests recovering the same lost answer at once: both 200, the SAME pair (no second session, no wipe)',
    twins.every(r => r.status === 200) && twins[0]!.data?.tokens?.refreshToken === twins[1]!.data?.tokens?.refreshToken, twins.map(r => why(r)).join(' | '))

  const reuser = await mk('student', { ...fx, enrollmentStatus: 'approved' })
  const dR = dev()
  const R0 = await appLogin(reuser.email, dR)
  const R1 = (await call('POST', '/auth/refresh', { headers: APP(dR), body: { refreshToken: R0?.refreshToken } })).data?.tokens
  const R2 = (await call('POST', '/auth/refresh', { headers: APP(dR), body: { refreshToken: R1?.refreshToken } })).data?.tokens
  await new Promise(r => setTimeout(r, 2_300))
  const replay = await call('POST', '/auth/refresh', { headers: APP(dR), body: { refreshToken: R0?.refreshToken } })
  const afterReplay = await call('POST', '/auth/refresh', { headers: APP(dR), body: { refreshToken: R2?.refreshToken } })
  check('I5 a REAL replay (its successor was already used): 401 TOKEN_REUSE and every session dies, as before', replay.status === 401 && replay.body?.error?.code === 'TOKEN_REUSE' && afterReplay.status === 401, `${why(replay)} / ${why(afterReplay)}`)

  const lateUser = await mk('student', { ...fx, enrollmentStatus: 'approved' })
  const dX = dev()
  const X0 = await appLogin(lateUser.email, dX)
  await call('POST', '/auth/refresh', { headers: APP(dX), body: { refreshToken: X0?.refreshToken } })
  /* Pretend the rotation happened 61 s ago — past the recovery window. */
  const { createHash } = await import('node:crypto')
  const h0 = createHash('sha256').update(X0!.refreshToken).digest('hex')
  const moved = await M.RefreshTokenModel.collection.updateOne({ tokenHash: h0 }, { $set: { updatedAt: new Date(Date.now() - 61_000) } })
  const tooLate = await call('POST', '/auth/refresh', { headers: APP(dX), body: { refreshToken: X0?.refreshToken } })
  check('I6 after the 60-s recovery window the old token is treated as theft again (401 TOKEN_REUSE)', moved.modifiedCount === 1 && tooLate.status === 401 && tooLate.body?.error?.code === 'TOKEN_REUSE', `modified=${moved.modifiedCount} ${why(tooLate)}`)

  /* ═══ J ═══ */
  section('J. A thief covering their tracks with logout (device QA 2026-10-21)')
  const victim = await mk('student', { ...fx, enrollmentStatus: 'approved' })
  const dV = dev()
  const V0 = await appLogin(victim.email, dV)
  /* The thief copied V0, used it, and keeps using what it gave them. */
  const V1 = (await call('POST', '/auth/refresh', { headers: APP(dV), body: { refreshToken: V0?.refreshToken } })).data?.tokens
  const V2 = (await call('POST', '/auth/refresh', { headers: APP(dV), body: { refreshToken: V1?.refreshToken } })).data?.tokens
  /* Then logs out with the stolen V0, hoping to turn it into a quiet 'logout'. */
  const cover = await call('POST', '/auth/logout', { headers: APP(dV), body: { refreshToken: V0?.refreshToken } })
  await new Promise(r => setTimeout(r, 2_300))
  const victimBack = await call('POST', '/auth/refresh', { headers: APP(dV), body: { refreshToken: V0?.refreshToken } })
  check('J1 a logout with an already-rotated token does not erase why it was revoked: the real phone still raises 401 TOKEN_REUSE',
    cover.status === 200 && victimBack.status === 401 && victimBack.body?.error?.code === 'TOKEN_REUSE', `${why(cover)} / ${why(victimBack)}`)
  const thiefAfter = await call('POST', '/auth/refresh', { headers: APP(dV), body: { refreshToken: V2?.refreshToken } })
  check('J2 and the thief\'s session dies with it', thiefAfter.status === 401, why(thiefAfter))
  const live = await appLogin(victim.email, dV)
  const out = await call('POST', '/auth/logout', { headers: APP(dV), body: { refreshToken: live?.refreshToken } })
  const afterOut = await call('POST', '/auth/refresh', { headers: APP(dV), body: { refreshToken: live?.refreshToken } })
  check('J3 an ordinary logout still ends a live session (401, not TOKEN_REUSE)', out.status === 200 && afterOut.status === 401 && afterOut.body?.error?.code !== 'TOKEN_REUSE', `${why(out)} / ${why(afterOut)}`)
} catch (err) {
  check('suite crashed', false, (err as Error).stack ?? String(err))
} finally {
  server.close()
  await new Promise(r => setTimeout(r, 300))
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
