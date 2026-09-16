/* ─────────────────────────────────────────────────────────────
   Regression hunt over the Join-button FIX round.

   A review round applied fixes on top of the Meet join feature. This suite
   does not re-prove the feature (joinclass.suite does that); it tries to
   break the FIXES — each one is asked "what did you change for everybody
   else?" and the answer is pinned so the next round cannot move it quietly.

     A  the LiveKit gate. assertStudentMayJoin grew a `window` parameter and
        an enrolment requirement. Everything else about the room door must be
        exactly what it was: a 'booked' seat only (an attended seat was
        refused before and still is), 15 min before → end + 15 min, TOO_EARLY
        with a Retry-After, CLASS_OVER after.
     B  the enrolment requirement, by status, across the THREE doors a
        student can reach — the schedule row (isBooked + window), the watch
        page (isBooked), and the click. 'active' and 'completed' pass all
        three. 'dropped' is refused at the click — and the other two doors
        are asked whether they agree, because a button the click refuses is
        the failure mode the fix round was meant to remove.
     C  the at-time notification link. It is now /live-classes/:id/watch
        instead of the raw Meet URL — but a path is only better than a URL if
        it actually lands: the id is the real class id, the path is
        app-relative so the topbar's <Link> branch takes it, the page it
        opens says isBooked=true, the button there releases the link, and a
        cancelled seat later makes the same page honest (isBooked=false).
     D  the upcoming feed rows carry the fields the hero's getJoinPhase reads
        (isOnline in particular — an in-person class must read false, not
        undefined, or the hero draws a Meet button for a classroom).
     E  the My Classes → Attended tab flow: /bookings/me?status=attended
        lists the seat with its class populated, the matching /live-classes
        row says isBooked=true with the window, and the click succeeds. The
        server's cancel rule (booked only) is pinned because the page now
        treats attended as booked.
     F  the two refusals the client now surfaces verbatim carry what the
        toast needs: JOIN_WINDOW_CLOSED names the grace in minutes;
        TOO_EARLY's body retryAfter is what drives the refresh.

   Checks that document a KNOWN DEFECT of the fix round use known(): they
   never fail the suite, they print KNOWN-DEFECT while the defect stands and
   RESOLVED once somebody fixes it (at which point promote them to check()).

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_joinregress_suite), dropped on exit.

   Run: bun run test:joinregress
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_joinregress_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_LOG_DIR = '.logs/emails-joinregress'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''
/* No CLT_BASE_URL and no signing key on purpose: section A calls the GATE
   (assertStudentMayJoin) directly and never mints a ticket, so the room
   integration is not needed and must not be reached. */

export {}

let pass = 0, fail = 0, known = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
/* An invariant the fix round SHOULD hold but does not yet. Never fails the
   suite; flips its label when fixed so the pin is visibly stale. */
