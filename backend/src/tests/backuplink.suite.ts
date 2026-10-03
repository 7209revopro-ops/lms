/* ─────────────────────────────────────────────────────────────
   Backup link — the instructor cannot get into the class's room, and an admin
   swaps another one in from the Live Classes table
   (LiveClassService.switchToBackupLink, POST /admin/live-classes/:id/backup-link).

     A  the dialog's facts: the room now, and who a new Meet makes co-host
        (their Gmail for Google Meet before their login email)
     B  PASTE onto an in-app class: it becomes a link class with the pasted
        link; a booked student's Join returns THAT link; the student's feed
        carries neither the link nor the backup record; booked students are
        told in-app; the instructor is emailed the link; the admin list marks
        it; the audit log records it
     C  GENERATE onto a Meet class (Google stubbed): the instructor is
        co-host at their Meet address, the new room replaces the old one,
        and the old room's invite is withdrawn
     D  refused: in-person, cancelled, over, not a link, another
        instructor's class, a student; allowed: the class's own instructor
     E  two clicks at once make ONE Meet
     F  without Google, "generate" says so (503) and changes nothing

   Google is never reached: the generate path takes a stubbed maker, and
   every Google credential is blanked so nothing can fall through to it.
   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_backuplink_suite), dropped on exit.

   Run: bun run test:backuplink
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_backuplink_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.ADMIN_URL    = 'http://localhost:3001'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''
/* '' and not delete: dotenv restores a deleted variable from backend/.env. */
process.env.GOOGLE_CLIENT_ID       = ''
process.env.GOOGLE_CLIENT_SECRET   = ''
process.env.GOOGLE_REFRESH_TOKEN   = ''
process.env.GOOGLE_CALENDAR_ID     = ''
process.env.GOOGLE_MEET_HOST_EMAIL = ''
process.env.GOOGLE_MEET_STAFF_COHOSTS = 'staff.cohost@example.com'

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
  UserModel, OrganizationModel, CourseModel, LiveClassModel, ClassBookingModel, EnrollmentModel,
  EmailOutboxModel, NotificationModel, AuditLogModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { LiveClassService } = await import('@/services/liveClass.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_backuplink_suite') {
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
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let parsed: any = text; try { parsed = JSON.parse(text) } catch {}
  return { status: res.status, body: parsed }
}
async function poll<T>(fn: () => Promise<T | null | undefined | false>, tries = 40): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, 100))
  }
  return null
}

const PW = 'Backup123'
const PASTED = 'https://meet.google.com/pas-tedx-999'
const svc = new LiveClassService()

