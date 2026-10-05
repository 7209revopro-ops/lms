/* ─────────────────────────────────────────────────────────────
   Department isolation (plan.md §10) — FOREX · DM · AI · JURA.

   A department's sub_admin sees, and acts on, its own department's data only,
   in every admin section; another department's record answers 404 (or the
   403 an older guard already gave); admins see everything; a sub_admin with
   no department reaches nothing.

     A  fail closed — a sub_admin with no department
     B  courses + course roster
     C  users: instructors, students, a student's enrolments, create-user,
        mentor availability
     D  enrolment requests: tabs, per-applicant actions, ID documents
     E  dashboard figures
     F  live classes: list, detail, stream controls, feedback, repeat,
        instructor of another department
     G  instructor attendance (no-shows)
     H  bookings: list, cancel, attendance, bulk attendance, book-for-student
     I  assignments review
     J  support tickets — including a student of two departments
     K  devices
     L  reports
     M  admins are not narrowed

   Boots against an ISOLATED throwaway database, dropped on exit.
   Run: bun run test:departmentisolation
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_departmentisolation_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.WHATSAPP_API_KEY         = ''
process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.GOOGLE_CLIENT_ID       = ''
process.env.GOOGLE_CLIENT_SECRET   = ''
process.env.GOOGLE_REFRESH_TOKEN   = ''
process.env.GOOGLE_MEET_HOST_EMAIL = ''
process.env.CLT_BASE_URL           = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.GOOGLE_CALENDAR_ID = ''
/* Pinned, not inherited from backend/.env: the shared-class checks need the
   guest-cohort arms switched on. */
process.env.CROSS_ORG_CLASSES  = 'true'
/* Bun loads backend/.env first: blank every outside service it may configure,
   so no check here can reach a real finance, ERP, portal, payment or media API. */
