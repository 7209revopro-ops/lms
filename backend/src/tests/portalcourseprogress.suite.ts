/* The Root portal's Students → Course progress (2026-10-29): each course's students — completed, in progress, not started —
   how many lessons done, where each stopped (the furthest lesson opened, and its module), a part payment's lock marked; one
   academy or both, one programme or all.
   Run: bun --no-env-file src/tests/portalcourseprogress.suite.ts */
process.env.DATABASE_URL = process.env.PORTALCOURSEPROGRESS_DB_URL || 'mongodb://localhost:27017/lms_portalcourseprogress'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'portalcourseprogress-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalcourseprogress-suite-refresh-secret-0123456789'
export {}
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const j = (v: unknown) => JSON.stringify(v).slice(0, 400)
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { courseProgressForPortal, progressState } = await import('@/services/portalCourseProgress.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_portalcourseprogress') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const at = (d: string, h = '12') => new Date(`2026-10-${d}T${h}:00:00+04:00`)
  const oid = () => new mongoose.Types.ObjectId()
  const dxb = { _id: oid(), name: 'Dubai Academy', slug: 'dubai' }, blr = { _id: oid(), name: 'Bangalore Academy', slug: 'bangalore' }
  await M.OrganizationModel.collection.insertMany([dxb, blr] as any)
  const u = (name: string, org: any, extra: Record<string, unknown> = {}) => ({ _id: oid(), name, email: `${name.toLowerCase()}@s.local`, role: 'student', isActive: true, organizationId: org._id, createdAt: at('01'), updatedAt: at('01'), ...extra })
  const done = u('Dana', dxb, { tetraCs: { name: 'Ajna Hamza', team: 'Team A' } })   // every lesson
  const mid = u('Mira', dxb, { phone: '971500000001' })                              // into module 2
  const early = u('Eli', dxb)                                                         // opened lesson 1, not finished
  const fresh = u('Fay', dxb)                                                         // nothing opened
  const part = u('Pat', blr)                                                          // part paid, stopped at the lock
  const staff = { ...u('Ann', dxb), role: 'instructor' }                              // not a student
  const gone = u('Gus', dxb)                                                          // dropped
  const seo = u('Sam', dxb)                                                           // on the digital course only
  await M.UserModel.collection.insertMany([done, mid, early, fresh, part, staff, gone, seo] as any)

  const forex = { _id: oid(), title: 'Forex Basics', program: '4x-trading', createdAt: at('01'), updatedAt: at('01') }
  const digital = { _id: oid(), title: 'SEO', program: 'digital-marketing', createdAt: at('01'), updatedAt: at('01') }
  const empty = { _id: oid(), title: 'Nobody here', program: '4x-trading', createdAt: at('01'), updatedAt: at('01') }
  await M.CourseModel.collection.insertMany([forex, digital, empty] as any)
  // Module 2 has the lower _id but order 2; lessons are listed out of order on purpose.
  const m2 = { _id: oid(), courseId: forex._id, title: 'Price action', order: 2 }, m1 = { _id: oid(), courseId: forex._id, title: 'Basics', order: 1 }
  await M.SectionModel.collection.insertMany([m2, m1] as any)
  const lesson = (s: any, title: string, order: number) => ({ _id: oid(), courseId: forex._id, sectionId: s._id, title, order, type: 'video', durationMins: 10 })
  const L3 = lesson(m2, 'Candles', 1), L4 = lesson(m2, 'Trends', 2), L1 = lesson(m1, 'Welcome', 1), L2 = lesson(m1, 'Brokers', 2)
  await M.LessonModel.collection.insertMany([L3, L4, L1, L2] as any)
  const sL = { _id: oid(), courseId: digital._id, sectionId: oid(), title: 'Keywords', order: 1, type: 'video', durationMins: 10 }
  await M.LessonModel.collection.insertOne(sL as any)

  const enrol = (s: any, c: any, extra: Record<string, unknown> = {}) => ({ _id: oid(), userId: s._id, courseId: c._id, status: 'active', enrolledAt: at('02'), createdAt: at('02'), updatedAt: at('02'), ...extra })
  await M.EnrollmentModel.collection.insertMany([
    enrol(done, forex, { status: 'completed', completedAt: at('20') }), enrol(mid, forex), enrol(early, forex), enrol(fresh, forex),
    enrol(part, forex, { paymentAccess: { status: 'partial' } }), enrol(staff, forex), enrol(gone, forex, { status: 'dropped' }), enrol(seo, digital),
  ] as any)
  const p = (s: any, l: any, isCompleted: boolean, day = '10') => ({ _id: oid(), userId: s._id, courseId: l.courseId, lessonId: l._id, isCompleted, watchTimeSecs: 60, createdAt: at(day), updatedAt: at(day) })
  await M.LessonProgressModel.collection.insertMany([
    p(done, L1, true), p(done, L2, true), p(done, L3, true), p(done, L4, true, '20'),
    p(mid, L1, true), p(mid, L2, true), p(mid, L3, false, '25'),
    p(early, L1, false, '05'),
    p(part, L1, true), p(part, L2, true, '15'),
    { _id: oid(), userId: mid._id, courseId: forex._id, lessonId: oid(), isCompleted: true, watchTimeSecs: 1, createdAt: at('26'), updatedAt: at('26') }, // a lesson since removed
  ] as any)

  check('progressState: completed enrolment', progressState('completed', 0, 4, 0) === 'completed')
  check('…every lesson done is completed', progressState('active', 4, 4, 4) === 'completed')
  check('…nothing opened is not started', progressState('active', 0, 4, 0) === 'not_started')
  check('…opened, not finished is in progress', progressState('active', 0, 4, 1) === 'in_progress')

  let r: any = await courseProgressForPortal({})
  check('courses: those with students, the most first; a course with none left out', j(r.courses.map((c: any) => [c.title, c.students, c.completed, c.program]))
    === j([['Forex Basics', 5, 1, 'forex'], ['SEO', 1, 0, 'digital']]), j(r.courses))
  check('no course asked: the one with the most students', r.course?.title === 'Forex Basics' && r.course.lessons === 4, j(r.course))
  check('modules in order, with their lessons and how many stopped in each', j(r.course.sections.map((s: any) => [s.no, s.title, s.lessons, s.stopped]))
    === j([[1, 'Basics', 2, 2], [2, 'Price action', 2, 1]]), j(r.course.sections))
  check('totals: 5 enrolled (staff and dropped left out), 1 completed, 3 in progress, 1 not started, average 40%, 1 locked',
    j(r.course.totals) === j({ enrolled: 5, completed: 1, in_progress: 3, not_started: 1, averagePercent: 40, locked: 1 }), j(r.course.totals))
  const row = (name: string) => r.course.students.find((s: any) => s.name === name)
  const m = row('Mira')
  check('Mira: 2 of 4 done, 50%, stopped at lesson 3 (Price action · Candles), not finished; a removed lesson ignored',
    m?.done === 2 && m.total === 4 && m.percent === 50 && m.state === 'in_progress' && m.stoppedAt?.section === 'Price action'
    && m.stoppedAt.lesson === 'Candles' && m.stoppedAt.lessonNo === 3 && m.stoppedAt.finished === false && m.phone === '971500000001', j(m))
  check('…her last activity is her latest lesson', m?.lastActivityAt === at('25').toISOString(), j(m?.lastActivityAt))
  const d = row('Dana')
  check('Dana: completed, 100%, the date, her CS', d?.state === 'completed' && d.percent === 100 && d.completedAt === at('20').toISOString() && d.cs.name === 'Ajna Hamza', j(d))
  const e = row('Eli'), f = row('Fay'), pt = row('Pat')
  check('Eli: opened lesson 1, none done — in progress at Basics · Welcome', e?.state === 'in_progress' && e.done === 0 && e.stoppedAt?.lessonNo === 1 && e.stoppedAt.finished === false, j(e))
  check('Fay: not started, nowhere', f?.state === 'not_started' && f.stoppedAt === null && f.lastActivityAt === '', j(f))
  check('Pat: part paid — marked locked, stopped at the end of module 1', pt?.locked === 'partial' && pt.stoppedAt?.lessonNo === 2 && pt.stoppedAt.finished === true && pt.academy === 'Bangalore Academy', j(pt))
  check('the furthest behind first, the finished last', j(r.course.students.map((s: any) => s.name)) === j(['Fay', 'Eli', 'Mira', 'Pat', 'Dana']), j(r.course.students.map((s: any) => s.name)))

  r = await courseProgressForPortal({ academy: 'bangalore' })
  check('one academy: only its students — Bangalore has Pat alone', r.course?.totals.enrolled === 1 && r.course.students[0].name === 'Pat' && r.courses.length === 1, j(r.courses))
  r = await courseProgressForPortal({ program: 'digital' })
  check('one programme: its courses only — SEO, Sam not started', r.courses.length === 1 && r.course?.title === 'SEO' && r.course.students[0].state === 'not_started', j(r))
  r = await courseProgressForPortal({ program: 'jura' })
  check('a programme with no students: no courses, no course', r.courses.length === 0 && r.course === null, j(r))
  r = await courseProgressForPortal({ course: String(digital._id) })
  check('a course asked for: that one', r.course?.title === 'SEO' && r.course.totals.enrolled === 1, j(r.course))
  r = await courseProgressForPortal({ course: String(empty._id) })
  check('a course with nobody: empty, not an error', r.course?.title === 'Nobody here' && r.course.totals.enrolled === 0 && r.course.students.length === 0, j(r.course))

  const refused = async (q: Record<string, unknown>, re: RegExp) => {
    try { await courseProgressForPortal(q); return false } catch (err) { return re.test((err as Error).message) }
  }
  check('a bad academy, programme or course id: refused', await refused({ academy: 'paris' }, /dubai or bangalore/) && await refused({ program: 'cooking' }, /program is/)
    && await refused({ course: 'abc' }, /course id/))
  check('a course that does not exist: refused', await refused({ course: String(oid()) }, /No such course/))
} finally {
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
