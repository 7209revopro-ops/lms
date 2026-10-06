/* ─────────────────────────────────────────────────────────────
   Student ↔ instructor chat — plan.md §11.

     A  who a student may message: own academy, own programmes (approved ∪ enrolled)
     B  sending: refusals for ineligible / pending / empty / too long
     C  the instructor inbox: only students who wrote; replies; read state; one bell
     D  isolation: every other party gets 404 / 401 / 403
     E  incremental `after` / `before` paging
     F  idempotent retries and racing first messages
     G  impersonation is read-only
     H  super-admin oversight: everything, instructor filter, org switcher, read-only
     I  text stays text; the send rate limit holds

   Run: bun run test:chat
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_chat_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.RATE_LIMIT_CHAT_MAX = '8'

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
const {
  UserModel, OrganizationModel, CourseModel, EnrollmentModel, NotificationModel,
  ChatConversationModel, ChatMessageModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_chat_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()
/* The pair-uniqueness and retry-dedupe guarantees ARE indexes — build them. */
await ChatConversationModel.syncIndexes()
await ChatMessageModel.syncIndexes()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

const PW = 'CorrectHorse1'
let seq = 0
const code = (r: { body: any }) => r.body?.error?.code

try {
  const dubai = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash  = await hashPassword(PW)
  const mk = (name: string, role: string, extra: Record<string, unknown> = {}) => UserModel.create({
    name, email: `u${seq++}@chat.local`, passwordHash: hash, role, isActive: true, isVerified: true,
    organizationId: dubai._id, ...extra,
  })
  const loginStudent = async (u: any) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/auth/login', { jar, body: { email: u.email, password: PW } })
    if (r.status !== 200) throw new Error(`student login ${u.name}: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }
  const loginStaff = async (u: any) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email: u.email, password: PW } })
    if (r.status !== 200) throw new Error(`staff login ${u.name}: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }
  const fxStudentOf = (name: string, extra: Record<string, unknown> = {}) =>
    mk(name, 'student', { category: '4x-trading', categories: ['4x-trading'], enrollmentStatus: 'approved', ...extra })

  const fxA      = await mk('Fx Alpha',  'instructor', { category: '4x-trading' })
  const fxMulti  = await mk('Fx Multi',  'instructor', { category: 'ai', categories: ['ai', '4x-trading'] })
  const fxIdle   = await mk('Fx Idle',   'instructor', { category: '4x-trading' })
  const fxOff    = await mk('Fx Off',    'instructor', { category: '4x-trading', isActive: false })
  const dmT      = await mk('Dm Teach',  'instructor', { category: 'digital-marketing' })
  const fxBlr    = await mk('Fx Blr',    'instructor', { category: '4x-trading', organizationId: blr._id, sharedAcrossOrgs: true })
  const dmCourse = await CourseModel.create({
    title: 'DM Course', slug: `dm-${seq++}`, description: 'd', instructorId: dmT._id, price: 0, isFree: true,
    status: 'published', language: 'English', organizationId: dubai._id, program: 'digital-marketing',
  })
  const superA = await mk('Super', 'super_admin', { organizationId: undefined })
  const admin  = await mk('Admin', 'admin')
  const SUPER = await loginStaff(superA)
  const FXA = await loginStaff(fxA), IDLE = await loginStaff(fxIdle), DMT = await loginStaff(dmT)

  /* ═══ A ═══ */
  section('A. A Forex student sees their own academy\'s Forex instructors')
  const s1 = await fxStudentOf('Student One')
  const S1 = await loginStudent(s1)
  {
    const r = await call('GET', '/chat/instructors', { jar: S1 })
    const names = ((r.body?.data ?? []) as any[]).map(i => i.name).sort()
    check('A1 lists Forex instructors by single or multiple programme', r.status === 200 && names.includes('Fx Alpha') && names.includes('Fx Multi') && names.includes('Fx Idle'), JSON.stringify(names))
    check('A2 never the DM instructor, an inactive one, or another academy\'s (even lent)', !names.some(n => /Dm Teach|Fx Off|Fx Blr/.test(n)), JSON.stringify(names))
    await EnrollmentModel.create({ userId: s1._id, courseId: dmCourse._id, source: 'admin' })
    const r2 = await call('GET', '/chat/instructors', { jar: S1 })
    check('A3 a programme the student studies (enrolled DM course) adds its instructors', ((r2.body?.data ?? []) as any[]).some(i => i.name === 'Dm Teach'))
    const none = await mk('No Programme', 'student', { enrollmentStatus: 'approved' })
    const r3 = await call('GET', '/chat/instructors', { jar: await loginStudent(none) })
    check('A4 a student with no programme sees nobody', r3.status === 200 && (r3.body?.data ?? []).length === 0, JSON.stringify(r3.body?.data))
  }

  /* ═══ B ═══ */
  section('B. Sending, and every refusal')
  const s2 = await fxStudentOf('Student Two')
  const S2 = await loginStudent(s2)
  let convId = ''
  {
    const ok = await call('POST', '/chat/messages', { jar: S2, body: { instructorId: String(fxA._id), body: '  Hello sir, a question about the lesson  ', clientMsgId: 'b1' } })
    convId = ok.body?.data?.conversationId
    check('B1 first message creates the conversation', ok.status === 201 && !!convId, `${ok.status} ${JSON.stringify(ok.body?.error)}`)
    check('B2 the body is trimmed', ok.body?.data?.message?.body === 'Hello sir, a question about the lesson', ok.body?.data?.message?.body)
    const dm = await call('POST', '/chat/messages', { jar: S2, body: { instructorId: String(dmT._id), body: 'hi' } })
    check('B3 an instructor outside the student\'s programmes: 404, not "forbidden"', dm.status === 404 && code(dm) === 'NOT_FOUND', `${dm.status} ${code(dm)}`)
    const blrR = await call('POST', '/chat/messages', { jar: S2, body: { instructorId: String(fxBlr._id), body: 'hi' } })
    check('B4 another academy\'s Forex instructor: 404', blrR.status === 404, String(blrR.status))
    const ghost = await call('POST', '/chat/messages', { jar: S2, body: { instructorId: '507f1f77bcf86cd799439011', body: 'hi' } })
    check('B5 an id that does not exist: the same 404', ghost.status === 404 && code(ghost) === 'NOT_FOUND')
    const blank = await call('POST', '/chat/messages', { jar: S2, body: { instructorId: String(fxA._id), body: '    ' } })
    check('B6 whitespace only is refused', blank.status === 400 && code(blank) === 'EMPTY_MESSAGE', `${blank.status} ${code(blank)}`)
    const long = await call('POST', '/chat/messages', { jar: S2, body: { instructorId: String(fxA._id), body: 'x'.repeat(2001) } })
    check('B7 over 2000 characters is refused', long.status === 400 && code(long) === 'MESSAGE_TOO_LONG', `${long.status} ${code(long)}`)
    const pending = await fxStudentOf('Pending', { enrollmentStatus: 'pending' })
    const pr = await call('POST', '/chat/messages', { jar: await loginStudent(pending), body: { instructorId: String(fxA._id), body: 'hi' } })
    check('B8 a pending applicant cannot write', pr.status === 403, `${pr.status} ${code(pr)}`)
  }

  /* ═══ C ═══ */
  section('C. The instructor inbox: only students who wrote, replies, read state, one bell')
  {
    const inbox = await call('GET', '/chat/staff/conversations', { jar: FXA })
    const rows = (inbox.body?.data?.items ?? []) as any[]
    check('C1 the instructor sees the student who wrote', inbox.status === 200 && rows.length === 1 && rows[0].student?.name === 'Student Two', JSON.stringify(rows.map(r => r.student?.name)))
    check('C2 with the student\'s email for the instructor', !!rows[0]?.student?.email)
    const idle = await call('GET', '/chat/staff/conversations', { jar: IDLE })
    check('C3 an instructor nobody wrote to sees nobody', idle.status === 200 && (idle.body?.data?.items ?? ['x']).length === 0, JSON.stringify(idle.body?.data))
    const uc = await call('GET', '/chat/staff/unread-count', { jar: FXA })
    check('C4 instructor unread = 1', uc.body?.data?.count === 1, JSON.stringify(uc.body?.data))

    const read = await call('POST', `/chat/staff/conversations/${convId}/read`, { jar: FXA })
    const uc2 = await call('GET', '/chat/staff/unread-count', { jar: FXA })
    check('C5 reading clears the instructor\'s unread', read.status === 200 && uc2.body?.data?.count === 0)

    const replies = []
    for (const [i, text] of ['Hi!', 'Which lesson?', 'Send a screenshot'].entries()) {
      replies.push(await call('POST', `/chat/staff/conversations/${convId}/messages`, { jar: FXA, body: { body: text, clientMsgId: `c${i}` } }))
    }
    check('C6 the instructor replies', replies.every(r => r.status === 201), JSON.stringify(replies.map(r => r.status)))
    const suc = await call('GET', '/chat/unread-count', { jar: S2 })
    check('C7 the student\'s unread counts all three', suc.body?.data?.count === 3, JSON.stringify(suc.body?.data))
    await new Promise(r => setTimeout(r, 200))  // the notification is fire-and-forget
    const notes = await NotificationModel.countDocuments({ userId: s2._id, kind: 'chat-message' })
    check('C8 three replies make ONE bell notification, not three', notes === 1, String(notes))

    const thread = await call('GET', `/chat/conversations/${convId}/messages`, { jar: S2 })
    check('C9 the student reads the whole thread in order', same(((thread.body?.data?.messages ?? []) as any[]).map(m => m.senderRole), ['student', 'instructor', 'instructor', 'instructor']), JSON.stringify(thread.body?.data?.messages?.map((m: any) => m.senderRole)))
    check('C10 and sees when the instructor last read (for ✓✓)', !!thread.body?.data?.peerLastReadAt)
    await call('POST', `/chat/conversations/${convId}/read`, { jar: S2 })
    const suc2 = await call('GET', '/chat/unread-count', { jar: S2 })
    check('C11 reading clears the student\'s unread', suc2.body?.data?.count === 0)
    await call('POST', `/chat/staff/conversations/${convId}/messages`, { jar: FXA, body: { body: 'Any luck?' } })
    await new Promise(r => setTimeout(r, 200))
    check('C12 a reply after the student read rings the bell again', await NotificationModel.countDocuments({ userId: s2._id, kind: 'chat-message' }) === 2)
    const list = await call('GET', '/chat/instructors', { jar: S2 })
    const fx = ((list.body?.data ?? []) as any[])
    check('C13 the student\'s list puts the conversation first, with its preview', fx[0]?.name === 'Fx Alpha' && fx[0]?.conversation?.lastMessagePreview === 'Any luck?', JSON.stringify(fx[0]))
  }

  /* ═══ D ═══ */
  section('D. Everyone else gets nothing')
  {
    const s3 = await fxStudentOf('Student Three'); const S3 = await loginStudent(s3)
    const other = await call('GET', `/chat/conversations/${convId}/messages`, { jar: S3 })
    check('D1 another student: 404', other.status === 404, String(other.status))
    const otherInst = await call('GET', `/chat/staff/conversations/${convId}/messages`, { jar: IDLE })
    check('D2 another instructor reading: 404', otherInst.status === 404, String(otherInst.status))
    const otherReply = await call('POST', `/chat/staff/conversations/${convId}/messages`, { jar: IDLE, body: { body: 'hi' } })
    check('D3 another instructor replying: 404', otherReply.status === 404, String(otherReply.status))
    const bad = await call('GET', '/chat/conversations/not-an-id/messages', { jar: S2 })
    check('D4 a malformed id: 404, never 500', bad.status === 404, String(bad.status))
    const studentOnStaff = await call('GET', '/chat/staff/conversations', { jar: S2 })
    check('D5 a student cookie on the instructor door: 401', studentOnStaff.status === 401, String(studentOnStaff.status))
    const staffOnStudent = await call('POST', '/chat/messages', { jar: FXA, body: { instructorId: String(fxA._id), body: 'hi' } })
    check('D6 an instructor cannot use the student door to START a chat: 401', staffOnStudent.status === 401, String(staffOnStudent.status))
    const ADMIN = await loginStaff(admin)
    const adminOnStaff = await call('GET', '/chat/staff/conversations', { jar: ADMIN })
    check('D7 an admin is not an instructor inbox: 403', adminOnStaff.status === 403, String(adminOnStaff.status))
    const adminOversight = await call('GET', '/chat/oversight/conversations', { jar: ADMIN })
    check('D8 oversight is super-admin only: admin gets 403', adminOversight.status === 403, String(adminOversight.status))
    const anon = await call('GET', '/chat/instructors')
    check('D9 anonymous: 401', anon.status === 401, String(anon.status))
  }

  /* ═══ E ═══ */
  section('E. Incremental and older pages')
  {
    const all = (await call('GET', `/chat/conversations/${convId}/messages`, { jar: S2 })).body?.data?.messages as any[]
    const after = await call('GET', `/chat/conversations/${convId}/messages?after=${all[2].id}`, { jar: S2 })
    const got = ((after.body?.data?.messages ?? []) as any[]).map(m => m.id)
    /* The poll re-reads a short window behind the cursor (see E4), so it may
       repeat messages the client has — never miss or reorder newer ones. */
    check('E1 ?after returns every newer message, oldest first', same(got.filter(id => id > all[2].id), all.slice(3).map(m => m.id)) && same(got, [...got].sort()), JSON.stringify(got))
    const none = await call('GET', `/chat/conversations/${convId}/messages?after=${all[all.length - 1].id}`, { jar: S2 })
    const known = new Set(all.map(m => m.id))
    check('E2 nothing new → nothing the client does not already hold', ((none.body?.data?.messages ?? [{ id: 'x' }]) as any[]).every(m => known.has(m.id)))
    const before = await call('GET', `/chat/conversations/${convId}/messages?before=${all[2].id}&limit=1`, { jar: S2 })
    check('E3 ?before pages backwards', same(((before.body?.data?.messages ?? []) as any[]).map(m => m.id), [all[1].id]))

    /* Two sends racing: a message whose _id was minted BEFORE the newest one
       the client holds, but committed after the client's last poll. */
    const newest = all[all.length - 1].id
    const lateId = mongoose.Types.ObjectId.createFromTime(Math.floor(new mongoose.Types.ObjectId(newest).getTimestamp().getTime() / 1000) - 1)
    await ChatMessageModel.create({ _id: lateId, conversationId: convId, senderId: fxA._id, senderRole: 'instructor', body: 'late commit' })
    const late = await call('GET', `/chat/conversations/${convId}/messages?after=${newest}`, { jar: S2 })
    check('E4 a message committed late with an older id still reaches the next poll', ((late.body?.data?.messages ?? []) as any[]).some(m => m.body === 'late commit'), JSON.stringify(late.body?.data?.messages?.map((m: any) => m.body)))
    const ancientId = mongoose.Types.ObjectId.createFromTime(Math.floor(Date.now() / 1000) - 120)
    await ChatMessageModel.create({ _id: ancientId, conversationId: convId, senderId: fxA._id, senderRole: 'instructor', body: 'ancient' })
    const bounded = await call('GET', `/chat/conversations/${convId}/messages?after=${newest}`, { jar: S2 })
    check('E5 the re-read window is bounded — history is not re-sent every poll', !((bounded.body?.data?.messages ?? []) as any[]).some(m => m.body === 'ancient'))
    await ChatMessageModel.deleteMany({ _id: { $in: [lateId, ancientId] } })
  }

  /* ═══ F ═══ */
  section('F. Retries and races')
  {
    const s4 = await fxStudentOf('Student Four'); const S4 = await loginStudent(s4)
    const a = await call('POST', '/chat/messages', { jar: S4, body: { instructorId: String(fxMulti._id), body: 'once', clientMsgId: 'retry-1' } })
    const b = await call('POST', '/chat/messages', { jar: S4, body: { instructorId: String(fxMulti._id), body: 'once', clientMsgId: 'retry-1' } })
    check('F1 a retried send returns the original message', a.body?.data?.message?.id === b.body?.data?.message?.id, JSON.stringify([a.body?.data?.message?.id, b.body?.data?.message?.id]))
    const cid = a.body?.data?.conversationId
    check('F2 and stores it once', await ChatMessageModel.countDocuments({ conversationId: cid }) === 1)
    const c = await ChatConversationModel.findById(cid).lean() as any
    check('F3 and counts it unread once', c?.instructorUnread === 1, String(c?.instructorUnread))

    const s5 = await fxStudentOf('Student Five'); const S5 = await loginStudent(s5)
    const burst = await Promise.all([0, 1, 2, 3, 4].map(i =>
      call('POST', '/chat/messages', { jar: S5, body: { instructorId: String(fxMulti._id), body: `m${i}`, clientMsgId: `race-${i}` } })))
    check('F4 five racing first messages all succeed', burst.every(r => r.status === 201), JSON.stringify(burst.map(r => `${r.status}${code(r) ?? ''}`)))
    const convs = await ChatConversationModel.find({ studentId: s5._id }).lean() as any[]
    check('F5 into ONE conversation', convs.length === 1, String(convs.length))
    check('F6 holding all five, all counted', await ChatMessageModel.countDocuments({ conversationId: convs[0]?._id }) === 5 && convs[0]?.instructorUnread === 5, `${convs[0]?.instructorUnread}`)
  }

  /* ═══ G ═══ */
  section('G. Impersonation is read-only')
  {
    const handoff = await call('POST', `/admin/users/${s2._id}/impersonate-client`, { jar: SUPER })
    const imp: Jar = new Map()
    const red = await call('POST', '/auth/impersonation/redeem', { jar: imp, body: { code: handoff.body?.data?.code } })
    check('G0 the super admin opens the student\'s view', handoff.status === 200 && red.status === 200, `${handoff.status} ${red.status}`)
    const look = await call('GET', `/chat/conversations/${convId}/messages`, { jar: imp })
    check('G1 they can read the student\'s chat', look.status === 200, String(look.status))
    const speak = await call('POST', '/chat/messages', { jar: imp, body: { instructorId: String(fxA._id), body: 'as the student' } })
    check('G2 they cannot write as the student', speak.status === 403 && code(speak) === 'IMPERSONATION_READ_ONLY', `${speak.status} ${code(speak)}`)
  }

  /* ═══ H ═══ */
  section('H. Super-admin oversight')
  {
    const sBlr = await fxStudentOf('Blr Student', { organizationId: blr._id })
    const r = await call('POST', '/chat/messages', { jar: await loginStudent(sBlr), body: { instructorId: String(fxBlr._id), body: 'hello from Bangalore' } })
    check('H0 a Bangalore student writes to a Bangalore instructor', r.status === 201, `${r.status} ${code(r)}`)
    const all = await call('GET', '/chat/oversight/conversations', { jar: SUPER })
    const rows = (all.body?.data?.items ?? []) as any[]
    check('H1 "All Orgs": every academy\'s conversations', rows.some(c => c.instructor?.name === 'Fx Blr') && rows.some(c => c.instructor?.name === 'Fx Alpha'), JSON.stringify(rows.map(c => c.instructor?.name)))
    const filtered = await call('GET', `/chat/oversight/conversations?instructorId=${fxA._id}`, { jar: SUPER })
    const fRows = (filtered.body?.data?.items ?? []) as any[]
    check('H2 the instructor filter narrows to one instructor', fRows.length > 0 && fRows.every(c => c.instructor?.name === 'Fx Alpha'), JSON.stringify(fRows.map(c => c.instructor?.name)))
    const switched = await call('GET', '/chat/oversight/conversations', { jar: SUPER, headers: { 'x-organization-id': String(blr._id) } })
    const sRows = (switched.body?.data?.items ?? []) as any[]
    check('H3 switched to Bangalore: Bangalore only', sRows.length > 0 && sRows.every(c => c.instructor?.name === 'Fx Blr'), JSON.stringify(sRows.map((c: any) => c.instructor?.name)))
    const crossOrg = await call('GET', `/chat/oversight/conversations/${convId}/messages`, { jar: SUPER, headers: { 'x-organization-id': String(blr._id) } })
    check('H4 a Dubai thread from the Bangalore view: 404', crossOrg.status === 404, String(crossOrg.status))
    const before = await ChatConversationModel.findById(convId).lean() as any
    const view = await call('GET', `/chat/oversight/conversations/${convId}/messages`, { jar: SUPER })
    const after = await ChatConversationModel.findById(convId).lean() as any
    check('H5 the super admin reads the thread', view.status === 200 && (view.body?.data?.messages ?? []).length >= 5)
    check('H6 without marking anything read for either side', before.instructorUnread === after.instructorUnread && before.studentUnread === after.studentUnread && String(before.studentLastReadAt) === String(after.studentLastReadAt))
    const filter = await call('GET', '/chat/oversight/instructors', { jar: SUPER })
    const fnames = ((filter.body?.data ?? []) as any[]).map(i => i.name)
    check('H7 the filter lists instructors who have chats, not idle ones', fnames.includes('Fx Alpha') && !fnames.includes('Fx Idle'), JSON.stringify(fnames))
  }


  /* ═══ J ═══ */
  section('J. Read-only both ways, paging, search, and no fall-through')
  {
    const s7 = await fxStudentOf('Student Seven'); const S7 = await loginStudent(s7)
    const first = await call('POST', '/chat/messages', { jar: S7, body: { instructorId: String(fxIdle._id), body: 'hi idle' } })
    const cid = first.body?.data?.conversationId
    const open = await call('GET', `/chat/staff/conversations/${cid}/messages`, { jar: IDLE })
    check('J1 opening a thread tells the instructor a reply is possible', open.body?.data?.canReply === true && open.body?.data?.readOnlyReason === null, JSON.stringify(open.body?.data))
    const poll = await call('GET', `/chat/staff/conversations/${cid}/messages?after=${first.body?.data?.message?.id}`, { jar: IDLE })
    check('J2 a poll does not pay for that check', !('canReply' in (poll.body?.data ?? {})))

    await UserModel.updateOne({ _id: s7._id }, { $set: { category: 'ai', categories: ['ai'] } })
    const lapsed = await call('GET', `/chat/staff/conversations/${cid}/messages`, { jar: IDLE })
    check('J3 the student left the programme: the thread opens read-only, with the reason', lapsed.body?.data?.canReply === false && /read-only|no longer/i.test(lapsed.body?.data?.readOnlyReason ?? ''), JSON.stringify(lapsed.body?.data))
    const lapsedReply = await call('POST', `/chat/staff/conversations/${cid}/messages`, { jar: IDLE, body: { body: 'one-way?' } })
    check('J4 and a reply is refused (409 NOT_YOUR_STUDENT) — no one-way chats', lapsedReply.status === 409 && code(lapsedReply) === 'NOT_YOUR_STUDENT', `${lapsedReply.status} ${code(lapsedReply)}`)
    await UserModel.updateOne({ _id: s7._id }, { $set: { category: '4x-trading', categories: ['4x-trading'], enrollmentStatus: 'rejected' } })
    const rej = await call('POST', `/chat/staff/conversations/${cid}/messages`, { jar: IDLE, body: { body: 'still approved?' } })
    check('J5 a student whose approval was revoked: 409 STUDENT_NOT_APPROVED', rej.status === 409 && code(rej) === 'STUDENT_NOT_APPROVED', `${rej.status} ${code(rej)}`)
    await UserModel.updateOne({ _id: s7._id }, { $set: { enrollmentStatus: 'approved' } })
    const back = await call('POST', `/chat/staff/conversations/${cid}/messages`, { jar: IDLE, body: { body: 'welcome back' } })
    check('J6 back in the programme: the instructor can reply again', back.status === 201, `${back.status} ${code(back)}`)

    /* Paging: walk every conversation (super admin, All Orgs) two at a time. */
    const total = await ChatConversationModel.countDocuments({})
    const seen: string[] = []
    let cursor: string | null = null, pages = 0
    do {
      const r: any = await call('GET', `/chat/oversight/conversations?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { jar: SUPER })
      seen.push(...((r.body?.data?.items ?? []) as any[]).map(c => c.id))
      cursor = r.body?.data?.nextCursor ?? null
      pages++
    } while (cursor && pages < 50)
    check('J7 cursor paging returns every conversation exactly once', total > 2 && seen.length === total && new Set(seen).size === total, `${seen.length}/${total} in ${pages} pages`)
    const one = await call('GET', '/chat/staff/conversations?q=seven', { jar: IDLE })
    check('J8 search finds a student by name, case-insensitively', ((one.body?.data?.items ?? []) as any[]).map(c => c.student?.name).join() === 'Student Seven', JSON.stringify(one.body?.data))
    const nope = await call('GET', '/chat/staff/conversations?q=nobody-here', { jar: IDLE })
    check('J9 and nothing for a miss', nope.status === 200 && (nope.body?.data?.items ?? ['x']).length === 0)
    const rx = await call('GET', `/chat/staff/conversations?q=${encodeURIComponent('(.*[')}`, { jar: IDLE })
    check('J10 regex characters are literal, never a 500', rx.status === 200, String(rx.status))
    const byInstructor = await call('GET', '/chat/oversight/conversations?q=fx%20idle', { jar: SUPER })
    check('J11 oversight search also matches the instructor', ((byInstructor.body?.data?.items ?? []) as any[]).some(c => c.instructor?.name === 'Fx Idle'), JSON.stringify(byInstructor.body?.data))

    const write = await call('POST', `/chat/oversight/conversations/${cid}/messages`, { jar: SUPER, body: { body: 'x' } })
    check('J12 a super admin POSTing into oversight: 404, not a student-door 401', write.status === 404, String(write.status))
    const stray = await call('GET', '/chat/staff/nothing-here', { jar: IDLE })
    check('J13 an unknown instructor path: 404', stray.status === 404, String(stray.status))
  }

  /* ═══ I ═══ */
  section('I. Text stays text; the rate limit holds')
  {
    const s6 = await fxStudentOf('Student Six'); const S6 = await loginStudent(s6)
    const xss = '<img src=x onerror=alert(1)> <b>bold</b>'
    const r = await call('POST', '/chat/messages', { jar: S6, body: { instructorId: String(fxA._id), body: xss } })
    check('I1 markup is stored and returned verbatim, as text', r.status === 201 && r.body?.data?.message?.body === xss)
    const statuses: number[] = []
    for (let i = 0; i < 10; i++) {
      statuses.push((await call('POST', '/chat/messages', { jar: S6, body: { instructorId: String(fxA._id), body: `spam ${i}` } })).status)
    }
    check('I2 past the per-minute limit the sender gets 429', statuses.includes(429) && statuses.indexOf(429) >= 6, JSON.stringify(statuses))
    const otherSender = await call('POST', '/chat/messages', { jar: S2, body: { instructorId: String(fxA._id), body: 'not me' } })
    check('I3 the limit is per user — another student is unaffected', otherSender.status === 201, String(otherSender.status))
  }
} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  server.close()
  await mongoose.disconnect()
}

function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b) }

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