for (const k of ['FINANCE_API_URL', 'FINANCE_S2S_SECRET', 'ROOT_ERP_API_URL', 'ROOT_ERP_SECRET',
  'COMMISSION_API_URL', 'COMMISSION_S2S_SECRET', 'CLT_PUBLIC_URL', 'CLT_S2S_SECRET', 'SALES_CRM_SECRET',
  'SMTP_BACKUP_HOST', 'SMTP_BACKUP_USER', 'SMTP_BACKUP_PASS', 'WHATSAPP_WABA_ID', 'MUX_TOKEN_ID', 'MUX_TOKEN_SECRET',
  'STRIPE_SECRET_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'TABBY_SECRET_KEY', 'TABBY_PUBLIC_KEY', 'TAMARA_API_KEY',
  'ABZER_ACCESS_KEY', 'ABZER_SECRET_KEY', 'SENTRY_DSN', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_URL']) {
  process.env[k] = ''
}

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

await import('./financeStandIn.ts')   // approving a student asks finance first; this one knows everybody
const mongoose = (await import('mongoose')).default
const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, EnrollmentModel, LiveClassModel, ClassBookingModel,
  DeviceModel, MentorAvailabilityModel, ClassAssignmentModel, SupportTicketModel, ReviewModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { departmentsNamedBy } = await import('@/utils/departmentScope.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_departmentisolation_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}
const code = (r: { body: any }) => String(r.body?.error?.code ?? '')
const ids  = (arr: any[] | undefined) => new Set((arr ?? []).map((x: any) => String(x?.id ?? x?._id ?? x)))

const PW = 'CorrectHorse1'
const H = 3_600_000

try {
  /* ── departmentsNamedBy — the applicant rule, on real option ids + legacy labels ── */
  section('0  which department an application names')
  check('forex-beginner → Forex', departmentsNamedBy(['forex-beginner']).join() === '4x-trading')
  check('dm-seo → DM', departmentsNamedBy(['dm-seo']).join() === 'digital-marketing')
  check('"AI Trading Automation" → AI, never Forex', departmentsNamedBy(['AI Trading Automation']).join() === 'ai')
  check('"AI & Data Science" (legacy label) → AI', departmentsNamedBy(['AI & Data Science']).join() === 'ai')
  check('"Digital Marketing" (legacy label) → DM', departmentsNamedBy(['Digital Marketing']).join() === 'digital-marketing')
  check('jura-labour-law → JURA', departmentsNamedBy(['jura-labour-law']).join() === 'jura')
  check('two picks → two departments', departmentsNamedBy(['forex-advanced', 'ai-fundamentals']).sort().join() === '4x-trading,ai')

  /* ── Seed ───────────────────────────────────────────── */
  const dubai = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const org = dubai._id
  const hash = await hashPassword(PW)
  const staff = (name: string, role: string, extra: Record<string, unknown> = {}) =>
    UserModel.create({ name, email: `${name.toLowerCase().replace(/\W+/g, '.')}@di.test`, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: org, ...extra })

  const admin    = await staff('Ada Admin', 'admin')
  const fxSub    = await staff('Fx Sub', 'sub_admin', { program: 'forex' })
  const dmSub    = await staff('Dm Sub', 'sub_admin', { program: 'digital_marketing' })
  const aiSub    = await staff('Ai Sub', 'sub_admin', { program: 'ai' })
  const noDept   = await staff('No Dept Sub', 'sub_admin')
  const fxInst   = await staff('Fx Teacher', 'instructor', { category: '4x-trading' })
  const dmInst   = await staff('Dm Teacher', 'instructor', { category: 'digital-marketing' })
  const aiInst   = await staff('Ai Teacher', 'instructor', { category: 'ai' })
  const juraInst = await staff('Jura Teacher', 'instructor', { category: 'jura' })

  const student = (name: string, extra: Record<string, unknown>) => UserModel.create({
    name, email: `${name.toLowerCase().replace(/\W+/g, '.')}@di.test`, passwordHash: hash, role: 'student',
    isActive: true, isVerified: true, organizationId: org, ...extra })
  const fxStu      = await student('Fx Student', { category: '4x-trading', categories: ['4x-trading'], enrollmentStatus: 'approved' })
  const dmStu      = await student('Dm Student', { category: 'digital-marketing', categories: ['digital-marketing'], enrollmentStatus: 'approved' })
  const multiStu   = await student('Both Student', { categories: ['4x-trading', 'digital-marketing'], enrollmentStatus: 'approved' })
  const fxEnrolled = await student('Enrolled Only', { categories: [], enrollmentStatus: 'approved' })
  const fxApp = await student('Fx Applicant', { categories: [], enrollmentStatus: 'pending', enrollmentApplication: { programs: ['forex-beginner'], passportUrl: '/uploads/images/fx-passport.jpg' } })
  const dmApp = await student('Dm Applicant', { categories: [], enrollmentStatus: 'pending', enrollmentApplication: { programs: ['dm-seo'], passportUrl: '/uploads/images/dm-passport.jpg' } })
  await student('Ai Applicant', { categories: [], enrollmentStatus: 'pending', enrollmentApplication: { programs: ['AI & Data Science'] } })
  /* Approved into DM, but the form also ticked a Forex option — the picks are
     history once a student is approved. */
  const dmOnceFx = await student('Dm Once Ticked Fx', { category: 'digital-marketing', categories: ['digital-marketing'], enrollmentStatus: 'approved', enrollmentApplication: { programs: ['dm-seo', 'forex-beginner'], passportUrl: '/uploads/images/dmfx-passport.jpg' } })

  const mkCourse = (title: string, program: string, inst: any) => CourseModel.create({
    title, slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`, description: 'd', instructorId: inst._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: org, program })
  const fxCourse   = await mkCourse('Forex Course', '4x-trading', fxInst)
  const dmCourse   = await mkCourse('DM Course', 'digital-marketing', dmInst)
  const aiCourse   = await mkCourse('AI Course', 'ai', aiInst)
  const juraCourse = await mkCourse('Jura Course', 'jura', juraInst)
  void aiCourse; void juraCourse

  const enrol = (u: any, c: any) => EnrollmentModel.create({ userId: u._id, courseId: c._id, status: 'active', organizationId: org })
  await enrol(fxStu, fxCourse); await enrol(dmStu, dmCourse)
  await enrol(multiStu, fxCourse); await enrol(multiStu, dmCourse)
  await enrol(fxEnrolled, fxCourse)

  const mkClass = (title: string, course: any, inst: any, startOffset: number, extra: Record<string, unknown> = {}) => LiveClassModel.create({
    title, courseId: course._id, instructorId: inst._id, organizationId: org, scheduledStart: new Date(Date.now() + startOffset),
    durationMins: 60, type: 'external', isOnline: false, location: 'Campus', sessionCapacity: 30, language: 'English', ...extra })
  const fxClass   = await mkClass('Forex upcoming', fxCourse, fxInst, 48 * H)
  const dmClass   = await mkClass('DM upcoming', dmCourse, dmInst, 48 * H)
  const fxPast    = await mkClass('Forex earlier', fxCourse, fxInst, -3 * H, { status: 'ended' })
  const dmPast    = await mkClass('DM earlier', dmCourse, dmInst, -3 * H, { status: 'ended' })
  const fxNoShow  = await mkClass('Forex no-show', fxCourse, fxInst, -26 * H, { mentorNoShowAlertSent: true })
  const dmNoShow  = await mkClass('DM no-show', dmCourse, dmInst, -26 * H, { mentorNoShowAlertSent: true })

  const seat = (u: any, c: any) => ClassBookingModel.create({ userId: u._id, liveClassId: c._id, status: 'booked', bookedAt: new Date(Date.now() - 4 * 24 * H) })
  const fxSeat    = await seat(fxStu, fxPast)
  const dmSeat    = await seat(dmStu, dmPast)
  const multiFx   = await seat(multiStu, fxPast)
  void multiFx

  const fxDevice = await DeviceModel.create({ userId: fxStu._id, deviceId: 'fx-device', status: 'pending' })
  const dmDevice = await DeviceModel.create({ userId: dmStu._id, deviceId: 'dm-device', status: 'pending' })
  const dmOnceFxDevice = await DeviceModel.create({ userId: dmOnceFx._id, deviceId: 'dmfx-device', status: 'pending' })
  void fxDevice
  await MentorAvailabilityModel.create({ mentorId: fxInst._id, slots: [] })
  await MentorAvailabilityModel.create({ mentorId: dmInst._id, slots: [] })

  const fxWork = await ClassAssignmentModel.create({ studentId: fxStu._id, liveClassId: fxPast._id, courseId: fxCourse._id, instructorId: fxInst._id, organizationId: org, title: 'Forex homework' })
  const dmWork = await ClassAssignmentModel.create({ studentId: dmStu._id, liveClassId: dmPast._id, courseId: dmCourse._id, instructorId: dmInst._id, organizationId: org, title: 'DM homework' })

  const ticket = (u: any, subject: string, program?: string) => SupportTicketModel.create({
    userId: u._id, subject, category: 'technical', organizationId: org, ...(program ? { program } : {}),
    messages: [{ senderId: u._id, senderRole: 'student', body: 'help', createdAt: new Date() }] })
  const fxTicket    = await ticket(fxStu, 'Forex ticket', '4x-trading')
  const dmTicket    = await ticket(dmStu, 'DM ticket', 'digital-marketing')
  const multiTicket = await ticket(multiStu, 'Two-department ticket')

  await ReviewModel.create({ userId: fxStu._id, courseId: fxCourse._id, rating: 5 })
  await ReviewModel.create({ userId: dmStu._id, courseId: dmCourse._id, rating: 4 })

  const login = async (u: any) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email: u.email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${u.email}: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }
  const FX = await login(fxSub), DM = await login(dmSub), AI = await login(aiSub)
  const NONE = await login(noDept), ADMIN = await login(admin)

  /* ═══════════════════════════════════════════════ */
  section('A  fail closed — a sub_admin with no department')
  {
    const c = await call('GET', '/admin/courses', { jar: NONE })
    check('A1 courses refused with NO_DEPARTMENT', c.status === 403 && code(c) === 'NO_DEPARTMENT', `${c.status} ${code(c)}`)
    const u = await call('GET', '/admin/users?role=student', { jar: NONE })
    check('A2 students refused', u.status === 403 && code(u) === 'NO_DEPARTMENT', `${u.status} ${code(u)}`)
    const s = await call('GET', '/support/admin', { jar: NONE })
    check('A3 support refused', s.status === 403 && code(s) === 'NO_DEPARTMENT', `${s.status} ${code(s)}`)
    const a = await call('GET', '/class-assignments/review', { jar: NONE })
    check('A4 assignment queue is empty, never everything', a.status === 200 && (a.body?.data ?? []).length === 0, `${a.status} ${JSON.stringify(a.body?.data)?.slice(0, 80)}`)
    const me = await call('GET', '/admin/auth/me', { jar: NONE })
    check('A5 they can still load who they are (for the notice)', me.status === 200, String(me.status))
    /* Their own account is no department's: preferences, academy name, own calendar. */
    const prefs = await call('PATCH', '/admin/auth/me/email-preferences', { jar: NONE, body: { masterEnabled: true } })
    const myOrg = await call('GET', '/admin/my-organization', { jar: NONE })
    const myCal = await call('GET', '/admin/availability/me', { jar: NONE })
    const stats = await call('GET', '/admin/stats', { jar: NONE })
    check('A6 …and manage their own account (preferences, academy name, calendar) — while every data route stays refused',
      prefs.status === 200 && myOrg.status === 200 && myCal.status === 200 && stats.status === 403 && code(stats) === 'NO_DEPARTMENT',
      [prefs, myOrg, myCal, stats].map(r => `${r.status} ${code(r)}`).join(' / '))
  }

  /* ═══════════════════════════════════════════════ */
  section('B  courses')
  {
    const r = await call('GET', '/admin/courses', { jar: FX })
    const got = ids(r.body?.data)
    check('B1 Forex sub-admin lists the Forex course only', r.status === 200 && got.size === 1 && got.has(String(fxCourse._id)), JSON.stringify([...got]))
    const own = await call('GET', `/admin/courses/${fxCourse._id}/students`, { jar: FX })
    const roster = JSON.stringify(own.body?.data ?? '')
    check('B2 own roster opens', own.status === 200 && roster.includes('Fx Student') && !roster.includes('Dm Student'), `${own.status}`)
    const other = await call('GET', `/admin/courses/${dmCourse._id}/students`, { jar: FX })
    check('B3 the DM roster answers 404', other.status === 404, `${other.status} ${code(other)}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('C  users')
  {
    const inst = await call('GET', '/admin/users?role=instructor', { jar: FX })
    const instNames = (inst.body?.data ?? []).map((u: any) => u.name)
    check('C1 instructor table: Forex instructors only', inst.status === 200 && instNames.includes('Fx Teacher') && !instNames.some((n: string) => /Dm|Ai|Jura/.test(n)), JSON.stringify(instNames))
    const stu = await call('GET', '/admin/users?role=student', { jar: FX })
    const stuNames = (stu.body?.data ?? []).map((u: any) => u.name)
    check('C2 student table: Forex students (incl. the two-department and enrolled-only ones), no DM student',
      stuNames.includes('Fx Student') && stuNames.includes('Both Student') && stuNames.includes('Enrolled Only') && !stuNames.includes('Dm Student'), JSON.stringify(stuNames))
    const enr = await call('GET', `/admin/users/${multiStu._id}/enrollments`, { jar: FX })
    const titles = JSON.stringify((enr.body?.data ?? []).map((e: any) => e.courseId?.title))
    check('C3 a two-department student shows only the Forex enrolment', enr.status === 200 && titles.includes('Forex Course') && !titles.includes('DM Course'), `${enr.status} ${titles}`)

    const made = await call('POST', '/admin/users', { jar: FX, body: { name: 'New Teacher', email: 'new.teacher@di.test', role: 'instructor', password: 'StrongPass1!', categories: ['digital-marketing'] } })
    const madeDoc = made.body?.data?.id ? await UserModel.findById(made.body.data.id).lean() as any : null
    check('C4 an instructor created by the Forex sub-admin lands in Forex, whatever `categories` says',
      made.status === 201 && madeDoc?.category === '4x-trading' && JSON.stringify(madeDoc?.categories) === '["4x-trading"]', `${made.status} ${JSON.stringify({ c: madeDoc?.category, cs: madeDoc?.categories, e: made.body?.error })}`)
    const sneaky = await call('POST', '/admin/users', { jar: FX, body: { name: 'Sneaky', email: 'sneaky@di.test', role: 'instructor', password: 'StrongPass1!', courses: [{ courseId: String(dmCourse._id), blockedLessons: [] }] } })
    check('C5 …and cannot be enrolled into a DM course on the way', sneaky.status === 403, `${sneaky.status} ${code(sneaky)}`)

    const ownAvail = await call('GET', `/admin/mentors/${fxInst._id}/availability`, { jar: FX })
    const dmAvail  = await call('GET', `/admin/mentors/${dmInst._id}/availability`, { jar: FX })
    const dmPut    = await call('PUT', `/admin/mentors/${dmInst._id}/availability`, { jar: FX, body: { slots: [] } })
    check('C6 mentor availability: own department opens, DM answers 404 to read and write',
      ownAvail.status === 200 && dmAvail.status === 404 && dmPut.status === 404, `${ownAvail.status}/${dmAvail.status}/${dmPut.status}`)

    /* The caller's own record is always theirs. A department head has no
       instructor category, and the live-classes page asks for the head's own
       meetings on every load — the browser pass caught that answering 404. */
    const me = String(fxSub._id)
    const myMeet  = await call('GET', `/admin/mentors/${me}/meetings`, { jar: FX })
    const myAvail = await call('GET', `/admin/mentors/${me}/availability`, { jar: FX })
    const myPut   = await call('PUT', `/admin/mentors/${me}/availability`, { jar: FX, body: { slots: [] } })
    const dmMeet  = await call('GET', `/admin/mentors/${dmInst._id}/meetings`, { jar: FX })
    check('C7 a sub-admin reads and sets their own calendar and meetings; DM teacher meetings answer 404',
      myMeet.status === 200 && myAvail.status === 200 && myPut.status === 200 && dmMeet.status === 404,
      `${myMeet.status}/${myAvail.status}/${myPut.status}/${dmMeet.status}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('D  enrolment requests')
  {
    const pend = async (jar: Jar) => (await call('GET', '/admin/enrollment-requests?status=pending', { jar })).body?.data?.map((u: any) => u.name) ?? []
    const fx = await pend(FX), dm = await pend(DM), ai = await pend(AI)
    check('D1 Forex sees the Forex applicant only', fx.length === 1 && fx[0] === 'Fx Applicant', JSON.stringify(fx))
    check('D2 DM sees the DM applicant only', dm.length === 1 && dm[0] === 'Dm Applicant', JSON.stringify(dm))
    check('D3 AI sees the legacy "AI & Data Science" applicant', ai.length === 1 && ai[0] === 'Ai Applicant', JSON.stringify(ai))
    const all = await call('GET', '/admin/enrollment-requests?status=all', { jar: FX })
    const allNames = JSON.stringify((all.body?.data ?? []).map((u: any) => u.name))
    check('D4 the "all" tab holds no other department\'s applicant', !allNames.includes('Dm Applicant') && !allNames.includes('Ai Applicant'), allNames)

    const fin = await call('GET', `/admin/enrollment-requests/${dmApp._id}/finance-check`, { jar: FX })
    const appr = await call('PATCH', `/admin/enrollment-requests/${dmApp._id}/approve`, { jar: FX, body: {} })
    const docs = await call('PATCH', `/admin/enrollment-requests/${dmApp._id}/docs`, { jar: FX, body: { passportUrl: '/uploads/images/x.jpg' } })
    check('D5 finance-check, approve and docs on a DM applicant all answer 404', fin.status === 404 && appr.status === 404 && docs.status === 404, `${fin.status}/${appr.status}/${docs.status}`)

    const rev = await call('PATCH', `/admin/enrollment-requests/${multiStu._id}/revoke-to-viewer`, { jar: FX })
    const rej = await call('PATCH', `/admin/enrollment-requests/${multiStu._id}/reject`, { jar: FX, body: { reason: 'Testing a two-department revoke' } })
    const still = await UserModel.findById(multiStu._id).lean() as any
    const dmEnrol = await EnrollmentModel.exists({ userId: multiStu._id, courseId: dmCourse._id })
    check('D6 Forex cannot revoke or reject a student DM also has — and DM keeps them',
      rev.status === 403 && rej.status === 403 && still?.enrollmentStatus === 'approved' && !!dmEnrol, `${rev.status}/${rej.status} ${still?.enrollmentStatus} dm=${!!dmEnrol}`)

    const ownDoc = await call('GET', `/documents/${fxApp._id}/passport`, { jar: FX })
    const dmDoc  = await call('GET', `/documents/${dmApp._id}/passport`, { jar: FX })
    check('D7 ID documents: own applicant\'s open, the DM applicant\'s answer 404', ownDoc.status === 200 && dmDoc.status === 404, `${ownDoc.status}/${dmDoc.status}`)

    /* Found by the property campaign: the application arm used to reach
       APPROVED students too, so a DM student who had once ticked Forex stayed
       in the Forex head's "all" tab and device list, ID scans included. */
    const allFx = await call('GET', '/admin/enrollment-requests?status=all', { jar: FX })
    const allDm = await call('GET', '/admin/enrollment-requests?status=all', { jar: DM })
    const devFx = await call('GET', '/admin/devices', { jar: FX })
    const docFx = await call('GET', `/documents/${dmOnceFx._id}/passport`, { jar: FX })
    const docDm = await call('GET', `/documents/${dmOnceFx._id}/passport`, { jar: DM })
    const finFx = await call('GET', `/admin/enrollment-requests/${dmOnceFx._id}/finance-check`, { jar: FX })
    const devAp = await call('PATCH', `/admin/devices/${dmOnceFxDevice._id}/approve`, { jar: FX })
    const inFx = (allFx.body?.data ?? []).some((u: any) => u.name === 'Dm Once Ticked Fx')
    const inDm = (allDm.body?.data ?? []).some((u: any) => u.name === 'Dm Once Ticked Fx')
    const devSeen = ids(devFx.body?.data).has(String(dmOnceFxDevice._id))
    check("D8 an approved DM student who once ticked a Forex option is DM's alone — not in Forex's tabs, devices, documents or actions",
      !inFx && inDm && !devSeen && docFx.status === 404 && docDm.status === 200 && finFx.status === 404 && devAp.status === 404,
      `fxAll=${inFx} dmAll=${inDm} fxDevice=${devSeen} doc ${docFx.status}/${docDm.status} fin=${finFx.status} approve=${devAp.status}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('E  dashboard')
  {
    const fx = await call('GET', '/admin/stats', { jar: FX })
    const d = fx.body?.data ?? {}
    check('E1 Forex figures: 1 course, Forex instructors only, no revenue',
      fx.status === 200 && d.totalCourses === 1 && d.totalInstructors >= 1 && d.revenueEstimate === null, JSON.stringify(d))
    check('E2 reviews counted on Forex courses only', d.totalReviews === 1, String(d.totalReviews))
    const ad = await call('GET', '/admin/stats', { jar: ADMIN })
    check('E3 an admin still gets revenue and every course', typeof ad.body?.data?.revenueEstimate === 'number' && ad.body?.data?.totalCourses === 4, JSON.stringify(ad.body?.data))
    const comp = await call('GET', '/admin/analytics/completion', { jar: FX })
    check('E4 completion counts Forex enrolments only (3)', comp.body?.data?.totalEnrollments === 3, JSON.stringify(comp.body?.data))
    const ser = await call('GET', '/admin/analytics/enrollments?days=7', { jar: FX })
    const sum = (ser.body?.data ?? []).reduce((n: number, x: any) => n + (x.count ?? 0), 0)
    check('E5 the enrolments chart counts Forex enrolments only', sum === 3, String(sum))
  }

  /* ═══════════════════════════════════════════════ */
  section('F  live classes')
  {
    const list = await call('GET', '/admin/live-classes', { jar: FX })
    const got = ids(list.body?.data)
    check('F1 list: Forex classes only', got.has(String(fxClass._id)) && got.has(String(fxPast._id)) && !got.has(String(dmClass._id)) && !got.has(String(dmPast._id)), JSON.stringify([...got]))
    const det = await call('GET', `/admin/live-classes/${dmClass._id}`, { jar: FX })
    check('F2 a DM class detail is refused', det.status === 403 || det.status === 404, `${det.status}`)
    const st  = await call('POST', `/admin/live-classes/${dmClass._id}/start`, { jar: FX })
    const en  = await call('POST', `/admin/live-classes/${dmClass._id}/end`, { jar: FX })
    const rc  = await call('POST', `/admin/live-classes/${dmClass._id}/recreate`, { jar: FX })
    const cr  = await call('GET', `/admin/live-classes/${dmClass._id}/stream-credentials`, { jar: FX })
    const fb  = await call('GET', `/admin/live-classes/${dmPast._id}/feedback`, { jar: FX })
    check('F3 start / end / recreate / stream-credentials / feedback on DM classes all answer 404',
      [st, en, rc, cr, fb].every(r => r.status === 404), [st, en, rc, cr, fb].map(r => r.status).join('/'))
    const before = (await LiveClassModel.findById(dmClass._id).lean() as any)?.seriesId
    const rep = await call('POST', `/admin/live-classes/${dmClass._id}/repeat`, { jar: FX, body: { weeks: 1 } })
    const after = (await LiveClassModel.findById(dmClass._id).lean() as any)?.seriesId
    check('F4 repeat of a DM class answers 404 and writes nothing to it', rep.status === 404 && String(before) === String(after), `${rep.status} ${before} → ${after}`)

    const when = new Date(Date.now() + 72 * H).toISOString()
    const bad = await call('POST', '/admin/live-classes', { jar: FX, body: { courseId: String(fxCourse._id), title: 'Forex with a DM teacher', scheduledStart: when, durationMins: 60, isOnline: false, location: 'Campus', instructorId: String(dmInst._id) } })
    check('F5 a DM instructor cannot be scheduled by the Forex sub-admin', bad.status === 403 && code(bad) === 'INSTRUCTOR_OUTSIDE_DEPARTMENT', `${bad.status} ${code(bad)}`)
    const good = await call('POST', '/admin/live-classes', { jar: FX, body: { courseId: String(fxCourse._id), title: 'Forex with its own teacher', scheduledStart: when, durationMins: 60, isOnline: false, location: 'Campus', instructorId: String(fxInst._id) } })
    check('F6 a Forex instructor can', good.status === 201, `${good.status} ${JSON.stringify(good.body?.error ?? '')}`)
    const swap = await call('PATCH', `/admin/live-classes/${fxClass._id}`, { jar: FX, body: { instructorId: String(dmInst._id) } })
    const same = await call('PATCH', `/admin/live-classes/${fxClass._id}`, { jar: FX, body: { instructorId: String(fxInst._id), title: 'Forex upcoming (renamed)' } })
    check('F7 editing: swapping to a DM instructor is refused; re-saving the same one works', swap.status === 403 && same.status === 200, `${swap.status}/${same.status}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('G  instructor attendance')
  {
    const r = await call('GET', '/admin/live-classes/no-shows', { jar: FX })
    const got = ids(r.body?.data)
    check('G1 no-shows: the Forex one only', r.status === 200 && got.has(String(fxNoShow._id)) && !got.has(String(dmNoShow._id)), JSON.stringify([...got]))
    const ad = await call('GET', '/admin/live-classes/no-shows', { jar: ADMIN })
    check('G2 an admin sees both', ids(ad.body?.data).has(String(dmNoShow._id)) && ids(ad.body?.data).has(String(fxNoShow._id)))
  }

  /* ═══════════════════════════════════════════════ */
  section('H  bookings')
  {
    const r = await call('GET', '/admin/bookings', { jar: FX })
    const blob = JSON.stringify(r.body?.data ?? '')
    check('H1 bookings list: Forex seats only', r.status === 200 && blob.includes('Fx Student') && !blob.includes('Dm Student'), `${r.status}`)
    const cancel = await call('PATCH', `/admin/bookings/${dmSeat._id}/cancel`, { jar: FX, body: {} })
    const att    = await call('PATCH', `/admin/bookings/${dmSeat._id}/attendance`, { jar: FX, body: { status: 'attended' } })
    check('H2 cancel / attendance on a DM seat answer 404', cancel.status === 404 && att.status === 404, `${cancel.status}/${att.status}`)
    const bulk = await call('PATCH', '/admin/bookings/bulk-attendance', { jar: FX, body: { ids: [String(fxSeat._id), String(dmSeat._id)], status: 'attended' } })
    const dmAfter = await ClassBookingModel.findById(dmSeat._id).lean() as any
    const fxAfter = await ClassBookingModel.findById(fxSeat._id).lean() as any
    check('H3 bulk attendance marks the Forex seat and skips the DM one', bulk.status === 200 && fxAfter?.status === 'attended' && dmAfter?.status === 'booked', `${bulk.status} fx=${fxAfter?.status} dm=${dmAfter?.status}`)
    const b1 = await call('POST', '/admin/bookings/book-for-student', { jar: FX, body: { liveClassId: String(dmClass._id), studentId: String(dmStu._id) } })
    const b2 = await call('POST', '/admin/bookings/book-for-student', { jar: FX, body: { liveClassId: String(fxClass._id), studentId: String(dmStu._id) } })
    check('H4 book-for-student: a DM class, or a DM student, answer 404', b1.status === 404 && b2.status === 404, `${b1.status} ${code(b1)} / ${b2.status} ${code(b2)}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('I  assignments')
  {
    const q = await call('GET', '/class-assignments/review', { jar: FX })
    const got = ids(q.body?.data)
    check('I1 review queue: the Forex submission only', q.status === 200 && got.has(String(fxWork._id)) && !got.has(String(dmWork._id)), JSON.stringify([...got]))
    const st = await call('GET', '/class-assignments/review/stats', { jar: FX })
    const names = JSON.stringify((st.body?.data?.instructors ?? []).map((i: any) => i.name))
    check('I2 stats name Forex instructors only', st.status === 200 && names.includes('Fx Teacher') && !names.includes('Dm Teacher'), names)
    const dec = await call('PATCH', `/class-assignments/${dmWork._id}/review`, { jar: FX, body: { decision: 'approved' } })
    const one = await call('GET', `/class-assignments/${dmWork._id}`, { jar: FX })
    check('I3 deciding or opening a DM submission answers 404', dec.status === 404 && one.status === 404, `${dec.status}/${one.status}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('J  support')
  {
    const list = async (jar: Jar) => (await call('GET', '/support/admin', { jar })).body?.data?.map((t: any) => t.subject) ?? []
    const fx = await list(FX), dm = await list(DM), ai = await list(AI)
    check('J1 Forex: its ticket + the two-department student\'s', fx.includes('Forex ticket') && fx.includes('Two-department ticket') && !fx.includes('DM ticket'), JSON.stringify(fx))
    check('J2 DM: its ticket + the two-department student\'s', dm.includes('DM ticket') && dm.includes('Two-department ticket') && !dm.includes('Forex ticket'), JSON.stringify(dm))
    check('J3 AI: none of them', ai.length === 0, JSON.stringify(ai))
    const open  = await call('GET', `/support/${dmTicket._id}`, { jar: FX })
    const close = await call('PATCH', `/support/${dmTicket._id}/status`, { jar: FX, body: { status: 'closed' } })
    const dmT = await SupportTicketModel.findById(dmTicket._id).lean() as any
    check('J4 a DM ticket cannot be opened or closed by Forex', open.status === 403 && close.status === 403 && dmT?.status === 'open', `${open.status}/${close.status} ${dmT?.status}`)
    const multiOpenAi = await call('GET', `/support/${multiTicket._id}`, { jar: AI })
    const multiOpenFx = await call('GET', `/support/${multiTicket._id}`, { jar: FX })
    check('J5 the no-programme ticket opens for Forex (the student\'s department), not for AI', multiOpenFx.status === 200 && multiOpenAi.status === 403, `${multiOpenFx.status}/${multiOpenAi.status}`)
    const perf = await call('GET', '/support/admin/performance', { jar: FX })
    check('J6 performance: the Forex row only', perf.status === 200 && (perf.body?.data ?? []).length === 1 && perf.body?.data?.[0]?.program === '4x-trading', JSON.stringify((perf.body?.data ?? []).map((p: any) => p.program)))
    void fxTicket
  }

  /* ═══════════════════════════════════════════════ */
  section('K  devices')
  {
    const r = await call('GET', '/admin/devices', { jar: FX })
    const owners = JSON.stringify((r.body?.data ?? []).map((d: any) => d.name))
    check('K1 devices: Forex students\' only', r.status === 200 && owners.includes('Fx Student') && !owners.includes('Dm Student'), owners)
    const ap = await call('PATCH', `/admin/devices/${dmDevice._id}/approve`, { jar: FX })
    const rv = await call('PATCH', `/admin/devices/${dmDevice._id}/revoke`, { jar: FX })
    const dev = await DeviceModel.findById(dmDevice._id).lean() as any
    check('K2 approving / revoking a DM student\'s device answers 404 and changes nothing', ap.status === 404 && rv.status === 404 && dev?.status === 'pending', `${ap.status}/${rv.status} ${dev?.status}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('L  reports')
  {
    const att = await call('GET', '/admin/reports/attendance', { jar: FX })
    const blob = JSON.stringify(att.body?.data ?? '')
    check('L1 attendance report: Forex students only', att.status === 200 && blob.includes('Fx Student') && !blob.includes('Dm Student'), `${att.status}`)
    const ms = await call('GET', '/admin/reports/mentor-schedule', { jar: FX })
    const mentors = JSON.stringify((ms.body?.data ?? []).map((m: any) => m.mentor?.name))
    check('L2 mentor schedule: Forex instructors only', ms.status === 200 && mentors.includes('Fx Teacher') && !mentors.includes('Dm Teacher'), mentors)
  }

  /* ═══════════════════════════════════════════════ */
  section('N  found by the code audit and the property campaign')
  {
    /* N1 — stored media is not a department head's to delete. */
    const delFx = await call('DELETE', '/uploads/images/some-dm-thumbnail.jpg', { jar: FX })
    const delNone = await call('DELETE', '/uploads/images/some-dm-thumbnail.jpg', { jar: NONE })
    check('N1 deleting stored media is refused to a department head, and to one with no department',
      delFx.status === 403 && delNone.status === 403, `${delFx.status} ${code(delFx)} / ${delNone.status} ${code(delNone)}`)

    /* N2 — a class shared INTO Dubai through Dubai's DM course belongs to DM,
       even when it is reached through a Bangalore Forex course id. */
    const blrOrg = await OrganizationModel.create({ name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
    const blrFxCourse = await CourseModel.create({ title: 'Bangalore Forex', slug: 'blr-fx-' + Date.now(), description: 'd', instructorId: fxInst._id,
      price: 0, isFree: true, status: 'published', language: 'English', organizationId: blrOrg._id, program: '4x-trading' })
    const shared = await LiveClassModel.create({ title: 'Bangalore class, DM door in Dubai', courseId: blrFxCourse._id, instructorId: dmInst._id,
      organizationId: blrOrg._id, scheduledStart: new Date(Date.now() + 50 * H), durationMins: 60, type: 'external', isOnline: false,
      location: 'Campus', sessionCapacity: 30, language: 'English', hostSeatsLeft: 20, overflowSeatsLeft: 5,
      guestCohorts: [{ organizationId: org, courseId: dmCourse._id, seatFloor: 5, seatsLeft: 5 }] })
    const viaFx = await call('GET', `/admin/courses/${blrFxCourse._id}/live-classes`, { jar: FX })
    const viaDm = await call('GET', `/admin/courses/${dmCourse._id}/live-classes`, { jar: DM })
    check("N2 a course page never lists a shared class whose door into this academy is another department's",
      !ids(viaFx.body?.data).has(String(shared._id)) && ids(viaDm.body?.data).has(String(shared._id)),
      `fx ${viaFx.status} sees=${ids(viaFx.body?.data).has(String(shared._id))} / dm ${viaDm.status} sees=${ids(viaDm.body?.data).has(String(shared._id))}`)

    /* N3 — account-wide actions on a student another department also has
       through a course: Forex by category, enrolled on DM's course by an admin. */
    const sharedStu = await student('Fx Cat Dm Course', { category: '4x-trading', categories: ['4x-trading'], enrollmentStatus: 'approved' })
    await enrol(sharedStu, fxCourse); await enrol(sharedStu, dmCourse)
    const rej = await call('PATCH', `/admin/enrollment-requests/${sharedStu._id}/reject`, { jar: FX, body: { reason: 'Testing a shared reject' } })
    const rev = await call('PATCH', `/admin/enrollment-requests/${sharedStu._id}/revoke-to-viewer`, { jar: FX })
    const rmc = await call('PATCH', `/admin/enrollment-requests/${sharedStu._id}/remove-category`, { jar: FX, body: { category: '4x-trading' } })
    const after = await UserModel.findById(sharedStu._id).lean() as any
    const dmKept = await EnrollmentModel.exists({ userId: sharedStu._id, courseId: dmCourse._id })
    check('N3 reject / revert / remove-last-programme on a student DM teaches are refused — and DM keeps them',
      rej.status === 403 && rev.status === 403 && rmc.status === 403 && after?.enrollmentStatus === 'approved' && !!dmKept,
      `${rej.status}/${rev.status}/${rmc.status} ${after?.enrollmentStatus} dm=${!!dmKept}`)
    const expressStu = await student('Express Shared', { signupType: 'express', categories: ['4x-trading'], category: '4x-trading', enrollmentStatus: 'approved' })
    await enrol(expressStu, dmCourse)
    const blk = await call('PATCH', `/admin/express-members/${expressStu._id}/block`, { jar: FX })
    const stillActive = (await UserModel.findById(expressStu._id).lean() as any)?.isActive
    check('N3b blocking an express member DM also teaches is refused', blk.status === 403 && stillActive === true, `${blk.status} active=${stillActive}`)

    /* N4 — the timetable import works for a department head (its background
       rows used to be refused as "no department"). */
    const start = new Date(Date.now() + 8 * 24 * H).toISOString().slice(0, 10)
    const imp = await call('POST', '/admin/live-classes/import', { jar: FX, body: {
      settings: { courseId: String(fxCourse._id), startDate: start, weeks: 1, capacity: 30, language: 'English', defaultPlatform: 'inapp', location: 'Campus', room: 'Room 1' },
      rows: [{ session_id: 'N-001', day: 'Tuesday', start_time: '1:00 PM', time: '1:00 PM - 3:00 PM', end_time: '3:00 PM', mentor: 'Fx Teacher', batch: 'MBT', session_number: '1', mode: 'Online Only', platform: 'In-app' }],
      fileName: 'dept.xlsx' } })
    let job: any = null
    for (let i = 0; i < 60 && imp.status === 202; i++) {
      const s = await call('GET', `/admin/live-classes/import/${imp.body?.data?.jobId}`, { jar: FX })
      job = s.body?.data
      if (job && !job.running && job.status !== 'running') break
      await new Promise(r => setTimeout(r, 250))
    }
    check('N4 a Forex head imports a Forex timetable row and the class is created', imp.status === 202 && job?.created === 1 && job?.failed === 0,
      `${imp.status} ${code(imp)} created=${job?.created} failed=${job?.failed} ${JSON.stringify(job?.failures ?? '')}`)

    /* N5 — repeat is held to the instructor rule before it writes anything. */
    const staffedByDm = await mkClass('Forex taught by a DM teacher', fxCourse, dmInst, 96 * H)
    const rep = await call('POST', `/admin/live-classes/${staffedByDm._id}/repeat`, { jar: FX, body: { weeks: 1 } })
    const series = (await LiveClassModel.findById(staffedByDm._id).lean() as any)?.seriesId
    check("N5 repeating a class staffed by another department's instructor is refused and writes nothing",
      rep.status === 403 && code(rep) === 'INSTRUCTOR_OUTSIDE_DEPARTMENT' && !series, `${rep.status} ${code(rep)} seriesId=${series}`)

    /* N6 — a legacy record (categories [] beside a category) keeps its other
       department when a head approves them into theirs. */
    const legacy = await student('Legacy Dm', { category: 'digital-marketing', categories: [], enrollmentStatus: 'approved' })
    await enrol(legacy, fxCourse)
    const appr = await call('PATCH', `/admin/enrollment-requests/${legacy._id}/approve`, { jar: FX, body: {} })
    const cats = (await UserModel.findById(legacy._id).lean() as any)?.categories ?? []
    check('N6 approving a legacy DM student into Forex keeps DM', appr.status === 200 && cats.includes('digital-marketing') && cats.includes('4x-trading'),
      `${appr.status} ${code(appr)} ${JSON.stringify(cats)}`)

    /* N7 — the recordings search is text. */
    const rs = await call('GET', '/admin/recordings?search=' + encodeURIComponent('(['), { jar: FX })
    const ra = await call('GET', '/admin/recordings?search=' + encodeURIComponent('(['), { jar: ADMIN })
    check('N7 a search for "([" answers, not 500', rs.status === 200 && ra.status === 200, `${rs.status}/${ra.status}`)

    /* N8 — the import preview says the mentor is busy, not what another
       department's class is called. */
    const previewBody = (start: string) => ({
      settings: { courseId: String(fxCourse._id), startDate: start, weeks: 1, capacity: 30, language: 'English', defaultPlatform: 'inapp' },
      rows: [{ session_id: 'N-008', day: 'Wednesday', start_time: '4:00 PM', time: '4:00 PM - 6:00 PM', end_time: '6:00 PM', mentor: 'Fx Teacher', batch: 'MBT', session_number: '2', mode: 'Online Only', platform: 'In-app' }] })
    const p8start = new Date(Date.now() + 15 * 24 * H).toISOString().slice(0, 10)
    const first = await call('POST', '/admin/live-classes/import/preview', { jar: FX, body: previewBody(p8start) })
    const slot = first.body?.data?.rows?.[0]?.occurrences?.[0]?.startISO
    if (slot) await mkClass('DM secret workshop', dmCourse, fxInst, new Date(slot).getTime() - Date.now())
    const second = await call('POST', '/admin/live-classes/import/preview', { jar: FX, body: previewBody(p8start) })
    const note = String(second.body?.data?.rows?.[0]?.occurrences?.[0]?.note ?? '')
    check('N8 an import clash with another department\'s class names no title',
      !!slot && note.includes('another department') && !note.includes('DM secret workshop'), `${first.status}/${second.status} slot=${slot} note=${note}`)
  }
  /* ═══════════════════════════════════════════════ */
  section('M  admins are not narrowed')
  {
    const lc = await call('GET', '/admin/live-classes', { jar: ADMIN })
    check('M1 admin lists every department\'s classes', ids(lc.body?.data).has(String(dmClass._id)) && ids(lc.body?.data).has(String(fxClass._id)))
    const inst = await call('GET', '/admin/users?role=instructor', { jar: ADMIN })
    const n = (inst.body?.data ?? []).filter((u: any) => / Teacher$/.test(u.name)).length
    check('M2 admin sees all four department instructors (+ the new one)', n >= 5, String(n))
    const sup = await call('GET', '/support/admin', { jar: ADMIN })
    check('M3 admin sees all three tickets', (sup.body?.data ?? []).length === 3, String((sup.body?.data ?? []).length))
    const req = await call('GET', '/admin/enrollment-requests?status=pending', { jar: ADMIN })
    check('M4 admin sees all three applicants', (req.body?.data ?? []).length === 3, String((req.body?.data ?? []).length))
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
console.log(`\ndepartmentisolation.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
