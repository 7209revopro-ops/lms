/* The meetings a person booked (2026-11-18, meetingOutcome.service.ts meetingsBookedBy) — for Root's salesperson and
   CS pages: every kind, by who booked it (any case), in the days asked; upcoming / done / waiting / cancelled.
   Run: MEETINGSBOOKED_DB_URL=mongodb://127.0.0.1:<scratch port>/lms_meetingsbooked bun --no-env-file src/tests/meetingsbooked.suite.ts */
process.env.DATABASE_URL = process.env.MEETINGSBOOKED_DB_URL || 'mongodb://127.0.0.1:27311/lms_meetingsbooked'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'meetingsbooked-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'meetingsbooked-suite-refresh-secret-0123456789'
export {}
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const j = (v: unknown) => JSON.stringify(v).slice(0, 600)
const refused = async (p: Promise<unknown>, status: number, has = '') => {
  try { await p; return 'not refused' } catch (e: any) { return e?.statusCode === status && String(e?.message).includes(has) ? true : `${e?.statusCode} ${e?.message}` }
}
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const S = await import('@/services/meetingOutcome.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_meetingsbooked') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const now = new Date('2026-11-18T12:00:00+04:00')
  const at = (iso: string) => new Date(iso)
  const org = new mongoose.Types.ObjectId()
  const id = () => new mongoose.Types.ObjectId()
  const ann = { _id: id(), name: 'Mentor Ann', email: 'ann@d.local', role: 'instructor', organizationId: org, isActive: true, createdAt: now, updatedAt: now }
  await M.UserModel.collection.insertOne(ann as any)
  const mt = (title: string, start: string, extra: Record<string, unknown> = {}) => ({ _id: id(), mentorId: ann._id, organizationId: org, title, kind: 'client', category: '',
    scheduledStart: at(start), durationMins: 30, isOnline: true, attendees: [{ name: 'Client A', email: 'a@client.local' }], bookedByEmail: 'sales@crm.local',
    outcome: null, cancelledAt: null, createdAt: now, updatedAt: now, ...extra })
  const outcome = { stage: 'interested', remark: 'ok', filledAt: at('2026-11-10T11:00:00+04:00'), filledByName: 'Mentor Ann' }
  await M.MentorMeetingModel.collection.insertMany([
    mt('Sales: held', '2026-11-10T10:00:00+04:00', { notes: 'Wants the evening batch' }),            // done (no outcome asked)
    mt('Sales: later today', '2026-11-18T15:00:00+04:00'),                                            // upcoming
    mt('Sales: called off', '2026-11-12T10:00:00+04:00', { cancelledAt: at('2026-11-11T10:00:00+04:00'), cancelReason: 'Client busy', cancelledBy: 'cs' }),
    mt('Sales: last month', '2026-10-20T10:00:00+04:00'),                                             // outside the days
    mt('CS: outcome in', '2026-11-10T10:00:00+04:00', { kind: 'student', bookedByEmail: 'cs@portal.local', bookedVia: 'portal', askOutcome: true, outcome }),
    mt('CS: no outcome yet', '2026-11-17T10:00:00+04:00', { kind: 'student', bookedByEmail: 'cs@portal.local', bookedVia: 'portal', askOutcome: true }),
    mt('CS: staff', '2026-11-15T10:00:00+04:00', { kind: 'staff', bookedByEmail: 'cs@portal.local' }),
    mt('Somebody else', '2026-11-10T10:00:00+04:00', { bookedByEmail: 'other@crm.local' }),
  ] as any)

  console.log('\nA salesperson')
  let r: any = await S.meetingsBookedBy({ emails: 'Sales@CRM.local', from: '2026-11-01', to: '2026-11-30' }, now)
  check('their three in November, newest first; not last month\'s, not somebody else\'s', j(r.meetings.map((m: any) => m.title)) === j(['Sales: later today', 'Sales: called off', 'Sales: held']), j(r.meetings.map((m: any) => m.title)))
  check('held (no outcome asked) = done; later today = upcoming; called off = cancelled', j(r.meetings.map((m: any) => m.status)) === j(['upcoming', 'cancelled', 'done']))
  check('counts', j(r.counts) === j({ upcoming: 1, done: 1, waiting: 0, cancelled: 1 }) && r.total === 3, j(r.counts))
  const off = r.meetings[1]
  check('a cancelled one: when, why, who', off.cancelReason === 'Client busy' && off.cancelledBy === 'cs' && !!off.cancelledAt, j(off))
  check('the mentor, the client, the kind', r.meetings[2].mentor.name === 'Mentor Ann' && r.meetings[2].attendees[0].name === 'Client A' && r.meetings[2].kind === 'client', j(r.meetings[2]))
  check('the booker\'s notes; none is ""', r.meetings[2].notes === 'Wants the evening batch' && r.meetings[0].notes === '', j(r.meetings.map((m: any) => m.notes)))

  console.log('\nA CS')
  r = await S.meetingsBookedBy({ emails: ' CS@Portal.local ', from: '2026-11-01', to: '2026-11-30' }, now)
  const by = (t: string) => r.meetings.find((m: any) => m.title === t)
  check('every kind they booked, the staff one too', r.total === 3 && !!by('CS: staff'), j(r.meetings.map((m: any) => m.title)))
  check('outcome filled = done, with the stage and the mentor\'s remark', by('CS: outcome in')?.status === 'done' && by('CS: outcome in')?.outcome?.stage === 'interested' && by('CS: outcome in')?.outcome?.remark === 'ok', j(by('CS: outcome in')))
  check('over, outcome not filled = waiting', by('CS: no outcome yet')?.status === 'waiting')
  check('where it was booked', by('CS: outcome in')?.bookedVia === 'portal' && by('CS: staff')?.bookedVia === null)
  r = await S.meetingsBookedBy({ emails: 'cs@portal.local,sales@crm.local', from: '2026-11-18', to: '2026-11-18' }, now)
  check('two people, one day ("to" included)', j(r.meetings.map((m: any) => m.title)) === j(['Sales: later today']), j(r.meetings.map((m: any) => m.title)))

  console.log('\nRefused')
  check('no emails', await refused(S.meetingsBookedBy({ from: '2026-11-01', to: '2026-11-30' }, now), 400, 'whose') === true)
  check('no days', await refused(S.meetingsBookedBy({ emails: 'cs@portal.local' }, now), 400, 'days') === true)
  check('the wrong way round', await refused(S.meetingsBookedBy({ emails: 'cs@portal.local', from: '2026-11-30', to: '2026-11-01' }, now), 400, 'days') === true)
  check('more than 400 days', await refused(S.meetingsBookedBy({ emails: 'cs@portal.local', from: '2025-01-01', to: '2026-11-30' }, now), 400, '400') === true)
} finally {
  await mongoose.connection.db!.dropDatabase().catch(() => {})
  await mongoose.disconnect()
}
console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
