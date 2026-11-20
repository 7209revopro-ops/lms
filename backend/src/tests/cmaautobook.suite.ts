/* ─────────────────────────────────────────────────────────────
   CMA classes book themselves (services/cmaAutoBook.service.ts)

     A. who: enrolled + approved + active + module open — not pending, not
        blocked, not dropped, not another course's, not one who cancelled
     B. a full class is made bigger; a second sweep books nobody twice
     C. never a non-CMA class, one starting within 5 minutes, a cancelled one,
        or the in-person half of an online + in-person pair
     D. told once: after the settling minutes, one notice / digest / WhatsApp
        per student for all their new seats; never again
     E. CMA_AUTO_BOOK off: the sweep does nothing
   Run: bun --no-env-file src/tests/cmaautobook.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_cmaautobook'
process.env.NODE_ENV = 'test'
process.env.SMTP_HOST = ''; process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.JWT_ACCESS_SECRET  ??= 'cmaautobook-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'cmaautobook-suite-refresh-secret-0123456789'
delete process.env.CMA_AUTO_BOOK

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { bookCmaClasses, tellCmaStudents, runCmaAutoBook, cmaAutoBookOn } = await import('@/services/cmaAutoBook.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_cmaautobook') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await M.ClassBookingModel.createIndexes()

const MIN = 60_000, HOUR = 60 * MIN
const seats = async (cls: unknown) => (await M.ClassBookingModel.find({ liveClassId: cls }).lean() as any[])
const bookedIds = async (cls: unknown) => (await seats(cls)).filter(b => b.status === 'booked').map(b => String(b.userId)).sort()

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const mentor = await M.UserModel.create({ name: 'Mentor', email: 'mentor@cma.local', passwordHash: 'x', role: 'instructor', isActive: true, organizationId: org._id })
  const cma = await M.CourseModel.create({ title: 'CMA (US) Part 1', slug: 'cma-1', description: 'd', instructorId: mentor._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id, program: 'cma' })
  const other = await M.CourseModel.create({ title: 'MBT', slug: 'mbt', description: 'd', instructorId: mentor._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id, program: '4x-trading' })
  const m1 = await M.SectionModel.create({ courseId: cma._id, title: 'Module 1', order: 1 })
  const m2 = await M.SectionModel.create({ courseId: cma._id, title: 'Module 2', order: 2 })
  const st = (name: string, extra: Record<string, unknown> = {}) => M.UserModel.create({ name, email: `${name.toLowerCase()}@cma.local`, passwordHash: 'x', role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id, enrollmentApplication: { phone: '+971500000000' }, ...extra })
  const ana = await st('Ana'), ben = await st('Ben'), cai = await st('Cai')
  const pen = await st('Pen', { enrollmentStatus: 'pending' })
  const blo = await st('Blo'), dro = await st('Dro'), oth = await st('Oth'), can = await st('Can'), off = await st('Off', { isActive: false })
  const enrol = (u: any, course: any, extra: Record<string, unknown> = {}) => M.EnrollmentModel.create({ userId: u._id, courseId: course._id, status: 'active', organizationId: org._id, ...extra } as any)
  for (const u of [ana, ben, cai, pen, can, off]) await enrol(u, cma)
  await enrol(blo, cma, { blockedLessons: [m1._id] })
  await enrol(dro, cma, { status: 'dropped' })
  await enrol(oth, other)

  const mk = (title: string, course: any, startIn: number, extra: Record<string, unknown> = {}) => M.LiveClassModel.create({
    title, courseId: course._id, sectionId: course === cma ? m1._id : undefined, instructorId: mentor._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() + startIn), durationMins: 90, type: 'external', isOnline: true, status: 'scheduled',
    sessionCapacity: 2, bookedCount: 0, ...extra,
  })
  const c1 = await mk('CMA 1 · Module 1', cma, 2 * HOUR)
  const c2 = await mk('CMA 2 · Module 1', cma, 26 * HOUR)
  const notCma = await mk('MBT class', other, 2 * HOUR)
  const soon = await mk('CMA starting in 3 min', cma, 3 * MIN)
  const cancelled = await mk('CMA cancelled', cma, 3 * HOUR, { status: 'cancelled', cancelReason: 'x' })
  const pair = new mongoose.Types.ObjectId()
  const online = await mk('CMA pair online', cma, 5 * HOUR, { hybridPairId: pair })
  const inPerson = await mk('CMA pair in person', cma, 5 * HOUR, { hybridPairId: pair, isOnline: false, location: 'Al Barsha' })
  /* Can cancelled their seat on c1 before. */
  await M.ClassBookingModel.create({ userId: can._id, liveClassId: c1._id, status: 'cancelled', cancelledAt: new Date() } as any)

  section('E · off unless switched on (tests: on)')
  check('on in tests by default', cmaAutoBookOn())
  process.env.CMA_AUTO_BOOK = 'off'
  check('CMA_AUTO_BOOK=off: the sweep does nothing', (await runCmaAutoBook()) === null && (await seats(c1)).length === 1)
  delete process.env.CMA_AUTO_BOOK

  section('A · who gets a seat')
  const dry = await bookCmaClasses(new Date(), { dryRun: true })
  check('a preview books nobody', (await seats(c1)).length === 1 && dry.booked > 0, JSON.stringify({ booked: dry.booked }))
  const r1 = await bookCmaClasses()
  const want = [ana, ben, cai].map(u => String(u._id)).sort()
  check('Ana, Ben and Cai are booked on the first class', JSON.stringify(await bookedIds(c1)) === JSON.stringify(want), JSON.stringify(await bookedIds(c1)))
  const wantAll = [ana, ben, cai, can].map(u => String(u._id)).sort()
  check('…and on the second — Can too, who cancelled only the first', JSON.stringify(await bookedIds(c2)) === JSON.stringify(wantAll), JSON.stringify(await bookedIds(c2)))
  const c1Ids = (await seats(c1)).map(b => String(b.userId))
  check('not a pending student', !c1Ids.includes(String(pen._id)))
  check("not one whose module is blocked", !c1Ids.includes(String(blo._id)))
  check('not a dropped enrolment', !c1Ids.includes(String(dro._id)))
  check("not another course's student", !c1Ids.includes(String(oth._id)))
  check('not a deactivated account', !c1Ids.includes(String(off._id)))
  check('one who cancelled their seat stays cancelled', (await seats(c1)).find(b => String(b.userId) === String(can._id))?.status === 'cancelled')
  const s1 = (await seats(c1)).find(b => String(b.userId) === String(ana._id))
  check('the seat is marked auto-booked, not yet told', !!s1?.autoBookedAt && !s1?.autoNoticeSentAt)

  section('B · room for everyone, never twice')
  const cls1 = await M.LiveClassModel.findById(c1._id).lean() as any
  check('a class of 2 seats grew to hold its 3 (and ten to spare)', cls1.bookedCount === 3 && cls1.sessionCapacity >= 13, `${cls1.bookedCount}/${cls1.sessionCapacity}`)
  const r2 = await bookCmaClasses()
  check('a second sweep books nobody', r2.booked === 0 && (await seats(c1)).length === 4, JSON.stringify(r2))
  check('first sweep total: 3 + 4 + 4 seats', r1.booked === 11, String(r1.booked))

  section('C · never these')
  check('not a non-CMA class', (await seats(notCma)).length === 0)
  check('not a class starting within 5 minutes', (await seats(soon)).length === 0)
  check('not a cancelled class', (await seats(cancelled)).length === 0)
  check('the online half of a pair: booked', (await seats(online)).length === 4)
  check('the in-person half: left to the online one', (await seats(inPerson)).length === 0)

  section('D · told once')
  const sent: Array<{ what: string; code: string }> = []
  const whatsapp = async (_p: string, _n: string, _c: string, what: string, _d: string, _t: string, code: string) => { sent.push({ what, code }) }
  check('nobody before the settling minutes', (await tellCmaStudents(new Date(), { whatsapp })) === 0 && sent.length === 0)
  const later = new Date(Date.now() + 5 * MIN)
  const told = await tellCmaStudents(later, { whatsapp })
  check('then each of the 4 students once', told === 4 && sent.length === 4, `${told} / ${sent.length}`)
  check('one WhatsApp each for all their classes, with a sign-in link', sent.every(s => s.code.length > 5) && sent.filter(s => /\+ 2 more classes/.test(s.what)).length === 3 && sent.filter(s => /\+ 1 more class$/.test(s.what)).length === 1, JSON.stringify(sent.map(s => s.what)))
  const notes = await M.NotificationModel.find({ userId: ana._id }).lean() as any[]
  check('one in-app notice listing the classes', notes.length === 1 && /3 CMA \(US\) Part 1 classes/.test(notes[0].title) && /CMA 1 · Module 1/.test(notes[0].body), JSON.stringify(notes[0]?.title))
  check('one e-mail digest item', (await M.DigestQueueModel.countDocuments({ userId: ana._id })) === 1)
  check('every seat marked told', (await M.ClassBookingModel.countDocuments({ autoBookedAt: { $exists: true }, autoNoticeSentAt: { $exists: false } })) === 0)
  check('never told again', (await tellCmaStudents(new Date(Date.now() + 10 * MIN), { whatsapp })) === 0 && sent.length === 4)

  section('A again · a student who enrols later')
  const dee = await st('Dee'); await enrol(dee, cma)
  const r3 = await bookCmaClasses()
  check('is booked into the upcoming classes on the next sweep', r3.booked === 3 && (await bookedIds(c1)).includes(String(dee._id)), JSON.stringify(r3))
  const told2 = await tellCmaStudents(new Date(Date.now() + 5 * MIN), { whatsapp })
  check('…and only they are told', told2 === 1 && sent.length === 5)
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
