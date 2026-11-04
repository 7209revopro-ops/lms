/* ─────────────────────────────────────────────────────
   Duplicate student accounts — finding and merging
   (services/accountMerge.service.ts, /admin/duplicates*).

   Over HTTP, against a real database:
     A. phoneKey: one number typed six ways is one key; other numbers are not;
     B. every model that points at a user is either moved by a merge or
        listed as left alone on purpose — a new one fails here;
     C. finding: two accounts on one phone (one a "gamil.com" typo) are a
        high-confidence group, a family on one phone a low one; "Not a
        duplicate" hides a group and brings it back;
     D. compare suggests keeping the verified, signed-in account;
     E. preview says what will move and changes nothing;
     F. refused: an academy admin, a wrong confirmation, the same account
        twice, a staff account;
     G. the merge: every row moves, the better copy of each clashing pair is
        kept, chats join, rosters hold the student once, the closed account
        signs out, the merge is audited and listed; merged once only;
     H. undo puts every collection back exactly as it was;
     I. a merge that fails half-way is marked failed and undone cleanly;
     J. two admins merging the same pair at once: one wins;
     K. after the merge, the closed account's email signs in to the kept one
        (password and login code), and the closed account is gone from the
        lists and from the duplicates page;
     L. picking the other account's academy moves the enrolment rows too.
   Run: bun --no-env-file src/tests/accountmerge.suite.ts
───────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_accountmerge'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.OTP_DEV_ECHO = '1'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.JWT_ACCESS_SECRET  ??= 'accountmerge-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'accountmerge-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
const { Types } = mongoose
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { phoneKey } = await import('@/utils/phoneKey.ts')
const svc = await import('@/services/accountMerge.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_accountmerge') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
/* The unique indexes are what makes a clash a clash — build them all. */
for (const n of mongoose.modelNames()) await mongoose.model(n).createIndexes().catch(() => {})   // UserStreak declares userId twice
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null; try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'
const oid = () => new Types.ObjectId()
const raw = (model: string) => mongoose.model(model).collection

/* Every row of every model a merge touches, plus the two accounts — to prove undo is exact. */
async function snapshot(userIds: unknown[]): Promise<string> {
  const models = [...new Set(svc.REFS.map(r => r.model)), 'ChatMessage']
  const out: Record<string, unknown> = {}
  for (const m of models.sort()) out[m] = await raw(m).find({}).sort({ _id: 1 }).toArray()
  out['users'] = (await raw('User').find({ _id: { $in: userIds as never[] } }).sort({ _id: 1 }).toArray())
    .map(u => { const { updatedAt, lastLoginAt, failedLoginAttempts, lockedUntil, ...rest } = u as Record<string, unknown>; return rest })
  const json = JSON.stringify(out, null, 1)
  if (process.env.SNAP_DIR) (await import('node:fs')).writeFileSync(`${process.env.SNAP_DIR}/snap${++snapN}.json`, json)
  return json
}
let snapN = 0

