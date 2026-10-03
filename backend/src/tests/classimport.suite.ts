/* ─────────────────────────────────────────────────────────────
   Live-class timetable import (services/classImport.service.ts).

     A  time parsing: 12-hour, 24-hour, midnight — and "16:00 PM" refused
     B  the real English-batch file: 36 rows → 144 classes over 4 weeks,
        platform per row (Moiz + MBT 4 → Google Meet, rest → in-app), dates
        and times in the ACADEMY's zone
     C  the drag-filled Friday start times are blocked, not imported
     D  mentors: matched by name; an unknown one is an error until picked
     E  per-row choices in the preview: skip a row, switch its platform
     F  in-app rooms refuse a capacity above the interactive-room limit
     G  import runs through the REAL create path: classes carry their import
        tags and series, NO per-class student notification or mentor email,
        and ONE summary per mentor
     H  importing the same file again creates nothing new
     I  a failed class is retried by resume; nothing is counted twice
     J  undo removes what the import made — never a class with a booking
     K  another academy's admin cannot see or touch the import
     L  a restart turns a running import into a resumable one
     M  modules: each row goes into the course module its code names (MBT 7 →
        "MBT 7 - …", IM 4 (1) → "IM 4 - PART 1"); no match waits for a pick

   Boots against an ISOLATED throwaway database, dropped on exit.
   Run: bun run test:classimport
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_classimport_suite'
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
process.env.CLASS_IMPORT_PACING_MS = '0'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
const {
  UserModel, OrganizationModel, CourseModel, LiveClassModel, ClassImportModel,
  EmailOutboxModel, NotificationModel, EnrollmentModel, SectionModel,
} = await import('@/models/schema.ts')
const { resetOrgSlugCache } = await import('@/utils/orgSlugs.ts')
const { ClassImportService, __test } = await import('@/services/classImport.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_classimport_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()
await Promise.all([LiveClassModel.createIndexes(), ClassImportModel.createIndexes()])

const svc = new ClassImportService()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
/* Wait on the service's in-process `running` flag, not the stored status: a run
   saves 'completed' BEFORE it sends the mentor summaries, and a resume flips the
   stored status back to 'running' only after it has loaded the job — polling
   the stored field alone raced both (one cold-cache run in seven saw it). The
   flag is set synchronously inside start()/resume() and cleared only after the
   summaries are out, which is exactly what the script and the admin page wait on. */
async function waitDone(jobId: string, actor: { id: string; role: string; organizationId?: string }, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const s = await svc.status(jobId, actor)
    if (!s.running && s.status !== 'running') {
      return (await ClassImportModel.findById(jobId).select('status items.status').lean())!
    }
    await sleep(100)
  }
  throw new Error('import did not finish')
}

