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
     N  --allow-clash: an offline group alongside the same mentor's online class
     O  course per row: a module the chosen course lacks is found in the
        academy's other courses of the programme ("IM 4 (1)", "ADVANCE 4"), or
        named by a course column or a pick; imported classes carry their own
        course and module, so a blocked module now locks them
     P  another programme's admin cannot touch the import
     Q  older imports, drafts, decimals, non-Latin course names, module-less courses

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

/* ── N ──────────────────────────────────────────────── */
section('N  an offline group alongside the same mentor\'s online class (--allow-clash)')
{
  const lena = { _id: oid(), name: 'Lena Clash', email: 'lena@imp.test', role: 'instructor', organizationId: dubai._id, isActive: true }
  await UserModel.collection.insertOne(lena)
  /* Her online class: Tuesday 1–3 PM GST, the first week of SETTINGS. */
  const at = new Date('2026-10-06T09:00:00.000Z')
  await LiveClassModel.collection.insertOne({
    courseId, instructorId: lena._id, title: 'MBT 1 · online', scheduledStart: at, durationMins: 120,
    type: 'external', status: 'scheduled', isOnline: true, organizationId: dubai._id, sessionCapacity: 30, bookedCount: 0,
  })
  const row = { session_id: 'OFF-001', day: 'Tuesday', start_time: '1:00 PM', end_time: '3:00 PM',
    mentor: 'Lena Clash', batch: 'MBT', session_number: '1', mode: 'Offline Only' }
  const one = { ...SETTINGS, weeks: 1 }

  const plain = (await svc.preview(one, [row], ACTOR, {}, NOW)).rows[0]!
  check('N1 by default the clash is skipped', plain.occurrences[0]?.state === 'conflict' && plain.newCount === 0,
    JSON.stringify(plain.occurrences))
  const allowed = (await svc.preview({ ...one, allowMentorClash: true }, [row], ACTOR, {}, NOW)).rows[0]!
  check('N2 with --allow-clash it is kept, and the preview says why',
    allowed.occurrences[0]?.state === 'new' && allowed.occurrences[0]?.note?.startsWith('Alongside') === true && allowed.newCount === 1,
    JSON.stringify(allowed.occurrences))

  const r = await svc.start({ ...one, allowMentorClash: true }, [row], ACTOR, {}, 'offline.xlsx')
  await waitDone(r.jobId, ACTOR)
  const both = await LiveClassModel.countDocuments({ instructorId: lena._id, scheduledStart: at })
  check('N3 the offline class is created next to the online one', both === 2, String(both))
  const made = await LiveClassModel.findOne({ importJobId: new mongoose.Types.ObjectId(r.jobId) }).lean() as any
  check('N4 in person, with a room and no link', made?.isOnline === false && !made?.meetingUrl && made?.room === 'Room 1',
    JSON.stringify({ isOnline: made?.isOnline, meetingUrl: made?.meetingUrl, room: made?.room }))
}

