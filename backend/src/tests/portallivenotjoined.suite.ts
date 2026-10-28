/* Booked but not joined (2026-10-28): today's started online classes, each with the booked students who haven't
   joined; live while the timetable runs. Run: bun --no-env-file src/tests/portallivenotjoined.suite.ts */
process.env.DATABASE_URL = process.env.PORTALLIVENOTJOINED_DB_URL || 'mongodb://localhost:27017/lms_portallivenotjoined'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'portallivenotjoined-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portallivenotjoined-suite-refresh-secret-0123456789'
export {}
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const j = (v: unknown) => JSON.stringify(v).slice(0, 400)
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { liveNotJoinedForPortal } = await import('@/services/portalLiveNotJoined.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_portallivenotjoined') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const org = new mongoose.Types.ObjectId(), id = () => new mongoose.Types.ObjectId()
  // Noon in Dubai, so "today" has room either side.
  const now = new Date('2026-10-28T08:00:00.000Z')
  const at = (mins: number) => new Date(now.getTime() + mins * 60_000)
  const u = (name: string, email: string, role: string, extra = {}) => ({ _id: id(), name, email, role, organizationId: org, createdAt: now, updatedAt: now, ...extra })
  const ann = u('ANN', 'Ann@d.local', 'instructor'), bob = u('BOB', 'bob@d.local', 'instructor')
  const s1 = u('Zara', 'zara@d.local', 'student', { phone: '+971500000001' }), s2 = u('Adil', 'adil@d.local', 'student'), s3 = u('Came', 'came@d.local', 'student'), s4 = u('Gone', 'gone@d.local', 'student')
  await M.UserModel.collection.insertMany([ann, bob, s1, s2, s3, s4] as any)
  const course = { _id: id(), title: 'MARKET BREAK-OUT', organizationId: org, createdAt: now, updatedAt: now }
  await M.CourseModel.collection.insertOne(course as any)
  const cls = (who: any, startMins: number, extra = {}) => ({ _id: id(), title: 'MBT 2', instructorId: who._id, courseId: course._id, scheduledStart: at(startMins), durationMins: 60, status: 'live', type: 'external', isOnline: true, organizationId: org, createdAt: now, updatedAt: now, ...extra })
  const live = cls(ann, -10, { coInstructorIds: [bob._id] }), over = cls(bob, -120, { status: 'ended' }), later = cls(ann, 30, { status: 'scheduled' })
  const cancelled = cls(ann, -5, { status: 'cancelled' }), offline = cls(ann, -5, { isOnline: false }), yesterday = cls(ann, -24 * 60)
  const allJoined = cls(bob, -15)
  await M.LiveClassModel.collection.insertMany([live, over, later, cancelled, offline, yesterday, allJoined] as any)
  const b = (c: any, s: any, extra = {}) => ({ _id: id(), liveClassId: c._id, userId: s._id, status: 'booked', bookedAt: at(-600), organizationId: org, createdAt: now, updatedAt: now, ...extra })
  await M.ClassBookingModel.collection.insertMany([
    b(live, s1), b(live, s2), b(live, s3, { attendedAt: at(-8), attendanceSource: 'click' }), b(live, s4, { status: 'cancelled' }),
    b(over, s1), b(over, s3, { status: 'attended' }),
    b(later, s1), b(cancelled, s1), b(offline, s1), b(yesterday, s1),
    b(allJoined, s3, { attendedAt: at(-14) }),
  ] as any)

  const r: any = await liveNotJoinedForPortal({}, now)
  const L = r.classes.find((c: any) => c.id === String(live._id)), O = r.classes.find((c: any) => c.id === String(over._id))
  check('only today\'s started online classes with someone missing (not later, cancelled, offline, yesterday, all joined)', r.classes.length === 2, j(r.classes.map((c: any) => c.id)))
  check('the day is the Dubai day', r.day === '2026-10-28', r.day)
  check('live class: live, 3 booked (not the cancelled seat), 1 joined', L.live === true && L.booked === 3 && L.joined === 1, j(L))
  check('live class: Adil and Zara not joined, by name, with phone + email lowercased', L.notJoined.map((s: any) => s.name).join() === 'Adil,Zara' && L.notJoined[1].phone === '+971500000001' && L.notJoined[0].email === 'adil@d.local', j(L.notJoined))
  check('mentor and co-mentor, emails lowercased, course title', L.mentor.email === 'ann@d.local' && L.coMentors[0].email === 'bob@d.local' && L.course === 'MARKET BREAK-OUT', j(L))
  check('ended class: not live, attended status counts as joined', O.live === false && O.notJoined.length === 1 && O.joined === 1, j(O))
  check('classes in start order', r.classes[0].id === String(over._id), j(r.classes.map((c: any) => c.startsAt)))
  const early: any = await liveNotJoinedForPortal({}, new Date('2026-10-27T20:30:00.000Z'))
  check('just after midnight Dubai: nothing started yet', early.classes.length === 0, j(early))
} finally {
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