/* ── The real file: Forex_Timetable_English_Batch_App_Import.xlsx, Sessions ── */
const FILE: Array<[string, string, string, string, string, string, string, string, string]> = [
  ['ENG-001','Tuesday','1:00 PM','1:00 PM - 3:00 PM','3:00 PM','Haffis','MBT','1','Offline + Online'],
  ['ENG-002','Tuesday','5:00 PM','5:00 PM - 7:00 PM','7:00 PM','Haffis','MBT','2','Offline + Online'],
  ['ENG-003','Tuesday','8:00 PM','8:00 PM - 10:00 PM','10:00 PM','Haffis','MBT','3','Offline + Online'],
  ['ENG-004','Tuesday','2:00 PM','2:00 PM - 4:00 PM','4:00 PM','Moiz','MBT','4','Online Only'],
  ['ENG-005','Tuesday','6:00 PM','6:00 PM - 8:00 PM','8:00 PM','Moiz','ADVANCE','1','Online Only'],
  ['ENG-006','Tuesday','9:00 PM','9:00 PM - 11:00 PM','11:00 PM','Moiz','IM','1','Online Only'],
  ['ENG-007','Wednesday','1:00 PM','1:00 PM - 3:00 PM','3:00 PM','Haffis','MBT','5','Offline + Online'],
  ['ENG-008','Wednesday','5:00 PM','5:00 PM - 7:00 PM','7:00 PM','Haffis','MBT','6','Offline + Online'],
  ['ENG-009','Wednesday','8:00 PM','8:00 PM - 10:00 PM','10:00 PM','Haffis','IM','2','Offline + Online'],
  ['ENG-010','Wednesday','2:00 PM','2:00 PM - 4:00 PM','4:00 PM','Moiz','MBT','7','Online Only'],
  ['ENG-011','Wednesday','6:00 PM','6:00 PM - 8:00 PM','8:00 PM','Moiz','ADVANCE','2','Online Only'],
  ['ENG-012','Wednesday','9:00 PM','9:00 PM - 11:00 PM','11:00 PM','Moiz','IM','3','Online Only'],
  ['ENG-013','Thursday','1:00 PM','1:00 PM - 3:00 PM','3:00 PM','Haffis','MBT','8','Offline + Online'],
  ['ENG-014','Thursday','5:00 PM','5:00 PM - 7:00 PM','7:00 PM','Haffis','MBT','1','Offline + Online'],
  ['ENG-015','Thursday','8:00 PM','8:00 PM - 10:00 PM','10:00 PM','Haffis','MBT','2','Offline + Online'],
  ['ENG-016','Thursday','2:00 PM','2:00 PM - 4:00 PM','4:00 PM','Moiz','MBT','3','Online Only'],
  ['ENG-017','Thursday','6:00 PM','6:00 PM - 8:00 PM','8:00 PM','Moiz','ADVANCE','3','Online Only'],
  ['ENG-018','Thursday','9:00 PM','9:00 PM - 11:00 PM','11:00 PM','Moiz','IM','4 (1)','Online Only'],
  ['ENG-019','Friday','1:00 PM','1:00 PM - 3:00 PM','3:00 PM','Haffis','MBT','4','Offline + Online'],
  ['ENG-020','Friday','5:00 PM','5:00 PM - 7:00 PM','7:00 PM','Haffis','MBT','5','Offline + Online'],
  ['ENG-021','Friday','8:00 PM','8:00 PM - 10:00 PM','10:00 PM','Haffis','IM','4 (2)','Offline + Online'],
  ['ENG-022','Friday','2:00 PM','2:00 PM - 4:00 PM','4:00 PM','Moiz','MBT','6','Online Only'],
  ['ENG-023','Friday','6:00 PM','6:00 PM - 8:00 PM','8:00 PM','Moiz','ADVANCE','4','Online Only'],
  ['ENG-024','Friday','9:00 PM','9:00 PM - 11:00 PM','11:00 PM','Moiz','IM','1','Online Only'],
  ['ENG-025','Saturday','1:00 PM','1:00 PM - 3:00 PM','3:00 PM','Haffis','MBT','3','Offline + Online'],
  ['ENG-026','Saturday','5:00 PM','5:00 PM - 7:00 PM','7:00 PM','Haffis','MBT','5','Offline + Online'],
  ['ENG-027','Saturday','8:00 PM','8:00 PM - 10:00 PM','10:00 PM','Haffis','MBT','7','Offline + Online'],
  ['ENG-028','Saturday','2:00 PM','2:00 PM - 4:00 PM','4:00 PM','Moiz','MBT','8','Online Only'],
  ['ENG-029','Saturday','6:00 PM','6:00 PM - 8:00 PM','8:00 PM','Moiz','ADVANCE','5','Online Only'],
  ['ENG-030','Saturday','9:00 PM','9:00 PM - 11:00 PM','11:00 PM','Moiz','IM','2','Online Only'],
  ['ENG-031','Sunday','1:00 PM','1:00 PM - 3:00 PM','3:00 PM','Haffis','MBT','1','Offline + Online'],
  ['ENG-032','Sunday','5:00 PM','5:00 PM - 7:00 PM','7:00 PM','Haffis','MBT','2','Offline + Online'],
  ['ENG-033','Sunday','8:00 PM','8:00 PM - 10:00 PM','10:00 PM','Haffis','IM','3','Offline + Online'],
  ['ENG-034','Sunday','2:00 PM','2:00 PM - 4:00 PM','4:00 PM','Moiz','MBT','3','Online Only'],
  ['ENG-035','Sunday','6:00 PM','6:00 PM - 8:00 PM','8:00 PM','Moiz','ADVANCE','6','Online Only'],
  ['ENG-036','Sunday','9:00 PM','9:00 PM - 11:00 PM','11:00 PM','Moiz','IM','4 (1)','Online Only'],
]
/* The agreed rule: Moiz → Google Meet, any MBT 4 → Google Meet, everything else → in-app. */
const platformFor = (mentor: string, batch: string, num: string) =>
  mentor === 'Moiz' || (batch === 'MBT' && num === '4') ? 'Google Meet' : 'In-app'