function knownDefect(label: string, ok: boolean, detail = '') {
  known++
  if (ok) lines.push(`  RESOLVED      ${label}  — promote this knownDefect() to check()`)
  else    lines.push(`  KNOWN-DEFECT  ${label}${detail ? '  — ' + detail : ''}`)
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, SectionModel, LiveClassModel,
  ClassBookingModel, EnrollmentModel, NotificationModel, EmailOutboxModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { assertStudentMayJoin, JoinError } = await import('@/services/liveClassJoin.service.ts')
const { runAtTimeReminders } = await import('@/jobs/reminders.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_joinregress_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, jar?: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar?.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let parsed: any = text; try { parsed = JSON.parse(text) } catch {}
  return { status: res.status, body: parsed, retryAfter: res.headers.get('retry-after') }
}

const PW   = 'Regress1234'
const MIN  = 60_000
const MEET = 'https://meet.google.com/regress-abc-def'
const code = (r: any) => String(r.body?.error?.code ?? '')

try {

const org  = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const hash = await hashPassword(PW)

let useq = 0
const student = (tag: string, extra: Record<string, unknown> = {}) =>
  UserModel.create({
    name: tag, email: `${tag}${useq++}@rg.local`, passwordHash: hash, role: 'student',
    isActive: true, isVerified: true, organizationId: org._id, enrollmentStatus: 'approved', ...extra,
  })
const teacher = await UserModel.create({
  name: 'teach', email: 'teach@rg.local', passwordHash: hash, role: 'instructor',
  isActive: true, isVerified: true, organizationId: org._id,
})
const course  = await CourseModel.create({
  title: 'Forex', slug: 'forex-rg', description: 'd', instructorId: teacher._id,
  price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
})
const module1 = await SectionModel.create({ courseId: course._id, title: 'Module 1', order: 1 })

const enrol = (u: any, status = 'active', blocked: unknown[] = []) =>
  EnrollmentModel.create({ userId: u._id, courseId: course._id, status, blockedLessons: blocked })
const seat = (u: any, lc: any, status = 'booked') =>
  ClassBookingModel.create({ userId: u._id, liveClassId: lc._id, status, bookedAt: new Date() })

let cseq = 0
const meetClass = (startsInMs: number, extra: Record<string, unknown> = {}) =>
  LiveClassModel.create({
    title: `Meet ${cseq++}`, courseId: course._id, instructorId: teacher._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() + startsInMs), durationMins: 60,
    type: 'external', isOnline: true, status: 'scheduled', language: 'English',
    sessionCapacity: 30, bookedCount: 0, meetingUrl: MEET, ...extra,
  })
const roomClass = (startsInMs: number, extra: Record<string, unknown> = {}) =>
  LiveClassModel.create({
    title: `Room ${cseq++}`, courseId: course._id, instructorId: teacher._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() + startsInMs), durationMins: 60,
    type: 'internal', provider: 'livekit', isOnline: true, status: 'scheduled', language: 'English',
    sessionCapacity: 30, bookedCount: 0, ...extra,
  })

async function login(u: any): Promise<Jar> {
  const jar: Jar = new Map()
  const r = await call('POST', '/auth/login', jar, { email: u.email, password: PW })
  if (r.status !== 200) throw new Error(`login ${u.email}: ${r.status} ${code(r)}`)
  return jar
}
const join  = (jar: Jar, lc: any) => call('POST', `/live-classes/${lc._id}/join`, jar)
const watch = (jar: Jar, lc: any) => call('GET',  `/live-classes/${lc._id}/watch`, jar)
const rowOf = async (jar: Jar, lc: any) =>
  (await call('GET', '/live-classes', jar)).body?.data?.find((x: any) => x.id === String(lc._id))
const upRowOf = async (jar: Jar, lc: any) =>
  (await call('GET', '/live-classes/upcoming?limit=100', jar)).body?.data?.find((x: any) => x.id === String(lc._id))

/* The LiveKit gate, called the way mintStudentTicket calls it — no window
   argument, so the DEFAULT (LIVEKIT_WINDOW) is what is under test. */
const ctxOf = (u: any) => ({
  userId: String(u._id), name: u.name, email: u.email, role: 'student',
  organizationId: String(org._id), enrollmentStatus: 'approved', isActive: true,
})
async function roomGate(live: any, u: any): Promise<{ code: string; status?: number; retryAfter?: number }> {
  try { await assertStudentMayJoin(live, ctxOf(u)); return { code: 'OK' } }
  catch (e) {
    if (e instanceof JoinError) return { code: e.code, status: e.status, retryAfter: e.retryAfter }
    return { code: `THREW ${(e as Error).message}` }
  }
}