try {

const org = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const hash = await hashPassword(PW)
const admin = await UserModel.create({
  name: 'Ops', email: 'ops@bl.local', passwordHash: hash, role: 'admin', isActive: true, isVerified: true, organizationId: org._id,
})
/* example.com — reserved, so even a stray real call could not reach anybody. */
const teacher = await UserModel.create({
  name: 'Moiz', email: 'moiz@bl.local', meetEmail: 'moiz.meet@example.com', passwordHash: hash,
  role: 'instructor', isActive: true, isVerified: true, organizationId: org._id,
})
const other = await UserModel.create({
  name: 'Other', email: 'other@bl.local', passwordHash: hash, role: 'instructor', isActive: true, isVerified: true, organizationId: org._id,
})
/* A Digital Marketing sub-admin: same academy, another programme. */
const dmSub = await UserModel.create({
  name: 'DM Sub', email: 'dmsub@bl.local', passwordHash: hash, role: 'sub_admin', program: 'digital_marketing',
  isActive: true, isVerified: true, organizationId: org._id,
})
const student = await UserModel.create({
  name: 'Sara', email: 'sara@bl.local', passwordHash: hash, role: 'student', isActive: true, isVerified: true,
  enrollmentStatus: 'approved', organizationId: org._id,
})
const course = await CourseModel.create({
  title: 'Forex', slug: 'forex-bl', description: 'd', instructorId: teacher._id, price: 0, isFree: true,
  status: 'published', language: 'English', organizationId: org._id, program: '4x-trading',
})
await EnrollmentModel.collection.insertOne({ userId: student._id, courseId: course._id, status: 'active', organizationId: org._id, blockedLessons: [], source: 'admin' })

const minutes = (n: number) => new Date(Date.now() + n * 60_000)
async function cls(over: Record<string, unknown>) {
  return LiveClassModel.create({
    title: 'MBT 4 · English batch', courseId: course._id, instructorId: teacher._id, organizationId: org._id,
    scheduledStart: minutes(-5), durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
    language: 'English', sessionCapacity: 30, bookedCount: 1, ...over,
  })
}
/* The in-app class running now, that the instructor cannot get into. */
const inApp = await cls({ type: 'internal', provider: 'livekit', cltRoomName: 'lms-room-1' })
await ClassBookingModel.create({ userId: student._id, liveClassId: inApp._id, status: 'booked', bookedAt: new Date() })

const adminJar: Jar = new Map(), studentJar: Jar = new Map(), teacherJar: Jar = new Map(), otherJar: Jar = new Map(), dmJar: Jar = new Map()
check('setup: admin signs in',      (await call('POST', '/admin/auth/login', adminJar,   { email: admin.email,   password: PW })).status === 200)
check('setup: student signs in',    (await call('POST', '/auth/login',       studentJar, { email: student.email, password: PW })).status === 200)
check('setup: instructor signs in', (await call('POST', '/admin/auth/login', teacherJar, { email: teacher.email, password: PW })).status === 200)
check('setup: another instructor signs in', (await call('POST', '/admin/auth/login', otherJar, { email: other.email, password: PW })).status === 200)
check('setup: a Digital Marketing sub-admin signs in', (await call('POST', '/admin/auth/login', dmJar, { email: dmSub.email, password: PW })).status === 200)

/* ═════════════════ A — the dialog's facts ═════════════════ */
section('A  what the Backup dialog shows')
{
  const r = await call('GET', `/admin/live-classes/${inApp._id}/backup-link`, adminJar)
  const d = r.body?.data
  check('A1 the room now: the in-app room', r.status === 200 && d?.current?.type === 'internal', JSON.stringify(r.body))
  check('A2 a new Meet makes the instructor co-host at their Gmail for Google Meet',
    d?.instructor?.meetEmail === 'moiz.meet@example.com' && d?.instructor?.via === 'meet-email' && d?.instructor?.organizer === false, JSON.stringify(d?.instructor))
  check('A3 it can be switched', d?.canSwitch === true)
}

/* ═════════════════ B — paste onto the in-app class ═════════════════ */
section('B  paste a link onto an in-app class')
{
  const insecure = await call('POST', `/admin/live-classes/${inApp._id}/backup-link`, adminJar, { mode: 'paste', url: 'http://meet.google.com/abc-defg-hij' })
  check('B1 an http:// link is refused', insecure.status === 400 && insecure.body?.error?.code === 'INVALID_URL', JSON.stringify(insecure.body))
  const junk = await call('POST', `/admin/live-classes/${inApp._id}/backup-link`, adminJar, { mode: 'paste', url: 'my meet room' })
  check('B2 something that is not a link is refused', junk.status === 400, String(junk.status))

  const before = await NotificationModel.countDocuments({ userId: student._id })
  const r = await call('POST', `/admin/live-classes/${inApp._id}/backup-link`, adminJar, { mode: 'paste', url: PASTED })
  check('B3 the pasted link is accepted', r.status === 200 && r.body?.data?.url === PASTED && r.body?.data?.mode === 'pasted' && r.body?.data?.previousType === 'internal',
    JSON.stringify(r.body))
  const doc = await LiveClassModel.findById(inApp._id).lean() as any
  check('B4 the class is now a link class carrying it', doc.type === 'external' && doc.meetingUrl === PASTED && doc.googleMeetCode === 'pas-tedx-999',
    JSON.stringify({ type: doc.type, url: doc.meetingUrl, code: doc.googleMeetCode }))
  check('B5 the backup is recorded — how, and that it was the in-app room', doc.backupLink?.mode === 'pasted' && doc.backupLink?.previousType === 'internal' && String(doc.backupLink?.by) === String(admin._id))
  check('B6 the in-app room\'s own fields are left alone', doc.provider === 'livekit' && doc.cltRoomName === 'lms-room-1')

  const join = await call('POST', `/live-classes/${inApp._id}/join`, studentJar)
  check('B7 a booked student\'s Join now returns the NEW link', join.status === 200 && join.body?.data?.url === PASTED, JSON.stringify(join.body))

  const feed = await call('GET', '/live-classes', studentJar)
  const row = (feed.body?.data ?? []).find((c: any) => String(c.id) === String(inApp._id))
  check('B8 the student\'s feed shows a link class…', row?.type === 'external', JSON.stringify(row && { type: row.type }))
  check('B9 …with neither the link nor the backup record in it', row && !('meetingUrl' in row) && !('backupLink' in row) && !('googleMeetCode' in row),
    JSON.stringify(row && Object.keys(row)))

  const told = await poll(async () => (await NotificationModel.countDocuments({ userId: student._id })) > before
    && NotificationModel.findOne({ userId: student._id }).sort({ createdAt: -1 }).lean())
  check('B10 the booked student is told in-app', !!told && /Joining link updated/.test(String((told as any).title)), JSON.stringify(told && (told as any).title))

  const mail = await poll(async () => EmailOutboxModel.findOne({ to: teacher.email, subject: /New link for your class/ }).lean())
  check('B11 the instructor is emailed the new link', !!mail && String((mail as any).html).includes(PASTED), String((mail as any)?.subject))

  const list = await call('GET', '/admin/live-classes', adminJar)
  const adminRow = (list.body?.data ?? []).find((c: any) => String(c.id) === String(inApp._id))
  check('B12 the admin list marks it a backup, and what it was', adminRow?.backupLink?.mode === 'pasted' && adminRow?.backupLink?.previousType === 'internal' && adminRow?.meetingUrl === PASTED,
    JSON.stringify(adminRow?.backupLink))

  const audited = await poll(async () => AuditLogModel.findOne({ action: 'liveclass.backup-link', entityId: String(inApp._id) }).lean())
  check('B13 the audit log records the switch', !!audited)

  const same = await call('POST', `/admin/live-classes/${inApp._id}/backup-link`, adminJar, { mode: 'paste', url: PASTED })
  check('B14 pasting the link it already has is refused', same.status === 400 && same.body?.error?.code === 'SAME_LINK', JSON.stringify(same.body))
}

/* ═════════════════ C — generate onto a Meet class (Google stubbed) ═════════════════ */
section('C  generate a new Google Meet')
{
  const OLD = { name: 'spaces/old', host: 'host@example.com', cohost: 'moiz.meet@example.com', calendarEventId: 'evt-old' }
  const meetCls = await cls({ scheduledStart: minutes(90), meetingUrl: 'https://meet.google.com/old-oldo-old', googleMeetCode: 'old-oldo-old', meetSpace: OLD })
  let asked: any = null
  const withdrawn: string[] = []
  const r = await svc.switchToBackupLink(String(meetCls._id), { mode: 'generate', actorId: String(admin._id) }, {
    makeMeet: async (o) => {
      asked = o
      return { meetingUrl: 'https://meet.google.com/new-newn-new', meetingCode: 'new-newn-new', accessType: null, invitedEmail: o.instructorMeetEmail,
        meetSpace: { name: 'spaces/new', host: 'host@example.com', cohost: o.instructorMeetEmail!, calendarEventId: 'evt-new' } }
    },
    withdraw: async (s) => { withdrawn.push(s.name) },
  })
  check('C1 the new Meet is made with the instructor as co-host at their Meet address',
    asked?.instructorMeetEmail === 'moiz.meet@example.com' && asked?.instructorEmail === 'moiz@bl.local' && asked?.title === meetCls.title, JSON.stringify(asked))
  check('C1b …and the staff co-host, as every class room has',
    JSON.stringify(asked?.staffCohosts) === '["staff.cohost@example.com"]', JSON.stringify(asked?.staffCohosts))
  const doc = await LiveClassModel.findById(meetCls._id).lean() as any
  check('C2 the class carries the new room', doc.meetingUrl === 'https://meet.google.com/new-newn-new' && doc.googleMeetCode === 'new-newn-new' && doc.meetSpace?.name === 'spaces/new')
  check('C3 recorded as generated, was a Meet class', doc.backupLink?.mode === 'generated' && doc.backupLink?.previousType === 'external')
  await new Promise(x => setTimeout(x, 50))
  check('C4 the old room\'s invite is withdrawn', withdrawn.join() === 'spaces/old', withdrawn.join())
  check('C5 the result names the co-host', r.cohost === 'moiz.meet@example.com' && r.mode === 'generated')

  const feed = await call('GET', '/live-classes', studentJar)
  const row = (feed.body?.data ?? []).find((c: any) => String(c.id) === String(meetCls._id))
  check('C6 the co-hosted room\'s record (the instructor\'s Gmail) never reaches a student', !!row && !('meetSpace' in row), JSON.stringify(row && Object.keys(row)))

  /* A second swap keeps saying what the class was before the FIRST one. */
  await svc.switchToBackupLink(String(inApp._id), { mode: 'generate', actorId: String(admin._id) }, {
    makeMeet: async () => ({ meetingUrl: 'https://meet.google.com/two-twot-two', meetingCode: 'two-twot-two', accessType: null }),
    withdraw: async () => {},
  })
  const again = await LiveClassModel.findById(inApp._id).lean() as any
  check('C7 a second backup still remembers it was the in-app room', again.backupLink?.previousType === 'internal' && again.meetingUrl === 'https://meet.google.com/two-twot-two' && !again.meetSpace)
}

/* ═════════════════ D — who and when ═════════════════ */
section('D  refused and allowed')
{
  const post = (id: unknown, jar: Jar, body: unknown = { mode: 'paste', url: 'https://zoom.us/j/123' }) =>
    call('POST', `/admin/live-classes/${id}/backup-link`, jar, body)
  const inPerson  = await cls({ isOnline: false, location: 'Al Qusais', room: 'Room No. 1' })
  const cancelled = await cls({ status: 'cancelled' })
  const over      = await cls({ scheduledStart: minutes(-180), durationMins: 60 })
  const mine      = await cls({ scheduledStart: minutes(30) })
  let r = await post(inPerson._id, adminJar)
  check('D1 an in-person class has no link to replace', r.status === 400 && r.body?.error?.code === 'NOT_ONLINE', JSON.stringify(r.body))
  r = await post(cancelled._id, adminJar)
  check('D2 a cancelled class is refused', r.status === 409 && r.body?.error?.code === 'CLASS_CANCELLED', JSON.stringify(r.body))
  r = await post(over._id, adminJar)
  check('D3 a class that is over is refused', r.status === 409 && r.body?.error?.code === 'CLASS_OVER', JSON.stringify(r.body))
  r = await post(mine._id, adminJar, { mode: 'teleport' })
  check('D4 an unknown mode is refused', r.status === 422, String(r.status))
  r = await post(mine._id, otherJar)
  check('D5 another instructor cannot switch this class', r.status === 403, String(r.status))
  r = await post(mine._id, studentJar)
  check('D6 a student cannot', r.status === 401 || r.status === 403, String(r.status))
  r = await post(mine._id, teacherJar)
  check('D7 the class\'s own instructor can — a Zoom link too', r.status === 200 && r.body?.data?.url === 'https://zoom.us/j/123', JSON.stringify(r.body))
  const z = await LiveClassModel.findById(mine._id).lean() as any
  check('D8 a non-Meet link carries no Meet code', z.meetingUrl === 'https://zoom.us/j/123' && !z.googleMeetCode)
  /* Same wall as Edit: a programme-scoped sub-admin of ANOTHER programme. */
  const dm = await post(mine._id, dmJar, { mode: 'paste', url: 'https://zoom.us/j/999' })
  const dmInfo = await call('GET', `/admin/live-classes/${mine._id}/backup-link`, dmJar)
  const dmEdit = await call('PATCH', `/admin/live-classes/${mine._id}`, dmJar, { description: 'x' })
  check('D9 another programme\'s sub-admin cannot switch a Forex class — exactly like Edit', dm.status === 403 && dmInfo.status === 403 && dmEdit.status === 403,
    JSON.stringify({ backup: dm.status, info: dmInfo.status, edit: dmEdit.status }))
  check('D10 and the link is untouched', ((await LiveClassModel.findById(mine._id).lean()) as any).meetingUrl === 'https://zoom.us/j/123')
}

/* ═════════════════ E — two clicks at once ═════════════════ */
section('E  a double click makes one Meet')
{
  const c = await cls({ scheduledStart: minutes(10) })
  let made = 0
  const slow = async () => { made++; await new Promise(x => setTimeout(x, 150)); return { meetingUrl: 'https://meet.google.com/one-onex-one', meetingCode: 'one-onex-one', accessType: null } }
  const both = await Promise.allSettled([
    svc.switchToBackupLink(String(c._id), { mode: 'generate', actorId: String(admin._id) }, { makeMeet: slow, withdraw: async () => {} }),
    svc.switchToBackupLink(String(c._id), { mode: 'generate', actorId: String(admin._id) }, { makeMeet: slow, withdraw: async () => {} }),
  ])
  const refused = both.find(x => x.status === 'rejected') as PromiseRejectedResult | undefined
  check('E1 one switch, the other told to wait', both.filter(x => x.status === 'fulfilled').length === 1 && (refused?.reason as any)?.code === 'BACKUP_IN_PROGRESS',
    JSON.stringify(both.map(x => x.status)))
  check('E2 only one Meet was made', made === 1, String(made))
}

/* ═════════════════ F — no Google ═════════════════ */
section('F  generate without Google')
{
  const c = await cls({ scheduledStart: minutes(20), meetingUrl: 'https://meet.google.com/kee-pkee-pme' })
  const r = await call('POST', `/admin/live-classes/${c._id}/backup-link`, adminJar, { mode: 'generate' })
  check('F1 says Google could not make a link (503)', r.status === 503 && r.body?.error?.code === 'MEET_LINK_UNAVAILABLE', JSON.stringify(r.body))
  const doc = await LiveClassModel.findById(c._id).lean() as any
  check('F2 and changes nothing', doc.meetingUrl === 'https://meet.google.com/kee-pkee-pme' && !doc.backupLink)
}

/* ═════════════════ G — the switched class's old room stays out of it ═════════════════ */
section('G  after a switch the abandoned room cannot end, own or re-open the class')
{
  const { handleCltEvent } = await import('@/services/cltWebhook.service.ts')
  const { mintStudentTicket, mintHostTicket } = await import('@/services/liveClassJoin.service.ts')
  /* inApp was switched in B and C: its room "lms-room-1" is abandoned. */
  const said = await handleCltEvent({ type: 'meeting.ended', roomName: 'lms-room-1' })
  const after = await LiveClassModel.findById(inApp._id).lean() as any
  check('G1 the old room ending does not end the class', after.status === 'scheduled' && /backup/i.test(said), JSON.stringify({ status: after.status, said }))

  const mux = await cls({ type: 'internal', provider: 'mux', muxLiveStreamId: 'mux-stream-1', status: 'live', scheduledStart: minutes(-20) })
  await svc.switchToBackupLink(String(mux._id), { mode: 'paste', url: 'https://zoom.us/j/555', actorId: String(admin._id) })
  await svc.handleMuxWebhook({ type: 'video.live_stream.idle', data: { id: 'mux-stream-1' } })
  check('G2 the abandoned Mux stream going idle does not end it', ((await LiveClassModel.findById(mux._id).lean()) as any).status === 'live')

  const ctx = { userId: String(student._id), name: 'Sara', email: student.email, role: 'student', organizationId: String(org._id) }
  const codeOf = async (p: Promise<unknown>) => { try { await p; return 'issued' } catch (e) { return (e as { code?: string }).code ?? 'threw' } }
  check('G3 no student ticket into the abandoned room', await codeOf(mintStudentTicket(String(inApp._id), ctx)) === 'MOVED_TO_LINK')
  check('G4 no host ticket either', await codeOf(mintHostTicket(String(inApp._id),
    { userId: String(teacher._id), name: 'Moiz', email: teacher.email, role: 'instructor', organizationId: String(org._id) })) === 'MOVED_TO_LINK')

  /* Somebody else changes the link while Google is still making ours. */
  const raced = await cls({ scheduledStart: minutes(25), meetingUrl: 'https://meet.google.com/rac-erac-era' })
  const withdrawn: string[] = []
  const slowMake = async () => {
    await LiveClassModel.updateOne({ _id: raced._id }, { $set: { meetingUrl: 'https://zoom.us/j/edited-meanwhile' } })
    return { meetingUrl: 'https://meet.google.com/los-erlo-ser', meetingCode: 'los-erlo-ser', accessType: null,
      meetSpace: { name: 'spaces/loser', host: 'host@example.com' } }
  }
  const lost = await codeOf(svc.switchToBackupLink(String(raced._id), { mode: 'generate', actorId: String(admin._id) },
    { makeMeet: slowMake, withdraw: async (s) => { withdrawn.push(s.name) } }))
  await new Promise(x => setTimeout(x, 50))
  check('G5 a link changed meanwhile is not overwritten', lost === 'CLASS_CHANGED'
    && ((await LiveClassModel.findById(raced._id).lean()) as any).meetingUrl === 'https://zoom.us/j/edited-meanwhile', lost)
  check('G6 …and the Meet made for nothing is withdrawn', withdrawn.join() === 'spaces/loser', withdrawn.join())

  check('G7 switching at class time stops the automatic "mentor didn\'t join" alert', after.mentorNoShowAlertSent === true)
  const far = await cls({ scheduledStart: minutes(3 * 1440) })
  await svc.switchToBackupLink(String(far._id), { mode: 'paste', url: 'https://zoom.us/j/777', actorId: String(admin._id) })
  check('G8 …but not for a class days away', ((await LiveClassModel.findById(far._id).lean()) as any).mentorNoShowAlertSent === false)

  const rep = await call('POST', `/admin/live-classes/${inApp._id}/repeat`, adminJar, { weeks: 1 })
  const copy = await LiveClassModel.findOne({ title: inApp.title, _id: { $ne: inApp._id }, scheduledStart: { $gt: minutes(6 * 1440) } }).lean() as any
  check('G9 next week repeats as the in-app class it was planned as', rep.status === 201 || rep.status === 200 ? copy?.type === 'internal' && copy?.provider === 'livekit' && !copy?.backupLink : false,
    JSON.stringify({ s: rep.status, type: copy?.type, provider: copy?.provider, err: rep.body?.error }))

  const { AuditLogModel: AL } = await import('@/models/schema.ts')
  const trail = await AL.findOne({ action: 'liveclass.backup-link', 'meta.url': PASTED }).lean()
  check('G10 the audit trail records the pasted link', !!trail)
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  server.close()
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\nbackuplink.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
