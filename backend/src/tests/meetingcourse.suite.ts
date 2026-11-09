/* ─────────────────────────────────────────────────────────────
   Course Upgradation meetings (2026-11-09): category course_upgrade with the course it is about.
     A. booked with its course — kept, returned, listed
     B. course_upgrade with no course refused; another category keeps no course
     C. changed to another category: the course goes; back, with one
     D. the Mentor Report counts it
   Run: MEETINGCOURSE_DB_URL=mongodb://127.0.0.1:<port>/lms_meetingcourse bun --no-env-file src/tests/meetingcourse.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.MEETINGCOURSE_DB_URL || 'mongodb://localhost:27017/lms_meetingcourse'
process.env.NODE_ENV = 'test'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.JWT_ACCESS_SECRET  ??= 'meetingcourse-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'meetingcourse-suite-refresh-secret-0123456789'

export {}

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { listMentorsForPortal, createMentorMeetingForPortal, updateMentorMeetingForPortal, getMentorMeetingForPortal } = await import('@/services/portal.service.ts') as any
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_meetingcourse') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  await M.UserModel.create({ name: 'MOIZ', email: 'moiz@mc.local', passwordHash: 'x', role: 'instructor', isActive: true, isVerified: true, organizationId: org._id })
  const when = new Date(Date.now() + 2 * 864e5)
  when.setUTCHours(8, 0, 0, 0)
  const base = { remoteOrgId: String(org._id), mentorEmail: 'moiz@mc.local', title: 'Session with Ann', kind: 'student', scheduledStart: when.toISOString(), durationMins: 30, attendees: [{ name: 'Ann' }], bookedByEmail: 'cs@portal.local', inPerson: true, location: 'Office' }

  const a = await createMentorMeetingForPortal({ ...base, category: 'course_upgrade', course: 'DSLP PRO' })
  check('A. booked with its course', a.meeting.category === 'course_upgrade' && a.meeting.course === 'DSLP PRO', JSON.stringify(a.meeting))
  const saved: any = await M.MentorMeetingModel.findById(a.meeting.id).lean()
  check('A. kept on the meeting', saved?.course === 'DSLP PRO' && saved?.category === 'course_upgrade')
  const list = await listMentorsForPortal({ remoteOrgId: String(org._id), from: new Date().toISOString(), to: new Date(Date.now() + 7 * 864e5).toISOString() })
  const listed = list.mentors[0]?.meetings?.[0]
  check('A. listed with its course', listed?.course === 'DSLP PRO' && listed?.category === 'course_upgrade', JSON.stringify(listed))

  let refused = false
  try { await createMentorMeetingForPortal({ ...base, scheduledStart: new Date(when.getTime() + 3 * 3600e3).toISOString(), category: 'course_upgrade' }) } catch (e: any) { refused = /needs its course/.test(String(e?.message)) }
  check('B. course_upgrade without a course refused', refused)
  const b = await createMentorMeetingForPortal({ ...base, scheduledStart: new Date(when.getTime() + 5 * 3600e3).toISOString(), category: 'course_pitch', course: 'DWT' })
  check('B. another category keeps no course', b.meeting.course === '', JSON.stringify(b.meeting.course))
  let bad = false
  try { await createMentorMeetingForPortal({ ...base, scheduledStart: new Date(when.getTime() + 7 * 3600e3).toISOString(), category: 'upgrade' }) } catch (e: any) { bad = /category must be/.test(String(e?.message)) }
  check('B. an unknown category still refused', bad)

  await updateMentorMeetingForPortal({ remoteOrgId: String(org._id), meetingId: a.meeting.id, actorEmail: 'cs@portal.local', category: 'overview' })
  const c1: any = await M.MentorMeetingModel.findById(a.meeting.id).lean()
  check('C. changed to Overview: the course goes', c1?.category === 'overview' && c1?.course === '', JSON.stringify({ c: c1?.category, k: c1?.course }))
  await updateMentorMeetingForPortal({ remoteOrgId: String(org._id), meetingId: a.meeting.id, actorEmail: 'cs@portal.local', category: 'course_upgrade', course: 'MSNR' })
  const c2 = await getMentorMeetingForPortal({ remoteOrgId: String(org._id), meetingId: a.meeting.id, actorEmail: 'cs@portal.local' }).catch(() => null)
  const c2db: any = await M.MentorMeetingModel.findById(a.meeting.id).lean()
  check('C. back to Course Upgradation with MSNR', c2db?.course === 'MSNR' && (!c2 || c2.course === 'MSNR'), JSON.stringify({ db: c2db?.course, api: c2?.course }))

  const { mentorReportForPortal } = await import('@/services/portalMentorReport.service.ts') as any
  if (typeof mentorReportForPortal === 'function') {
    const r = await mentorReportForPortal({ remoteOrgId: String(org._id), from: new Date(Date.now() - 864e5).toISOString().slice(0, 10), to: new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10) }).catch((e: any) => ({ err: String(e?.message) }))
    const txt = JSON.stringify(r)
    check('D. the Mentor Report counts Course Upgradation', /"mCourseUpgrade":1/.test(txt), txt.slice(0, 300))
  } else console.log('  (D skipped: no mentorReportForPortal export)')
} catch (err) {
  fail++; console.log('  FAIL  threw', err)
} finally {
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