/* ═══════════ A — the LiveKit gate, before and after ═══════════ */
section('A. The room gate accepts exactly what it did, plus the enrolment requirement')
{
  const lk = await roomClass(-5 * MIN)                       // started five minutes ago

  const a1 = await student('lkBooked');   await enrol(a1); await seat(a1, lk)
  check('A1 booked + enrolled, inside the window → passes', (await roomGate(lk, a1)).code === 'OK',
    (await roomGate(lk, a1)).code)

  /* Unchanged from before the fix: the room door counts only a 'booked'
     seat. The MEET door counts 'attended' too; that difference predates
     this round (the old code queried status: 'booked') and is pinned here
     so a later "make them agree" is a decision, not drift. */
  const a2 = await student('lkAttended'); await enrol(a2); await seat(a2, lk, 'attended')
  check('A2 an ATTENDED seat is refused NOT_BOOKED at the room door — as it was before the fix',
    (await roomGate(lk, a2)).code === 'NOT_BOOKED', (await roomGate(lk, a2)).code)

  const a3 = await student('lkNoEnrol'); await seat(a3, lk)
  const r3 = await roomGate(lk, a3)
  check('A3 NEW: a seat with no enrolment → NOT_ENROLLED (used to pass)', r3.code === 'NOT_ENROLLED' && r3.status === 403,
    `${r3.code} ${r3.status}`)

  const a4 = await student('lkDropped'); await enrol(a4, 'dropped'); await seat(a4, lk)
  check('A4 NEW: a dropped enrolment → NOT_ENROLLED', (await roomGate(lk, a4)).code === 'NOT_ENROLLED',
    (await roomGate(lk, a4)).code)

  const a5 = await student('lkCompleted'); await enrol(a5, 'completed'); await seat(a5, lk)
  check('A5 a completed enrolment still passes (only dropped loses access)', (await roomGate(lk, a5)).code === 'OK',
    (await roomGate(lk, a5)).code)

  const a6 = await student('lkNothing')
  check('A6 no seat AND no enrolment → NOT_BOOKED first (seat is checked before enrolment, same order as Meet)',
    (await roomGate(lk, a6)).code === 'NOT_BOOKED', (await roomGate(lk, a6)).code)

  /* The clock: 15 before → end + 15, untouched. */
  const early14 = await roomClass(14 * MIN);  await seat(a1, early14)
  check('A7 fourteen minutes before start is OPEN for the room (15-min lead unchanged)',
    (await roomGate(early14, a1)).code === 'OK', (await roomGate(early14, a1)).code)

  const early16 = await roomClass(16 * MIN);  await seat(a1, early16)
  const r8 = await roomGate(early16, a1)
  check('A8 sixteen minutes before → TOO_EARLY 425', r8.code === 'TOO_EARLY' && r8.status === 425, `${r8.code} ${r8.status}`)
  check('A8b with a Retry-After of roughly one minute', (r8.retryAfter ?? 0) > 30 && (r8.retryAfter ?? 0) <= 61, String(r8.retryAfter))

  const late14 = await roomClass(-(60 + 14) * MIN); await seat(a1, late14)
  check('A9 fourteen minutes after the END is still open (15-min tail unchanged)',
    (await roomGate(late14, a1)).code === 'OK', (await roomGate(late14, a1)).code)

  const late16 = await roomClass(-(60 + 16) * MIN); await seat(a1, late16)
  const r10 = await roomGate(late16, a1)
  check('A10 sixteen minutes after the end → CLASS_OVER 409 (not JOIN_WINDOW_CLOSED — that code is the Meet door\'s)',
    r10.code === 'CLASS_OVER' && r10.status === 409, `${r10.code} ${r10.status}`)

  const gated = await roomClass(-1 * MIN, { sectionId: module1._id })
  const a11 = await student('lkBlocked'); await enrol(a11, 'active', [module1._id]); await seat(a11, gated)
  check('A11 a blocked module is still MODULE_BLOCKED (after the enrolment read moved)',
    (await roomGate(gated, a11)).code === 'MODULE_BLOCKED', (await roomGate(gated, a11)).code)

  /* Enrolment is read BEFORE the clock, so a permanent no is never reported
     as "not yet": a dropped student on a class that is hours away must hear
     NOT_ENROLLED, not TOO_EARLY. */
  const far = await roomClass(3 * 60 * MIN); await seat(a4, far)
  check('A12 a dropped enrolment on a class hours away → NOT_ENROLLED, not TOO_EARLY',
    (await roomGate(far, a4)).code === 'NOT_ENROLLED', (await roomGate(far, a4)).code)
}

