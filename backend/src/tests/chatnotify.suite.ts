/* ─────────────────────────────────────────────────────────────
   Chat notifications (2026-10-18).
     A  a student's message: the mentor gets ONE bell notification per unread
        run, readable through the admin session (/notifications/staff)
     B  the email waits CHAT_EMAIL_DELAY_MINS: not before, once after, one per run
     C  opening the chat cancels the email and reads the bell notification
     D  the mentor's reply: the student's email follows the same rule
     E  /notifications/staff needs the admin session; the student feed is untouched
   Run: bun --no-env-file src/tests/chatnotify.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_chatnotify'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'; process.env.RATE_LIMIT_CHAT_MAX = '900'
process.env.CHAT_EMAIL_DELAY_MINS = '10'
process.env.ADMIN_URL = 'https://admin.test'; process.env.CLIENT_URL = 'https://lms.test'
process.env.JWT_ACCESS_SECRET  ??= 'chatnotify-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'chatnotify-refresh-secret-0123456789abcdef'
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
const { flushChatEmails } = await import('@/jobs/chatEmail.job.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_chatnotify') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await M.ChatConversationModel.syncIndexes()
await M.ChatMessageModel.syncIndexes()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar | null, body?: unknown) {
  const h: Record<string, string> = {}
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0 && jar) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: any) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`
const PW = 'CorrectHorse1'

/* Captures the emails instead of sending them. */
const mails: Array<{ to: string; opts: any }> = []
const capture = async (to: string, opts: any) => { mails.push({ to, opts }) }
const at = (mins: number) => new Date(Date.now() + mins * 60_000)

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mentor  = await M.UserModel.create({ name: 'Mentor Mia', email: 'mia@cn.local', passwordHash: hash, role: 'instructor', isActive: true, isVerified: true, organizationId: dubai._id, category: '4x-trading' })
  const student = await M.UserModel.create({ name: 'Student Sam', email: 'sam@cn.local', passwordHash: hash, role: 'student', isActive: true, isVerified: true, organizationId: dubai._id, category: '4x-trading', categories: ['4x-trading'], enrollmentStatus: 'approved' })
  const login = async (p: string, email: string) => { const j: Jar = new Map(); const x = await call('POST', p, j, { email, password: PW }); if (x.status !== 200) throw new Error(`${email} ${why(x)}`); return j }
  const sj = await login('/auth/login', 'sam@cn.local')
  const mj = await login('/admin/auth/login', 'mia@cn.local')

  section('A · the mentor\'s bell')
  const s1 = await call('POST', '/chat/messages', sj, { instructorId: String(mentor._id), body: 'Hello, a question about MBT 3' })
  check('the student sends', s1.status === 201 || s1.status === 200, why(s1))
  const convId = s1.body?.data?.conversationId
  await call('POST', '/chat/messages', sj, { instructorId: String(mentor._id), body: 'and another' })
  await new Promise(r => setTimeout(r, 150))
  const bell = await M.NotificationModel.find({ userId: mentor._id, kind: 'chat-message' }).lean() as any[]
  check('one notification for two messages', bell.length === 1, `${bell.length}`)
  check('...titled with the student, linked to the chat', bell[0]?.title === 'New message from Student Sam' && bell[0]?.link === `/messages?c=${convId}`, JSON.stringify(bell[0]))
  const staffFeed = await call('GET', '/notifications/staff', mj)
  check('the admin session reads it at /notifications/staff', staffFeed.status === 200 && staffFeed.body?.data?.items?.length === 1 && staffFeed.body?.data?.unreadCount === 1, why(staffFeed))
  const cnt = await call('GET', '/notifications/staff/unread-count', mj)
  check('...and its unread count', cnt.body?.data?.unreadCount === 1, why(cnt))

  section('B · the email waits')
  mails.length = 0
  let r = await flushChatEmails(capture as any, at(5))
  check('5 minutes in: no email', mails.length === 0 && r.sent === 0)
  r = await flushChatEmails(capture as any, at(11))
  check('11 minutes in: one email, to the mentor', mails.length === 1 && mails[0]!.to === 'mia@cn.local', JSON.stringify(mails))
  check('...from the student, with the unread count and the admin link',
    mails[0]?.opts.from === 'Student Sam' && mails[0]?.opts.unread === 2 && mails[0]?.opts.toMentor === true
    && mails[0]?.opts.url === `https://admin.test/messages?c=${convId}`, JSON.stringify(mails[0]?.opts))
  await flushChatEmails(capture as any, at(30))
  check('a later tick: no second email for the same run', mails.length === 1)
  await call('POST', '/chat/messages', sj, { instructorId: String(mentor._id), body: 'still there?' })
  await flushChatEmails(capture as any, at(60))
  check('more messages in the SAME unread run: still one email', mails.length === 1)

  section('C · opening the chat')
  const rd = await call('POST', `/chat/staff/conversations/${convId}/read`, mj)
  check('the mentor reads it', rd.status === 200, why(rd))
  const after = await M.NotificationModel.countDocuments({ userId: mentor._id, kind: 'chat-message', readAt: { $exists: false } })
  check('...the bell notification is read too', after === 0, `${after}`)
  await call('POST', '/chat/messages', sj, { instructorId: String(mentor._id), body: 'new question' })
  await new Promise(r => setTimeout(r, 150))
  check('a new run: a new bell notification', await M.NotificationModel.countDocuments({ userId: mentor._id, kind: 'chat-message' }) === 2)
  await call('POST', `/chat/staff/conversations/${convId}/read`, mj)
  mails.length = 0
  await flushChatEmails(capture as any, at(20))
  check('read within 10 minutes: no email at all', mails.length === 0, JSON.stringify(mails))

  section('D · the mentor replies')
  const rep = await call('POST', `/chat/staff/conversations/${convId}/messages`, mj, { body: 'Here is the answer' })
  check('the mentor replies', rep.status === 201 || rep.status === 200, why(rep))
  await flushChatEmails(capture as any, at(3))
  check('3 minutes in: no email to the student', mails.length === 0)
  await flushChatEmails(capture as any, at(12))
  check('12 minutes in: one email, to the student, with the student-app link',
    mails.length === 1 && mails[0]!.to === 'sam@cn.local' && mails[0]!.opts.toMentor === false
    && mails[0]!.opts.from === 'Mentor Mia' && mails[0]!.opts.url === `https://lms.test/messages?c=${convId}`, JSON.stringify(mails))
  const sb = await M.NotificationModel.countDocuments({ userId: student._id, kind: 'chat-message' })
  check('the student\'s bell, as before: one notification', sb === 1, `${sb}`)

  section('E · the staff feed')
  check('no admin session: 401', (await call('GET', '/notifications/staff', null)).status === 401)
  check('a student session cannot read it', (await call('GET', '/notifications/staff', sj)).status === 401)
  const own = await call('GET', '/notifications', sj)
  check('the student feed still works', own.status === 200 && own.body?.data?.items?.length === 1, why(own))
  check('an unknown staff path: 404', (await call('GET', '/notifications/staff/nope', mj)).status === 404)
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