/* ── O ──────────────────────────────────────────────── */
section('O  course per row')
{
  /* The Dubai Forex courses as production names them, plus three that must
     never be looked in: another programme, another academy, an archived course. */
  const course = async (title: string, slug: string, program: string, org: unknown, status = 'published') => {
    const _id = oid()
    await CourseModel.collection.insertOne({ _id, title, slug, program, organizationId: org, status, price: 0 })
    return _id
  }
  const MBT = await course('MARKET BREAK-OUT TRADING PROGRAM', 'mbt-suite', '4x-trading', dubai._id)
  const IM  = await course('DELTA WAVE THEORY TRADING PROGRAMME', 'im-suite', '4x-trading', dubai._id)
  const MMC = await course('MMC (MARKET MAKING CYCLE)', 'mmc-suite', '4x-trading', dubai._id)
  const DM  = await course('Digital Marketing Pro', 'dm-suite', 'digital-marketing', dubai._id)
  const BLR = await course('Bangalore Forex', 'blr-suite', '4x-trading', blr._id)
  const OLD = await course('Old Forex', 'old-suite', '4x-trading', dubai._id, 'archived')
  const mod: Record<string, ReturnType<typeof oid>> = {}
  const sectionsOf = async (courseId: unknown, titles: string[]) => {
    for (const [i, title] of titles.entries()) {
      const _id = oid(); mod[`${String(courseId)}|${title}`] = _id
      await SectionModel.collection.insertOne({ _id, courseId, title, order: i + 1 })
    }
  }
  await sectionsOf(MBT, ['MBT 1 - Basics of Forex', 'MBT 4 - Order Types & Live Trade', 'MBT 10 - Advanced Review'])
  await sectionsOf(IM,  ['IM 1', 'IM 4 - PART 1', 'IM 4 - PART 2'])
  await sectionsOf(MMC, ['ADVANCE 4'])
  await sectionsOf(DM,  ['IM 1'])
  await sectionsOf(BLR, ['MBT 4 - Somewhere Else'])
  await sectionsOf(OLD, ['ADVANCE 9'])
  const M = (c: unknown, title: string) => String(mod[`${String(c)}|${title}`])

  /* One Tuesday, one-hour slots for one mentor, so no two rows overlap. */
  const ROWS_M = [
    ['MOD-1',  'MBT', '4',     { mode: 'Offline + Online' }],
    ['MOD-2',  'IM', '4 (1)',  {}],
    ['MOD-3',  'ADVANCE', '4', {}],
    ['MOD-4',  'MBT', '1',     {}],
    ['MOD-5',  'IM', '4',      {}],
    ['MOD-6',  'MBT', '9',     {}],
    ['MOD-7',  'MBT', '4',     { module: 'MBT 1' }],
    ['MOD-8',  'Session', '8', { module: 'IM 7' }],
    ['MOD-9',  'X', '1',       { course: 'MMC', module: 'none' }],
    ['MOD-10', 'IM', '1',      {}],
    ['MOD-11', 'MBT', '4',     { course: 'Nonexistent Course' }],
    ['MOD-12', 'ADVANCE', '9', {}],
    ['MOD-13', 'MBT', '4',     { course: 'Delta Wave' }],
    ['MOD-14', 'IM', '1',      { module: M(DM, 'IM 1') }],
  ].map(([id, batch, num, extra], i) => ({
    session_id: id as string, day: 'Tuesday', start_time: `${8 + i}:00`, end_time: `${9 + i}:00`,
    mentor: 'Haffis', batch: batch as string, session_number: num as string, mode: 'Online Only',
    ...(extra as Record<string, string>),
  }))
  const MSET = { ...SETTINGS, courseId: String(MBT), startDate: '2026-12-01', weeks: 1, room: 'Room No. 1' }
  const row = (p: Awaited<ReturnType<typeof svc.preview>>, id: string) => p.rows.find(r => r.sessionId === id)!
  const say = (r: { status: string; messages: string[]; course: { title: string }; module: unknown }) =>
    JSON.stringify({ s: r.status, c: r.course.title, m: r.module, msg: r.messages })

  const p = await svc.preview(MSET, ROWS_M, ACTOR, {}, NOW)
  const r1 = row(p, 'MOD-1'), r2 = row(p, 'MOD-2'), r3 = row(p, 'MOD-3'), r4 = row(p, 'MOD-4')
  check('O1 "MBT 4" → MBT 4 - Order Types & Live Trade, in the chosen MBT course',
    r1.module?.id === M(MBT, 'MBT 4 - Order Types & Live Trade') && r1.course.id === String(MBT) && r1.moduleFrom === 'name' && r1.status === 'ready', say(r1))
  check('O2 "IM 4 (1)", which the MBT course lacks → IM 4 - PART 1, in the IM course',
    r2.module?.id === M(IM, 'IM 4 - PART 1') && r2.course.id === String(IM) && r2.moduleFrom === 'name' && r2.status === 'ready', say(r2))
  check('O3 "ADVANCE 4" → ADVANCE 4, in MMC', r3.module?.id === M(MMC, 'ADVANCE 4') && r3.course.id === String(MMC), say(r3))
  check('O4 "MBT 1" is MBT 1 - Basics of Forex, never MBT 10', r4.module?.id === M(MBT, 'MBT 1 - Basics of Forex'), say(r4))
  const r5 = row(p, 'MOD-5')
  check('O5 "IM 4" names two modules of another course — blocked until picked, both named',
    r5.module === null && r5.status === 'error' && r5.messages.some(m => m.includes('IM 4 - PART 1') && m.includes('IM 4 - PART 2') && m.includes('pick one')), say(r5))
  const r6 = row(p, 'MOD-6')
  check('O6 no course of the programme has "MBT 9" — blocked until picked',
    r6.module === null && r6.status === 'error' && r6.messages.some(m => m.includes('"MBT 9"') && m.includes('pick one')), say(r6))
  const r7 = row(p, 'MOD-7')
  check('O7 a module column wins over the session code', r7.module?.id === M(MBT, 'MBT 1 - Basics of Forex') && r7.moduleFrom === 'sheet', say(r7))
  const r8 = row(p, 'MOD-8')
  check('O8 a module no course of the programme has blocks the row', r8.status === 'error' && r8.messages.some(m => m.includes('"IM 7" is not a module')), say(r8))
  const r9 = row(p, 'MOD-9')
  check('O9 course column + module "none": that course, no module, ready',
    r9.course.id === String(MMC) && r9.module === null && r9.moduleFrom === 'none' && r9.status === 'ready', say(r9))
  const r10 = row(p, 'MOD-10')
  check('O10 "IM 1" is the Forex IM course — never another programme\'s namesake', r10.module?.id === M(IM, 'IM 1'), say(r10))
  const titles = p.courses.map(c => c.title)
  check('O11 only this academy\'s live courses of the programme are offered, chosen one first',
    titles[0] === 'MARKET BREAK-OUT TRADING PROGRAM' && titles.length === 3 && !titles.includes('Digital Marketing Pro') && !titles.includes('Bangalore Forex') && !titles.includes('Old Forex'),
    titles.join(' | '))
  const r11 = row(p, 'MOD-11')
  check('O12 an unknown course blocks the row', r11.status === 'error' && r11.messages.some(m => m.includes('No course "Nonexistent Course"')), say(r11))
  const r12 = row(p, 'MOD-12')
  check('O13 an archived course is not looked in', r12.module === null && r12.status === 'error', say(r12))
  const r13 = row(p, 'MOD-13')
  check('O14 a course column narrows the lookup to that one course',
    r13.course.id === String(IM) && r13.status === 'error' && r13.messages.some(m => m.includes('DELTA WAVE THEORY TRADING PROGRAMME') && m.includes('"MBT 4"')), say(r13))
  const r14 = row(p, 'MOD-14')
  check('O15 a module id from another programme is refused, never followed',
    r14.module === null && r14.status === 'error' && r14.messages.some(m => m.includes('is not a module')), say(r14))
  check('O16 7 classes over 3 courses', p.summary.classes === 7 && p.summary.courses === 3, JSON.stringify(p.summary))
  check('O17 `modules` is still the chosen course\'s own, in order',
    p.modules.length === 3 && p.modules[0]!.id === M(MBT, 'MBT 1 - Basics of Forex') && p.courses[0]!.modules.length === 3, JSON.stringify(p.modules))

  /* A pick in the preview fills the row's module cell — with the module's id. */
  const picked = ROWS_M.map(r => r.session_id === 'MOD-5' ? { ...r, module: M(IM, 'IM 4 - PART 2') }
                               : r.session_id === 'MOD-6' ? { ...r, module: 'none' } : r)
  const q = await svc.preview(MSET, picked, ACTOR, {}, NOW)
  const q5 = row(q, 'MOD-5'), q6 = row(q, 'MOD-6')
  check('O18 picking another course\'s module fixes the row — and moves it to that course',
    q5.module?.id === M(IM, 'IM 4 - PART 2') && q5.course.id === String(IM) && q5.moduleFrom === 'sheet' && q5.status === 'ready', say(q5))
  check('O19 "No module" keeps the row in the chosen course, on purpose',
    q6.course.id === String(MBT) && q6.module === null && q6.moduleFrom === 'none' && q6.status === 'ready', say(q6))

  /* Through the real create path. */
  const before = await EmailOutboxModel.countDocuments({ to: haffis.email })
  const started = await svc.start(MSET, ROWS_M, ACTOR, {}, 'modules.xlsx')
  check('O20 the seven good rows are planned', started.total === 7, String(started.total))
  const job = await waitDone(started.jobId, ACTOR)
  check('O21 import completed', job.status === 'completed' && job.items.every(i => i.status === 'created'), JSON.stringify(job.items.map(i => i.status)))
  const made = await LiveClassModel.find({ importJobId: new mongoose.Types.ObjectId(started.jobId) }).lean()
  const byKey = (k: string) => made.find(c => String(c.importRef).includes(`:${k}:`))!
  const c2 = byKey('MOD-2'), c9 = byKey('MOD-9'), c1 = byKey('MOD-1')
  check('O22 a class carries its row\'s course and module',
    String(c2.courseId) === String(IM) && String(c2.sectionId) === M(IM, 'IM 4 - PART 1')
      && String(c1.courseId) === String(MBT) && String(c1.sectionId) === M(MBT, 'MBT 4 - Order Types & Live Trade'),
    JSON.stringify({ c2: [String(c2.courseId), String(c2.sectionId)] }))
  check('O23 "none" on purpose: that course, no module', String(c9.courseId) === String(MMC) && !c9.sectionId)
  check('O24 import refs are keyed by the row\'s course', made.every(c => String(c.importRef).startsWith(`${String(c.courseId)}:MOD-`)))
  const stored = await ClassImportModel.findById(started.jobId).lean()
  check('O25 the job records every course it touched', (stored!.courseIds ?? []).length === 3)
  const listed = (await svc.list(ACTOR)).find(j => j.id === started.jobId)
  check('O26 recent imports say it spans 3 courses', listed?.courses === 3, String(listed?.courses))

  const mail = await EmailOutboxModel.findOne({ to: haffis.email }).sort({ createdAt: -1 }).lean()
  const html = String(mail?.html ?? '')
  check('O27 one more summary for the mentor', (await EmailOutboxModel.countDocuments({ to: haffis.email })) === before + 1)
  check('O28 the summary names each class\'s module', html.includes('Module: IM 4 - PART 1') && html.includes('Module: ADVANCE 4'))
  check('O29 …and its course, since they span several', html.includes('DELTA WAVE THEORY TRADING PROGRAMME') && !String(mail?.subject ?? '').includes('MARKET BREAK-OUT'))
  check('O30 "Room No. 1" is not printed as "Room Room No. 1"', html.includes('Room No. 1') && !html.includes('Room Room'))

  const again = await svc.preview(MSET, ROWS_M, ACTOR, {}, NOW)
  check('O31 importing it again finds everything already imported',
    again.rows.filter(r => r.status !== 'error').every(r => r.occurrences.every(o => o.state === 'exists')) && again.summary.classes === 0)

  /* The point of it all: a blocked module now locks the imported class. */
  const { resolveClassEntitlement } = await import('@/services/classEntitlement.service.ts')
  await EnrollmentModel.collection.insertOne({
    userId: student._id, courseId: MBT, status: 'active', organizationId: dubai._id,
    blockedLessons: [new mongoose.Types.ObjectId(M(MBT, 'MBT 4 - Order Types & Live Trade'))],
  })
  const locked = await resolveClassEntitlement(c1, String(student._id), String(dubai._id), 'active')
  const open   = await resolveClassEntitlement(byKey('MOD-4'), String(student._id), String(dubai._id), 'active')
  check('O32 a student blocked from MBT 4 cannot book the imported MBT 4 class', !locked.ok && locked.code === 'MODULE_BLOCKED', JSON.stringify(locked))
  check('O33 …but can book the imported MBT 1 class', open.ok, JSON.stringify(open))

  /* ── P: the programme wall on a job, not just on the preview ── */
  section('P  another programme\'s admin cannot touch a Forex import')
  const DM_ADMIN = { id: String(admin._id), role: 'sub_admin', organizationId: String(dubai._id), categoryScope: 'digital-marketing' }
  const FX_ADMIN = { ...DM_ADMIN, categoryScope: '4x-trading' }
  const codeOf = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e) { return (e as { code?: string }).code ?? 'threw' } }
  check('P1 cannot read its status', await codeOf(svc.status(started.jobId, DM_ADMIN)) === 'NOT_FOUND')
  check('P2 cannot undo it', await codeOf(svc.undo(started.jobId, DM_ADMIN)) === 'NOT_FOUND')
  check('P3 cannot resume it', await codeOf(svc.resume(started.jobId, DM_ADMIN)) === 'NOT_FOUND')
  check('P4 does not see it in Recent imports', !(await svc.list(DM_ADMIN)).some(j => j.id === started.jobId))
  check('P5 the Forex sub-admin still can', await codeOf(svc.status(started.jobId, FX_ADMIN)) === 'ok'
    && (await svc.list(FX_ADMIN)).some(j => j.id === started.jobId))
  check('P6 and the classes are all still there', (await LiveClassModel.countDocuments({ importJobId: new mongoose.Types.ObjectId(started.jobId) })) === 7)

  /* ── Q: edges a real catalogue has ── */
  section('Q  older imports, drafts, decimals, non-Latin names, module-less courses')
  /* A file imported BEFORE rows had their own course: its "IM 1" row went into
     the chosen course, keyed by it. Re-importing it now must not make it twice. */
  const LEG = { session_id: 'LEG-1', day: 'Wednesday', start_time: '9:00', end_time: '10:00', mentor: 'Moiz', batch: 'IM', session_number: '1', mode: 'Online Only' }
  await LiveClassModel.collection.insertOne({
    title: 'IM 1 · old import', courseId: MBT, instructorId: moiz._id, organizationId: dubai._id, type: 'external', isOnline: true,
    status: 'cancelled', scheduledStart: new Date('2026-12-02T05:00:00Z'), durationMins: 60, importRef: `${String(MBT)}:LEG-1:2026-12-02`,
  })
  const leg = await svc.preview(MSET, [LEG], ACTOR, {}, NOW)
  check('Q1 a class from an older import of the same row still counts as imported', leg.rows[0]!.course.id === String(IM)
    && leg.rows[0]!.occurrences[0]!.state === 'exists', JSON.stringify(leg.rows[0]!.occurrences))
  const draft = await course('Forex Draft Copy', 'draft-suite', '4x-trading', dubai._id, 'draft')
  await sectionsOf(draft, ['ADVANCE 7'])
  const dr = await svc.preview(MSET, [{ ...LEG, session_id: 'DR-1', batch: 'ADVANCE', session_number: '7' }], ACTOR, {}, NOW)
  check('Q2 a draft course is never a silent target', dr.rows[0]!.module === null && dr.rows[0]!.status === 'error', say(dr.rows[0]!))
  await sectionsOf(MBT, ['MBT 1.5 - Bonus Session'])
  const dec = await svc.preview(MSET, [
    { ...LEG, session_id: 'DEC-1', batch: 'MBT', session_number: '1' },
    { ...LEG, session_id: 'DEC-2', batch: 'MBT', session_number: '1.5', start_time: '11:00', end_time: '12:00' },
  ], ACTOR, {}, NOW)
  check('Q3 "MBT 1" is not made ambiguous by "MBT 1.5"', dec.rows[0]!.module?.title === 'MBT 1 - Basics of Forex', say(dec.rows[0]!))
  check('Q4 "MBT 1.5" finds its own module', dec.rows[1]!.module?.title === 'MBT 1.5 - Bonus Session', say(dec.rows[1]!))
  const na = await svc.preview(MSET, [{ ...LEG, session_id: 'NA-1', course: 'دورة الفوركس' }], ACTOR, {}, NOW)
  check('Q5 a course name in letters the matcher cannot read matches nothing — never everything', na.rows[0]!.status === 'error'
    && na.rows[0]!.messages.some(m => m.includes('No course')), say(na.rows[0]!))
  /* A chosen course with no modules imports as it always did — its rows are
     not routed away on their codes. Only a row that names its module goes
     where that module is. */
  const plainFx = await course('Forex Webinars', 'webinars-suite', '4x-trading', dubai._id)
  const PW = { ...MSET, courseId: String(plainFx) }
  const pw = await svc.preview(PW, [{ ...LEG, session_id: 'PW-1', batch: 'MBT', session_number: '4' }], ACTOR, {}, NOW)
  check('Q6 a chosen course with no modules keeps its rows', pw.rows[0]!.course.id === String(plainFx)
    && pw.rows[0]!.module === null && pw.rows[0]!.moduleFrom === null && pw.rows[0]!.status === 'ready', say(pw.rows[0]!))
  const pw2 = await svc.preview(PW, [{ ...LEG, session_id: 'PW-2', batch: 'MBT', session_number: '4', module: 'MBT 4' }], ACTOR, {}, NOW)
  check('Q7 …unless the row names its module', pw2.rows[0]!.course.id === String(MBT)
    && pw2.rows[0]!.module?.id === M(MBT, 'MBT 4 - Order Types & Live Trade') && pw2.rows[0]!.moduleFrom === 'sheet', say(pw2.rows[0]!))
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
