/* ─────────────────────────────────────────────────────────────
   A class a student attended, once it is over — for the commission portal —
   and when a Google Meet class really ended
   (services/portalActivity.service.ts classAttendedEvents,
   jobs/reminders.job.ts runMeetClassEnd).

   Pinned here, against a real database:

     A. a seat attended — joined the LMS room, joined through the link, or
        marked attended by hand — is told once the class is over: at the end
        the meeting gave (the LMS room, or Google Meet), else at the timetable
        end plus a margin (15 minutes; an hour for a Meet class, so Google's
        word comes first); attendance marked later is told when it was marked;
        each under the seat's own key, the same however often it is asked for —
        and only to a caller that asks for classes (include=classes);
     B. never told: a class not over yet, a seat missed or cancelled, a class
        cancelled; nothing outside `since` … now;
     C. a Meet class past its timetable end is 'ended' when Google records its
        conference ending (endSource 'meet'): not while it is still going, not
        from a conference long before the class, not when Google can't be
        asked, not once 12 hours have gone by, never for a classroom session.

   Run: bun --no-env-file src/tests/classcompletion.suite.ts
   (CLASSCOMPLETION_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.CLASSCOMPLETION_DATABASE_URL ?? 'mongodb://localhost:27017/lms_classcompletion'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.SMTP_BACKUP_HOST = ''
process.env.SMTP_BACKUP_USER = ''
process.env.SMTP_BACKUP_PASS = ''
process.env.EMAIL_FROM   = ''
process.env.DOTENV_CONFIG_PATH = '/nonexistent/classcompletion-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'classcompletion-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'classcompletion-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

const mongoose = (await import('mongoose')).default
const { UserModel, CourseModel, LiveClassModel, ClassBookingModel, OrganizationModel } = await import('@/models/schema.ts')
const { studentActivityForPortal } = await import('@/services/portalActivity.service.ts')
const { runMeetClassEnd } = await import('@/jobs/reminders.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_classcompletion') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.dropDatabase()

const now = new Date()
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
const ago = (ms: number) => new Date(now.getTime() - ms)
const iso = (d: Date) => d.toISOString()

// Raw rows: this is about what is reported, not about what makes a valid class or booking.
const org = (await OrganizationModel.collection.insertOne({ name: 'Delta Dubai', createdAt: ago(DAY), updatedAt: ago(DAY) })).insertedId
const course = (await CourseModel.collection.insertOne({ title: 'DSLP', status: 'published', createdAt: ago(DAY), updatedAt: ago(DAY) })).insertedId
const person = async (email: string, name: string, role = 'student') =>
  (await UserModel.collection.insertOne({ email, name, role, isActive: true, enrollmentStatus: 'approved', createdAt: ago(10 * DAY), updatedAt: ago(10 * DAY) })).insertedId
const mentor = await person('mentor@lms.test', 'Marco Mentor', 'instructor')
const [s1, s2, s3, s4, s5, s6] = await Promise.all([1, 2, 3, 4, 5, 6].map(i => person(`student${i}@lms.test`, `Student ${i}`)))

const klass = async (o: Record<string, unknown>) => (await LiveClassModel.collection.insertOne({
  courseId: course, instructorId: mentor, organizationId: org, title: 'Liquidity zones', type: 'internal', provider: 'livekit',
  status: 'scheduled', isOnline: true, durationMins: 120, createdAt: ago(DAY), updatedAt: ago(DAY), ...o,
})).insertedId
const seat = async (userId: unknown, liveClassId: unknown, o: Record<string, unknown>) => (await ClassBookingModel.collection.insertOne({
  userId, liveClassId, status: 'booked', bookedAt: ago(DAY), createdAt: ago(DAY), updatedAt: ago(DAY), ...o,
})).insertedId

// A — the LMS's own room, which said it ended 50 minutes ago.
const roomEnded = await klass({ scheduledStart: ago(3 * HOUR), status: 'ended', endedAt: ago(50 * MIN) })
// B — Google Meet, timetable end 30 minutes ago, nothing from Google yet.
const meet = await klass({ type: 'external', provider: 'mux', googleMeetCode: 'abc-defg-hij', meetSpace: { name: 'spaces/B', host: 'host@delta.test' }, scheduledStart: ago(150 * MIN) })
// C — a classroom session that finished 3 hours ago.
const classroom = await klass({ type: 'external', provider: 'mux', isOnline: false, durationMins: 60, scheduledStart: ago(4 * HOUR) })
// D — not started yet.
const later = await klass({ scheduledStart: new Date(now.getTime() + HOUR) })
// E — the LMS's room, no word from it: timetable end 40 minutes ago.
const roomSilent = await klass({ durationMins: 60, scheduledStart: ago(100 * MIN) })
// F — cancelled.
const cancelled = await klass({ status: 'cancelled', scheduledStart: ago(3 * HOUR), durationMins: 60 })

const seatA = await seat(s1, roomEnded, { status: 'attended', attendedAt: ago(170 * MIN), attendanceSource: 'livekit' })
const seatB = await seat(s2, meet, { attendedAt: ago(148 * MIN), attendanceSource: 'click' })
const seatC = await seat(s3, classroom, { status: 'attended', updatedAt: ago(5 * MIN) })     // marked by hand just now
await seat(s4, later, { attendedAt: ago(1 * MIN), attendanceSource: 'livekit' })
await seat(s5, roomEnded, { status: 'missed', updatedAt: ago(20 * MIN) })
await seat(s6, roomEnded, { status: 'cancelled', cancelledAt: ago(DAY), updatedAt: ago(DAY) })
const seatE = await seat(s1, roomSilent, { status: 'attended', updatedAt: ago(30 * MIN) })
await seat(s2, cancelled, { status: 'attended', updatedAt: ago(10 * MIN) })

const classEvents = async (since: Date) =>
  (await studentActivityForPortal({ since: iso(since), now, classes: true })).events.filter(e => e.type === 'class_attended')
const byKey = (events: Awaited<ReturnType<typeof classEvents>>) => new Map(events.map(e => [e.key, e]))

step('A. attended, and over — told once, at the right moment')
let events = await classEvents(ago(4 * HOUR))
let keyed = byKey(events)
check('three seats told: the room that ended, the classroom marked just now, the silent room past its timetable',
  events.length === 3 && keyed.has(`class-attended:${seatA}`) && keyed.has(`class-attended:${seatC}`) && keyed.has(`class-attended:${seatE}`),
  events.map(e => e.key).join(', '))
const a = keyed.get(`class-attended:${seatA}`)
check('the room: over when it said so, joined the room, told at that end',
  a?.class?.endSource === 'lms_room' && a.class.heldIn === 'lms_room' && a.class.attendance === 'joined_room'
    && a.class.endedAt === iso(ago(50 * MIN)) && a.at === iso(ago(50 * MIN)), JSON.stringify(a))
check('…with the course, the mentor, the academy and the student',
  a?.class?.course === 'DSLP' && a.class.mentor === 'Marco Mentor' && a.class.academy === 'Delta Dubai' && a.class.title === 'Liquidity zones'
    && a.student.email === 'student1@lms.test' && a.student.name === 'Student 1', JSON.stringify(a))
const c = keyed.get(`class-attended:${seatC}`)
check('the classroom: over at its timetable end, marked by hand — told when it was marked',
  c?.class?.endSource === 'timetable' && c.class.heldIn === 'classroom' && c.class.attendance === 'marked'
    && c.class.endedAt === iso(ago(3 * HOUR)) && c.at === iso(ago(5 * MIN)) && c.class.attendedAt === '', JSON.stringify(c))
const e = keyed.get(`class-attended:${seatE}`)
check('the silent room: its timetable end, told 15 minutes after it',
  e?.class?.endSource === 'timetable' && e.class.heldIn === 'lms_room' && e.class.endedAt === iso(ago(40 * MIN)) && e.at === iso(ago(25 * MIN)), JSON.stringify(e))
check('the same keys however often it is asked', (await classEvents(ago(4 * HOUR))).map(x => x.key).sort().join() === events.map(x => x.key).sort().join())
check('only for a caller that asks for classes — the portal of before would take them for something else',
  (await studentActivityForPortal({ since: iso(ago(4 * HOUR)), now })).events.every(x => x.type !== 'class_attended'))

step('B. never told — not over, missed, cancelled, or outside the window')
check('the Meet class waits for Google (an hour past its timetable end)', !keyed.has(`class-attended:${seatB}`))
check('nothing for the class not started, the missed seat, the cancelled seat or the cancelled class',
  events.every(x => ![s4, s5, s6].map(String).includes(x.student.lmsUserId)) && events.filter(x => x.student.lmsUserId === String(s2)).length === 0)
events = await classEvents(ago(10 * MIN))
check('asked from 10 minutes ago: only the classroom marked 5 minutes ago', events.length === 1 && events[0]!.key === `class-attended:${seatC}`, events.map(x => x.key).join(', '))

step('C. a Meet class ends when Google says its meeting ended')
const asked: string[] = []
const google = (answers: Record<string, { startTime: Date; endTime?: Date }[] | undefined>) => async (cls: { googleMeetCode?: string | null }) => {
  asked.push(String(cls.googleMeetCode))
  return answers[String(cls.googleMeetCode)]
}
const running  = await klass({ type: 'external', provider: 'mux', googleMeetCode: 'run-ning-now', durationMins: 60, scheduledStart: ago(80 * MIN) })
const reused   = await klass({ type: 'external', provider: 'mux', googleMeetCode: 'old-meet-ing', durationMins: 60, scheduledStart: ago(90 * MIN) })
const unknown  = await klass({ type: 'external', provider: 'mux', googleMeetCode: 'not-answ-red', durationMins: 60, scheduledStart: ago(90 * MIN) })
const tooOld   = await klass({ type: 'external', provider: 'mux', googleMeetCode: 'too-long-ago', durationMins: 60, scheduledStart: ago(14 * HOUR) })
const inPerson = await klass({ type: 'external', provider: 'mux', isOnline: false, googleMeetCode: 'in-pers-onnn', durationMins: 60, scheduledStart: ago(90 * MIN) })
await runMeetClassEnd(google({
  'abc-defg-hij': [{ startTime: ago(2 * DAY), endTime: ago(2 * DAY - HOUR) }, { startTime: ago(152 * MIN), endTime: ago(25 * MIN) }],
  'run-ning-now': [{ startTime: ago(79 * MIN) }],
  'old-meet-ing': [{ startTime: ago(3 * DAY), endTime: ago(3 * DAY - HOUR) }],
  'not-answ-red': undefined,
}))
const after = new Map((await LiveClassModel.find({ _id: { $in: [meet, running, reused, unknown, tooOld, inPerson] } }).lean()).map(x => [String(x._id), x]))
const m = after.get(String(meet))
check('the Meet class: ended when its own conference ended, started when it began, said by Google Meet',
  m?.status === 'ended' && m.endedAt?.toISOString() === iso(ago(25 * MIN)) && m.startedAt?.toISOString() === iso(ago(152 * MIN)) && m.endSource === 'meet',
  JSON.stringify({ status: m?.status, endedAt: m?.endedAt, endSource: m?.endSource }))
check('still going: left as it is', after.get(String(running))?.status === 'scheduled' && !after.get(String(running))?.endedAt)
check('only a conference long before the class: left as it is', after.get(String(reused))?.status === 'scheduled')
check('Google not answering: left as it is, asked again next time', after.get(String(unknown))?.status === 'scheduled')
check('12 hours past its end, and the classroom session: not even asked', !asked.includes('too-long-ago') && !asked.includes('in-pers-onnn'), asked.join(', '))
events = await classEvents(ago(4 * HOUR))
const b = byKey(events).get(`class-attended:${seatB}`)
check('…and now the Meet seat is told: Google Meet\'s end, joined through the link',
  b?.class?.endSource === 'google_meet' && b.class.heldIn === 'google_meet' && b.class.attendance === 'joined_link'
    && b.class.endedAt === iso(ago(25 * MIN)) && b.at === iso(ago(25 * MIN)) && b.class.attendedAt === iso(ago(148 * MIN)), JSON.stringify(b))

await mongoose.connection.dropDatabase()
await mongoose.disconnect()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

export {}
