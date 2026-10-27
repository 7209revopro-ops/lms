/* Late to class on the portal's Mentor Report (2026-10-27: "show the late coming for the classes"): a class whose
   mentor joined more than 5 minutes after the start is a late join, one with no join recorded is counted apart, and
   cancelled or future classes are neither; the breakdown lists them with their minutes late.
   Run: bun --no-env-file src/tests/portalmentorlate.suite.ts */
process.env.DATABASE_URL = process.env.PORTALMENTORLATE_DB_URL || 'mongodb://localhost:27017/lms_portalmentorlate'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'portalmentorlate-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalmentorlate-suite-refresh-secret-0123456789'
export {}
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const j = (v: unknown) => JSON.stringify(v).slice(0, 400)
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { mentorReportForPortal, joinOf } = await import('@/services/portalMentorReport.service.ts')
const { mentorReportDetailForPortal } = await import('@/services/portalMentorDetail.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_portalmentorlate') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const org = new mongoose.Types.ObjectId()
  const id = () => new mongoose.Types.ObjectId()
  const ann = { _id: id(), name: 'ANN', email: 'ann@d.local', role: 'instructor', organizationId: org, createdAt: new Date(), updatedAt: new Date() }
  await M.UserModel.collection.insertOne(ann as any)
  const start = (d: string) => new Date(`2026-10-${d}T19:00:00+04:00`)
  const min = (d: Date, m: number) => new Date(d.getTime() + m * 60_000)
  const cls = (title: string, d: string, extra: Record<string, unknown> = {}) =>
    ({ _id: id(), title, instructorId: ann._id, courseId: id(), scheduledStart: start(d), durationMins: 60, status: 'ended', organizationId: org, createdAt: new Date(), updatedAt: new Date(), ...extra })
  const onTime = cls('On time', '20', { instructorJoinedAt: min(start('20'), 3) })
  const late = cls('Late 12', '20', { instructorJoinedAt: min(start('20'), 12) })
  const late2 = cls('Late 30', '21', { instructorJoinedAt: min(start('21'), 30) })
  const early = cls('Early', '21', { instructorJoinedAt: min(start('21'), -10) })
  const none = cls('No join', '22')
  const cancelled = cls('Cancelled', '22', { status: 'cancelled' })
  const future = cls('Future', '22', { status: 'scheduled', scheduledStart: new Date(Date.now() + 86_400_000) })
  await M.LiveClassModel.collection.insertMany([onTime, late, late2, early, none, cancelled] as any)

  check('joinOf: exactly 5 minutes is on time', joinOf({ status: 'ended', scheduledStart: start('20'), instructorJoinedAt: min(start('20'), 5) }).state === 'on_time')
  check('joinOf: 6 minutes is late', joinOf({ status: 'ended', scheduledStart: start('20'), instructorJoinedAt: min(start('20'), 6) }).lateMins === 6)
  check('joinOf: a future class is not due', joinOf(future as any).state === 'n/a')

  const r: any = await mentorReportForPortal({ from: '2026-10-19', to: '2026-10-23', emails: 'ann@d.local' })
  const t = r.mentors[0].total
  check('two late joins, 42 minutes late in all', t.lateJoins === 2 && t.lateMinutes === 42, j(t))
  check('one class with no join recorded (cancelled not counted)', t.notJoined === 1, j(t))
  const d20 = r.mentors[0].days.find((d: any) => d.day === '2026-10-20')
  check('by day: the 20th has one late join', d20?.lateJoins === 1 && d20?.lateMinutes === 12, j(d20))

  const lj: any = await mentorReportDetailForPortal({ kind: 'late_joins', from: '2026-10-19', to: '2026-10-23', emails: 'ann@d.local' })
  check('late_joins lists the two, with minutes late', lj.total === 2 && lj.rows.map((x: any) => x.lateMins).sort().join() === '12,30', j(lj.rows))
  check('each row says when the mentor joined', lj.rows.every((x: any) => x.joinedAt && x.join === 'late'))
  const nj: any = await mentorReportDetailForPortal({ kind: 'not_joined', from: '2026-10-19', to: '2026-10-23', emails: 'ann@d.local' })
  check('not_joined lists the one with no join', nj.total === 1 && nj.rows[0].title === 'No join', j(nj.rows))
  const all: any = await mentorReportDetailForPortal({ kind: 'classes', from: '2026-10-19', to: '2026-10-23', emails: 'ann@d.local' })
  check('class rows carry the join too', all.rows.find((x: any) => x.title === 'On time')?.join === 'on_time', j(all.rows))
} finally {
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
