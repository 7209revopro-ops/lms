/* ─────────────────────────────────────────────────────────────
   Instructor mismatch — "admin created a class with instructor A, but the
   client shows instructor B for the same section."

   The client class-bookings page groups sessions by title alone and labels the
   whole group with slots[0].instructor (the EARLIEST session's instructor).
   Two same-title sessions with different instructors therefore both show the
   first one's name.

   This suite pins the ground truth in two independent layers:

     BACKEND  GET /live-classes returns, for EACH session, its OWN instructor
              (populated { id, name }). The payload is per-class correct — so a
              correct client can always show the right name. If this ever fails,
              the bug is (also) a backend populate gap, not just display.

     CLIENT   The exact client grouping logic is ported here as a pure function.
              groupBuggy() reproduces the defect (later session shows the first
              session's instructor). groupFixed() is what the fix must satisfy:
              every session keeps its own instructor. Guards the fix against
              regression at the logic level, next to the browser check.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_instructormismatch_suite), dropped on exit.

   Run: bun src/tests/instructormismatch.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_instructormismatch_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_LOG_DIR = '.logs/emails-instructormismatch'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''

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
  UserModel, OrganizationModel, CourseModel, SectionModel, LiveClassModel,
  EnrollmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_instructormismatch_suite') {
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
  return { status: res.status, body: parsed }
}

const PW  = 'Mismatch1234'
const MIN = 60_000
const code = (r: any) => String(r.body?.error?.code ?? '')

/* ── Client grouping, ported from
   client/src/app/(dashboard)/class-bookings/page.tsx (allGroups useMemo). ── */
type Slot = {
  id: string; title: string; scheduledStart: string
  instructor: { id: string; name: string } | null
  courseId?: string; sectionId?: string | { id: string; title: string }
}
type Group = { id: string; title: string; instructor: Slot['instructor']; slots: Slot[] }

/* BEFORE the fix: bucket by title alone, group instructor = earliest slot. */
function groupBuggy(classes: Slot[]): Group[] {
  const map = new Map<string, Slot[]>()
  classes.forEach(lc => { const k = lc.title.trim(); if (!map.has(k)) map.set(k, []); map.get(k)!.push(lc) })
  const res: Group[] = []
  map.forEach((slots, title) => {
    slots.sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
    res.push({ id: title, title, instructor: slots[0]!.instructor ?? null, slots })   // <-- defect: one instructor for the whole title-group
  })
  return res
}
/* AFTER the fix: composite id [title|instructor|course|section]; display title
   stays clean (slots[0].title.trim()), instructor still from slots[0] but the
   bucket is now homogeneous so that is correct for every slot. */
const secKey = (lc: Slot) => { const s = lc.sectionId; return typeof s === 'object' && s ? s.id : s ?? '' }
function groupFixed(classes: Slot[]): Group[] {
  const map = new Map<string, Slot[]>()
  classes.forEach(lc => {
    const k = [lc.title.trim(), lc.instructor?.id ?? '', lc.courseId ?? '', secKey(lc)].join('|')
    if (!map.has(k)) map.set(k, []); map.get(k)!.push(lc)
  })
  const res: Group[] = []
  map.forEach((slots, id) => {
    slots.sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
    res.push({ id, title: slots[0]!.title.trim(), instructor: slots[0]!.instructor ?? null, slots })
  })
  return res
}