const toRow = (r: typeof FILE[number], withPlatform = true) => ({
  session_id: r[0], day: r[1], start_time: r[2], time: r[3], end_time: r[4],
  mentor: r[5], batch: r[6], session_number: r[7], mode: r[8],
  ...(withPlatform ? { platform: platformFor(r[5], r[6], r[7]) } : {}),
})
const ROWS = FILE.map(r => toRow(r))

const NOW = new Date('2026-10-01T08:00:00Z')

try {

/* ── A ──────────────────────────────────────────────── */
section('A  time parsing')
check('A1 1:00 PM = 13:00', __test.parseTime('1:00 PM') === 780)
check('A2 12:00 AM = midnight', __test.parseTime('12:00 AM') === 0)
check('A3 12:30 PM = 12:30', __test.parseTime('12:30 PM') === 750)
check('A4 24-hour 13:00', __test.parseTime('13:00') === 780)
check('A5 "9 pm"', __test.parseTime('9 pm') === 1260)
check('A6 "16:00 PM" is refused', __test.parseTime('16:00 PM') === null)
check('A7 "25:00" is refused', __test.parseTime('25:00') === null)

/* ── Seed ───────────────────────────────────────────── */
const dubai = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const blr   = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay', countryFilter: 'India' })
resetOrgSlugCache()

const oid = () => new mongoose.Types.ObjectId()
const courseId = oid()
await CourseModel.collection.insertOne({ _id: courseId, title: 'Forex Trading', slug: 'forex-trading', organizationId: dubai._id, status: 'published', price: 0 })
const admin   = { _id: oid(), name: 'Ada Admin',  email: 'ada@imp.test',    role: 'admin',      organizationId: dubai._id, isActive: true }
const haffis  = { _id: oid(), name: 'Haffis',     email: 'haffis@imp.test', role: 'instructor', organizationId: dubai._id, isActive: true }
const moiz    = { _id: oid(), name: 'Moiz',       email: 'moiz@imp.test',   role: 'instructor', organizationId: dubai._id, isActive: true }
const otherAd = { _id: oid(), name: 'Bala Admin', email: 'bala@imp.test',   role: 'admin',      organizationId: blr._id,   isActive: true }
const student = { _id: oid(), name: 'Sara',       email: 'sara@imp.test',   role: 'student',    organizationId: dubai._id, isActive: true, enrollmentStatus: 'approved' }
await UserModel.collection.insertMany([admin, haffis, moiz, otherAd, student])
await EnrollmentModel.collection.insertOne({ userId: student._id, courseId, status: 'active', organizationId: dubai._id, blockedLessons: [] })

const ACTOR = { id: String(admin._id), role: 'admin', organizationId: String(dubai._id) }
const SETTINGS = {
  courseId: String(courseId), startDate: '2026-10-06', weeks: 4, capacity: 30,
  language: 'English', titleLabel: 'English batch', location: 'Dubai Campus', room: 'Room 1',
  defaultPlatform: 'inapp' as const,
}

/* ── B ──────────────────────────────────────────────── */
section('B  the English-batch file')
{
  const p = await svc.preview(SETTINGS, ROWS, ACTOR, {}, NOW)
  check('B1 36 rows, all ready', p.summary.rows === 36 && p.summary.ready === 36, JSON.stringify(p.summary))
  check('B2 144 classes over 4 weeks', p.summary.classes === 144, String(p.summary.classes))
  check('B3 76 Google Meet (Moiz + MBT 4) and 68 in-app', p.summary.meet === 76 && p.summary.inapp === 68, `${p.summary.meet}/${p.summary.inapp}`)
  check('B4 academy is Dubai (GST)', p.academy.zone === 'Asia/Dubai' && p.academy.tag === 'GST')
  const r1 = p.rows.find(r => r.sessionId === 'ENG-001')!
  check('B5 title "MBT 1 · English batch"', r1.title === 'MBT 1 · English batch', r1.title)
  check('B6 ENG-001 every Tuesday from 6 Oct', r1.occurrences.map(o => o.dateKey).join(',') === '2026-10-06,2026-10-13,2026-10-20,2026-10-27')
  check('B7 1:00 PM GST is 09:00 UTC', r1.occurrences[0]!.startISO === '2026-10-06T09:00:00.000Z', r1.occurrences[0]!.startISO)
  check('B8 Offline + Online keeps the room', r1.mode === 'hybrid' && r1.room === 'Room 1' && r1.platform === 'inapp')
  const r19 = p.rows.find(r => r.sessionId === 'ENG-019')!
  check('B9 Haffis MBT 4 (Fri) → Google Meet', r19.platform === 'meet')
  const r6 = p.rows.find(r => r.sessionId === 'ENG-006')!
  check('B10 Moiz → Google Meet, online only, no room', r6.platform === 'meet' && r6.mode === 'online' && !r6.room)
  const r31 = p.rows.find(r => r.sessionId === 'ENG-031')!
  check('B11 Sunday rows start Sun 11 Oct', r31.occurrences[0]!.dateKey === '2026-10-11')
  check('B12 two mentors', p.summary.mentors === 2)
  check('B13 nothing written by a preview', (await LiveClassModel.countDocuments()) === 0 && (await ClassImportModel.countDocuments()) === 0)
  const noCol = await svc.preview(SETTINGS, FILE.map(r => toRow(r, false)), ACTOR, {}, NOW)
  check('B14 without a platform column, the default (in-app) applies', noCol.summary.inapp === 144 && noCol.summary.meet === 0)
}

/* ── C ──────────────────────────────────────────────── */
section('C  drag-filled Friday start times')
{
  const broken = FILE.slice(18, 24).map((r, i) => ({ ...toRow(r), start_time: `${16 + i}:00 PM` }))
  const p = await svc.preview(SETTINGS, broken, ACTOR, {}, NOW)
  check('C1 all six blocked', p.rows.every(r => r.status === 'error') && p.summary.classes === 0, JSON.stringify(p.rows.map(r => r.status)))
  check('C2 the message names the bad time', p.rows[0]!.messages.some(m => m.includes('16:00 PM')), p.rows[0]!.messages.join(' | '))
  const mismatch = [{ ...toRow(FILE[18]!), start_time: '2:00 PM' }]
  const q = await svc.preview(SETTINGS, mismatch, ACTOR, {}, NOW)
  check('C3 a valid but wrong start_time is caught by the time column', q.rows[0]!.status === 'error' && q.rows[0]!.messages.some(m => m.includes('does not match')))
}

/* ── D ──────────────────────────────────────────────── */
section('D  mentors')
{
  const p = await svc.preview(SETTINGS, [{ ...ROWS[0]!, mentor: 'Nobody' }], ACTOR, {}, NOW)
  check('D1 unknown mentor is an error', p.rows[0]!.status === 'error' && p.rows[0]!.messages.some(m => m.includes('No LMS account')))
  const q = await svc.preview(SETTINGS, [{ ...ROWS[0]!, mentor: 'Nobody' }], ACTOR, { 2: { instructorId: String(haffis._id) } }, NOW)
  check('D2 picking an account in the preview fixes it', q.rows[0]!.status === 'ready' && q.rows[0]!.matchedBy === 'manual')
  check('D3 the instructor list excludes students', !p.instructors.some(i => i.role === 'student') && p.instructors.some(i => i.id === String(moiz._id)))
}

/* ── E ──────────────────────────────────────────────── */
section('E  per-row choices')
{
  const p = await svc.preview(SETTINGS, ROWS, ACTOR, { 2: { include: false }, 3: { platform: 'meet' } }, NOW)
  check('E1 a skipped row leaves the total', p.summary.classes === 140, String(p.summary.classes))
  check('E2 a switched row moves to Google Meet', p.rows.find(r => r.rowNumber === 3)!.platform === 'meet' && p.summary.meet === 80, String(p.summary.meet))
}

/* ── F ──────────────────────────────────────────────── */
section('F  in-app capacity')
{
  const p = await svc.preview({ ...SETTINGS, capacity: 200 }, ROWS, ACTOR, {}, NOW)
  check('F1 in-app rows refuse 200 seats', p.rows.filter(r => r.platform === 'inapp').every(r => r.status === 'error'))
  check('F2 Google Meet rows are fine with 200', p.rows.filter(r => r.platform === 'meet').every(r => r.status !== 'error'))
}

/* ── G ──────────────────────────────────────────────── */
section('G  import through the real create path')
const SMALL = ROWS.filter(r => ['ENG-001', 'ENG-002', 'ENG-007'].includes(r.session_id))   // Haffis, in-app
let jobId = ''
{
  const before = await EmailOutboxModel.countDocuments()
  const r = await svc.start(SETTINGS, SMALL, ACTOR, {}, 'english.xlsx')
  jobId = r.jobId
  check('G1 12 classes planned', r.total === 12, String(r.total))
  const job = await waitDone(jobId, ACTOR)
  check('G2 import completed', job.status === 'completed', job.status)
  const classes = await LiveClassModel.find({ importJobId: new mongoose.Types.ObjectId(jobId) }).lean()
  check('G3 12 classes created', classes.length === 12, String(classes.length))
  check('G4 in-app interactive rooms', classes.every(c => c.type === 'internal' && c.provider === 'livekit'))
  check('G5 every class carries its import ref', classes.every(c => typeof c.importRef === 'string' && c.importRef.startsWith(`${courseId}:ENG-`)))
  const series = new Set(classes.map(c => String(c.seriesId)))
  check('G6 one series per weekly row', series.size === 3, String(series.size))
  check('G7 room recorded on Offline + Online', classes.every(c => c.room === 'Room 1' && c.location === 'Dubai Campus'))
  check('G8 instructor is Haffis', classes.every(c => String(c.instructorId) === String(haffis._id)))
  await sleep(600)   // the per-class student notification would be fire-and-forget
  check('G9 no per-class student notifications', (await NotificationModel.countDocuments({ userId: student._id })) === 0,
    String(await NotificationModel.countDocuments({ userId: student._id })))
  const mails = await EmailOutboxModel.find({ createdAt: { $gte: new Date(Date.now() - 60_000) } }).lean()
  const toHaffis = mails.filter(m => m.to === haffis.email)
  check('G10 ONE summary email to the mentor', toHaffis.length === 1 && (await EmailOutboxModel.countDocuments()) - before === 1,
    toHaffis.map(m => m.subject).join(' | '))
  check('G11 the summary lists the weekly sessions', String(toHaffis[0]?.html ?? '').includes('Every Tuesday') && String(toHaffis[0]?.html ?? '').includes('MBT 1 · English batch'))
}

/* ── H ──────────────────────────────────────────────── */
section('H  importing the same rows again')
{
  const p = await svc.preview(SETTINGS, SMALL, ACTOR, {}, NOW)
  check('H1 preview shows them as already imported', p.rows.every(r => r.occurrences.every(o => o.state === 'exists')) && p.summary.classes === 0)
  let threw = ''
  try { await svc.start(SETTINGS, SMALL, ACTOR, {}) } catch (e) { threw = (e as { code?: string }).code ?? '' }
  check('H2 start refuses — nothing to import', threw === 'NOTHING_TO_IMPORT', threw)
  check('H3 still 12 classes', (await LiveClassModel.countDocuments({ importRef: { $exists: true } })) === 12)
}

/* ── I ──────────────────────────────────────────────── */
section('I  failure + resume (Google Meet rows, stubbed creator)')
{
  const MEET = ROWS.filter(r => ['ENG-004', 'ENG-005'].includes(r.session_id))  // Moiz → Meet, 8 classes
  let calls = 0
  const flaky = async (dto: any, _a: any, seriesId: string, meta: { importJobId: string; importRef: string }) => {
    calls++
    if (calls <= 2) throw new Error('Could not create the Google Meet link.')
    const doc = await LiveClassModel.create({ ...dto, instructorId: dto.instructorId, meetingUrl: 'https://meet.google.com/aaa-bbbb-ccc',
      seriesId, importJobId: meta.importJobId, importRef: meta.importRef, status: 'scheduled' })
    return { live: { id: String(doc._id) } }
  }
  const r = await svc.start(SETTINGS, MEET, ACTOR, {}, 'meet.xlsx', flaky)
  const j1 = await waitDone(r.jobId, ACTOR)
  const s1 = await svc.status(r.jobId, ACTOR)
  check('I1 two failed, six created', s1.failed === 2 && s1.created === 6, JSON.stringify({ c: s1.created, f: s1.failed }))
  check('I2 failures carry the reason', s1.failures.every(f => f.error.includes('Google Meet')))
  check('I3 no summary while classes are missing', !(await ClassImportModel.findById(r.jobId).lean())!.summariesSentAt)
  await svc.resume(r.jobId, ACTOR, flaky)
  await sleep(50); await waitDone(r.jobId, ACTOR)
  const s2 = await svc.status(r.jobId, ACTOR)
  check('I4 resume creates the two missing', s2.created === 8 && s2.failed === 0, JSON.stringify({ c: s2.created, f: s2.failed }))
  check('I5 no duplicates', (await LiveClassModel.countDocuments({ importJobId: new mongoose.Types.ObjectId(r.jobId) })) === 8)
  check('I6 the mentor summary goes once it is complete', (await EmailOutboxModel.countDocuments({ to: moiz.email })) === 1)
  void j1
}

/* ── J ──────────────────────────────────────────────── */
section('J  undo')
{
  const one = await LiveClassModel.findOne({ importJobId: new mongoose.Types.ObjectId(jobId) }).sort({ scheduledStart: 1 })
  await LiveClassModel.updateOne({ _id: one!._id }, { $set: { bookedCount: 1 } })   // a student booked it
  const r = await svc.undo(jobId, ACTOR)
  check('J1 eleven removed, the booked one kept', r.deleted === 11 && r.kept === 1, JSON.stringify(r))
  check('J2 the booked class survives', !!(await LiveClassModel.exists({ _id: one!._id })))
  check('J3 a partly undone import is not marked undone', (await ClassImportModel.findById(jobId).lean())!.status === 'completed')
}

/* ── K ──────────────────────────────────────────────── */
section('K  another academy')
{
  const OTHER = { id: String(otherAd._id), role: 'admin', organizationId: String(blr._id) }
  let code = ''
  try { await svc.preview(SETTINGS, ROWS, OTHER, {}, NOW) } catch (e) { code = (e as { code?: string }).code ?? '' }
  check('K1 cannot import into a Dubai course', code === 'FORBIDDEN', code)
  code = ''
  try { await svc.status(jobId, OTHER) } catch (e) { code = (e as { code?: string }).code ?? '' }
  check('K2 cannot see a Dubai import', code === 'NOT_FOUND', code)
  code = ''
  try { await svc.undo(jobId, OTHER) } catch (e) { code = (e as { code?: string }).code ?? '' }
  check('K3 cannot undo it', code === 'NOT_FOUND', code)
}

/* ── L ──────────────────────────────────────────────── */
section('L  restart')
{
  const j = await ClassImportModel.create({
    createdBy: admin._id, actor: ACTOR, organizationId: dubai._id, courseId,
    settings: { ...SETTINGS }, status: 'running', total: 0, items: [],
  })
  await ClassImportService.markInterruptedOnBoot()
  check('L1 a running import becomes interrupted (resumable)', (await ClassImportModel.findById(j._id).lean())!.status === 'interrupted')
}

/* ── M ──────────────────────────────────────────────── */
section('M  modules')
{
  check('M1 "MBT 1" is not "MBT 10"',
    __test.matchModule('MBT 1', [{ title: 'MBT 10 - Advanced' }, { title: 'MBT 1 - Basics' }])?.title === 'MBT 1 - Basics')
  check('M2 "IM 4" alone names two modules — no guess',
    __test.matchModule('IM 4', [{ title: 'IM 4 - PART 1' }, { title: 'IM 4 - PART 2' }]) === null)

  const mCourse = oid()
  await CourseModel.collection.insertOne({ _id: mCourse, title: 'Forex Modules', slug: 'forex-modules', organizationId: dubai._id, status: 'published', price: 0 })
  const sec = (title: string, order: number) => ({ _id: oid(), courseId: mCourse, title, order, createdAt: new Date(), updatedAt: new Date() })
  const mbt1 = sec('MBT 1 - Basics of Forex', 1), mbt10 = sec('MBT 10 - Advanced', 10)
  const im41 = sec('IM 4 - PART 1', 11), im42 = sec('IM 4 - PART 2', 12), adv1 = sec('ADVANCE 1', 13)
  await SectionModel.collection.insertMany([mbt1, mbt10, im41, im42, adv1])
  /* Her own mentor, so nothing earlier in the suite clashes with these rows. */
  const mira = { _id: oid(), name: 'Mira Mentor', email: 'mira@imp.test', role: 'instructor', organizationId: dubai._id, isActive: true }
  await UserModel.collection.insertOne(mira)
  const MS = { ...SETTINGS, courseId: String(mCourse) }
  const row = (batch: string, num: string, extra: Record<string, string> = {}) =>
    ({ ...toRow(FILE[0]!), session_id: `M-${batch}-${num}`, mentor: 'Mira Mentor', batch, session_number: num, ...extra })
  const one = async (r: Record<string, string>) => (await svc.preview(MS, [r], ACTOR, {}, NOW)).rows[0]!

  let r = await one(row('MBT', '1'))
  check('M3 "MBT 1" goes into "MBT 1 - Basics of Forex"', r.module?.id === String(mbt1._id) && r.moduleFrom === 'name' && r.status !== 'error', JSON.stringify(r.module))
  r = await one(row('IM', '4 (1)'))
  check('M4 "IM 4 (1)" goes into "IM 4 - PART 1"', r.module?.id === String(im41._id), JSON.stringify(r.module))
  r = await one(row('MMC', '1'))
  check('M5 no module named like "MMC 1" — blocked until picked', r.module === null && r.status === 'error' && r.messages.some(m => m.includes('pick one')), r.messages.join(' | '))
  r = await one(row('MMC', '1', { module: String(adv1._id) }))
  check('M6 a pick (the module column) fixes it', r.module?.id === String(adv1._id) && r.moduleFrom === 'sheet' && r.status !== 'error', r.messages.join(' | '))
  r = await one(row('MMC', '1', { module: 'none' }))
  check('M7 "none" means General sessions, on purpose', r.module === null && r.moduleFrom === 'none' && r.status !== 'error', r.messages.join(' | '))
  r = await one(row('MBT', '1', { Module: 'Nonexistent module' }))
  check('M8 a module the course does not have is an error', r.status === 'error' && r.messages.some(m => m.includes('is not a module')), r.messages.join(' | '))
  const p = await svc.preview(MS, [row('MBT', '1')], ACTOR, {}, NOW)
  check('M9 the preview lists the course modules for the picker', p.modules.length === 5 && p.modules[0]!.id === String(mbt1._id), JSON.stringify(p.modules.map(m => m.title)))
  const plain = (await svc.preview(SETTINGS, [ROWS[0]!], ACTOR, {}, NOW)).rows[0]!
  check('M10 a course with no modules imports as before', plain.module === null && plain.moduleFrom === null && plain.status !== 'error', plain.messages.join(' | '))

  const started = await svc.start(MS, [row('MBT', '1')], ACTOR, {}, 'modules.xlsx')
  await waitDone(started.jobId, ACTOR)
  const made = await LiveClassModel.find({ importJobId: new mongoose.Types.ObjectId(started.jobId) }).select('sectionId').lean()
  check('M11 imported classes carry the module', made.length === 4 && made.every(c => String(c.sectionId) === String(mbt1._id)), `${made.length}: ${made.map(c => String(c.sectionId)).join(',')}`)
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\nclassimport.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
