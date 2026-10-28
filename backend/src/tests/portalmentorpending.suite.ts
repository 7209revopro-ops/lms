/* What waits on each mentor, for CS Portal's Dashboard (2026-10-28): meeting outcome forms (over, not filled),
   classes to verify (overdue after the 9 AM reminder), students' unread messages — per mentor, with the rows.
   Run: bun --no-env-file src/tests/portalmentorpending.suite.ts */
process.env.DATABASE_URL = process.env.PORTALMENTORPENDING_DB_URL || 'mongodb://localhost:27017/lms_portalmentorpending'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'portalmentorpending-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalmentorpending-suite-refresh-secret-0123456789'
export {}
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const j = (v: unknown) => JSON.stringify(v).slice(0, 400)
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { mentorPendingForPortal } = await import('@/services/portalMentorPending.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_portalmentorpending') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const org = new mongoose.Types.ObjectId(), id = () => new mongoose.Types.ObjectId(), now = new Date()
  const u = (name: string, email: string, role: string, extra = {}) => ({ _id: id(), name, email, role, organizationId: org, createdAt: now, updatedAt: now, ...extra })
  const ann = u('ANN', 'ann@d.local', 'instructor'), bob = u('BOB', 'bob@d.local', 'instructor'), old = u('OLD', 'old@d.local', 'instructor', { isActive: false }), stu = u('Saif', 's@d.local', 'student')
  await M.UserModel.collection.insertMany([ann, bob, old, stu] as any)
  const ago = (h: number) => new Date(now.getTime() - h * 3600_000)
  const meeting = (who: any, startH: number, extra = {}) => ({ _id: id(), mentorId: who._id, title: 'Overview', kind: 'student', askOutcome: true, scheduledStart: ago(startH), durationMins: 30, cancelledAt: null, outcome: null, attendees: [{ name: 'Saif', email: 's@d.local' }], organizationId: org, createdAt: now, updatedAt: now, ...extra })
  await M.MentorMeetingModel.collection.insertMany([
    meeting(ann, 3), meeting(ann, 26),                                  // two waiting
    meeting(ann, 0.2),                                                  // started 12 min ago, not over: not yet
    meeting(ann, 5, { outcome: { stage: 'interested' } }),               // filled
    meeting(ann, 5, { cancelledAt: ago(6) }),                           // cancelled
    meeting(bob, 2, { askOutcome: false }),                             // not asked
  ] as any)
  const cls = (who: any, extra = {}) => ({ _id: id(), title: 'MBT', instructorId: who._id, courseId: id(), scheduledStart: ago(30), durationMins: 60, status: 'ended', organizationId: org, createdAt: now, updatedAt: now, ...extra })
  await M.LiveClassModel.collection.insertMany([
    cls(bob, { verifyRequestedAt: ago(29) }),                           // pending
    cls(bob, { verifyRequestedAt: ago(29), verifyFinalReminderAt: ago(10) }), // overdue
    cls(bob, { verifyRequestedAt: ago(29), verifiedAt: ago(20) }),      // verified
    cls(bob),                                                           // never asked
    cls(bob, { verifyRequestedAt: ago(29), status: 'cancelled' }),      // cancelled
  ] as any)
  await M.ChatConversationModel.collection.insertMany([
    { _id: id(), studentId: stu._id, instructorId: ann._id, instructorUnread: 3, studentUnread: 0, lastMessageAt: ago(1), lastMessagePreview: 'Sir when is the class?', organizationId: org, createdAt: now, updatedAt: now },
    { _id: id(), studentId: stu._id, instructorId: bob._id, instructorUnread: 0, studentUnread: 2, lastMessageAt: ago(1), organizationId: org, createdAt: now, updatedAt: now },
  ] as any)

  const all: any = await mentorPendingForPortal({})
  const A = all.mentors.find((m: any) => m.email === 'ann@d.local'), B = all.mentors.find((m: any) => m.email === 'bob@d.local')
  check('every active instructor (not the inactive one, not a student)', all.mentors.length === 2, j(all.mentors.map((m: any) => m.email)))
  check('Ann: 2 outcome forms waiting (not the one still on, filled, cancelled)', A.counts.outcomes === 2, j(A.counts))
  check('Ann: 3 unread messages in 1 chat, with the preview', A.counts.messages === 3 && A.counts.chats === 1 && A.rows.messages[0].preview.startsWith('Sir'), j(A.rows.messages))
  check('Bob: 2 classes to verify, 1 overdue', B.counts.unverified === 2 && B.counts.unverifiedOverdue === 1, j(B.counts))
  check("Bob: the not-asked meeting isn't waiting", B.counts.outcomes === 0, j(B.counts))
  check('totals and order (most waiting first)', A.total === 5 && B.total === 2 && all.mentors[0].email === 'ann@d.local', j(all.mentors.map((m: any) => [m.email, m.total])))
  check('outcome rows name who it was with', A.rows.outcomes.every((r: any) => r.attendees[0] === 'Saif'), j(A.rows.outcomes))
  const one: any = await mentorPendingForPortal({ emails: 'bob@d.local, OLD@d.local' })
  check('named addresses: just those (an inactive one too)', one.mentors.map((m: any) => m.email).sort().join() === 'bob@d.local,old@d.local', j(one.mentors.map((m: any) => m.email)))
  const none: any = await mentorPendingForPortal({ emails: 'nobody@d.local' })
  check('nobody known: empty', none.mentors.length === 0)
} finally {
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
