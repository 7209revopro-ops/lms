/* The portal's Mentor Report breakdowns (2026-10-27: "each count we can break down … which classes, bookings, students,
   reviews of the class, cancellations — a programs report and a meeting report"): what is behind each number, for the
   same dates and mentors, and the different students on the report itself.
   Run: bun --no-env-file src/tests/portalmentordetail.suite.ts */
process.env.DATABASE_URL = process.env.PORTALMENTORDETAIL_DB_URL || 'mongodb://localhost:27017/lms_portalmentordetail'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'portalmentordetail-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalmentordetail-suite-refresh-secret-0123456789'
export {}
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const j = (v: unknown) => JSON.stringify(v).slice(0, 500)
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { mentorReportForPortal } = await import('@/services/portalMentorReport.service.ts')
const { mentorReportDetailForPortal } = await import('@/services/portalMentorDetail.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_portalmentordetail') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const at = (d: string, h = '19') => new Date(`2026-10-${d}T${h}:00:00+04:00`)
  const org = new mongoose.Types.ObjectId()
  const id = () => new mongoose.Types.ObjectId()
  const u = (name: string, email: string, role: string) => ({ _id: id(), name, email, role, organizationId: org, createdAt: new Date(), updatedAt: new Date() })
  const ann = u('ANN', 'ann@d.local', 'instructor'), bob = u('BOB', 'bob@d.local', 'instructor')
  const s1 = u('Saif', 's1@d.local', 'student'), s2 = u('Nitish', 's2@d.local', 'student'), s3 = u('Hamda', 's3@d.local', 'student')
  await M.UserModel.collection.insertMany([ann, bob, s1, s2, s3] as any)
  const course = { _id: id(), title: 'Market Breakout', organizationId: org, createdAt: new Date(), updatedAt: new Date() }
  await M.CourseModel.collection.insertOne(course as any)
  const prog = { _id: id(), title: 'MBT Evening', instructorId: ann._id, coInstructorIds: [bob._id], courseId: course._id, repeat: 'weekly', weekdays: [2, 4],
    startDate: '2026-10-01', endDate: '2026-11-30', time: '19:00', timezone: 'Asia/Dubai', durationMins: 60, isOnline: true,
    studentIds: [s1._id, s2._id, s3._id], status: 'active', source: 'lms', createdAt: new Date(), updatedAt: new Date() }
  const oldProg = { ...prog, _id: id(), title: 'Ended in September', startDate: '2026-08-01', endDate: '2026-09-30' }
  await M.ProgramModel.collection.insertMany([prog, oldProg] as any)
  const cls = (title: string, who: any, day: string, status = 'ended', extra: Record<string, unknown> = {}) =>
    ({ _id: id(), title, instructorId: who._id, courseId: course._id, scheduledStart: at(day), durationMins: 60, status, organizationId: org, createdAt: new Date(), updatedAt: new Date(), ...extra })
  const c1 = cls('MBT 6', ann, '20', 'ended', { programId: prog._id }), c2 = cls('MBT 7', ann, '22', 'cancelled', { programId: prog._id })
  const c3 = cls('Bob basics', bob, '21'), c4 = cls('MBT 8', bob, '23', 'ended', { programId: prog._id })
  await M.LiveClassModel.collection.insertMany([c1, c2, c3, c4] as any)
  const bk = (who: any, c: any, status: string, extra: Record<string, unknown> = {}) => ({ _id: id(), userId: who._id, liveClassId: c._id, status, bookedAt: at('19', '10'), ...extra })
  await M.ClassBookingModel.collection.insertMany([
    bk(s1, c1, 'attended', { attendedAt: at('20') }), bk(s2, c1, 'missed'), bk(s3, c1, 'cancelled', { cancelledAt: at('19', '12') }),
    bk(s1, c2, 'cancelled', { cancelledAt: at('22', '18') }),
    bk(s2, c3, 'attended'), bk(s1, c4, 'attended'),
  ] as any)
  await M.InstructorReviewModel.collection.insertOne({ instructorId: ann._id, studentId: s1._id, liveClassId: c1._id, rating: 4, createdAt: at('20', '21'), updatedAt: new Date() } as any)
  await M.ClassFeedbackModel.collection.insertOne({ liveClassId: c1._id, userId: s2._id, rating: 2, comment: 'Lost me', createdAt: at('20', '21'), updatedAt: new Date() } as any)
  const mt = (title: string, who: any, day: string, extra: Record<string, unknown> = {}) => ({ _id: id(), mentorId: who._id, title, kind: 'student', category: 'course_pitch',
    scheduledStart: at(day, '11'), durationMins: 30, attendees: [{ name: 'Saif', email: 's1@d.local' }], bookedByEmail: 'cs@portal.local', bookedVia: 'portal', cancelledAt: null, createdAt: new Date(), updatedAt: new Date(), ...extra })
  await M.MentorMeetingModel.collection.insertMany([mt('Pitch', ann, '20'), mt('Overview', ann, '21', { category: 'overview', cancelledAt: at('21', '09') }), mt('Bob 1:1', bob, '21', { category: '' })] as any)

  const span = { from: '2026-10-20', to: '2026-10-23' }
  const detail = (kind: string, extra: Record<string, unknown> = {}) => mentorReportDetailForPortal({ kind, ...span, ...extra }) as Promise<any>

  console.log('\nThe report: different students')
  const report: any = await mentorReportForPortal(span)
  const annRow = report.mentors.find((m: any) => m.email === 'ann@d.local'), bobRow = report.mentors.find((m: any) => m.email === 'bob@d.local')
  check('Ann: 2 students booked (a cancelled booking is not one), 1 came', annRow?.total?.students === 2 && annRow.total.studentsAttended === 1, j(annRow?.total))
  check('Bob: 2 booked, 2 came', bobRow?.total?.students === 2 && bobRow.total.studentsAttended === 2, j(bobRow?.total))
  check('the whole list: Saif and Nitish once each — 2 booked, 2 came', report.students?.booked === 2 && report.students.attended === 2, j(report.students))

  console.log('\nClasses')
  let r = await detail('classes')
  const mbt6 = r.rows.find((x: any) => x.title === 'MBT 6')
  check('every class not cancelled, newest first: MBT 8, Bob basics, MBT 6', r.rows.map((x: any) => x.title).join() === 'MBT 8,Bob basics,MBT 6', j(r.rows))
  check('MBT 6: Ann, the Program and course, 3 booked, 1 came, 1 missed, 1 cancelled', mbt6?.mentor === 'ANN' && mbt6.program === 'MBT Evening' && mbt6.course === 'Market Breakout'
    && mbt6.booked === 3 && mbt6.attended === 1 && mbt6.missed === 1 && mbt6.cancelled === 1 && mbt6.held === true, j(mbt6))
  check("…its reviews: Saif's rating 4 and Nitish's class feedback 2 — 2, average 3", mbt6?.reviews === 2 && mbt6.avgRating === 3, j(mbt6))
  r = await detail('cancelled_classes')
  check('cancelled classes: MBT 7, with the 1 booking it had', r.total === 1 && r.rows[0].title === 'MBT 7' && r.rows[0].booked === 1, j(r.rows))
  r = await detail('classes', { emails: 'bob@d.local' })
  check("a chief's team (Bob): his classes only", r.rows.map((x: any) => x.title).join() === 'MBT 8,Bob basics', j(r.rows))
  r = await detail('classes', { instructorId: String(ann._id), emails: 'bob@d.local' })
  check('one mentor outside that team: nothing', r.total === 0, j(r))

  console.log('\nBookings and students')
  r = await detail('bookings')
  check('every booking: 6', r.total === 6, j(r.rows))
  r = await detail('cancelled_bookings')
  check('cancelled bookings: Hamda on MBT 6, Saif on MBT 7 — with when', r.rows.map((x: any) => `${x.student}|${x.class}`).sort().join() === 'Hamda|MBT 6,Saif|MBT 7' && r.rows.every((x: any) => x.cancelledAt), j(r.rows))
  r = await detail('missed')
  check('missed: Nitish on MBT 6', r.total === 1 && r.rows[0].student === 'Nitish' && r.rows[0].class === 'MBT 6', j(r.rows))
  r = await detail('attended', { instructorId: String(bob._id) })
  check("attended, Bob's: Nitish and Saif", r.rows.map((x: any) => x.student).sort().join() === 'Nitish,Saif', j(r.rows))
  r = await detail('students')
  const saif = r.rows.find((x: any) => x.student === 'Saif')
  check('students: 3, Saif first (2 attended)', r.total === 3 && r.rows[0].student === 'Saif', j(r.rows))
  check('…Saif: 3 booked, 2 came, 1 cancelled, 3 classes, both mentors', saif?.booked === 3 && saif.attended === 2 && saif.cancelled === 1 && saif.classes === 3 && saif.mentors.sort().join() === 'ANN,BOB', j(saif))
  r = await detail('bookings', { programId: String(prog._id) })
  check("one Program's bookings: its 3 classes' 5", r.total === 5, j(r.rows))

  console.log('\nMeetings')
  r = await detail('meetings')
  check('every meeting: 3, with the cancelled one said', r.total === 3 && r.rows.filter((x: any) => x.cancelled).length === 1, j(r.rows))
  const pitch = r.rows.find((x: any) => x.title === 'Pitch')
  check('…the pitch: Ann, student meeting, course pitch, who came, booked from the portal', pitch?.mentor === 'ANN' && pitch.meetingKind === 'student' && pitch.category === 'course_pitch'
    && pitch.attendees.join() === 'Saif' && pitch.bookedVia === 'portal', j(pitch))
  r = await detail('cancelled_meetings', { emails: 'ann@d.local' })
  check("cancelled, Ann's: the overview", r.total === 1 && r.rows[0].title === 'Overview' && r.rows[0].cancelledAt, j(r.rows))

  console.log('\nPrograms')
  r = await detail('programs')
  const p = r.rows[0]
  check('the Program running in the dates (not the one that ended in September)', r.total === 1 && p?.title === 'MBT Evening', j(r.rows))
  check('…Ann, Bob co-mentor, 3 students, 2 held, 1 cancelled', p?.mentor === 'ANN' && p.coMentors.join() === 'BOB' && p.students === 3 && p.held === 2 && p.cancelled === 1, j(p))
  check('…bookings 5, 2 came, 1 missed, attendance 67%, 1 different student came (Saif)', p?.bookings === 5 && p.attended === 2 && p.missed === 1 && p.attendancePct === 67 && p.studentsAttended === 1, j(p))
  check('…its reviews: 2, average 3', p?.reviews === 2 && p.avgRating === 3, j(p))
  r = await detail('programs', { emails: 'bob@d.local' })
  check("Bob's team: the Program he co-mentors", r.total === 1 && r.rows[0].title === 'MBT Evening', j(r.rows))

  console.log('\nRefusals')
  const refused = async (q: Record<string, unknown>) => { try { await mentorReportDetailForPortal(q); return '' } catch (e) { return (e as Error).message } }
  check('a kind that is not one', /kind is one of/.test(await refused({ kind: 'everything', ...span })))
  check('no dates', /from and to/.test(await refused({ kind: 'classes' })))
  check('more than three months', /Three months/.test(await refused({ kind: 'classes', from: '2026-01-01', to: '2026-10-01' })))
  check('a bad instructor id', /Invalid instructorId/.test(await refused({ kind: 'classes', ...span, instructorId: 'nope' })))
} catch (err) { fail++; console.log('  FAIL threw', err) } finally {
  await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