/* ═══════════ B — three doors, per enrolment status ═══════════ */
section('B. Schedule row, watch page and click agree — for every enrolment status')
{
  const m = await meetClass(-1 * MIN)

  const done = await student('meetCompleted'); await enrol(done, 'completed'); await seat(done, m)
  const dj = await login(done)
  const dRow = await rowOf(dj, m)
  const dW   = await watch(dj, m)
  const dJ   = await join(dj, m)
  check('B1 completed: the row says isBooked + isEnrolled', dRow?.isBooked === true && dRow?.isEnrolled === true,
    JSON.stringify({ isBooked: dRow?.isBooked, isEnrolled: dRow?.isEnrolled }))
  check('B2 completed: the watch page says isBooked', dW.status === 200 && dW.body?.data?.isBooked === true,
    `${dW.status} ${String(dW.body?.data?.isBooked)}`)
  check('B3 completed: the click releases the link', dJ.status === 200 && dJ.body?.data?.url === MEET, `${dJ.status} ${code(dJ)}`)
  check('B3b and the click\'s closesAt is the row\'s joinClosesAt to the millisecond',
    dJ.body?.data?.closesAt === dRow?.joinClosesAt, `${dJ.body?.data?.closesAt} vs ${dRow?.joinClosesAt}`)

  const drop = await student('meetDropped'); await enrol(drop, 'dropped'); await seat(drop, m)
  const pj = await login(drop)
  const pRow = await rowOf(pj, m)
  const pW   = await watch(pj, m)
  const pJ   = await join(pj, m)
  check('B4 dropped: the click refuses NOT_ENROLLED (the fix)', pJ.status === 403 && code(pJ) === 'NOT_ENROLLED', `${pJ.status} ${code(pJ)}`)
  check('B5 dropped: the row already says isEnrolled=false', pRow?.isEnrolled === false, String(pRow?.isEnrolled))
  check('B5b and carries no Meet URL', !JSON.stringify(pRow ?? {}).includes('meet.google.com'))

  /* The two doors the BUTTON is drawn from. JoinMeetButton/getJoinPhase read
     isBooked + the window only — never isEnrolled — so a row that says
     isBooked=true with a window draws a button that B4 refuses. The fix's
     own comment says "the watch page already refuses the same student with
     NOT_ENROLLED, and the two doors must not disagree"; for a DROPPED
     enrolment the watch page does not refuse (findByUserCourse has no status
     filter), so they do disagree. */
  /* Was a knownDefect() pin; the fix landed (dropped enrolment is refused at
     all three doors), so it is a hard check now — and a stricter one than
     the pin: the exact refusal, not merely "not isBooked". */
  check('B6 dropped: the watch page refuses NOT_ENROLLED, exactly as the click does',
    pW.status === 403 && code(pW) === 'NOT_ENROLLED',
    `watch ${pW.status} isBooked=${String(pW.body?.data?.isBooked)} while join → ${code(pJ)}`)
  check('B7 dropped: the schedule row says isBooked=false, so no button is drawn for a seat the click refuses',
    pRow?.isBooked === false,
    `row isBooked=${String(pRow?.isBooked)} joinOpensAt=${String(pRow?.joinOpensAt)} while join → ${code(pJ)}`)
  const pUp = await upRowOf(pj, m)
  check('B7b dropped: nor does the upcoming feed', !pUp || pUp.isBooked === false,
    `feed isBooked=${String(pUp?.isBooked)} joinOpensAt=${String(pUp?.joinOpensAt)}`)

  /* A DELETED enrolment (what an admin actually leaves behind) — here the
     watch door and the click DO agree. */
  const gone = await student('meetGone'); await enrol(gone); await seat(gone, m)
  const gj = await login(gone)
  await EnrollmentModel.deleteOne({ userId: gone._id, courseId: course._id })
  const gW = await watch(gj, m)
  const gJ = await join(gj, m)
  check('B8 deleted enrolment: the watch page refuses NOT_ENROLLED', gW.status === 403 && code(gW) === 'NOT_ENROLLED', `${gW.status} ${code(gW)}`)
  check('B9 deleted enrolment: the click refuses NOT_ENROLLED', gJ.status === 403 && code(gJ) === 'NOT_ENROLLED', `${gJ.status} ${code(gJ)}`)
  const gRow = await rowOf(gj, m)
  check('B10 deleted enrolment: the schedule row says isBooked=false as well',
    gRow?.isBooked === false,
    `row isBooked=${String(gRow?.isBooked)} isEnrolled=${String(gRow?.isEnrolled)} joinOpensAt=${String(gRow?.joinOpensAt)}`)
}

