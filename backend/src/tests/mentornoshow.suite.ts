/* ─────────────────────────────────────────────────────────────
   Mentor no-show detection.

   Two escalating stages, both keyed off LiveClassModel.instructorJoinedAt:
     stage 1 (start time)      — nudge the mentor alone if not joined
     stage 2 (start + 5 min)   — still not joined: escalate to super_admins,
                                  the academy's admin(s), the class's course
                                  programme's sub_admin(s), and the mentor
                                  again

   "Joined" has two sources, both covered here:
     - internal/LiveKit: the CLT participant.joined webhook
       (cltWebhook.service.ts) — a real presence signal
     - external/Zoom-Meet: POST /live-classes/:id/mark-joined, fired when the
       assigned instructor clicks Join in the admin panel — a proxy for
       intent, the only signal that exists for a provider the LMS never
       hears from again

   Questions this suite answers:
     A  stage 1 sends when the mentor hasn't joined by start time, and flags
        the class so it isn't sent twice
     B  stage 1 is skipped entirely if the mentor already joined
     C  stage 2 escalates to admin + matching-programme sub_admin + every
        super_admin + the mentor, when still not joined 5 min after start
     D  stage 2 is skipped if the mentor joined between stage 1 and stage 2
        (a late join, not a no-show)
     E  a sub_admin in a DIFFERENT programme is never notified
     F  the CLT webhook's participant.joined event, for the INSTRUCTOR,
        sets instructorJoinedAt (not a ClassBooking row) and is idempotent
     G  POST /:id/mark-joined only counts when the caller IS the assigned
        instructor; anyone else's click is a harmless no-op
     H  GET /admin/live-classes/no-shows is org-scoped for an ordinary admin
        and unscoped for a super_admin

   Boots the REAL Express app (for F/G/H) against an ISOLATED throwaway
   database (lms_mentornoshow_suite), dropped on exit. NODE_ENV=test forces
   the console mail sender; EMAIL_OUTBOX=on records every message so
   assertions can read a real send back out of the outbox.

   Run: bun run test:mentornoshow
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_mentornoshow_suite'
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
process.env.CLT_S2S_SECRET       = 'test-s2s-secret'

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
const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, LiveClassModel, EmailOutboxModel, NotificationModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { runMentorJoinReminder, runMentorNoShowEscalation } = await import('@/jobs/reminders.job.ts')
const { handleCltEvent } = await import('@/services/cltWebhook.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_mentornoshow_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (opts.jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}
async function signInAdmin(email: string, password: string): Promise<Jar> {
  const jar: Jar = new Map()
  const res = await call('POST', '/admin/auth/login', { jar, body: { email, password } })
  if (res.status !== 200) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(res.body)}`)
  return jar
}

/* Mail is written to the outbox before any send is attempted, but the job
   fires it without awaiting the write, so poll rather than sleep a guess —
   same helper as remindermails.suite.ts. */
async function mailFor(to: string, subject: RegExp, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const rows = await EmailOutboxModel.find({ to }).sort({ createdAt: -1 }).lean() as any[]
    const hit = rows.find(r => subject.test(String(r.subject ?? '')))
    if (hit) return hit
    await new Promise(r => setTimeout(r, 100))
  }
  return null
}

const PW = 'MentorNoShow1'

