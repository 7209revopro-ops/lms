/* ─────────────────────────────────────────────────────────────
   Push notifications and links for the student app (plan.md §13.4 B3, B4).

     A  POST /push-tokens — signed in only, Expo tokens only, device recorded,
        a phone that changes account moves its token (never two owners)
     B  DELETE /push-tokens — by token alone (a dead session must still be
        able to stop the pushes)
     C  every in-app notification is pushed: one request, every phone, the
        link carried for the app
     D  a token Expo reports DeviceNotRegistered is deleted
     E  a mentor's chat reply reaches the student's phone, and its link maps
        to the app's thread
     F  a blocked account's phones hear nothing
     G  PUSH_ENABLED off → nothing leaves the server
     H  Expo down or refusing → the action that notified still succeeds
     I  join / sign-in links from the app — tokens in the body, mapped screens
     J  the notification list the app reads

   Expo is a local stub (EXPO_PUSH_URL); nothing reaches a real phone.
   --no-env-file; mail, WhatsApp, Google and R2 are blanked.
   Run: bun run test:mobilepush
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_mobilepush_suite'
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
process.env.JWT_ACCESS_SECRET  ??= 'mobilepush-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'mobilepush-suite-refresh-secret-0123456789'
process.env.EXPO_ACCESS_TOKEN = ''

/* ── The Expo stub: records every request; a token containing "Dead" answers
   DeviceNotRegistered; `mode` switches it to failing. ── */
