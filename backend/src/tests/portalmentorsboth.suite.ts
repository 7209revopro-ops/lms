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

  // D. where each class is held (Root's Class TV, 2026-11-14): the pod booked, the room typed, an in-person venue;
  //    the class's own academy; another academy's place kept back when not asked for all of them.
  const moiz = await M.UserModel.findOne({ email: 'moiz@pm.local' })
  await M.LiveClassModel.collection.insertMany([
    { title: 'Pod class', instructorId: moiz!._id, organizationId: dubai._id, scheduledStart: new Date(start.getTime() + 3600e3), durationMins: 60, status: 'scheduled', bookedCount: 0, sessionCapacity: 30, isOnline: true, room: 'Old room', pod: { state: 'booked', roomName: 'Pod 6' } },
    { title: 'Room class', instructorId: moiz!._id, organizationId: dubai._id, scheduledStart: new Date(start.getTime() + 2 * 3600e3), durationMins: 60, status: 'scheduled', bookedCount: 0, sessionCapacity: 30, isOnline: false, room: 'Class Room 1', location: 'Head office' },
    { title: 'Off-site class', instructorId: moiz!._id, organizationId: dubai._id, scheduledStart: new Date(start.getTime() + 3 * 3600e3), durationMins: 60, status: 'scheduled', bookedCount: 0, sessionCapacity: 30, isOnline: false, location: 'The villa' },
    { title: 'No pod yet', instructorId: moiz!._id, organizationId: dubai._id, scheduledStart: new Date(start.getTime() + 4 * 3600e3), durationMins: 60, status: 'scheduled', bookedCount: 0, sessionCapacity: 30, isOnline: true, location: 'ignored online', pod: { state: 'no_room' } },
    { title: 'Lent to Bangalore', instructorId: moiz!._id, organizationId: blr._id, scheduledStart: new Date(start.getTime() + 5 * 3600e3), durationMins: 60, status: 'scheduled', bookedCount: 0, sessionCapacity: 30, isOnline: true, pod: { state: 'booked', roomName: 'Pod 9' } },
  ] as any[])
  const d = await listMentorsForPortal({ remoteOrgId: String(dubai._id), from, to, allAcademies: true })
  const byTitle = new Map((d.mentors.find(m => m.email === 'moiz@pm.local')?.classes ?? []).map(c => [c.title, c]))
  check('D. the pod booked for it, over the room typed', byTitle.get('Pod class')?.place === 'Pod 6' && byTitle.get('Pod class')?.online === true, JSON.stringify(byTitle.get('Pod class')))
  check('D. an in-person class: its room', byTitle.get('Room class')?.place === 'Class Room 1' && byTitle.get('Room class')?.online === false, JSON.stringify(byTitle.get('Room class')))
  check('D. in person with no room: its venue', byTitle.get('Off-site class')?.place === 'The villa', JSON.stringify(byTitle.get('Off-site class')))
  check('D. online with no pod: no place', byTitle.get('No pod yet')?.place === '', JSON.stringify(byTitle.get('No pod yet')))
  check('D. each class with its own academy', byTitle.get('Pod class')?.academy === 'Dubai Academy' && byTitle.get('Lent to Bangalore')?.academy === 'Bangalore Academy' && byTitle.get('Lent to Bangalore')?.place === 'Pod 9', JSON.stringify(byTitle.get('Lent to Bangalore')))
  const own = await listMentorsForPortal({ remoteOrgId: String(dubai._id), from, to })
  const lent = (own.mentors.find(m => m.email === 'moiz@pm.local')?.classes ?? []).find(c => c.mine === false)
  check('D. another academy\'s class, not asked for all: no title and no place, still its academy', !!lent && lent.title === null && lent.place === null && lent.academy === 'Bangalore Academy', JSON.stringify(lent))

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
