/* ─────────────────────────────────────────────────────────────
   The portal's Mentor Calendar, both academies (2026-10-15):
     A. without allAcademies — this academy's mentors and the lent ones only, as before
     B. with it — every academy's mentors, each with its academy; the other academy's
        classes with their titles
     C. booking: another academy's mentor only with allAcademies
   Run: bun --no-env-file src/tests/portalmentorsboth.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.PORTALMENTORS_DB_URL || 'mongodb://localhost:27017/lms_portalmentorsboth'
process.env.NODE_ENV = 'test'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.JWT_ACCESS_SECRET  ??= 'portalmentorsboth-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalmentorsboth-suite-refresh-secret-0123456789'

export {}

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { listMentorsForPortal, createMentorMeetingForPortal } = await import('@/services/portal.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_portalmentorsboth') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer' })
  const mk = (name: string, email: string, org: unknown) => M.UserModel.create({ name, email, passwordHash: 'x', role: 'instructor', isActive: true, isVerified: true, organizationId: org })
  await mk('MOIZ', 'moiz@pm.local', dubai._id)
  const raj = await mk('RAJ', 'raj@pm.local', blr._id)
  const start = new Date(Date.now() + 2 * 864e5)
  await M.LiveClassModel.collection.insertOne({ title: 'Bangalore live', instructorId: raj._id, organizationId: blr._id, scheduledStart: start, durationMins: 60, status: 'scheduled', bookedCount: 0, sessionCapacity: 10, createdAt: new Date(), updatedAt: new Date() })
  const from = new Date().toISOString(), to = new Date(Date.now() + 7 * 864e5).toISOString()

  const a = await listMentorsForPortal({ remoteOrgId: String(dubai._id), from, to })
  check('A. as before: Dubai only', a.mentors.map(m => m.email).join() === 'moiz@pm.local', JSON.stringify(a.mentors.map(m => m.email)))

  const b = await listMentorsForPortal({ remoteOrgId: String(dubai._id), from, to, allAcademies: true })
  const rajRow = b.mentors.find(m => m.email === 'raj@pm.local')
  check('B. both academies\' mentors', b.mentors.length === 2 && !!rajRow, JSON.stringify(b.mentors.map(m => m.email)))
  check('B. each with its academy', rajRow?.academy?.name === 'Bangalore Academy' && b.mentors.find(m => m.email === 'moiz@pm.local')?.academy?.name === 'Dubai Academy', JSON.stringify(rajRow?.academy))
  check('B. the other academy\'s class with its title', rajRow?.classes?.[0]?.title === 'Bangalore live' && rajRow?.classes?.[0]?.mine === true, JSON.stringify(rajRow?.classes))

  const when = new Date(Date.now() + 3 * 864e5).toISOString()
  const base = { remoteOrgId: String(dubai._id), mentorEmail: 'raj@pm.local', title: 'Strategy review', kind: 'staff', scheduledStart: when, durationMins: 30, attendees: [{ name: 'A CS' }], bookedByEmail: 'cs@portal.local', inPerson: true, location: 'Office' }
  let refused = false
  try { await createMentorMeetingForPortal(base) } catch (e: any) { refused = e?.status === 404 || /No mentor/.test(String(e?.message)) }
  check('C. without allAcademies a Bangalore mentor is not bookable', refused)
  const ok = await createMentorMeetingForPortal({ ...base, allAcademies: true })
  check('C. with it, booked', ok?.meeting?.title === 'Strategy review' && ok.mentorEmail === 'raj@pm.local', JSON.stringify(ok).slice(0, 200))
} catch (err) {
  fail++; console.log('  FAIL  threw', err)
} finally {
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