/* ═══════════ C — the at-time notification link ═══════════ */
section('C. The class-started notification lands on a page that works')
{
  const sn = await student('notified'); await enrol(sn)
  const lc = await meetClass(-1 * MIN)
  const bk = await seat(sn, lc)
  await runAtTimeReminders()

  const note = await NotificationModel.findOne({ userId: sn._id, kind: 'class-reminder' }).sort({ createdAt: -1 }).lean() as any
  check('C1 an at-time notification exists', !!note, String(note?.title))
  check('C2 its link is /live-classes/<THIS class id>/watch — the real id, not a regex-shaped placeholder',
    String(note?.link) === `/live-classes/${String(lc._id)}/watch`, String(note?.link))
  check('C3 the link is app-relative, so ClientTopbar takes the <Link> branch rather than target=_blank',
    !/^https?:\/\//i.test(String(note?.link)), String(note?.link))
  check('C4 neither title nor body smuggles the URL',
    !String(note?.title ?? '').includes('meet.google.com') && !String(note?.body ?? '').includes('meet.google.com'))

  const jar = await login(sn)
  const w = await call('GET', String(note?.link).replace(/^\/live-classes/, '/live-classes'), jar)
  check('C5 following the link as the student answers 200', w.status === 200, String(w.status))
  check('C6 and the page says isBooked=true, type external, online — the button is drawn',
    w.body?.data?.isBooked === true && w.body?.data?.type === 'external' && w.body?.data?.isOnline === true,
    JSON.stringify(w.body?.data))
  check('C7 and carries no URL itself', !JSON.stringify(w.body).includes('meet.google.com'))
  const j = await join(jar, lc)
  check('C8 the button on that page releases the link', j.status === 200 && j.body?.data?.url === MEET, `${j.status} ${code(j)}`)

  /* The email still carries the link — that is the decision on record. */
  let mail: any = null
  for (let i = 0; i < 40 && !mail; i++) {
    const rows = await EmailOutboxModel.find({ to: sn.email }).sort({ createdAt: -1 }).lean() as any[]
    mail = rows.find(r => /start/i.test(String(r.subject ?? ''))) ?? null
    if (!mail) await new Promise(r => setTimeout(r, 100))
  }
  check('C9 the at-time EMAIL still carries the Meet URL', !!mail && String(mail?.html ?? mail?.text ?? '').includes(MEET),
    String(mail?.subject))

  /* "honest about it once it is not": the row outlives the seat. */
  await ClassBookingModel.updateOne({ _id: bk._id }, { $set: { status: 'cancelled' } })
  const w2 = await watch(jar, lc)
  const j2 = await join(jar, lc)
  check('C10 after the seat is cancelled the same link shows isBooked=false', w2.status === 200 && w2.body?.data?.isBooked === false,
    `${w2.status} ${String(w2.body?.data?.isBooked)}`)
  check('C11 and the click there is NOT_BOOKED', j2.status === 403 && code(j2) === 'NOT_BOOKED', `${j2.status} ${code(j2)}`)
  const still = await NotificationModel.findById(note?._id).lean() as any
  check('C12 the notification row itself is unchanged (no URL appeared in it)', String(still?.link) === String(note?.link)
    && !JSON.stringify(still).includes('meet.google.com'))
}

/* ═══════════ D — the upcoming feed rows the hero reads ═══════════ */
section('D. Upcoming rows carry what getJoinPhase reads')
{
  const sd = await student('feedReader'); await enrol(sd)
  const online  = await meetClass(30 * MIN)
  const inRoom  = await meetClass(31 * MIN, { isOnline: false, meetingUrl: undefined, location: 'Campus A', room: 'R1' })
  const internal = await roomClass(32 * MIN)
  await seat(sd, online); await seat(sd, inRoom); await seat(sd, internal)
  const jar = await login(sd)

  const on = await upRowOf(jar, online)
  check('D1 online Meet row: isOnline === true (boolean, not absent)', on?.isOnline === true, String(on?.isOnline))
  check('D2 online Meet row: isBooked true, type external, both instants parse',
    on?.isBooked === true && on?.type === 'external'
      && !Number.isNaN(new Date(on?.joinOpensAt).getTime()) && !Number.isNaN(new Date(on?.joinClosesAt).getTime()),
    JSON.stringify({ isBooked: on?.isBooked, type: on?.type, o: on?.joinOpensAt, c: on?.joinClosesAt }))
  check('D3 online Meet row: closesAt − opensAt is the 20-minute default',
    new Date(on?.joinClosesAt).getTime() - new Date(on?.joinOpensAt).getTime() === 20 * MIN)
  check('D4 online Meet row: status is a string the phase helper can compare', typeof on?.status === 'string', String(on?.status))

  const off = await upRowOf(jar, inRoom)
  check('D5 in-person row: isOnline === false — so the hero falls back to Details, not a Meet button',
    off?.isOnline === false, String(off?.isOnline))
  check('D6 in-person row: still says isBooked (the seat is real, the button is not)', off?.isBooked === true, String(off?.isBooked))
  check('D7 in-person row: location and room ride along', off?.location === 'Campus A' && off?.room === 'R1',
    `${off?.location} ${off?.room}`)

  const inn = await upRowOf(jar, internal)
  check('D8 internal row: type internal, no meetingUrl key at all', inn?.type === 'internal' && !('meetingUrl' in (inn ?? {})),
    Object.keys(inn ?? {}).join(','))
}

/* ═══════════ E — the Attended tab ═══════════ */
section('E. My Classes → Attended: the seat is listed with its class, and the button works')
{
  const sa = await student('attendee'); await enrol(sa)
  const live = await meetClass(-5 * MIN)
  const bk = await seat(sa, live, 'attended')
  const jar = await login(sa)

  const att = await call('GET', '/bookings/me?status=attended&per_page=50', jar)
  const attRow = att.body?.data?.find((x: any) => String(x.liveClassId?.id ?? x.liveClassId?._id) === String(live._id))
  check('E1 ?status=attended lists the seat', att.status === 200 && !!attRow, `${att.status} rows=${att.body?.data?.length}`)
  check('E2 with the class populated: id, type, isOnline, status, scheduledStart, durationMins',
    !!attRow?.liveClassId && attRow.liveClassId.type === 'external' && attRow.liveClassId.isOnline === true
      && typeof attRow.liveClassId.status === 'string' && !!attRow.liveClassId.scheduledStart && typeof attRow.liveClassId.durationMins === 'number',
    JSON.stringify(attRow?.liveClassId))
  check('E2b and no Meet URL / window on the booking row (the page reads those from /live-classes)',
    !JSON.stringify(attRow ?? {}).includes('meet.google.com') && !('joinOpensAt' in (attRow?.liveClassId ?? {})))

  const booked = await call('GET', '/bookings/me?status=booked&per_page=50', jar)
  const inBooked = booked.body?.data?.some((x: any) => String(x.liveClassId?.id ?? x.liveClassId?._id) === String(live._id))
  check('E3 the same seat is NOT under ?status=booked — so the Upcoming tab (which asks for booked) will not show it',
    booked.status === 200 && !inBooked, `${booked.status} present=${inBooked}`)

  const row = await rowOf(jar, live)
  check('E4 the matching /live-classes row says isBooked=true for the attended seat', row?.isBooked === true, String(row?.isBooked))
  check('E5 with the window, so the button renders', !!row?.joinOpensAt && !!row?.joinClosesAt, `${row?.joinOpensAt}..${row?.joinClosesAt}`)
  const j = await join(jar, live)
  check('E6 and the click succeeds for the attended seat', j.status === 200 && j.body?.data?.url === MEET, `${j.status} ${code(j)}`)

  /* The page now treats attended as booked and shows Cancel on any not-yet-
     started row; the server has one rule for cancelling, and it is 'booked'. */
  const future = await meetClass(2 * 60 * MIN)
  const fbk = await seat(sa, future, 'attended')
  const del = await call('DELETE', `/bookings/${fbk._id}`, jar)
  check('E7 DELETE on an attended seat → 400 CANNOT_CANCEL (the server rule the page\'s Cancel button must respect)',
    del.status === 400 && code(del) === 'CANNOT_CANCEL', `${del.status} ${code(del)}`)
  const delOk = await call('DELETE', `/bookings/${bk._id}`, jar)
  check('E7b and the live attended seat is refused the same way', delOk.status === 400 && code(delOk) === 'CANNOT_CANCEL',
    `${delOk.status} ${code(delOk)}`)
}

/* ═══════════ F — what the toasts read ═══════════ */
section('F. The refusals the client surfaces verbatim carry what the toast needs')
{
  const sf = await student('toasted'); await enrol(sf)
  const jar = await login(sf)

  const closed = await meetClass(-25 * MIN); await seat(sf, closed)
  const c = await join(jar, closed)
  check('F1 JOIN_WINDOW_CLOSED 409', c.status === 409 && code(c) === 'JOIN_WINDOW_CLOSED', `${c.status} ${code(c)}`)
  check('F2 its message names the grace in minutes (the client toasts it as-is)',
    /20 minutes/.test(String(c.body?.error?.message)), String(c.body?.error?.message))
  check('F3 and does not carry a retryAfter (the client must not count down to a window that is over)',
    c.body?.error?.retryAfter === undefined && c.retryAfter === null, `${c.body?.error?.retryAfter} ${c.retryAfter}`)

  const far = await meetClass(2 * 60 * MIN); await seat(sf, far)
  const e = await join(jar, far)
  check('F4 TOO_EARLY body.retryAfter > 60 for a class two hours out (the client refreshes rows on that)',
    e.status === 425 && Number(e.body?.error?.retryAfter) > 60, `${e.status} ${e.body?.error?.retryAfter}`)
  const near = await meetClass(30_000); await seat(sf, near)
  const n = await join(jar, near)
  check('F5 TOO_EARLY body.retryAfter ≤ 60 for a class half a minute out (formats as "30s", no refresh)',
    n.status === 425 && Number(n.body?.error?.retryAfter) >= 1 && Number(n.body?.error?.retryAfter) <= 60,
    `${n.status} ${n.body?.error?.retryAfter}`)
  check('F6 a NOT_BOOKED refusal has a message too (the generic toast branch reads it)',
    typeof (await join(await login(await student('unbooked')), near)).body?.error?.message === 'string')
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\njoinclass.regression.suite — ${pass} passed, ${fail} failed, ${known} known-defect pins`)
process.exit(fail === 0 ? 0 : 1)
