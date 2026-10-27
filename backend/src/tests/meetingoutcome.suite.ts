/* How a student meeting went (2026-10-27, meetingOutcome.service.ts): what waits on a mentor, the form's rules, the
   first to fill it counts, and the feed Tetra Commission reads.
   Run: bun --no-env-file src/tests/meetingoutcome.suite.ts */
process.env.DATABASE_URL = process.env.MEETINGOUTCOME_DB_URL || 'mongodb://localhost:27017/lms_meetingoutcome'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'meetingoutcome-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'meetingoutcome-suite-refresh-secret-0123456789'
export {}
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const j = (v: unknown) => JSON.stringify(v).slice(0, 500)
const refused = async (p: Promise<unknown>, status: number, has = '') => {
  try { await p; return 'not refused' } catch (e: any) { return e?.statusCode === status && String(e?.message).includes(has) ? true : `${e?.statusCode} ${e?.message}` }
}
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const S = await import('@/services/meetingOutcome.service.ts')
const { createMentorMeetingForPortal } = await import('@/services/portal.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_meetingoutcome') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const now = new Date('2026-10-27T12:00:00+04:00')
  const ago = (mins: number) => new Date(now.getTime() - mins * 60_000)
  const org = new mongoose.Types.ObjectId()
  const id = () => new mongoose.Types.ObjectId()
  await M.OrganizationModel.collection.insertOne({ _id: org, name: 'Dubai', slug: 'dubai', createdAt: new Date(), updatedAt: new Date() } as any)
  const u = (name: string, email: string, role: string, extra = {}) => ({ _id: id(), name, email, role, organizationId: org, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...extra })
  const ann = u('ANN', 'ann@d.local', 'instructor'), bob = u('BOB', 'bob@d.local', 'instructor'), gone = u('GONE', 'gone@d.local', 'instructor', { isActive: false })
  const adm = u('ADMIN', 'admin@d.local', 'admin')
  await M.UserModel.collection.insertMany([ann, bob, gone, adm] as any)
  const course = { _id: id(), title: 'Market Breakout', status: 'published', organizationId: org, createdAt: new Date(), updatedAt: new Date() }
  const draft = { _id: id(), title: 'Draft course', status: 'draft', organizationId: org, createdAt: new Date(), updatedAt: new Date() }
  const other = { _id: id(), title: 'Other', status: 'published', organizationId: org, createdAt: new Date(), updatedAt: new Date() }
  await M.CourseModel.collection.insertMany([course, draft, other] as any)
  const mod1 = { _id: id(), courseId: course._id, title: 'Price action', order: 1 }, modOther = { _id: id(), courseId: other._id, title: 'Elsewhere', order: 1 }
  await M.SectionModel.collection.insertMany([mod1, modOther] as any)

  const mt = (title: string, who: any, startMinsAgo: number, extra: Record<string, unknown> = {}) => ({ _id: id(), mentorId: who._id, organizationId: org, title, kind: 'student', category: 'course_pitch',
    scheduledStart: ago(startMinsAgo), durationMins: 30, isOnline: true, attendees: [{ name: 'Saif', email: 's1@d.local' }], bookedByEmail: 'cs@portal.local', bookedVia: 'portal',
    askOutcome: true, outcome: null, cancelledAt: null, createdAt: new Date(), updatedAt: new Date(), ...extra })
  const done1 = mt('Pitch Saif', ann, 120), done2 = mt('Overview Hamda', ann, 60, { attendees: [{ name: 'Hamda', email: 'h@d.local' }] })
  const live = mt('Still on', ann, 10), future = mt('Tomorrow', ann, -1440)
  const cancelled = mt('Called off', ann, 200, { cancelledAt: ago(300) })
  const staff = mt('Staff sync', ann, 90, { kind: 'staff' })
  const crm = mt('Booked by a sales CRM', ann, 90, { askOutcome: undefined })
  const bobs = mt('Bob pitch', bob, 90)
  await M.MentorMeetingModel.collection.insertMany([done1, done2, live, future, cancelled, staff, crm, bobs] as any)

  console.log('\nWhat waits on a mentor')
  const annPending = await S.pendingOutcomesForUser(String(ann._id), now)
  check('Ann: her two student meetings that are over, oldest first', j(annPending.map((m) => m.title)) === j(['Pitch Saif', 'Overview Hamda']), j(annPending.map((m) => m.title)))
  check('…with the attendees and the end', annPending[0]?.attendees[0]?.email === 's1@d.local' && annPending[0]?.endsAt === new Date(ago(90)).toISOString(), j(annPending[0]))
  const byEmail = await S.pendingOutcomesForEmail('ANN@d.local', now)
  check('the same by her address (any case)', byEmail.length === 2)
  check('somebody who is not a mentor: nothing', (await S.pendingOutcomesForEmail('admin@d.local', now)).length === 0 && (await S.pendingOutcomesForEmail('', now)).length === 0)
  check('Bob: only his', j((await S.pendingOutcomesForEmail('bob@d.local', now)).map((m) => m.title)) === j(['Bob pitch']))

  console.log('\nThe form\'s lists')
  const opts: any = await S.outcomeOptions()
  check('published courses only, with their modules', j(opts.courses.map((c: any) => c.title)) === j(['Market Breakout', 'Other']) && opts.courses[0].modules[0].title === 'Price action', j(opts.courses))
  check('active mentors only', j(opts.mentors.map((m: any) => m.email)) === j(['ann@d.local', 'bob@d.local']), j(opts.mentors))
  check('the five stages and the payment modes', opts.stages.length === 5 && opts.paymentModes.includes('Tabby'))

  console.log('\nRefused')
  const fill = (meetingId: unknown, body: Record<string, unknown>, who = 'ann@d.local') => S.saveOutcomeForEmail(who, String(meetingId), body, now)
  check('no remark', await refused(fill(done1._id, { stage: 'not_interested', reason: 'Price' }), 400, 'remark') === true)
  check('no stage', await refused(fill(done1._id, { remark: 'x' }), 400, 'client stands') === true)
  check('interested without a course', await refused(fill(done1._id, { stage: 'interested', remark: 'x', paymentDate: '2026-10-30', paymentMode: 'Card' }), 400, 'course') === true)
  check('interested without a date', await refused(fill(done1._id, { stage: 'interested', remark: 'x', courseId: String(course._id), paymentMode: 'Card' }), 400, 'payment date') === true)
  check('interested with a made-up mode', await refused(fill(done1._id, { stage: 'interested', remark: 'x', courseId: String(course._id), paymentDate: '2026-10-30', paymentMode: 'Gold' }), 400, 'pay') === true)
  check('follow-up without the kind', await refused(fill(done1._id, { stage: 'follow_up', remark: 'x', followUpDate: '2026-10-30' }), 400, 'CSE') === true)
  check('follow-up with a bad date', await refused(fill(done1._id, { stage: 'follow_up', remark: 'x', followUpKind: 'cse_follow_up', followUpDate: '30/10' }), 400, 'date') === true)
  check('meeting with nobody', await refused(fill(done1._id, { stage: 'meeting_with', remark: 'x' }), 400, 'mentor') === true)
  check('meeting with somebody who is not a mentor', await refused(fill(done1._id, { stage: 'meeting_with', remark: 'x', withMentorEmail: 'admin@d.local' }), 400, 'mentor') === true)
  check('revision with a module of another course', await refused(fill(done1._id, { stage: 'revision', remark: 'x', courseId: String(course._id), moduleId: String(modOther._id) }), 400, 'module') === true)
  check('not interested without why', await refused(fill(done1._id, { stage: 'not_interested', remark: 'x' }), 400, 'why') === true)
  check('somebody else\'s meeting', await refused(fill(bobs._id, { stage: 'not_interested', reason: 'Price', remark: 'x' }), 404) === true)
  check('a meeting not over yet', await refused(fill(live._id, { stage: 'not_interested', reason: 'Price', remark: 'x' }), 409, 'not over') === true)
  check('a cancelled one', await refused(fill(cancelled._id, { stage: 'not_interested', reason: 'Price', remark: 'x' }), 409, 'cancelled') === true)
  check('a sales CRM booking (nothing asked)', await refused(fill(crm._id, { stage: 'not_interested', reason: 'Price', remark: 'x' }), 404) === true)
  check('a staff meeting', await refused(fill(staff._id, { stage: 'not_interested', reason: 'Price', remark: 'x' }), 404) === true)
  check('nothing was written by any of those', (await M.MentorMeetingModel.countDocuments({ outcome: { $ne: null } })) === 0)

  console.log('\nFilled')
  const r1: any = await fill(done1._id, { stage: 'interested', remark: '  Will pay after salary ', courseId: String(course._id), paymentDate: '2026-11-02', paymentMode: 'Tabby' })
  check('interested: course, date, mode, remark, who, where', r1.outcome.stage === 'interested' && r1.outcome.courseTitle === 'Market Breakout' && r1.outcome.paymentDate === '2026-11-02'
    && r1.outcome.paymentMode === 'Tabby' && r1.outcome.remark === 'Will pay after salary' && r1.outcome.filledByName === 'ANN' && r1.outcome.filledVia === 'portal', j(r1))
  check('a second fill (LMS admin, the same mentor) is told it was filled', await refused(S.saveOutcomeForUser({ id: String(ann._id), email: 'ann@d.local' }, String(done1._id), { stage: 'not_interested', reason: 'Price', remark: 'x' }, now), 409, 'Already filled by ANN') === true)
  const r2: any = await S.saveOutcomeForUser({ id: String(ann._id), email: 'ann@d.local' }, String(done2._id), { stage: 'revision', remark: 'Lost on entries', courseId: String(course._id), moduleId: String(mod1._id), withMentorEmail: 'bob@d.local' }, new Date(now.getTime() + 1000))
  check('revision from LMS admin: course, module, preferred mentor', r2.outcome.moduleTitle === 'Price action' && r2.outcome.withMentorName === 'BOB' && r2.outcome.filledVia === 'lms', j(r2))
  check('nothing waits on Ann now', (await S.pendingOutcomesForUser(String(ann._id), now)).length === 0)
  const r3: any = await fill(bobs._id, { stage: 'meeting_with', remark: 'Wants the chief', withMentorEmail: 'ann@d.local' }, 'bob@d.local')
  check('meeting with: the mentor', r3.outcome.withMentorEmail === 'ann@d.local', j(r3))

  console.log('\nThe feed Tetra Commission reads')
  const all: any = await S.outcomesSince(undefined)
  check('every outcome, oldest first, with the attendees and the mentor', j(all.meetings.map((m: any) => m.title)) === j(['Pitch Saif', 'Bob pitch', 'Overview Hamda']) && all.meetings[0].mentor.email === 'ann@d.local' && all.meetings[0].attendees[0].email === 's1@d.local', j(all))
  const later: any = await S.outcomesSince(new Date(now.getTime() + 500).toISOString())
  check('from a time on: only the later one', j(later.meetings.map((m: any) => m.title)) === j(['Overview Hamda']), j(later))
  check('next = the last one\'s time', later.next === new Date(now.getTime() + 1000).toISOString(), later.next)
  const none: any = await S.outcomesSince(new Date(now.getTime() + 5000).toISOString())
  check('nothing new: next stays where it was', none.meetings.length === 0 && none.next === new Date(now.getTime() + 5000).toISOString(), j(none))

  console.log('\nBooking asks for it only when Tetra Commission says so')
  const at = new Date(now.getTime() + 3 * 86_400_000).toISOString()
  const asked: any = await createMentorMeetingForPortal({ remoteOrgId: String(org), mentorEmail: 'bob@d.local', title: 'Asked', kind: 'student', scheduledStart: at, durationMins: 30, attendees: [{ name: 'Saif', email: 's1@d.local' }], bookedByEmail: 'cs@portal.local', askOutcome: true, meetingUrl: 'https://meet.example/x' })
  const plain: any = await createMentorMeetingForPortal({ remoteOrgId: String(org), mentorEmail: 'bob@d.local', title: 'Plain', kind: 'student', scheduledStart: new Date(now.getTime() + 4 * 86_400_000).toISOString(), durationMins: 30, attendees: [{ name: 'Saif', email: 's1@d.local' }], bookedByEmail: 'sales@crm.local', meetingUrl: 'https://meet.example/y' })
  const a = await M.MentorMeetingModel.findById(asked.meeting.id).lean(), p = await M.MentorMeetingModel.findById(plain.meeting.id).lean()
  check('askOutcome kept when asked, absent otherwise', a?.askOutcome === true && p?.askOutcome === undefined && a?.outcome === null, j([a?.askOutcome, p?.askOutcome, a?.outcome]))
} finally {
  await mongoose.connection.db!.dropDatabase().catch(() => {})
  await mongoose.disconnect()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