try {
  /* ── A. phoneKey ─────────────────────────────────── */
  section('A. phoneKey')
  const same = ['+971 56 802 1277', '0568021277', '971568021277', '00971568021277', '568021277', '+971-56-802-1277']
  check('six ways of typing one UAE number are one key', new Set(same.map(phoneKey)).size === 1 && phoneKey(same[0]) === '971568021277', same.map(phoneKey).join(','))
  check('Indian number with and without +91 and 0 is one key', new Set(['+91 98765 43210', '9876543210', '09876543210', '919876543210'].map(phoneKey)).size === 1)
  check('two different numbers are two keys', phoneKey('+971568021277') !== phoneKey('+971568021278'))
  check('an Indian and a UAE number never share a key', phoneKey('9876543210') !== phoneKey('0987654321'))
  check('too short / empty is no key', phoneKey('12345') === null && phoneKey('') === null && phoneKey(undefined) === null)
  check('a placeholder (one digit repeated) is no key', phoneKey('0000000000') === null && phoneKey('+971 111111111') !== null && phoneKey('1111111111') === null && phoneKey('9999999999') === null)

  /* ── B. Coverage ─────────────────────────────────── */
  section('B. every user reference is accounted for')
  const uncovered = svc.uncoveredUserRefs()
  check('no model points at a user without the merge knowing', uncovered.length === 0, uncovered.join(', '))
  const all = svc.userRefPaths()
  check('the walk finds nested and array references', all.includes('SupportTicket.messages.senderId') && all.includes('Program.studentIds'), `${all.length} found`)

  /* ── Setup ───────────────────────────────────────── */
  const dxb = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW)
  const make = (o: Record<string, unknown>) => M.UserModel.create({ passwordHash: hash, isActive: true, enrollmentStatus: 'approved', organizationId: dxb._id, ...o } as never) as Promise<any>
  await make({ name: 'Super', email: 'sa@am.local', role: 'super_admin', isVerified: true })
  await make({ name: 'Academy Admin', email: 'ad@am.local', role: 'admin', isVerified: true })
  const mentor  = await make({ name: 'Mentor', email: 'mentor@am.local', role: 'instructor', isVerified: true })
  const mentor2 = await make({ name: 'Mentor Two', email: 'mentor2@am.local', role: 'instructor', isVerified: true })
  /* The real account (signed up, verified, photo) and the typo one (imported). */
  const k1 = await make({ name: 'KRISHNANUNNI N', email: 'nkrishnanunni@gmail.com', role: 'student', isVerified: true, avatarUrl: '/uploads/images/k1.webp',
    lastLoginAt: new Date(), categories: ['4x-trading'], enrollmentApplication: { phone: '+971 56 802 1277', idNumber: '784-1999-1234567-1', dateOfBirth: '1999-01-01', city: 'Dubai' } })
  const k2 = await make({ name: '《KRISHNANUNNI》', email: 'nkrishnanunni@gamil.com', role: 'student', isVerified: false,
    phone: '0568021277', categories: ['digital-marketing'] })
  /* A family on one phone, and someone alone. */
  const f1 = await make({ name: 'Aisha Rahman', email: 'aisha@am.local', role: 'student', enrollmentApplication: { phone: '+971501112222' } })
  const f2 = await make({ name: 'Omar Rahman',  email: 'omar@am.local',  role: 'student', phone: '0501112222' })
  await make({ name: 'Solo', email: 'solo@am.local', role: 'student', phone: '+971509998888' })
  /* Staff on a student's phone is never a candidate. */
  await make({ name: 'Staff Same Phone', email: 'staff@am.local', role: 'admin', phone: '+971568021277' })

  const login = async (email: string, path = '/admin/auth/login') => {
    const j: Jar = new Map(); const r = await call('POST', path, { jar: j, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${email} ${why(r)}`); return j
  }
  const sa = await login('sa@am.local')
  const ad = await login('ad@am.local')
  /* The secondary has a live session — it must end at the merge. Signed in now,
     before its data (and its devices) exist. */
  const k2jar = await login('nkrishnanunni@gamil.com', '/auth/login').catch(e => { lines.push(`  note  ${e}`); return null })

  /* ── C. Finding ─────────────────────────────────── */
  section('C. finding duplicates')
  let g = await call('GET', '/admin/duplicates', { jar: sa })
  check('the duplicates list answers', g.status === 200, why(g))
  const groups = g.body?.data?.groups ?? []
  const kGroup = groups.find((x: any) => x.accounts.some((a: any) => a.id === String(k1._id)))
  const fGroup = groups.find((x: any) => x.accounts.some((a: any) => a.id === String(f1._id)))
  check('exactly two groups (Krishnanunni, the family) — the single student and staff are not in any', groups.length === 2, JSON.stringify(groups.map((x: any) => x.accounts.map((a: any) => a.email))))
  check('Krishnanunni\'s two accounts are found, phone typed two ways', kGroup?.accounts.length === 2 && kGroup.phone === '+971568021277')
  check('…and marked high confidence for the near-identical email', kGroup?.confidence === 'high' && kGroup.reasons.includes('Email nearly the same'), JSON.stringify(kGroup?.reasons))
  check('the family is a low-confidence group', fGroup?.confidence === 'low', fGroup?.confidence)
  check('an academy admin may not open the page', (await call('GET', '/admin/duplicates', { jar: ad })).status === 403)

  const dis = await call('POST', '/admin/duplicates/dismiss', { jar: sa, body: { userIds: [String(f1._id), String(f2._id)] } })
  check('"Not a duplicate" is accepted', dis.status === 200, why(dis))
  g = await call('GET', '/admin/duplicates', { jar: sa })
  check('…and hides that group, counted as dismissed', g.body.data.groups.length === 1 && g.body.data.dismissed === 1)
  const withDis = await call('GET', '/admin/duplicates?dismissed=1', { jar: sa })
  check('…still listed when asked for dismissed ones', withDis.body.data.groups.length === 2)
  await call('DELETE', `/admin/duplicates/dismiss/${encodeURIComponent(dis.body.data.key)}`, { jar: sa })
  check('"show again" brings it back', (await call('GET', '/admin/duplicates', { jar: sa })).body.data.groups.length === 2)
  await call('POST', '/admin/duplicates/dismiss', { jar: sa, body: { userIds: [String(f1._id), String(f2._id)] } })

  /* ── Data on both accounts ───────────────────────── */
  const c1 = oid(), c2 = oid(), lesson = oid(), lc1 = oid(), lc2 = oid(), exam = oid(), course3 = oid()
  const K1 = k1._id, K2 = k2._id
  await raw('Enrollment').insertMany([
    { userId: K1, courseId: c1, organizationId: dxb._id, progressPercent: 10, status: 'active' },
    { userId: K2, courseId: c1, organizationId: dxb._id, progressPercent: 60, status: 'active' },   // further along: kept
    { userId: K2, courseId: c2, organizationId: dxb._id, progressPercent: 5,  status: 'active' },
  ])
  await raw('LessonProgress').insertMany([
    { userId: K1, lessonId: lesson, courseId: c1, isCompleted: false, watchTimeSecs: 30 },
    { userId: K2, lessonId: lesson, courseId: c1, isCompleted: true,  watchTimeSecs: 600 },       // completed: kept
  ])
  await raw('ClassBooking').insertMany([
    { userId: K1, liveClassId: lc1, status: 'booked' },
    { userId: K2, liveClassId: lc1, status: 'attended' },   // attended: kept
    { userId: K2, liveClassId: lc2, status: 'booked' },
  ])
  await raw('ExamAttempt').insertMany([
    { userId: K1, examId: exam, courseId: c1, status: 'submitted', totalMarks: 70 },   // primary's better: kept
    { userId: K2, examId: exam, courseId: c1, status: 'in_progress' },
  ])
  await raw('Order').insertOne({ userId: K2, courseId: c2, amount: 100, status: 'paid' })
  await raw('UserStreak').insertMany([
    { userId: K1, longestStreak: 2, totalDaysActive: 3 },
    { userId: K2, longestStreak: 9, totalDaysActive: 20 },   // longer: kept
  ])
  await raw('Favorite').insertMany([{ userId: K1, courseId: course3 }, { userId: K2, courseId: course3 }])
  const conv1 = oid(), conv2 = oid(), conv3 = oid()
  const t0 = new Date(Date.now() - 3_600_000), t1 = new Date()
  await raw('ChatConversation').insertMany([
    { _id: conv1, studentId: K1, instructorId: mentor._id, lastMessageAt: t0, lastMessagePreview: 'old', lastSenderRole: 'student', studentUnread: 1, instructorUnread: 0 },
    { _id: conv2, studentId: K2, instructorId: mentor._id, lastMessageAt: t1, lastMessagePreview: 'newer', lastSenderRole: 'instructor', studentUnread: 2, instructorUnread: 1 },
    { _id: conv3, studentId: K2, instructorId: mentor2._id, lastMessageAt: t1, lastMessagePreview: 'hi', lastSenderRole: 'student', studentUnread: 0, instructorUnread: 1 },
  ])
  await raw('ChatMessage').insertMany([
    { conversationId: conv1, senderId: K1, senderRole: 'student', body: 'a' },
    { conversationId: conv2, senderId: K2, senderRole: 'student', body: 'b' },
    { conversationId: conv2, senderId: mentor._id, senderRole: 'instructor', body: 'c' },
    { conversationId: conv3, senderId: K2, senderRole: 'student', body: 'd' },
  ])
  const ticket = oid()
  await raw('SupportTicket').insertOne({ _id: ticket, userId: K2, subject: 'help', messages: [
    { senderId: K2, senderRole: 'student', body: 'q' }, { senderId: mentor._id, senderRole: 'admin', body: 'a' }] })
  const progBoth = oid(), progOne = oid()
  await raw('Program').insertMany([
    { _id: progBoth, name: 'both', studentIds: [K1, K2, f1._id] },
    { _id: progOne,  name: 'one',  studentIds: [f2._id, K2] },
  ])
  const thread = oid()
  await raw('DiscussionThread').insertOne({ _id: thread, authorId: K2, upvotedBy: [K2, f1._id] })
  await raw('Notification').insertOne({ userId: K2, title: 'n' })
  await raw('Device').insertMany([{ userId: K1, deviceId: 'phone-1', status: 'approved' }, { userId: K2, deviceId: 'phone-1', status: 'approved' }, { userId: K2, deviceId: 'laptop', status: 'approved' }])

  /* ── D. Compare ─────────────────────────────────── */
  section('D. compare')
  const cmp = await call('GET', `/admin/duplicates/compare?ids=${K2},${K1}`, { jar: sa })
  check('compare answers', cmp.status === 200, why(cmp))
  check('it suggests keeping the verified, signed-in account', cmp.body?.data?.suggestedPrimaryId === String(K1))
  const a2 = cmp.body?.data?.accounts?.find((a: any) => a.id === String(K2))
  check('it counts what each account has', a2?.counts?.courses === 2 && a2?.counts?.bookings === 2 && a2?.counts?.orders === 1 && a2?.counts?.chats === 2, JSON.stringify(a2?.counts))

  /* ── E. Preview ─────────────────────────────────── */
  section('E. preview')
  const before = await snapshot([K1, K2])
  const pv = await call('POST', '/admin/duplicates/preview', { jar: sa, body: { primaryId: String(K1), secondaryId: String(K2) } })
  check('preview answers', pv.status === 200, why(pv))
  const item = (label: string) => pv.body?.data?.items?.find((i: any) => i.label === label)
  check('preview: enrolments — 1 moves, 1 clash (2 rows: one moved, one dropped)', item('Course enrolments')?.moved === 2 && item('Course enrolments')?.dropped === 1, JSON.stringify(item('Course enrolments')))
  check('preview: chats — one joins, one moves', item('Chats with instructors')?.moved === 2)
  check('preview: default picks keep the primary\'s name and photo, take nothing it has', pv.body?.data?.picks?.name === 'primary' && pv.body?.data?.picks?.photo === 'primary')
  check('preview: programmes are both accounts\' together', JSON.stringify(pv.body?.data?.categories?.sort()) === JSON.stringify(['4x-trading', 'digital-marketing']))
  check('preview changes nothing', (await snapshot([K1, K2])) === before)

  /* ── F. Refusals ────────────────────────────────── */
  section('F. refusals')
  const r1 = await call('POST', '/admin/duplicates/merge', { jar: ad, body: { primaryId: String(K1), secondaryId: String(K2), confirmEmail: k2.email } })
  check('an academy admin may not merge (403)', r1.status === 403, why(r1))
  const r2 = await call('POST', '/admin/duplicates/merge', { jar: sa, body: { primaryId: String(K1), secondaryId: String(K2), confirmEmail: k1.email } })
  check('the confirmation must be the closed account\'s email (422)', r2.status === 422 && r2.body?.error?.code === 'CONFIRM_MISMATCH', why(r2))
  const r3 = await call('POST', '/admin/duplicates/merge', { jar: sa, body: { primaryId: String(K1), secondaryId: String(K1), confirmEmail: k1.email } })
  check('the same account twice is refused (400)', r3.status === 400, why(r3))
  const r4 = await call('POST', '/admin/duplicates/merge', { jar: sa, body: { primaryId: String(K1), secondaryId: String(mentor._id), confirmEmail: 'mentor@am.local' } })
  check('a staff account is refused (400)', r4.status === 400 && r4.body?.error?.code === 'NOT_A_STUDENT', why(r4))
  check('nothing changed after the refusals', (await snapshot([K1, K2])) === before)

  /* ── G. Merge ───────────────────────────────────── */
  section('G. merge')
  const mg = await call('POST', '/admin/duplicates/merge', { jar: sa, body: {
    primaryId: String(K1), secondaryId: String(K2), confirmEmail: '  NKrishnanunni@GAMIL.com ', picks: { phone: 'secondary' } } })
  check('the merge succeeds', mg.status === 200, why(mg))
  const mergeId = mg.body?.data?.mergeId
  const n = (m: string, q: object) => raw(m).countDocuments(q)
  check('nothing is left on the closed account', (await Promise.all(svc.REFS.filter(r => r.kind === 'scalar' || r.kind === 'chat').map(r => n(r.model, { [r.path]: K2 })))).every(c => c === 0))
  const enr = await raw('Enrollment').find({ userId: K1 }).toArray()
  check('enrolments: both courses, the clash keeps the further copy (60%)', enr.length === 2 && enr.find(e => String(e['courseId']) === String(c1))?.['progressPercent'] === 60)
  check('lesson progress: the completed copy kept', (await raw('LessonProgress').findOne({ userId: K1, lessonId: lesson }))?.['isCompleted'] === true)
  check('bookings: the attended copy kept, the other class moved', (await raw('ClassBooking').findOne({ userId: K1, liveClassId: lc1 }))?.['status'] === 'attended' && await n('ClassBooking', { userId: K1 }) === 2)
  check('exam: the kept account\'s submitted attempt stays', (await raw('ExamAttempt').findOne({ userId: K1, examId: exam }))?.['totalMarks'] === 70 && await n('ExamAttempt', {}) === 1)
  check('order moved', await n('Order', { userId: K1 }) === 1)
  check('streak: the longer one kept, one row', (await raw('UserStreak').findOne({ userId: K1 }))?.['longestStreak'] === 9 && await n('UserStreak', {}) === 1)
  check('favourite: one row', await n('Favorite', { userId: K1 }) === 1)
  const convs = await raw('ChatConversation').find({ studentId: K1 }).toArray()
  const withMentor = convs.find(c => String(c['instructorId']) === String(mentor._id))
  check('chats: one conversation per instructor', convs.length === 2)
  check('…the two with the same instructor joined, all 3 messages in it', await n('ChatMessage', { conversationId: withMentor?._id }) === 3)
  check('…showing the newest message and both unread counts', withMentor?.['lastMessagePreview'] === 'newer' && withMentor?.['studentUnread'] === 3)
  check('chat messages written by the closed account are now the kept one\'s', await n('ChatMessage', { senderId: K2 }) === 0 && await n('ChatMessage', { senderId: K1 }) === 3)
  const t = await raw('SupportTicket').findOne({ _id: ticket })
  check('support ticket and its messages moved; staff replies untouched', String(t?.['userId']) === String(K1) && String(t?.['messages'][0].senderId) === String(K1) && String(t?.['messages'][1].senderId) === String(mentor._id))
  const pb = await raw('Program').findOne({ _id: progBoth }), po = await raw('Program').findOne({ _id: progOne })
  check('roster holding both: the student once', pb?.['studentIds'].length === 2 && pb?.['studentIds'].filter((x: any) => String(x) === String(K1)).length === 1)
  check('roster holding the closed one: swapped in place', po?.['studentIds'].map(String).join() === [String(f2._id), String(K1)].join())
  const th = await raw('DiscussionThread').findOne({ _id: thread })
  check('discussion author and upvote moved', String(th?.['authorId']) === String(K1) && th?.['upvotedBy'].map(String).includes(String(K1)))
  const devs = (await raw('Device').find({ userId: K1 }).toArray()).map(d => String(d['deviceId']))
  check('devices: one row per device (the shared phone once)', devs.length === new Set(devs).size && devs.filter(d => d === 'phone-1').length === 1 && devs.includes('laptop'), devs.join(','))
  const u1 = await raw('User').findOne({ _id: K1 }), u2 = await raw('User').findOne({ _id: K2 })
  check('kept account keeps its email, name and photo', u1?.['email'] === 'nkrishnanunni@gmail.com' && u1?.['name'] === 'KRISHNANUNNI N' && u1?.['avatarUrl'] === '/uploads/images/k1.webp')
  check('…takes the picked phone (the other account\'s), in both fields', u1?.['phone'] === '0568021277' && u1?.['enrollmentApplication']?.phone === '0568021277')
  check('…keeps its own registration details', u1?.['enrollmentApplication']?.idNumber === '784-1999-1234567-1')
  check('…has both programmes', [...(u1?.['categories'] ?? [])].sort().join() === '4x-trading,digital-marketing')
  check('closed account: switched off, pointing at the kept one', u2?.['isActive'] === false && String(u2?.['mergedInto']) === String(K1))
  check('the closed account had a live session to end', !!k2jar)
  if (k2jar) check('closed account\'s open session no longer works', (await call('GET', '/auth/me', { jar: k2jar })).status === 401)
  check('closed account\'s sign-in tokens revoked', await n('RefreshToken', { userId: K2, isRevoked: false }) === 0)
  const trail = await M.AuditLogModel.findOne({ action: 'user.merge' }).lean() as any
  check('the merge is audited with what moved', trail?.meta?.mergeId === mergeId && String(trail?.meta?.closed) === String(K2) && Array.isArray(trail?.meta?.moved))
  const hist = await call('GET', '/admin/duplicates/merges', { jar: sa })
  check('the merge is in the history, done', hist.body?.data?.[0]?.id === mergeId && hist.body?.data?.[0]?.status === 'done')
  const again = await call('POST', '/admin/duplicates/merge', { jar: sa, body: { primaryId: String(K1), secondaryId: String(K2), confirmEmail: k2.email } })
  check('the same pair cannot be merged twice (409)', again.status === 409 && again.body?.error?.code === 'ALREADY_MERGED', why(again))
  g = await call('GET', '/admin/duplicates', { jar: sa })
  check('the group is gone from the duplicates page', !g.body.data.groups.some((x: any) => x.accounts.some((a: any) => a.id === String(K1))))

  /* ── H. Undo ────────────────────────────────────── */
  section('H. undo')
  const un = await call('POST', `/admin/duplicates/merges/${mergeId}/undo`, { jar: sa })
  check('undo succeeds with nothing it could not restore', un.status === 200 && un.body?.data?.notes?.length === 0, why(un) + JSON.stringify(un.body?.data?.notes))
  check('every collection and both accounts are exactly as before', (await snapshot([K1, K2])) === before)
  check('the merge shows as undone', (await raw('AccountMerge').findOne({ _id: new Types.ObjectId(mergeId) }))?.['status'] === 'undone')
  check('undoing twice is refused (409)', (await call('POST', `/admin/duplicates/merges/${mergeId}/undo`, { jar: sa })).status === 409)
  check('the group is back on the duplicates page', (await call('GET', '/admin/duplicates', { jar: sa })).body.data.groups.some((x: any) => x.accounts.some((a: any) => a.id === String(K1))))

  /* ── I. A merge that fails half-way ─────────────── */
  section('I. failure half-way')
  const orders = raw('Order') as any
  const realUpdateMany = orders.updateMany.bind(orders)
  orders.updateMany = async () => { throw new Error('simulated outage') }
  const bad = await call('POST', '/admin/duplicates/merge', { jar: sa, body: { primaryId: String(K1), secondaryId: String(K2), confirmEmail: k2.email } })
  orders.updateMany = realUpdateMany
  check('the merge reports the failure', bad.status >= 500, why(bad))
  const failed = await raw('AccountMerge').findOne({ status: 'failed' })
  check('it is recorded as failed, with the error', !!failed && String(failed['error']).includes('simulated outage'))
  check('the closed account was NOT closed (it stopped before that)', (await raw('User').findOne({ _id: K2 }))?.['isActive'] === true)
  check('the lock was released', await n('Mutex', {}) === 0)
  const un2 = await call('POST', `/admin/duplicates/merges/${failed?._id}/undo`, { jar: sa })
  check('the half-done merge is undone', un2.status === 200, why(un2))
  check('…and everything is exactly as before', (await snapshot([K1, K2])) === before)

  /* ── J. Two admins at once ──────────────────────── */
  section('J. concurrency')
  const both = await Promise.all([1, 2].map(() => call('POST', '/admin/duplicates/merge', { jar: sa, body: { primaryId: String(K1), secondaryId: String(K2), confirmEmail: k2.email } })))
  const codes = both.map(r => r.status).sort()
  check('one merge wins, the other is refused (409)', codes[0] === 200 && codes[1] === 409, codes.join(',') + ' ' + both.map(why).join(' | '))
  check('one merge record is done', await n('AccountMerge', { status: 'done' }) === 1)
  check('enrolments are not doubled or lost', await n('Enrollment', { userId: K1 }) === 2 && await n('Enrollment', {}) === 2)

  /* ── K. Signing in after the merge ──────────────── */
  section('K. signing in with the old email')
  /* The merged account now holds both accounts' devices — over the two-device limit; a fresh browser needs a free slot. */
  await raw('Device').deleteMany({ userId: K1 })
  const sj: Jar = new Map()
  const li = await call('POST', '/auth/login', { jar: sj, body: { email: 'nkrishnanunni@gamil.com', password: PW } })
  const meEmail = async (j: Jar) => (await call('GET', '/auth/me', { jar: j })).body?.data?.user?.email
  check('password sign-in with the closed account\'s email opens the kept account', li.status === 200 && await meEmail(sj) === 'nkrishnanunni@gmail.com', why(li))
  const ot = await call('POST', '/auth/otp/request', { body: { email: 'NKrishnanunni@gamil.com' } })
  check('a login code can be asked for with the old email', ot.status === 200 && !!ot.body?.data?.devCode, why(ot))
  const oj: Jar = new Map([['lms_device', sj.get('lms_device') ?? '']])   // the same browser
  const ov = await call('POST', '/auth/otp/verify', { jar: oj, body: { email: 'nkrishnanunni@gamil.com', code: ot.body?.data?.devCode } })
  check('…and signs in to the kept account', ov.status === 200 && await meEmail(oj) === 'nkrishnanunni@gmail.com', why(ov))
  check('forgot password with the old email is accepted', (await call('POST', '/auth/forgot-password', { body: { email: 'nkrishnanunni@gamil.com' } })).status === 200)
  const wrong = await call('POST', '/auth/login', { body: { email: 'nkrishnanunni@gamil.com', password: 'WrongHorse1' } })
  check('a wrong password is still wrong', wrong.status === 401)
  const list = await call('GET', '/admin/users?role=student&per_page=100', { jar: sa })
  const listed = (list.body?.data ?? []).map((u: any) => u.email)
  check('the student list shows the kept account and not the closed one', listed.includes('nkrishnanunni@gmail.com') && !listed.includes('nkrishnanunni@gamil.com'), why(list) + ' ' + listed.join(','))

  /* ── L. Taking the other academy ────────────────── */
  section('L. academy pick')
  const b1 = await make({ name: 'Ravi Kumar', email: 'ravi@am.local', role: 'student', isVerified: true, phone: '+91 98765 43210', organizationId: dxb._id })
  const b2 = await make({ name: 'Ravi K', email: 'ravi@gmial.com', role: 'student', phone: '9876543210', organizationId: blr._id })
  await raw('Enrollment').insertMany([{ userId: b1._id, courseId: oid(), organizationId: dxb._id }, { userId: b2._id, courseId: oid(), organizationId: blr._id }])
  const lBefore = await snapshot([b1._id, b2._id])
  const ml = await call('POST', '/admin/duplicates/merge', { jar: sa, body: { primaryId: String(b1._id), secondaryId: String(b2._id), confirmEmail: 'ravi@gmial.com', picks: { academy: 'secondary' } } })
  check('merge taking the other account\'s academy succeeds', ml.status === 200, why(ml))
  check('the kept account is now in Bangalore', String((await raw('User').findOne({ _id: b1._id }))?.['organizationId']) === String(blr._id))
  check('…and so are all its enrolment rows', (await raw('Enrollment').find({ userId: b1._id }).toArray()).every(e => String(e['organizationId']) === String(blr._id)))
  await call('POST', `/admin/duplicates/merges/${ml.body?.data?.mergeId}/undo`, { jar: sa })
  check('undo puts the academy and rows back', (await snapshot([b1._id, b2._id])) === lBefore)
} catch (err) {
  fail++
  lines.push(`  FAIL  suite crashed — ${(err as Error)?.stack ?? err}`)
} finally {
  console.log(lines.join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  server.close()
  await mongoose.connection.db?.dropDatabase().catch(() => {})
  await mongoose.disconnect()
  process.exit(fail ? 1 : 0)
}
