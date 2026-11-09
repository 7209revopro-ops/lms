/* The Mentor Report's figures for Root's mentor KPIs (2026-11-09): cancellations by who caused them (the mentor's own,
   and older ones with no cause), Program classes apart from regular ones, class assignments reviewed and how fast,
   meetings over — booked by CS Portal or by the mentor themselves — and their reports in on time, and meetings the
   mentor called off; plus "cancelled by" kept when CS Portal cancels a meeting.
   Run: bun --no-env-file src/tests/portalmentorkpi.suite.ts */
process.env.DATABASE_URL = process.env.PORTALMENTORKPI_DB_URL || 'mongodb://localhost:27017/lms_portalmentorkpi'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'portalmentorkpi-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalmentorkpi-suite-refresh-secret-0123456789'
export {}
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const j = (v: unknown) => JSON.stringify(v).slice(0, 500)
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { mentorReportForPortal } = await import('@/services/portalMentorReport.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_portalmentorkpi') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const org = new mongoose.Types.ObjectId()
  const id = () => new mongoose.Types.ObjectId()
  const now = Date.now()
  const H = 3_600_000
  const ago = (h: number) => new Date(now - h * H)
  const ann = { _id: id(), name: 'ANN', email: 'ann@d.local', role: 'instructor', organizationId: org, createdAt: new Date(), updatedAt: new Date() }
  await M.UserModel.collection.insertOne(ann as any)
  const cls = (title: string, h: number, extra: Record<string, unknown> = {}) =>
    ({ _id: id(), title, instructorId: ann._id, courseId: id(), scheduledStart: ago(h), durationMins: 60, status: 'ended', organizationId: org, createdAt: new Date(), updatedAt: new Date(), ...extra })
  const regular = cls('Regular', 50)
  const program = cls('Program class', 49, { programId: id() })
  await M.LiveClassModel.collection.insertMany([
    regular, program,
    cls('Mentor sick', 48, { status: 'cancelled', cancelCause: 'mentor', cancelReason: 'Unwell' }),
    cls('Low booking', 47, { status: 'cancelled', cancelCause: 'student', cancelReason: 'Nobody booked' }),
    cls('Old one', 46, { status: 'cancelled', cancelReason: 'Before causes were asked' }),
  ] as any)
  const seat = (c: any, status: string) => ({ _id: id(), liveClassId: c._id, userId: id(), status, organizationId: org, createdAt: new Date(), updatedAt: new Date() })
  await M.ClassBookingModel.collection.insertMany([
    seat(regular, 'attended'), seat(regular, 'attended'), seat(regular, 'missed'),
    seat(program, 'attended'), seat(program, 'missed'), seat(program, 'missed'),
  ] as any)

  // Class assignments: reviewed in 10 h and in 30 h, one waiting 40 h (due), one sent 2 h ago (not due yet).
  const work = (sentHoursAgo: number, reviewedAfter: number | null) => ({
    _id: id(), studentId: id(), liveClassId: regular._id, courseId: id(), instructorId: ann._id, organizationId: org, title: 'Homework',
    files: [], status: reviewedAfter == null ? 'pending' : 'approved', attempt: 1, reviews: [],
    submittedAt: ago(sentHoursAgo), ...(reviewedAfter == null ? {} : { reviewedAt: ago(sentHoursAgo - reviewedAfter) }),
    createdAt: new Date(), updatedAt: new Date(),
  })
  await M.ClassAssignmentModel.collection.insertMany([work(60, 10), work(50, 30), work(40, null), work(2, null)] as any)

  // Meetings: CS Portal's (askOutcome) — reported in 3 h (interested), reported after 30 h, not reported 40 h on, one
  // still ahead; the mentor's own; one the mentor called off; one the student called off.
  const meet = (h: number, extra: Record<string, unknown> = {}) => ({
    _id: id(), mentorId: ann._id, organizationId: org, title: 'Meeting', kind: 'student', scheduledStart: ago(h), durationMins: 60,
    isOnline: true, attendees: [{ name: 'S', email: 's@x.local' }], bookedByEmail: 'cs@portal.local', bookedVia: 'portal',
    createdAt: new Date(), updatedAt: new Date(), ...extra,
  })
  const outcome = (filledHoursAfterEnd: number, h: number, stage: string) =>
    ({ stage, concern: 'x', remark: '', filledAt: new Date(now - h * H + H + filledHoursAfterEnd * H), filledBy: 'ann@d.local' })
  await M.MentorMeetingModel.collection.insertMany([
    meet(72, { askOutcome: true, outcome: outcome(3, 72, 'interested') }),
    meet(70, { askOutcome: true, outcome: outcome(30, 70, 'follow_up') }),
    meet(60, { askOutcome: true, outcome: null }),
    meet(-24, { askOutcome: true, outcome: null }),
    meet(30, { bookedByEmail: 'ann@d.local', bookedVia: 'lms' }),
    meet(20, { cancelledAt: ago(25), cancelledBy: 'mentor', cancelReason: 'Mentor busy' }),
    meet(18, { cancelledAt: ago(25), cancelledBy: 'student', cancelReason: 'Student away' }),
  ] as any)

  const day = (d: Date) => new Date(d.getTime() + 4 * H).toISOString().slice(0, 10)
  const r: any = await mentorReportForPortal({ from: day(ago(24 * 6)), to: day(new Date(now + 2 * 24 * H)), emails: 'ann@d.local' })
  const t = r.mentors[0]?.total ?? {}
  check('cancellations: 3 in all — 1 by the mentor, 1 with no cause recorded', t.classesCancelled === 3 && t.classesCancelledByMentor === 1 && t.classesCancelledUnclassified === 1, j(t))
  check('Program classes apart: 1 held, 1 attended, 2 missed (of 3 attended, 3 missed)', t.programHeld === 1 && t.programAttended === 1 && t.programMissed === 2 && t.attended === 3 && t.missed === 3, j(t))
  check('assignments: 4 sent, 2 reviewed, 3 due (the 2-hour-old one is not), 40 hours to review in all', t.assignmentsSubmitted === 4 && t.assignmentsReviewed === 2
    && t.assignmentsDue === 3 && t.reviewsTimed === 2 && Math.abs(t.reviewHoursSum - 40) < 0.2, j(t))
  check('meetings over: 4 held — 3 booked by CS Portal, 1 by the mentor themselves', t.meetingsHeld === 4 && t.meetingsHeldCs === 3 && t.meetingsHeldOwn === 1, j(t))
  check('called off: 2, of which the mentor 1', t.meetingsCancelled === 2 && t.meetingsCancelledByMentor === 1, j(t))
  check('reports: 3 due, 2 filled, 1 within 24 hours, 1 interested (the one ahead is not due)', t.reportsDue === 3 && t.reportsFilled === 2 && t.reportsOnTime === 1 && t.meetingsInterested === 1, j(t))
  check('by day as well (the days add up to the total)', r.mentors[0].days.reduce((a: number, d: any) => a + d.meetingsHeldCs, 0) === 3)

  // CS Portal cancelling a meeting says who called it off.
  const { cancelMentorMeetingForPortal } = await import('@/services/portal.service.ts')
  await M.OrganizationModel.collection.insertOne({ _id: org, name: 'Dubai', slug: 'dubai', createdAt: new Date(), updatedAt: new Date() } as any)
  const m = meet(-48, { askOutcome: true })
  await M.MentorMeetingModel.collection.insertOne(m as any)
  try {
    await cancelMentorMeetingForPortal({ remoteOrgId: String(org), meetingId: String(m._id), actorEmail: 'cs@portal.local', silent: true, reason: 'Mentor on leave', cancelledBy: 'mentor', allAcademies: true })
    const kept = await M.MentorMeetingModel.findById(m._id).lean() as any
    check('CS Portal cancelling: "cancelled by" kept with the reason', kept?.cancelledBy === 'mentor' && kept?.cancelReason === 'Mentor on leave' && !!kept?.cancelledAt, j(kept))
  } catch (e) {
    check('CS Portal cancelling: "cancelled by" kept with the reason', false, (e as Error).message)
  }
} finally {
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