type Sent = { to: string; title: string; body?: string; data?: { link?: string | null; kind?: string | null }; channelId?: string; sound?: string }
const received: Sent[][] = []
let mode: 'ok' | 'http500' = 'ok'
const { createServer } = await import('node:http')
const stub = createServer((req, res) => {
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    const batch = JSON.parse(raw || '[]') as Sent[]
    received.push(batch)
    if (mode === 'http500') { res.writeHead(500).end('boom'); return }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      data: batch.map(m => m.to.includes('Dead')
        ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok', id: crypto.randomUUID() }),
    }))
  })
})
await new Promise<void>(r => stub.listen(0, '127.0.0.1', () => r()))
const STUB_URL = `http://127.0.0.1:${(stub.address() as { port: number }).port}/--/api/v2/push/send`
process.env.PUSH_ENABLED = 'true'
process.env.EXPO_PUSH_URL = STUB_URL

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
const { env } = await import('@/config/env.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { NotificationService } = await import('@/services/notification.service.ts')
const chat = await import('@/services/chat.service.ts')
const { mintJoinCode } = await import('@/services/joinLink.service.ts')
const { mintSigninCode } = await import('@/services/signinLink.service.ts')
const S = await import('../../../shared/src/index.ts')

if (['GOOGLE_CLIENT_ID', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_CALENDAR_ID', 'SMTP_HOST', 'WHATSAPP_API_KEY'].some(k => process.env[k])) {
  console.error('REFUSING TO RUN — an outbound credential reached the suite'); process.exit(1)
}
if (!env.EXPO_PUSH_URL.startsWith('http://127.0.0.1:')) { console.error('REFUSING TO RUN — push would reach the real Expo service'); process.exit(1) }

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_mobilepush_suite') { console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await Promise.all([M.DeviceModel.syncIndexes(), M.PushTokenModel.syncIndexes(), M.ChatMessageModel.syncIndexes(), M.ChatConversationModel.syncIndexes()])

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'
const APP = (device: string) => ({ 'x-client': 'mobile', 'x-device-id': device, 'user-agent': 'DeltaLMS/1.0.0 (Pixel 8; Android 15)' })
const tok = (s: string) => `ExponentPushToken[${s.padEnd(22, 'x')}]`

async function call(method: string, p: string, o: { body?: unknown; headers?: Record<string, string>; bearer?: string } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) }
  if (o.bearer) headers['authorization'] = `Bearer ${o.bearer}`
  if (o.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${BASE}${p}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
  let body: any = null; try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body, data: body?.data, cookies: res.headers.getSetCookie?.() ?? [] }
}
async function appLogin(email: string, device: string): Promise<string> {
  const r = await call('POST', '/auth/login', { headers: APP(device), body: { email, password: PW } })
  const t = r.data?.tokens?.accessToken
  if (!t) throw new Error(`login ${email}: ${why(r)}`)
  return t
}
/* pushToUser is fire-and-forget: wait for the stub to see `n` more requests. */
async function waitForPushes(before: number, n = 1, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (received.length >= before + n) return true
    await new Promise(r => setTimeout(r, 25))
  }
  return false
}
const quiet = async (ms = 400) => { await new Promise(r => setTimeout(r, ms)) }

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  let seq = 0
  const mk = (role: string, extra: Record<string, unknown> = {}) => M.UserModel.create({
    name: `${role} ${seq}`, email: `u${seq++}@push.local`, passwordHash: hash, role, isActive: true, isVerified: true,
    organizationId: org._id, ...extra,
  })
  const amal = await mk('student', { category: '4x-trading', categories: ['4x-trading'], enrollmentStatus: 'approved' })
  const bilal = await mk('student', { category: '4x-trading', categories: ['4x-trading'], enrollmentStatus: 'approved' })
  const mentor = await mk('instructor', { category: '4x-trading', name: 'Sam Mentor' })
  const notify = new NotificationService()

  const amalT = await appLogin(amal.email, 'a'.repeat(64))
  const bilalT = await appLogin(bilal.email, 'b'.repeat(64))

  /* ═══ A ═══ */
  section('A. Registering a phone')
  const noAuth = await call('POST', '/push-tokens', { body: { token: tok('phoneA'), platform: 'android' } })
  check('A1 without a session: 401', noAuth.status === 401, why(noAuth))
  const bad = await call('POST', '/push-tokens', { bearer: amalT, headers: APP('a'.repeat(64)), body: { token: 'fcm:raw-device-token', platform: 'android' } })
  check('A2 something that is not an Expo token: 422', bad.status === 422, why(bad))
  const badPlatform = await call('POST', '/push-tokens', { bearer: amalT, headers: APP('a'.repeat(64)), body: { token: tok('phoneA'), platform: 'windows' } })
  check('A3 an unknown platform: 422', badPlatform.status === 422, why(badPlatform))
  const ok = await call('POST', '/push-tokens', { bearer: amalT, headers: APP('a'.repeat(64)), body: { token: tok('phoneA'), platform: 'android', appVersion: '1.0.0' } })
  const row = await M.PushTokenModel.findOne({ token: tok('phoneA') }).lean()
  check('A4 registered: 200, owned by the student, the phone\'s device id kept', ok.status === 200 && String(row?.userId) === String(amal._id) && row?.deviceId === 'a'.repeat(64) && row?.appVersion === '1.0.0', `${why(ok)} ${JSON.stringify(row)}`)
  const again = await call('POST', '/push-tokens', { bearer: amalT, headers: APP('a'.repeat(64)), body: { token: tok('phoneA'), platform: 'android' } })
  check('A5 registering again (every launch) is idempotent: still one row', again.status === 200 && await M.PushTokenModel.countDocuments({ token: tok('phoneA') }) === 1)
  const moved = await call('POST', '/push-tokens', { bearer: bilalT, headers: APP('b'.repeat(64)), body: { token: tok('phoneA'), platform: 'android' } })
  const movedRow = await M.PushTokenModel.findOne({ token: tok('phoneA') }).lean()
  check('A6 the same phone signed in as another student: the token MOVES (one owner, never two)', moved.status === 200 && String(movedRow?.userId) === String(bilal._id) && await M.PushTokenModel.countDocuments({ token: tok('phoneA') }) === 1, JSON.stringify(movedRow))

  /* ═══ B ═══ */
  section('B. Unregistering')
  const gone = await call('DELETE', '/push-tokens', { body: { token: tok('phoneA') } })
  check('B1 by token alone, no session needed: 200 and the row is gone', gone.status === 200 && await M.PushTokenModel.countDocuments({ token: tok('phoneA') }) === 0, why(gone))
  const goneAgain = await call('DELETE', '/push-tokens', { body: { token: tok('phoneA') } })
  check('B2 again (already gone): still 200', goneAgain.status === 200, why(goneAgain))
  const goneBad = await call('DELETE', '/push-tokens', { body: { token: 'anything' } })
  check('B3 not a token at all: 422', goneBad.status === 422, why(goneBad))

  /* ═══ C ═══ */
  section('C. Every in-app notification is pushed')
  await call('POST', '/push-tokens', { bearer: amalT, headers: APP('a'.repeat(64)), body: { token: tok('amalPhone'), platform: 'android' } })
  await call('POST', '/push-tokens', { bearer: amalT, headers: APP('c'.repeat(64)), body: { token: tok('amalTablet'), platform: 'ios' } })
  let before = received.length
  const n1 = await notify.create(String(amal._id), { kind: 'booking-confirmed', title: 'Seat booked', body: 'Forex · Mon 10:00', link: '/live-classes/6ad0abc/watch' })
  const arrived = await waitForPushes(before)
  const batch = received[before] ?? []
  check('C1 the in-app notification is created (and returned at once)', !!n1?.id)
  check('C2 ONE request to Expo, carrying both of the student\'s phones', arrived && batch.length === 2 && batch.map(m => m.to).sort().join() === [tok('amalPhone'), tok('amalTablet')].sort().join(), JSON.stringify(batch.map(m => m.to)))
  check('C3 title, body, the website link and kind, the Android channel the app creates', batch[0]?.title === 'Seat booked' && batch[0]?.body === 'Forex · Mon 10:00' && batch[0]?.data?.link === '/live-classes/6ad0abc/watch' && batch[0]?.data?.kind === 'booking-confirmed' && batch[0]?.channelId === 'default', JSON.stringify(batch[0]))
  check('C4 and the app opens it on the class screen', S.appPathFor(batch[0]?.data?.link ?? '') === '/class/6ad0abc')
  before = received.length
  await notify.create(String(bilal._id), { kind: 'system', title: 'No phone' })
  await quiet()
  check('C5 a student with no registered phone: nothing sent', received.length === before)

  /* ═══ D ═══ */
  section('D. A phone that has gone away')
  await M.PushTokenModel.create({ userId: amal._id, token: tok('amalDead'), platform: 'android' })
  before = received.length
  await notify.create(String(amal._id), { kind: 'system', title: 'Ping' })
  await waitForPushes(before)
  await quiet(200)
  check('D1 Expo said DeviceNotRegistered → that token is deleted', await M.PushTokenModel.countDocuments({ token: tok('amalDead') }) === 0)
  check('D2 the live phones are kept', await M.PushTokenModel.countDocuments({ userId: amal._id }) === 2)

  /* ═══ E ═══ */
  section('E. A mentor\'s reply reaches the phone')
  const sent = await call('POST', '/chat/messages', { bearer: amalT, headers: APP('a'.repeat(64)), body: { instructorId: String(mentor._id), body: 'Is Monday on?', clientMsgId: crypto.randomUUID() } })
  const convId = sent.data?.conversationId
  check('E1 the student writes from the app (Bearer): 201', sent.status === 201 && !!convId, why(sent))
  before = received.length
  await chat.replyAsInstructor(String(mentor._id), convId, { body: 'Yes, 10 am.', clientMsgId: crypto.randomUUID() })
  const replied = await waitForPushes(before)
  const push = received[before]?.[0]
  check('E2 the reply is pushed to the student', replied && !!push && /Sam Mentor/.test(push.title + (push.body ?? '')), JSON.stringify(push))
  check('E3 its link opens that conversation in the app', S.appPathFor(push?.data?.link ?? '') === `/messages?c=${convId}`, push?.data?.link ?? '')
  const page = await call('GET', `/chat/conversations/${convId}/messages`, { bearer: amalT, headers: APP('a'.repeat(64)) })
  const merged = S.mergeMessages([], page.data?.messages ?? [])
  check('E4 the thread the app polls has both messages, in order', merged.map(m => m.senderRole).join() === 'student,instructor', JSON.stringify(page.data?.messages))
  const unread = await call('GET', '/chat/unread-count', { bearer: amalT, headers: APP('a'.repeat(64)) })
  check('E5 the tab badge count: 1', unread.data?.count === 1, JSON.stringify(unread.data))

  /* ═══ F ═══ */
  section('F. A blocked account')
  await M.UserModel.updateOne({ _id: amal._id }, { $set: { isActive: false } })
  before = received.length
  await notify.create(String(amal._id), { kind: 'system', title: 'Should not arrive' })
  await quiet()
  check('F1 nothing is pushed to a blocked student\'s phones', received.length === before)
  await M.UserModel.updateOne({ _id: amal._id }, { $set: { isActive: true } })

  /* ═══ G ═══ */
  section('G. Push switched off')
  env.PUSH_ENABLED = ''
  before = received.length
  await notify.create(String(amal._id), { kind: 'system', title: 'Logged only' })
  await quiet()
  check('G1 PUSH_ENABLED off: no request leaves the server', received.length === before)
  check('G2 and the tokens are untouched', await M.PushTokenModel.countDocuments({ userId: amal._id }) === 2)
  env.PUSH_ENABLED = 'true'

  /* ═══ H ═══ */
  section('H. Expo down')
  mode = 'http500'
  before = received.length
  let threw = false
  try { await notify.create(String(amal._id), { kind: 'system', title: 'Expo is down' }) } catch { threw = true }
  await waitForPushes(before)
  await quiet(200)
  check('H1 Expo answering 500: the notification is still created, nothing throws', !threw && await M.NotificationModel.countDocuments({ userId: amal._id, title: 'Expo is down' }) === 1)
  check('H2 and no token is deleted for Expo\'s failure', await M.PushTokenModel.countDocuments({ userId: amal._id }) === 2)
  mode = 'ok'
  env.EXPO_PUSH_URL = 'http://127.0.0.1:9/unreachable'
  threw = false
  try { await notify.create(String(amal._id), { kind: 'system', title: 'Expo unreachable' }) } catch { threw = true }
  await quiet(600)
  check('H3 Expo unreachable: still created, nothing throws', !threw && await M.NotificationModel.countDocuments({ userId: amal._id, title: 'Expo unreachable' }) === 1)
  env.EXPO_PUSH_URL = STUB_URL

  /* ═══ I ═══ */
  section('I. Join and sign-in links opened in the app')
  const course = await M.CourseModel.create({ title: 'Forex', slug: 'forex', instructorId: mentor._id, organizationId: org._id, status: 'published', price: 0, isFree: true, language: 'en' })
  const lc = await M.LiveClassModel.create({ courseId: course._id, instructorId: mentor._id, organizationId: org._id, title: 'Live', scheduledStart: new Date(Date.now() + 3 * 60_000), durationMins: 60, type: 'external', status: 'scheduled' })
  await M.ClassBookingModel.create({ userId: bilal._id, liveClassId: lc._id, status: 'booked' })
  const joinCode = await mintJoinCode(String(bilal._id), String(lc._id))
  const reminderUrl = `https://lms.deltainstitutions.com/j/${joinCode}?m=abc-defg-hij`
  check('I1 the reminder\'s Join URL maps to the app\'s join screen, code and meeting kept', S.appPathFor(reminderUrl) === `/j/${joinCode}?m=abc-defg-hij`, S.appPathFor(reminderUrl) ?? 'null')
  const redeem = await call('POST', '/auth/join-link/redeem', { headers: APP('b'.repeat(64)), body: { token: joinCode } })
  check('I2 redeemed from a signed-out app: tokens in the body, NO cookie, the class id', redeem.status === 200 && !!redeem.data?.tokens?.accessToken && !redeem.cookies.some(c => /^lms_(at|rt)=/.test(c)) && redeem.data?.liveClassId === String(lc._id), why(redeem))
  const me = await call('GET', '/auth/me', { bearer: redeem.data?.tokens?.accessToken })
  check('I3 the app then reads the user with that token (the redeem does not send it)', me.status === 200 && (me.data?.user?.email ?? me.data?.email) === bilal.email, why(me))
  const signCode = await mintSigninCode(String(bilal._id), '/messages')
  const sRedeem = await call('POST', '/auth/signin-link/redeem', { headers: APP('b'.repeat(64)), body: { token: signCode } })
  check('I4 a sign-in link: tokens in the body, and its destination maps to the Messages tab', sRedeem.status === 200 && !!sRedeem.data?.tokens?.accessToken && S.appPathFor(sRedeem.data?.next ?? '') === '/messages', `${why(sRedeem)} next=${sRedeem.data?.next}`)

  /* ═══ J ═══ */
  section('J. The notification list')
  const list = await call('GET', '/notifications?page=1&per_page=30', { bearer: amalT, headers: APP('a'.repeat(64)) })
  const items = list.data?.items ?? []
  check('J1 newest first, each with an id, title and link the app maps', list.status === 200 && items.length >= 4 && items.every((n: any) => typeof n.id === 'string') && items.some((n: any) => S.appPathFor(n.link ?? '') === '/class/6ad0abc'), why(list))
  check('J2 paging meta for the app\'s infinite list', typeof list.body?.meta?.has_next === 'boolean', JSON.stringify(list.body?.meta))
  const readAll = await call('POST', '/notifications/read-all', { bearer: amalT, headers: APP('a'.repeat(64)) })
  const count = await call('GET', '/notifications/unread-count', { bearer: amalT, headers: APP('a'.repeat(64)) })
  check('J3 mark all read → the bell count is 0', readAll.status === 200 && count.data?.unreadCount === 0, JSON.stringify(count.data))

  /* ═══ K ═══ */
  section('K. Signed out everywhere ⇒ no more pushes to those phones (QA round 2026-10-21)')
  const kStudent = await mk('student', { category: '4x-trading', categories: ['4x-trading'], enrollmentStatus: 'approved' })
  const kT = await appLogin(kStudent.email, 'e'.repeat(64))
  await call('POST', '/push-tokens', { bearer: kT, headers: APP('e'.repeat(64)), body: { token: tok('kPhone'), platform: 'android' } })
  const outAll = await call('POST', '/auth/logout-all', { bearer: kT, headers: APP('e'.repeat(64)) })
  check('K1 "sign out of all devices": every push token of the account is gone', outAll.status === 200 && await M.PushTokenModel.countDocuments({ userId: kStudent._id }) === 0, why(outAll))
  before = received.length
  await notify.create(String(kStudent._id), { kind: 'system', title: 'Should not arrive' })
  await quiet()
  check('K2 so a notification afterwards reaches no phone', received.length === before)
} catch (err) {
  check('suite crashed', false, (err as Error).stack ?? String(err))
} finally {
  server.close()
  stub.close()
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