try {
  const hash = await hashPassword(PW)

  const org = await OrganizationModel.create({
    name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const otherOrg = await OrganizationModel.create({
    name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay',
  })

  const superAdmin = await UserModel.create({
    name: 'Root', email: 'root@mns.local', passwordHash: hash, role: 'super_admin', isActive: true,
  })
  const orgAdmin = await UserModel.create({
    name: 'Org Admin', email: 'orgadmin@mns.local', passwordHash: hash, role: 'admin',
    isActive: true, organizationId: org._id,
  })
  const forexSubAdmin = await UserModel.create({
    name: 'Forex Sub', email: 'forexsub@mns.local', passwordHash: hash, role: 'sub_admin',
    isActive: true, organizationId: org._id, program: 'forex',
  })
  const juraSubAdmin = await UserModel.create({
    name: 'Jura Sub', email: 'jurasub@mns.local', passwordHash: hash, role: 'sub_admin',
    isActive: true, organizationId: org._id, program: 'jura',
  })
  const otherOrgAdmin = await UserModel.create({
    name: 'Other Org Admin', email: 'otherorgadmin@mns.local', passwordHash: hash, role: 'admin',
    isActive: true, organizationId: otherOrg._id,
  })

  let seq = 0
  async function mentor() {
    const n = seq++
    return UserModel.create({
      name: `Mentor ${n}`, email: `mentor${n}@mns.local`, passwordHash: hash, role: 'instructor',
      isActive: true, organizationId: org._id,
    })
  }
  async function course(programme: string) {
    const n = seq++
    const m = await mentor()
    return { c: await CourseModel.create({
      title: `Course ${n}`, slug: `course-${n}`, description: 'd', instructorId: m._id,
      price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
      program: programme,
    }), m }
  }
  /** A live class `minutesFromNow` from now, taught by its own fresh mentor. */
  async function classFor(programme: string, minutesFromNow: number, opts: { type?: 'internal' | 'external'; meetingUrl?: string } = {}) {
    const { c, m } = await course(programme)
    const lc = await LiveClassModel.create({
      title: `Session for ${m.name}`, courseId: c._id, instructorId: m._id, organizationId: org._id,
      scheduledStart: new Date(Date.now() + minutesFromNow * 60 * 1000),
      durationMins: 60, type: opts.type ?? 'external', isOnline: true, status: 'scheduled',
      language: 'English', sessionCapacity: 30, bookedCount: 0,
      ...(opts.type !== 'internal' ? { meetingUrl: opts.meetingUrl ?? 'https://meet.google.com/mns-test' } : {}),
    })
    return { lc, mentorUser: m }
  }

  /* ═════════════════ A — stage 1 sends, and flags the class ═════════════════ */
  section('A. Stage 1 nudges the mentor at start time')
  {
    /* '4x-trading', not 'forex' — Course.program uses the course-category
       vocabulary (categoryScope's), which SUB_ADMIN_PROGRAM_OF maps to the
       sub_admin vocabulary. Passing 'forex' here would silently create a
       course in a category no sub_admin is ever scoped to. */
    const { lc, mentorUser } = await classFor('4x-trading', -1)  // started 1 min ago — inside [now-8, now]
    await runMentorJoinReminder()

    const mail = await mailFor(mentorUser.email, /has started — join now/i)
    check('A1 the mentor receives the stage-1 email', !!mail, JSON.stringify(await EmailOutboxModel.find({ to: mentorUser.email }).lean()))
    check('A2 the join link is in the body', String(mail?.html ?? '').includes('meet.google.com'), String(mail?.html).slice(0, 160))

    const row = await LiveClassModel.findById(lc._id).lean() as any
    check('A3 mentorReminderSent is flagged', row?.mentorReminderSent === true, String(row?.mentorReminderSent))

    const notes = await NotificationModel.countDocuments({ userId: mentorUser._id })
    check('A4 an in-app notification is created too', notes > 0, String(notes))

    const before = await EmailOutboxModel.countDocuments({ to: mentorUser.email })
    await runMentorJoinReminder()
    await new Promise(r => setTimeout(r, 300))
    const after = await EmailOutboxModel.countDocuments({ to: mentorUser.email })
    check('A5 running it again does not send a second nudge', after === before, `${before} -> ${after}`)
  }

  /* ═════════════════ B — already joined ⇒ stage 1 never fires ═════════════════ */
  section('B. Stage 1 is skipped if the mentor already joined')
  {
    const { lc, mentorUser } = await classFor('forex', -1)
    await LiveClassModel.updateOne({ _id: lc._id }, { $set: { instructorJoinedAt: new Date() } })
    await runMentorJoinReminder()
    await new Promise(r => setTimeout(r, 300))

    const mail = await mailFor(mentorUser.email, /has started — join now/i, 3)
    check('B1 no stage-1 email is sent', !mail, JSON.stringify(mail))

    const row = await LiveClassModel.findById(lc._id).lean() as any
    check('B2 mentorReminderSent stays false — nothing to flag, no reminder was due', row?.mentorReminderSent === false)
  }

  /* ═════════════════ C — stage 2 escalates to everyone, correctly ═════════════════ */
  section('C. Stage 2 escalates to admin + matching sub_admin + super_admin + mentor')
  {
    const { lc, mentorUser } = await classFor('4x-trading', -6)  // started 6 min ago — inside [now-13, now-5]
    await runMentorNoShowEscalation()

    const adminMail   = await mailFor(orgAdmin.email, /Mentor has not joined/i)
    const subMail     = await mailFor(forexSubAdmin.email, /Mentor has not joined/i)
    const superMail   = await mailFor(superAdmin.email, /Mentor has not joined/i)
    const mentorMail  = await mailFor(mentorUser.email, /You have not joined/i)

    check('C1 the academy admin is alerted', !!adminMail)
    check('C2 the matching-programme sub_admin is alerted', !!subMail)
    check('C3 every super_admin is alerted, platform-wide, no org filter', !!superMail)
    check('C4 the mentor gets their own (second-person) copy', !!mentorMail)
    check('C5 the mentor copy is worded for the mentor, not about them',
      /You have not joined/i.test(String(mentorMail?.subject)))

    const notesAdmin = await NotificationModel.countDocuments({ userId: orgAdmin._id, kind: 'mentor-no-show' })
    check('C6 an in-app notification is created for the admin too', notesAdmin > 0, String(notesAdmin))

    const row = await LiveClassModel.findById(lc._id).lean() as any
    check('C7 mentorNoShowAlertSent is flagged', row?.mentorNoShowAlertSent === true)

    const before = await EmailOutboxModel.countDocuments({})
    await runMentorNoShowEscalation()
    await new Promise(r => setTimeout(r, 300))
    const after = await EmailOutboxModel.countDocuments({})
    check('C8 running it again does not escalate twice', after === before, `${before} -> ${after}`)
  }

  /* ═════════════════ D — joined late, between stage 1 and stage 2 ═════════════════ */
  section('D. A late join before stage 2 cancels the escalation')
  {
    const { lc, mentorUser } = await classFor('4x-trading', -6)
    await LiveClassModel.updateOne({ _id: lc._id }, { $set: { instructorJoinedAt: new Date() } })
    await runMentorNoShowEscalation()
    await new Promise(r => setTimeout(r, 300))

    const adminMail = await mailFor(orgAdmin.email, new RegExp(`Session for ${mentorUser.name}`), 3)
    check('D1 no escalation is sent once the mentor has joined', !adminMail, JSON.stringify(adminMail))

    const row = await LiveClassModel.findById(lc._id).lean() as any
    check('D2 mentorNoShowAlertSent stays false — this was a late join, not a no-show', row?.mentorNoShowAlertSent === false)
    check('D3 instructorJoinedAt is preserved, not cleared', !!row?.instructorJoinedAt)
  }

  /* ═════════════════ E — wrong-programme sub_admin is never notified ═════════════════ */
  section('E. A sub_admin in a different programme is not notified')
  {
    await classFor('jura', -6)
    await runMentorNoShowEscalation()

    const forexMailCountBefore = await EmailOutboxModel.countDocuments({ to: forexSubAdmin.email })
    await new Promise(r => setTimeout(r, 300))
    const forexMailCountAfter = await EmailOutboxModel.countDocuments({ to: forexSubAdmin.email })
    check('E1 the forex sub_admin gets nothing for a jura no-show', forexMailCountAfter === forexMailCountBefore)

    const juraMail = await mailFor(juraSubAdmin.email, /Mentor has not joined/i)
    check('E2 the jura sub_admin IS notified for their own programme', !!juraMail)
  }

  /* ═════════════════ F — CLT webhook: instructor join, not student attendance ═════════════════ */
  section('F. participant.joined for the instructor sets instructorJoinedAt, idempotently')
  {
    const { c, m } = await course('ai')
    const lc = await LiveClassModel.create({
      title: 'Internal room', courseId: c._id, instructorId: m._id, organizationId: org._id,
      scheduledStart: new Date(), durationMins: 60, type: 'internal', provider: 'livekit',
      cltRoomName: `room-${m._id}`, isOnline: true, status: 'live',
      language: 'English', sessionCapacity: 30, bookedCount: 0,
    })

    const result = await handleCltEvent({
      type: 'participant.joined', roomName: `room-${m._id}`,
      data: { lmsUserId: String(m._id) },
    })
    check('F1 the handler reports an instructor join, not a booking match', /instructor join/i.test(result), result)

    const row = await LiveClassModel.findById(lc._id).lean() as any
    check('F2 instructorJoinedAt is set', !!row?.instructorJoinedAt)

    const firstJoin = row.instructorJoinedAt
    await new Promise(r => setTimeout(r, 50))
    await handleCltEvent({ type: 'participant.joined', roomName: `room-${m._id}`, data: { lmsUserId: String(m._id) } })
    const rowAfter = await LiveClassModel.findById(lc._id).lean() as any
    check('F3 a repeat delivery does not move the timestamp later',
      new Date(rowAfter.instructorJoinedAt).getTime() === new Date(firstJoin).getTime())
  }

  /* ═════════════════ G — POST /:id/mark-joined only counts for the real instructor ═════════════════ */
  section('G. mark-joined records the click only for the assigned instructor')
  {
    const { c, m } = await course('ai')
    const lc = await LiveClassModel.create({
      title: 'External room', courseId: c._id, instructorId: m._id, organizationId: org._id,
      scheduledStart: new Date(), durationMins: 60, type: 'external', meetingUrl: 'https://meet.google.com/g-test',
      isOnline: true, status: 'scheduled', language: 'English', sessionCapacity: 30, bookedCount: 0,
    })

    const observerJar = await signInAdmin(orgAdmin.email, PW)
    const observerRes = await call('POST', `/live-classes/${lc._id}/mark-joined`, { jar: observerJar })
    check('G1 an admin observer clicking Join gets a 200', observerRes.status === 200, JSON.stringify(observerRes.body))
    check('G2 …but it is NOT recorded as the instructor joining', observerRes.body?.data?.recorded === false, JSON.stringify(observerRes.body))
    const stillUnjoined = await LiveClassModel.findById(lc._id).lean() as any
    check('G3 instructorJoinedAt is still unset after the observer\'s click', !stillUnjoined?.instructorJoinedAt)

    const mentorJar = await signInAdmin(m.email, PW)
    const mentorRes = await call('POST', `/live-classes/${lc._id}/mark-joined`, { jar: mentorJar })
    check('G4 the assigned instructor\'s click is recorded', mentorRes.body?.data?.recorded === true, JSON.stringify(mentorRes.body))
    const nowJoined = await LiveClassModel.findById(lc._id).lean() as any
    check('G5 instructorJoinedAt is now set', !!nowJoined?.instructorJoinedAt)

    const firstTimestamp = nowJoined.instructorJoinedAt
    await new Promise(r => setTimeout(r, 50))
    await call('POST', `/live-classes/${lc._id}/mark-joined`, { jar: mentorJar })
    const afterSecondClick = await LiveClassModel.findById(lc._id).lean() as any
    check('G6 a second click from the same mentor does not move the timestamp',
      new Date(afterSecondClick.instructorJoinedAt).getTime() === new Date(firstTimestamp).getTime())

    const badRes = await call('POST', '/live-classes/000000000000000000000000/mark-joined', { jar: mentorJar })
    check('G7 a non-existent class id is a 404, not a silent success', badRes.status === 404, JSON.stringify(badRes.body))
  }

  /* ═════════════════ H — admin listing is org-scoped, super_admin unscoped ═════════════════ */
  section('H. GET /admin/live-classes/no-shows respects tenancy')
  {
    const { lc: myOrgClass } = await classFor('ai', -6)
    await LiveClassModel.updateOne({ _id: myOrgClass._id }, { $set: { mentorNoShowAlertSent: true } })

    const otherOrgClass = await LiveClassModel.create({
      title: 'Other org no-show', courseId: (await course('ai')).c._id, instructorId: otherOrgAdmin._id,
      organizationId: otherOrg._id, scheduledStart: new Date(Date.now() - 6 * 60_000), durationMins: 60,
      type: 'external', meetingUrl: 'https://meet.google.com/other-org', isOnline: true, status: 'scheduled',
      language: 'English', sessionCapacity: 30, bookedCount: 0, mentorNoShowAlertSent: true,
    })

    const orgAdminJar = await signInAdmin(orgAdmin.email, PW)
    const orgRes = await call('GET', '/admin/live-classes/no-shows', { jar: orgAdminJar })
    const orgIds = (orgRes.body?.data ?? []).map((r: any) => r.id)
    check('H1 an ordinary admin sees their own academy\'s no-show', orgIds.includes(String(myOrgClass._id)))
    check('H2 …but not another academy\'s', !orgIds.includes(String(otherOrgClass._id)))

    const superJar = await signInAdmin(superAdmin.email, PW)
    const superRes = await call('GET', '/admin/live-classes/no-shows', { jar: superJar })
    const superIds = (superRes.body?.data ?? []).map((r: any) => r.id)
    check('H3 super_admin sees every academy\'s no-shows', superIds.includes(String(myOrgClass._id)) && superIds.includes(String(otherOrgClass._id)))

    const joinedRow = (superRes.body?.data ?? []).find((r: any) => r.id === String(myOrgClass._id))
    check('H4 the row carries instructor + course for the admin table', !!joinedRow?.instructor?.email && !!joinedRow?.course?.title,
      JSON.stringify(joinedRow))
  }

} finally {
  server.close()
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
