/* ─────────────────────────────────────────────────────────────
   The 9 PM "your schedule for tomorrow" instructor email.

     A  zone-day math: tomorrow's bounds in Dubai and Bangalore, midnight edges
     B  before 9 PM local, nobody is mailed
     C  9 PM IST comes 90 minutes before 9 PM GST — Bangalore goes first
     D  at 9 PM GST each Dubai instructor gets ONE email: their classes and
        meetings for tomorrow, in time order, cancelled/other-day/other-person
        items excluded; a free day gets the short "nothing scheduled" note;
        opted-out, master-off, inactive and non-instructor staff get nothing
     E  running again the same evening mails nobody twice
     F  after local midnight nothing sends (tomorrow has moved on)
     G  the send log records the day and item count
     H  a failed send releases its claim and the next tick delivers
     I  opting back in late in the evening still gets tonight's email

   Boots against an ISOLATED throwaway database, dropped on exit.
   NODE_ENV=test forces the console sender; EMAIL_OUTBOX=on records every
   message so the assertions read real sends.

   Run: bun run test:instructorschedule
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_instructorschedule_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.ADMIN_URL    = 'http://localhost:3001'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''
delete process.env.INSTRUCTOR_SCHEDULE_HOUR   // pin the default 21

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const {
  UserModel, OrganizationModel, LiveClassModel, MentorMeetingModel,
  EmailOutboxModel, InstructorScheduleMailModel,
} = await import('@/models/schema.ts')
const { resetOrgSlugCache } = await import('@/utils/orgSlugs.ts')
const { zoneDateKey, zoneHourMinute, addDaysToDateKey, zoneDayBounds } = await import('@/utils/zoneDay.ts')
const { runInstructorScheduleMail } = await import('@/jobs/instructorSchedule.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_instructorschedule_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()
/* autoIndex is off in the suites; the unique index is the guarantee under test. */
await InstructorScheduleMailModel.createIndexes()

const mails = (to: string) => EmailOutboxModel.countDocuments({ to })
const latestMail = (to: string) =>
  EmailOutboxModel.findOne({ to }).sort({ createdAt: -1 }).lean() as any
const allMailCount = () => EmailOutboxModel.countDocuments({})

