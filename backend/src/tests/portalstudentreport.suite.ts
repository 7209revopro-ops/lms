/* The Root portal's Students report (2026-10-29): the dates' bookings (upcoming, live, attended, missed), the most-booked
   students and classes, who attended fully, and the non-active students (no sign-in for 14 days) by CS — one academy or both,
   one programme (Forex / Digital Marketing + AI / JURA / none set) or all.
   Run: bun --no-env-file src/tests/portalstudentreport.suite.ts */
process.env.DATABASE_URL = process.env.PORTALSTUDENTREPORT_DB_URL || 'mongodb://localhost:27017/lms_portalstudentreport'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'portalstudentreport-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalstudentreport-suite-refresh-secret-0123456789'
export {}
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const j = (v: unknown) => JSON.stringify(v).slice(0, 400)
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { studentReportForPortal, seatState, programmeOf } = await import('@/services/portalStudentReport.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_portalstudentreport') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const NOW = new Date('2026-10-29T15:00:00+04:00')
  const at = (d: string, h = '12') => new Date(`2026-10-${d}T${h}:00:00+04:00`)
  const oid = () => new mongoose.Types.ObjectId()
  const dxb = { _id: oid(), name: 'Dubai Academy', slug: 'dubai' }, blr = { _id: oid(), name: 'Bangalore Academy', slug: 'bangalore' }
  await M.OrganizationModel.collection.insertMany([dxb, blr] as any)
  const u = (name: string, org: any, extra: Record<string, unknown> = {}) => ({ _id: oid(), name, email: `${name.toLowerCase()}@s.local`, role: 'student', isActive: true, organizationId: org._id, createdAt: at('01'), updatedAt: at('01'), ...extra })
  const ann = { ...u('Ann', dxb), role: 'instructor' }
  const saif = u('Saif', dxb, { lastLoginAt: at('28'), tetraCs: { name: 'Ajna Hamza', team: 'Team A', code: 'STU-1' } })
  const nitish = u('Nitish', dxb, { lastLoginAt: new Date('2026-10-01T10:00:00+04:00'), tetraCs: { name: 'Ajna Hamza', team: 'Team A', code: 'STU-2' } })
  const hamda = u('Hamda', dxb, { tetraCs: { name: 'Arya', team: 'Team B', code: 'STU-3' } })            // never signed in
  const ravi = u('Ravi', blr, { lastLoginAt: new Date('2026-09-20T10:00:00+04:00') })                     // no CS yet
  const off = u('Off', dxb, { isActive: false })                                                         // account off
  const loose = u('Loose', dxb)                                                                          // no active enrolment
  await M.UserModel.collection.insertMany([ann, saif, nitish, hamda, ravi, off, loose] as any)
  const course = { _id: oid(), title: 'Forex Basics', program: '4x-trading', createdAt: at('01'), updatedAt: at('01') }
  await M.CourseModel.collection.insertOne(course as any)
  await M.EnrollmentModel.collection.insertMany([saif, nitish, hamda, ravi, off].map(s => ({ _id: oid(), userId: s._id, courseId: course._id, status: 'active', createdAt: at('01'), updatedAt: at('01') })) as any)
  await M.EnrollmentModel.collection.insertOne({ _id: oid(), userId: loose._id, courseId: course._id, status: 'dropped', createdAt: at('01'), updatedAt: at('01') } as any)

  const cls = (title: string, start: Date, extra: Record<string, unknown> = {}) => ({ _id: oid(), title, courseId: course._id, instructorId: ann._id, scheduledStart: start, durationMins: 60, status: 'scheduled', organizationId: dxb._id, createdAt: at('01'), updatedAt: at('01'), ...extra })
  const morning = cls('MBT 1', at('29', '10'), { status: 'ended' })      // today, over
  const now = cls('MBT 2', at('29', '14'))                                // today 14:00–15:00, nobody booked: not counted
  const evening = cls('MBT 3', at('29', '19'))                            // today, ahead
  const tomorrow = cls('MBT 4', at('30', '19'))
  const dropped = cls('MBT 5', at('29', '18'), { status: 'cancelled' })
  const past = cls('MBT 0', at('27', '19'), { status: 'ended' })
  await M.LiveClassModel.collection.insertMany([morning, now, evening, tomorrow, dropped, past] as any)
  const seat = (s: any, c: any, extra: Record<string, unknown> = {}) => ({ _id: oid(), userId: s._id, liveClassId: c._id, status: 'booked', bookedAt: at('20'), createdAt: at('20'), updatedAt: at('20'), ...extra })
  await M.ClassBookingModel.collection.insertMany([
    seat(saif, morning, { attendedAt: at('29', '10') }), seat(saif, evening), seat(saif, tomorrow), seat(saif, past, { status: 'attended' }),
    seat(nitish, morning), seat(nitish, evening, { status: 'cancelled' }), seat(nitish, dropped),
    seat(hamda, morning, { status: 'missed' }), seat(hamda, evening),
    seat(ravi, evening),
  ] as any)

  check('seatState: joined = attended', seatState({ attendedAt: at('29') }, morning, NOW.getTime()) === 'attended')
  check('…ended without a join = missed', seatState({ status: 'booked' }, morning, NOW.getTime()) === 'missed')
  check('…ahead = upcoming', seatState({ status: 'booked' }, evening, NOW.getTime()) === 'upcoming')
  check('…on now = live', seatState({ status: 'booked' }, { scheduledStart: at('29', '14'), durationMins: 90 }, NOW.getTime()) === 'live')

  const today = await studentReportForPortal({ from: '2026-10-29', to: '2026-10-29' }, NOW)
  check("today: 6 seats — Nitish's cancelled one and the cancelled class's left out", today.totals.seats === 6 && today.totals.cancelledSeats === 1 && today.totals.cancelledClassSeats === 1, j(today.totals))
  check('…1 attended, 2 missed, 3 upcoming', today.totals.attended === 1 && today.totals.missed === 2 && today.totals.upcoming === 3 && today.totals.live === 0, j(today.totals))
  check('…4 students, 2 classes', today.totals.students === 4 && today.totals.classes === 2, j(today.totals))
  check('…listed by class time, with the CS on each', today.bookings[0]?.class.title === 'MBT 1' && today.bookings.find((b: any) => b.student.name === 'Saif')?.student.cs.name === 'Ajna Hamza', j(today.bookings[0]))
  const saifRow: any = today.students.find((s: any) => s.name === 'Saif')
  check('Saif most booked today (2), attended fully', today.students[0]?.name === 'Saif' && saifRow.booked === 2 && saifRow.attendance === 'full', j(today.students))
  check('Nitish: none, Hamda: none, Ravi: not due yet', today.students.find((s: any) => s.name === 'Nitish')?.attendance === 'none' && today.students.find((s: any) => s.name === 'Hamda')?.attendance === 'none' && today.students.find((s: any) => s.name === 'Ravi')?.attendance === 'not_due', j(today.students))
  check('fullness counted', today.fullness.full === 1 && today.fullness.none === 2 && today.fullness.not_due === 1, j(today.fullness))
  check('classes: MBT 1 and MBT 3, 3 seats each — the empty MBT 2 not listed', today.classes.length === 2 && today.classes.every((c: any) => c.booked === 3), j(today.classes))

  const week = await studentReportForPortal({ from: '2026-10-27', to: '2026-10-30' }, NOW)
  const saifWeek: any = week.students.find((s: any) => s.name === 'Saif')
  check('past + future: Saif 4 seats, 2 attended, 2 upcoming, still full', saifWeek?.booked === 4 && saifWeek.attended === 2 && saifWeek.upcoming === 2 && saifWeek.attendance === 'full', j(saifWeek))

  const dubai = await studentReportForPortal({ from: '2026-10-29', to: '2026-10-29', academy: 'dubai' }, NOW)
  check("Dubai only: Ravi's seat left out", dubai.totals.seats === 5 && !dubai.students.some((s: any) => s.name === 'Ravi'), j(dubai.totals))

  const idle = today.inactive
  check('non-active: Nitish (28 days), Hamda (never), Ravi — not Saif, not the off account, not the unenrolled', idle.total === 3 && idle.students.map((s: any) => s.name).sort().join() === 'Hamda,Nitish,Ravi', j(idle.students.map((s: any) => s.name)))
  check('…the never-signed-in first, then the longest away', idle.students[0]?.name === 'Hamda' && idle.students[1]?.name === 'Ravi' && idle.never === 1, j(idle.students))
  check('…Nitish 28 days away', idle.students.find((s: any) => s.name === 'Nitish')?.daysAway === 28, j(idle.students))
  check('…by CS: Ajna Hamza 1, Arya 1 (never), no CS 1', idle.byCs.length === 3 && idle.byCs.find((r: any) => r.cs === 'Ajna Hamza')?.count === 1 && idle.byCs.find((r: any) => r.cs === 'Arya')?.never === 1 && idle.byCs.find((r: any) => r.cs === '')?.count === 1, j(idle.byCs))
  check('…Bangalore only: Ravi alone', (await studentReportForPortal({ from: '2026-10-29', to: '2026-10-29', academy: 'bangalore' }, NOW)).inactive.total === 1)
  check('academies listed', today.academies.length === 2)

  /* ── Programmes: a Digital Marketing class and an AI class today, a student enrolled only in Digital Marketing ── */
  check('programmeOf: 4x-trading forex, digital-marketing and ai digital, jura, else none',
    programmeOf('4x-trading') === 'forex' && programmeOf('digital-marketing') === 'digital' && programmeOf('ai') === 'digital' && programmeOf('jura') === 'jura' && programmeOf(undefined) === 'none' && programmeOf('other') === 'none')
  const seo = { _id: oid(), title: 'Digital Marketing', program: 'digital-marketing', createdAt: at('01'), updatedAt: at('01') }
  const aiCourse = { _id: oid(), title: 'AI Academy', program: 'ai', createdAt: at('01'), updatedAt: at('01') }
  await M.CourseModel.collection.insertMany([seo, aiCourse] as any)
  const dina = u('Dina', dxb, { tetraCs: { name: 'Arya', team: 'Team B', code: 'STU-4' } })                 // never signed in, Digital only
  await M.UserModel.collection.insertOne(dina as any)
  await M.EnrollmentModel.collection.insertOne({ _id: oid(), userId: dina._id, courseId: seo._id, status: 'active', createdAt: at('01'), updatedAt: at('01') } as any)
  const seo4 = cls('SEO 4', at('29', '09'), { courseId: seo._id, status: 'ended' }), ai1 = cls('AI 1', at('29', '20'), { courseId: aiCourse._id })
  await M.LiveClassModel.collection.insertMany([seo4, ai1] as any)
  await M.ClassBookingModel.collection.insertMany([seat(saif, seo4, { attendedAt: at('29', '09') }), seat(hamda, ai1), seat(dina, ai1, { status: 'cancelled' })] as any)

  const all = await studentReportForPortal({ from: '2026-10-29', to: '2026-10-29' }, NOW)
  check('all programmes: 8 seats, counted per programme (forex 6, digital 2)', all.totals.seats === 8 && all.program === 'all' && all.programmes.forex === 6 && all.programmes.digital === 2 && all.programmes.jura === 0 && all.programmes.none === 0, j({ t: all.totals, p: all.programmes }))
  check('…each class carries its programme', all.classes.find((c: any) => c.title === 'SEO 4')?.program === 'digital' && all.classes.find((c: any) => c.title === 'MBT 1')?.program === 'forex', j(all.classes))
  const fx = await studentReportForPortal({ from: '2026-10-29', to: '2026-10-29', program: 'forex' }, NOW)
  check('Forex: the 6 forex seats, the same pill counts', fx.totals.seats === 6 && fx.totals.classes === 2 && fx.program === 'forex' && fx.programmes.digital === 2, j({ t: fx.totals, p: fx.programmes }))
  const dg = await studentReportForPortal({ from: '2026-10-29', to: '2026-10-29', program: 'digital' }, NOW)
  check('Digital (Marketing + AI): 2 seats on SEO 4 and AI 1, Dina\'s cancelled one apart', dg.totals.seats === 2 && dg.totals.classes === 2 && dg.totals.cancelledSeats === 1 && dg.bookings.every((b: any) => b.class.program === 'digital'), j(dg.totals))
  check('…Saif attended fully there, Hamda upcoming', dg.students.find((s: any) => s.name === 'Saif')?.attendance === 'full' && dg.students.find((s: any) => s.name === 'Hamda')?.upcoming === 1, j(dg.students))
  check('non-active per programme: Dina in Digital, the 3 in Forex, 4 in all', dg.inactive.total === 1 && dg.inactive.students[0]?.name === 'Dina' && fx.inactive.total === 3 && all.inactive.total === 4, j({ d: dg.inactive.total, f: fx.inactive.total, a: all.inactive.total }))
  check('JURA and none: nothing today', (await studentReportForPortal({ from: '2026-10-29', to: '2026-10-29', program: 'jura' }, NOW)).totals.seats === 0 && (await studentReportForPortal({ from: '2026-10-29', to: '2026-10-29', program: 'none' }, NOW)).inactive.total === 0)

  const refuse = async (q: Record<string, unknown>) => { try { await studentReportForPortal(q, NOW); return '' } catch (e) { return (e as Error).message } }
  check('refuses a bad day', /days/.test(await refuse({ from: '29-10-2026', to: '2026-10-29' })))
  check('refuses to before from', /before/.test(await refuse({ from: '2026-10-29', to: '2026-10-28' })))
  check('refuses over three months', /Three months/.test(await refuse({ from: '2026-06-01', to: '2026-10-29' })))
  check('refuses an unknown programme', /program/.test(await refuse({ from: '2026-10-29', to: '2026-10-29', program: 'cooking' })))
  check('refuses an unknown academy', /academy/.test(await refuse({ from: '2026-10-29', to: '2026-10-29', academy: 'paris' })))
} finally {
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
