/* ─────────────────────────────────────────────────────────────
   Programs: a picture and each class's Meet link (the portal, 2026-10-15)
     A. made with a picture — on it and its hidden course (the student app's class cards)
     B. the picture changed alone — the classes stay as they were
     C. a bad address is refused
     D. each class carries its Meet link: the program's own link; in person none
   Run: bun --no-env-file src/tests/programimage.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.PROGRAMIMAGE_DB_URL || 'mongodb://localhost:27017/lms_programimage'
process.env.NODE_ENV = 'test'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.JWT_ACCESS_SECRET  ??= 'programimage-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'programimage-suite-refresh-secret-0123456789'

export {}

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const P = await import('@/services/program.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_programimage') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const day = (o: number) => new Date(Date.now() + o * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const mk = (name: string, email: string, role: string) => M.UserModel.create({ name, email, passwordHash: 'x', role, isActive: true, isVerified: true, organizationId: org._id, ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}) })
  const admin = await mk('Admin', 'admin@pi.local', 'admin')
  await mk('MOIZ', 'moiz@pi.local', 'instructor')
  await mk('Stu', 'stu@pi.local', 'student')
  const actor = { id: String(admin._id), role: 'admin', organizationId: String(org._id), email: 'admin@pi.local', name: 'Admin' } as any
  const base = { title: 'Weekly review', repeat: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], startDate: day(1), endDate: day(3), time: '19:00', durationMins: 60, mentorEmail: 'moiz@pi.local', students: ['stu@pi.local'] }
  const pic = 'https://cdn.example.com/review.png'

  const a: any = await P.createProgram({ ...base, isOnline: false, location: 'Room 1', thumbnailUrl: pic }, actor)
  const course: any = await M.CourseModel.findOne({ programId: a.id }).lean()
  check('A. the program has its picture', a.thumbnailUrl === pic, a.thumbnailUrl)
  check('A. …and its hidden course (the class cards)', course?.thumbnailUrl === pic, course?.thumbnailUrl)
  check('D. in person: no Meet link', a.classes.length > 0 && a.classes.every((c: any) => c.meetUrl === ''), JSON.stringify(a.classes.slice(0, 1)))

  const before = a.classes.map((c: any) => c.id).join()
  const b: any = await P.rescheduleProgram(a.id, { thumbnailUrl: 'https://cdn.example.com/new.png' }, actor)
  const course2: any = await M.CourseModel.findOne({ programId: a.id }).lean()
  check('B. picture changed', b.thumbnailUrl === 'https://cdn.example.com/new.png' && course2?.thumbnailUrl === 'https://cdn.example.com/new.png')
  check('B. the classes are the same ones', b.classes.map((c: any) => c.id).join() === before && b.classes.every((c: any) => c.status === 'scheduled'))

  let refused = false
  try { await P.createProgram({ ...base, isOnline: false, location: 'Room 1', thumbnailUrl: 'javascript:alert(1)' }, actor) } catch { refused = true }
  check('C. a bad address is refused', refused)

  const meet = 'https://meet.google.com/abc-defg-hij'
  const d: any = await P.createProgram({ ...base, title: 'Online review', isOnline: true, meetingMode: 'link', meetingUrl: meet }, actor)
  check('D. its own Meet link on every class', d.classes.length > 0 && d.classes.every((c: any) => c.meetUrl === meet), JSON.stringify(d.classes.slice(0, 1)))
} catch (err) {
  fail++; console.log('  FAIL  threw', err)
} finally {
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