try {

const org = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const hash = await hashPassword(PW)

const mk = (email: string, role: string, extra: Record<string, unknown> = {}) =>
  UserModel.create({
    name: email.split('@')[0], email, passwordHash: hash, role,
    isActive: true, isVerified: true, organizationId: org._id, ...extra,
  })

const alice   = await mk('alice@im.local', 'instructor', { name: 'Alice Anderson' })
const bob     = await mk('bob@im.local',   'instructor', { name: 'Bob Brown' })
const student = await mk('stud@im.local',  'student',    { enrollmentStatus: 'approved' })

const course = await CourseModel.create({
  title: 'Forex', slug: 'forex-im', description: 'd', instructorId: alice._id,
  price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
})
await SectionModel.create({ courseId: course._id, title: 'Module 1', order: 1 })
await EnrollmentModel.create({ userId: student._id, courseId: course._id, status: 'active', blockedLessons: [] })

const TITLE = 'Market Breakout'
const mkClass = (instructorId: any, startsInMs: number) =>
  LiveClassModel.create({
    title: TITLE, courseId: course._id, instructorId,
    organizationId: org._id, scheduledStart: new Date(Date.now() + startsInMs),
    durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
    language: 'English', sessionCapacity: 30, bookedCount: 0,
    meetingUrl: 'https://meet.google.com/im-test', googleMeetCode: 'im-test',
  })

/* Bob's session is EARLIER, so it sorts first inside the title-group — this is
   the case that makes Alice's later session display "Bob Brown". */
const bobClass   = await mkClass(bob._id,   1 * MIN)   // sorts first
const aliceClass = await mkClass(alice._id, 2 * MIN)   // the one the admin "just created" with Alice

async function login(email: string): Promise<Jar> {
  const jar: Jar = new Map()
  const r = await call('POST', '/auth/login', jar, { email, password: PW })
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${code(r)}`)
  return jar
}

const studentJar = await login('stud@im.local')

/* ═══════════ BACKEND — the payload is per-class correct ═══════════ */
section('BACKEND — GET /live-classes carries each session\'s OWN instructor')
const list = await call('GET', '/live-classes', studentJar)
check('L1 request ok', list.status === 200, `${list.status} ${code(list)}`)
const rows: any[] = Array.isArray(list.body?.data) ? list.body.data : []
const rowBob   = rows.find(r => String(r.id) === String(bobClass._id))
const rowAlice = rows.find(r => String(r.id) === String(aliceClass._id))

check('L2 both same-title sessions are returned (not collapsed by the API)', !!rowBob && !!rowAlice,
  `bob=${!!rowBob} alice=${!!rowAlice} total=${rows.length}`)

/* The instructor may arrive as a populated instructorId object or as a DTO
   `instructor` field — accept either, mirroring client normalizeLiveClass
   (liveClasses.ts:159-163), which resolves id as `obj.id ?? String(obj._id)`.
   Reproducing that _id fallback matters: the shipped fix keys the group on
   lc.instructor.id, and a lean populated doc exposes _id, not id. */
const instrOf = (r: any): { id: string; name: string } | null => {
  if (!r) return null
  const o = (r.instructor && typeof r.instructor === 'object') ? r.instructor
          : (r.instructorId && typeof r.instructorId === 'object') ? r.instructorId
          : null
  if (!o) return null
  return { id: o.id ?? String(o._id ?? ''), name: o.name ?? '' }
}
const iBob   = instrOf(rowBob)
const iAlice = instrOf(rowAlice)

check('L3 Bob\'s session carries an instructor object', !!iBob && !!iBob.name,
  `instructor=${JSON.stringify(iBob)} rawInstructorId=${JSON.stringify(rowBob?.instructorId)}`)
check('L4 Alice\'s session carries an instructor object', !!iAlice && !!iAlice.name,
  `instructor=${JSON.stringify(iAlice)} rawInstructorId=${JSON.stringify(rowAlice?.instructorId)}`)
check('L5 Bob\'s session instructor is Bob (not Alice)', iBob?.name === 'Bob Brown', JSON.stringify(iBob))
check('L6 Alice\'s session instructor is Alice (not Bob)', iAlice?.name === 'Alice Anderson', JSON.stringify(iAlice))
check('L7 the two sessions have DIFFERENT instructors in the payload', !!iBob && !!iAlice && iBob.name !== iAlice.name,
  `${iBob?.name} vs ${iAlice?.name}`)

/* ═══════════ CLIENT — the grouping defect, at the logic level ═══════════ */
section('CLIENT (before) — group-by-title + slots[0].instructor mislabels the later session')
const secOf = (r: any): Slot['sectionId'] =>
  r?.sectionId && typeof r.sectionId === 'object' ? { id: String(r.sectionId.id), title: r.sectionId.title }
  : (r?.sectionId ? String(r.sectionId) : undefined)
const slots: Slot[] = rows
  .filter(r => r.title === TITLE)
  .map(r => ({
    id: String(r.id), title: r.title, scheduledStart: r.scheduledStart, instructor: instrOf(r) as any,
    courseId: r.course?.id ?? (typeof r.courseId === 'string' ? r.courseId : undefined), sectionId: secOf(r),
  }))

const buggy = groupBuggy(slots)
check('C1 the two sessions collapse into ONE title-group', buggy.length === 1, `groups=${buggy.length}`)
const grpInstr = buggy[0]?.instructor?.name
check('C2 BUG REPRODUCED — the group shows only the earliest session\'s instructor (Bob)',
  grpInstr === 'Bob Brown', `group instructor=${grpInstr}`)
check('C3 …so Alice\'s session is displayed under the wrong name (Bob), though its own data says Alice',
  grpInstr !== 'Alice Anderson' && iAlice?.name === 'Alice Anderson',
  `shown=${grpInstr} actual=${iAlice?.name}`)

/* ═══════════ CLIENT (after) — the shipped composite-key fix ═══════════ */
section('CLIENT (after) — composite id splits instructors, each shows its OWN name, title stays clean')
const fixed = groupFixed(slots)
check('F1 the two different-instructor sessions no longer collapse — two groups', fixed.length === 2, `groups=${fixed.length}`)
const gAlice = fixed.find(g => g.slots.some(s => s.id === String(aliceClass._id)))
const gBob   = fixed.find(g => g.slots.some(s => s.id === String(bobClass._id)))
check('F2 Alice\'s session is in a group labeled Alice', gAlice?.instructor?.name === 'Alice Anderson', `${gAlice?.instructor?.name}`)
check('F3 Bob\'s session is in a group labeled Bob', gBob?.instructor?.name === 'Bob Brown', `${gBob?.instructor?.name}`)
check('F4 the group DISPLAY title stays clean (not the composite key)',
  gAlice?.title === TITLE && gBob?.title === TITLE, `alice='${gAlice?.title}' bob='${gBob?.title}'`)
check('F5 the composite group id is NOT rendered as the title (defends the title regression the review caught)',
  !!gAlice && gAlice.id !== gAlice.title && gAlice.id.includes('|'), `id='${gAlice?.id}'`)

/* ═══════════ CLIENT (after) — genuine weekly repeat still merges ═══════════ */
section('CLIENT (after) — a real weekly repeat (same title+instructor+course+section) still merges into one card')
const repeat: Slot[] = [
  { id: 'r1', title: TITLE, scheduledStart: new Date(Date.now() + 3 * MIN).toISOString(), instructor: { id: 'aid', name: 'Alice Anderson' }, courseId: 'c1', sectionId: 's1' },
  { id: 'r2', title: TITLE, scheduledStart: new Date(Date.now() + 4 * 24 * 60 * MIN).toISOString(), instructor: { id: 'aid', name: 'Alice Anderson' }, courseId: 'c1', sectionId: 's1' },
]
const rGroups = groupFixed(repeat)
check('F6 identical title+instructor+course+section merge into ONE group with both slots',
  rGroups.length === 1 && rGroups[0]!.slots.length === 2, `groups=${rGroups.length} slots=${rGroups[0]?.slots.length}`)

} catch (err) {
  fail++
  lines.push(`\n  FATAL  ${(err as Error).stack ?? String(err)}`)
} finally {
  console.log(lines.join('\n'))
  console.log(`\ninstructormismatch.suite — ${pass} passed, ${fail} failed`)
  await mongoose.connection.dropDatabase().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}