try {

/* ── A. zone-day math ───────────────────────────────── */
section('A  zone-day math')
{
  const d = zoneDayBounds('2026-10-06', 'Asia/Dubai')
  check('A1 Dubai 6 Oct starts 5 Oct 20:00Z', d.start.toISOString() === '2026-10-05T20:00:00.000Z', d.start.toISOString())
  check('A2 Dubai 6 Oct ends 6 Oct 20:00Z',   d.end.toISOString()   === '2026-10-06T20:00:00.000Z', d.end.toISOString())
  const k = zoneDayBounds('2026-10-06', 'Asia/Kolkata')
  check('A3 Bangalore 6 Oct starts 5 Oct 18:30Z', k.start.toISOString() === '2026-10-05T18:30:00.000Z', k.start.toISOString())
  const i = new Date('2026-10-05T18:45:00Z')
  check('A4 00:15 IST is already the 6th in Bangalore', zoneDateKey(i, 'Asia/Kolkata') === '2026-10-06')
  check('A5 …but still the 5th in Dubai',               zoneDateKey(i, 'Asia/Dubai')   === '2026-10-05')
  check('A6 local midnight is the new day, not hour 24',
    zoneDateKey(new Date('2026-10-05T20:00:00Z'), 'Asia/Dubai') === '2026-10-06'
    && zoneHourMinute(new Date('2026-10-05T20:00:00Z'), 'Asia/Dubai').hour === 0)
  const hm = zoneHourMinute(new Date('2026-10-05T17:00:00Z'), 'Asia/Dubai')
  check('A7 17:00Z is 21:00 GST', hm.hour === 21 && hm.minute === 0, JSON.stringify(hm))
  check('A8 date keys roll across the year', addDaysToDateKey('2026-12-31', 1) === '2027-01-01')
}

/* ── Seed ───────────────────────────────────────────── */
const dubai = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const blr   = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay', countryFilter: 'India' })
resetOrgSlugCache()

const courseId = new mongoose.Types.ObjectId()
await mongoose.connection.collection('courses').insertOne({ _id: courseId, title: 'TypeScript from Zero to Hero' })

const oid = () => new mongoose.Types.ObjectId()
const U = {
  dIns:     { _id: oid(), email: 'd.ins@sched.test',     name: 'Dana Instructor' },
  dFree:    { _id: oid(), email: 'd.free@sched.test',    name: 'Farah Free' },
  dOptOut:  { _id: oid(), email: 'd.optout@sched.test',  name: 'Omar OptOut' },
  dMaster:  { _id: oid(), email: 'd.master@sched.test',  name: 'Mona Master' },
  dGone:    { _id: oid(), email: 'd.gone@sched.test',    name: 'Ghazi Gone' },
  dAdmin:   { _id: oid(), email: 'd.admin@sched.test',   name: 'Adam Admin' },
  bIns:     { _id: oid(), email: 'b.ins@sched.test',     name: 'Bala Instructor' },
}
await UserModel.collection.insertMany([
  { ...U.dIns,    role: 'instructor', isActive: true,  organizationId: dubai._id },
  { ...U.dFree,   role: 'instructor', isActive: true,  organizationId: dubai._id },
  { ...U.dOptOut, role: 'instructor', isActive: true,  organizationId: dubai._id, emailPrefs: { categories: { dailySchedule: false } } },
  { ...U.dMaster, role: 'instructor', isActive: true,  organizationId: dubai._id, emailPrefs: { masterEnabled: false } },
  { ...U.dGone,   role: 'instructor', isActive: false, organizationId: dubai._id },
  { ...U.dAdmin,  role: 'admin',      isActive: true,  organizationId: dubai._id },
  { ...U.bIns,    role: 'instructor', isActive: true,  organizationId: blr._id },
])

const cls = (instructorId: unknown, title: string, iso: string, extra: Record<string, unknown> = {}) => ({
  _id: oid(), courseId, instructorId, title, scheduledStart: new Date(iso), durationMins: 60,
  type: 'external', status: 'scheduled', isOnline: true, bookedCount: 0, sessionCapacity: 30, ...extra,
})
await LiveClassModel.collection.insertMany([
  /* Dana — tomorrow (6 Oct GST) is [5 Oct 20:00Z, 6 Oct 20:00Z) */
  cls(U.dIns._id, 'Generics deep dive',    '2026-10-06T06:00:00Z', { durationMins: 90, meetingUrl: 'https://meet.google.com/abc-defg-hij', bookedCount: 12 }),
  cls(U.dIns._id, 'In-person workshop',    '2026-10-06T12:00:00Z', { isOnline: false, location: 'Dubai Campus', room: '4' }),
  cls(U.dIns._id, 'Midnight kickoff',      '2026-10-05T20:15:00Z'),                       // 00:15 GST — tomorrow, first
  cls(U.dIns._id, 'CANCELLED class',       '2026-10-06T08:00:00Z', { status: 'cancelled' }),
  cls(U.dIns._id, 'TODAY class',           '2026-10-05T10:00:00Z'),
  cls(U.dIns._id, 'LATE TONIGHT class',    '2026-10-05T19:45:00Z'),                       // 23:45 GST today
  cls(U.dIns._id, 'DAY AFTER class',       '2026-10-07T06:00:00Z'),
  /* An admin teaching tomorrow — strictly-instructor rule */
  cls(U.dAdmin._id, 'ADMIN taught class',  '2026-10-06T07:00:00Z'),
  /* Bala — tomorrow (6 Oct IST) is [5 Oct 18:30Z, 6 Oct 18:30Z) */
  cls(U.bIns._id, 'Bangalore early batch', '2026-10-05T18:45:00Z'),                       // 00:15 IST — tomorrow
  cls(U.bIns._id, 'BLR TONIGHT class',     '2026-10-05T18:15:00Z'),                       // 23:45 IST today
])
await MentorMeetingModel.collection.insertMany([
  { _id: oid(), mentorId: U.dIns._id, organizationId: dubai._id, title: 'Portfolio review', kind: 'student',
    scheduledStart: new Date('2026-10-06T09:00:00Z'), durationMins: 30, meetingUrl: 'https://meet.google.com/xyz-abcd-efg',
    attendees: [{ name: 'Aisha', email: '' }, { name: 'Omar', email: '' }], notes: '', bookedByEmail: 'x@y.z', cancelledAt: null },
  { _id: oid(), mentorId: U.dIns._id, organizationId: dubai._id, title: 'CALLED OFF meeting', kind: 'staff',
    scheduledStart: new Date('2026-10-06T11:00:00Z'), durationMins: 30, meetingUrl: '',
    attendees: [{ name: 'Zed', email: '' }], notes: '', bookedByEmail: 'x@y.z', cancelledAt: new Date() },
])

/* ── B. before 9 PM everywhere ──────────────────────── */
section('B  before 9 PM local — nobody')
{
  const r = await runInstructorScheduleMail(new Date('2026-10-05T15:00:00Z'))   // 19:00 GST, 20:30 IST
  check('B1 nothing sent', r.sent === 0, JSON.stringify(r))
  check('B2 no mail in the outbox', (await allMailCount()) === 0)
}

/* ── C. Bangalore's 9 PM comes first ────────────────── */
section('C  9 PM IST is 19:30 GST — Bangalore first')
{
  const r = await runInstructorScheduleMail(new Date('2026-10-05T15:30:00Z'))   // 19:30 GST, 21:00 IST
  check('C1 exactly one sent', r.sent === 1, JSON.stringify(r))
  check('C2 it went to the Bangalore instructor', (await mails(U.bIns.email)) === 1)
  check('C3 no Dubai instructor yet', (await mails(U.dIns.email)) === 0 && (await mails(U.dFree.email)) === 0)
  const m = await latestMail(U.bIns.email)
  const html = String(m?.html ?? '')
  check('C4 00:15 IST class is on tomorrow’s list', html.includes('Bangalore early batch'))
  check('C5 23:45 IST class today is not', !html.includes('BLR TONIGHT class'))
  check('C6 times are in IST', html.includes('IST') && !html.includes('GST'), m?.subject)
}

/* ── D. 9 PM GST ────────────────────────────────────── */
section('D  9 PM GST — Dubai instructors')
{
  const r = await runInstructorScheduleMail(new Date('2026-10-05T17:00:00Z'))   // 21:00 GST
  check('D1 two Dubai sends (the one with sessions + the free one)', r.sent === 2, JSON.stringify(r))
  check('D2 opted-out and master-off were counted, not mailed', r.optedOut === 2, JSON.stringify(r))

  check('D3 Dana: exactly one email', (await mails(U.dIns.email)) === 1)
  const m = await latestMail(U.dIns.email)
  const subject = String(m?.subject ?? '')
  const html = String(m?.html ?? '')
  check('D4 subject names tomorrow and counts 4 sessions',
    subject.startsWith('Your schedule for tomorrow — ') && subject.includes('Oct 6') && subject.endsWith('(4 sessions)'), subject)

  for (const t of ['Midnight kickoff', 'Generics deep dive', 'Portfolio review', 'In-person workshop']) {
    check(`D5 includes "${t}"`, html.includes(t))
  }
  for (const t of ['CANCELLED class', 'TODAY class', 'LATE TONIGHT class', 'DAY AFTER class', 'CALLED OFF meeting', 'ADMIN taught class']) {
    check(`D6 excludes "${t}"`, !html.includes(t))
  }
  const order = ['Midnight kickoff', 'Generics deep dive', 'Portfolio review', 'In-person workshop'].map(t => html.indexOf(t))
  check('D7 in time order', order.every((v, i) => i === 0 || v > order[i - 1]!), JSON.stringify(order))
  check('D8 time range in GST', html.includes('10:00 AM – 11:30 AM GST'))
  check('D9 online class shows its Meet link', html.includes('Join Google Meet') && html.includes('https://meet.google.com/abc-defg-hij'))
  check('D10 in-person class shows location + room', html.includes('Dubai Campus, Room 4'))
  check('D11 seats booked', html.includes('12 of 30 seats booked'))
  check('D12 meeting shows who is coming', html.includes('With Aisha, Omar'))
  check('D13 course title shown', html.includes('TypeScript from Zero to Hero'))

  check('D14 free day: one short "nothing scheduled" note', (await mails(U.dFree.email)) === 1)
  const free = await latestMail(U.dFree.email)
  check('D15 …with the right subject',
    String(free?.subject ?? '').startsWith('Nothing scheduled tomorrow — ') && String(free?.subject).includes('Oct 6'), free?.subject)

  check('D16 opted out of dailySchedule: nothing', (await mails(U.dOptOut.email)) === 0)
  check('D17 master switch off: nothing',          (await mails(U.dMaster.email)) === 0)
  check('D18 inactive instructor: nothing',        (await mails(U.dGone.email)) === 0)
  check('D19 admin teaching tomorrow: nothing (instructors only)', (await mails(U.dAdmin.email)) === 0)
  check('D20 Bangalore not mailed a second time',  (await mails(U.bIns.email)) === 1)
}

/* ── E. same evening again ──────────────────────────── */
section('E  run again the same evening — no duplicates')
{
  const before = await allMailCount()
  const r1 = await runInstructorScheduleMail(new Date('2026-10-05T17:15:00Z'))
  const r2 = await runInstructorScheduleMail(new Date('2026-10-05T19:45:00Z'))   // 23:45 GST
  check('E1 nothing new sent', r1.sent === 0 && r2.sent === 0, JSON.stringify([r1, r2]))
  check('E2 outbox unchanged', (await allMailCount()) === before)
}

/* ── F. after local midnight ────────────────────────── */
section('F  after local midnight — the window has closed')
{
  const before = await allMailCount()
  const r = await runInstructorScheduleMail(new Date('2026-10-05T20:30:00Z'))    // 00:30 GST / 02:00 IST on the 6th
  check('F1 nothing sent', r.sent === 0, JSON.stringify(r))
  check('F2 outbox unchanged', (await allMailCount()) === before)
}

/* ── G. send log ────────────────────────────────────── */
section('G  send log')
{
  const dana = await InstructorScheduleMailModel.findOne({ instructorId: U.dIns._id }).lean()
  check('G1 Dana logged for 2026-10-06 with 4 items', dana?.forDate === '2026-10-06' && dana?.itemCount === 4, JSON.stringify(dana))
  const free = await InstructorScheduleMailModel.findOne({ instructorId: U.dFree._id }).lean()
  check('G2 free day logged with 0 items', free?.forDate === '2026-10-06' && free?.itemCount === 0)
  const bala = await InstructorScheduleMailModel.findOne({ instructorId: U.bIns._id }).lean()
  check('G3 Bangalore logged for its own tomorrow', bala?.forDate === '2026-10-06' && bala?.itemCount === 1)
  check('G4 no log for the opted-out', !(await InstructorScheduleMailModel.exists({ instructorId: U.dOptOut._id })))
}

/* ── H. failure releases the claim ──────────────────── */
section('H  a failed send is retried on the next tick')
{
  const f = { _id: oid(), email: 'd.flaky@sched.test', name: 'Flaky' }
  await UserModel.collection.insertOne({ ...f, role: 'instructor', isActive: true, organizationId: dubai._id })
  const boom = async () => { throw new Error('SMTP down') }
  const r1 = await runInstructorScheduleMail(new Date('2026-10-05T17:30:00Z'), boom)
  check('H1 the failure is reported', r1.failed === 1 && r1.sent === 0, JSON.stringify(r1))
  check('H2 its claim was released', !(await InstructorScheduleMailModel.exists({ instructorId: f._id })))
  check('H3 others were not re-sent on the failing tick', (await mails(U.dIns.email)) === 1)
  const r2 = await runInstructorScheduleMail(new Date('2026-10-05T17:45:00Z'))
  check('H4 the next tick delivers', r2.sent === 1 && (await mails(f.email)) === 1, JSON.stringify(r2))
}

/* ── I. opting back in late ─────────────────────────── */
section('I  opting back in before midnight still gets tonight’s email')
{
  await UserModel.collection.updateOne({ _id: U.dOptOut._id }, { $set: { 'emailPrefs.categories.dailySchedule': true } })
  const r = await runInstructorScheduleMail(new Date('2026-10-05T18:00:00Z'))    // 22:00 GST
  check('I1 sent to the re-enabled instructor', r.sent === 1 && (await mails(U.dOptOut.email)) === 1, JSON.stringify(r))
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\ninstructorschedule.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
