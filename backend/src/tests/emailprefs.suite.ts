/* ─────────────────────────────────────────────────────────────
   Staff email-notification preferences.

   Admin-side users (super_admin, admin, sub_admin, support, instructor) can
   silence the mail the platform sends them — wholesale or per category —
   from Settings. The model is OPT-OUT: an absent preference means "send", so
   existing accounts are untouched and nothing needs backfilling. The single
   exception is role-aware: sub_admin and support were never recipients of the
   two admin alerts, so for those they opt IN instead of being subscribed on
   deploy.

     A  the decision helper, over every role × category × explicit × master
     B  PATCH /admin/auth/me/email-preferences — auth, merge, validation,
        isolation — and GET /admin/auth/me exposing the result
     C  new-signup alerts honour the preference, and the DUAL-USE sender is
        not gated: a student's own verification mail must still arrive
     D  the instructor 15-min reminder honours the preference, and an opted-out
        class is still marked handled so the job stops reconsidering it

   Boots the REAL Express app against an ISOLATED throwaway database.
   Run: bun src/tests/emailprefs.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_emailprefs_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.CLIENT_URL   = 'http://client.test'
process.env.ADMIN_URL    = 'http://admin.test'
process.env.EMAIL_LOG_DIR = '.logs/emails-emailprefs'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.RATE_LIMIT_AUTH_MAX = '2000'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID = ''
process.env.R2_ACCESS_KEY_ID = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL = ''

export {}

import { readdir, rm } from 'fs/promises'

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
const { UserModel, OrganizationModel, CourseModel, LiveClassModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { wantsStaffEmail, defaultWants, STAFF_EMAIL_CATEGORIES } = await import('@/utils/emailPrefs.ts')
const { runInstructor15MinReminders } = await import('@/jobs/reminders.job.ts')

const MAILDIR = process.env.EMAIL_LOG_DIR!
await rm(MAILDIR, { recursive: true, force: true }).catch(() => {})

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_emailprefs_suite') {
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
  const text = await res.text(); let b: any = text; try { b = JSON.parse(text) } catch {}
  return { status: res.status, body: b, code: String(b?.error?.code ?? '') }
}

const settle = (ms = 450) => new Promise(r => setTimeout(r, ms))
/* Several notification paths are fire-and-forget, so always settle before
   counting — that makes a "no mail" assertion as deterministic as a positive. */
async function mailsTo(email: string, sinceMs: number): Promise<number> {
  let files: string[] = []
  try { files = await readdir(MAILDIR) } catch { return 0 }
  const safe = email.replace(/[^a-z0-9@._-]/gi, '_')
  return files.filter(f => f.includes(safe) && Number(f.split('-')[0]) >= sinceMs).length
}

const PW = 'Passw0rd!'
try {

const org = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const hash = await hashPassword(PW)
const mk = (email: string, role: string, extra: Record<string, unknown> = {}) =>
  UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: org._id, ...extra })

const superAdmin = await mk('super@ep.test',  'super_admin')
const admin      = await mk('admin@ep.test',  'admin')
const subAdmin   = await mk('sub@ep.test',    'sub_admin')
const support    = await mk('support@ep.test','support')
const instructor = await mk('instr@ep.test',  'instructor')

const login = async (email: string): Promise<Jar> => {
  const jar: Jar = new Map()
  const r = await call('POST', '/admin/auth/login', jar, { email, password: PW })
  if (r.status !== 200) throw new Error(`admin login ${email}: ${r.status} ${r.code}`)
  return jar
}
const prefsOf = async (id: any) =>
  (await UserModel.findById(id).select('emailPrefs').lean<{ emailPrefs?: any }>())?.emailPrefs ?? {}

/* ═══════════ A — the decision helper ═══════════ */
section('A. wantsStaffEmail over every role × category × explicit value × master switch')
{
  const ROLES = ['super_admin', 'admin', 'sub_admin', 'support', 'instructor']
  const ADMIN_ALERTS = ['enrollmentRequest', 'deviceApproval']

  let defaultsOk = true, explicitOk = true, masterOk = true
  for (const role of ROLES) {
    for (const cat of STAFF_EMAIL_CATEGORIES) {
      /* No prefs at all → role-aware default. */
      const expectedDefault = !(ADMIN_ALERTS.includes(cat) && (role === 'sub_admin' || role === 'support'))
      if (wantsStaffEmail({ role }, cat) !== expectedDefault) defaultsOk = false
      if (defaultWants(role, cat) !== expectedDefault) defaultsOk = false
      /* An explicit choice always wins over the default, in both directions. */
      if (wantsStaffEmail({ role, emailPrefs: { categories: { [cat]: true } } }, cat) !== true) explicitOk = false
      if (wantsStaffEmail({ role, emailPrefs: { categories: { [cat]: false } } }, cat) !== false) explicitOk = false
      /* Master off silences everything, even an explicit opt-in. */
      if (wantsStaffEmail({ role, emailPrefs: { masterEnabled: false, categories: { [cat]: true } } }, cat) !== false) masterOk = false
      /* Master explicitly on behaves exactly like master absent. */
      if (wantsStaffEmail({ role, emailPrefs: { masterEnabled: true } }, cat) !== expectedDefault) masterOk = false
    }
  }
  check('A1 absent prefs resolve to the role-aware default for all 25 role×category pairs', defaultsOk)
  check('A2 an explicit true/false always overrides the default', explicitOk)
  check('A3 masterEnabled:false silences every category; true == absent', masterOk)
  check('A4 opt-out: a brand-new admin receives the admin alerts',
    wantsStaffEmail({ role: 'admin' }, 'enrollmentRequest') && wantsStaffEmail({ role: 'admin' }, 'deviceApproval'))
  check('A5 opt-in: a brand-new sub_admin/support does NOT receive them',
    !wantsStaffEmail({ role: 'sub_admin' }, 'enrollmentRequest') && !wantsStaffEmail({ role: 'support' }, 'deviceApproval'))
  check('A6 instructor categories default ON for every role (anyone can be a class instructor)',
    ROLES.every(role => wantsStaffEmail({ role }, 'classReminder')))
  check('A7 a missing user is never mailed', !wantsStaffEmail(null, 'classReminder') && !wantsStaffEmail(undefined, 'classScheduled'))
}

/* ═══════════ B — the API ═══════════ */
section('B. PATCH /admin/auth/me/email-preferences + GET /admin/auth/me')
{
  const unauth = await call('PATCH', '/admin/auth/me/email-preferences', undefined, { masterEnabled: false })
  check('B1 unauthenticated → 401', unauth.status === 401, `${unauth.status}`)

  /* Every admin-side role manages its own preferences — including the two that
     have no admin-alert categories by default. */
  for (const [label, email] of [
    ['super_admin', 'super@ep.test'], ['admin', 'admin@ep.test'], ['sub_admin', 'sub@ep.test'],
    ['support', 'support@ep.test'], ['instructor', 'instr@ep.test'],
  ] as const) {
    const jar = await login(email)
    const r = await call('PATCH', '/admin/auth/me/email-preferences', jar, { categories: { classReminder: false } })
    check(`B2:${label} can update its own preferences`, r.status === 200, `${r.status} ${r.code}`)
  }

  const jar = await login('admin@ep.test')
  /* Merge, not replace: a second partial patch must not clobber the first. */
  await call('PATCH', '/admin/auth/me/email-preferences', jar, { categories: { classScheduled: false } })
  const merged = await prefsOf(admin._id)
  check('B3 partial patches MERGE (classReminder survives a later classScheduled patch)',
    merged?.categories?.classReminder === false && merged?.categories?.classScheduled === false,
    JSON.stringify(merged))

  const me = await call('GET', '/admin/auth/me', jar)
  check('B4 GET /admin/auth/me exposes emailPrefs', me.status === 200 && !!me.body?.data?.user?.emailPrefs,
    JSON.stringify(me.body?.data?.user?.emailPrefs))
  check('B5 …with the stored values', me.body?.data?.user?.emailPrefs?.categories?.classScheduled === false)

  const bad1 = await call('PATCH', '/admin/auth/me/email-preferences', jar, { nope: true })
  check('B6 unknown top-level key rejected', bad1.status === 422, `${bad1.status}`)
  const bad2 = await call('PATCH', '/admin/auth/me/email-preferences', jar, { categories: { notACategory: false } })
  check('B7 unknown category rejected', bad2.status === 422, `${bad2.status}`)
  const bad3 = await call('PATCH', '/admin/auth/me/email-preferences', jar, { masterEnabled: 'yes' })
  check('B8 non-boolean rejected', bad3.status === 422, `${bad3.status}`)

  /* One user's change must never touch another's. */
  const before = await prefsOf(superAdmin._id)
  await call('PATCH', '/admin/auth/me/email-preferences', jar, { masterEnabled: false })
  const after = await prefsOf(superAdmin._id)
  check('B9 a change is scoped to the caller only', JSON.stringify(before) === JSON.stringify(after),
    `${JSON.stringify(before)} vs ${JSON.stringify(after)}`)
  check('B10 the caller\'s master switch was stored', (await prefsOf(admin._id))?.masterEnabled === false)

  /* Put admin back to a clean, fully-on state for the E2E sections. */
  await call('PATCH', '/admin/auth/me/email-preferences', jar,
    { masterEnabled: true, categories: { classReminder: true, classScheduled: true } })
}

/* ═══════════ C — new-signup alerts + the dual-use sender ═══════════ */
section('C. New-signup alerts honour preferences; the dual-use verification sender does NOT get gated')
{
  let n = 0
  const signup = async () => {
    const t0 = Date.now()
    const email = `student${n++}@ep.test`
    /* Express signup signs the new user straight in — keep that session rather
       than logging in again, which would trip the new-device gate. */
    const jar: Jar = new Map()
    const r = await call('POST', '/auth/register', jar, {
      name: 'Student Person', email, password: PW,
      signupType: 'express', organizationSlug: 'dubai',
      enrollmentApplication: { homeCountry: 'India' },
    })
    await settle()
    return { t0, email, status: r.status, jar }
  }

  const s1 = await signup()
  check('C1 express signup succeeds', s1.status === 201, `${s1.status}`)
  check('C2 super_admin (opt-out default) is alerted', (await mailsTo('super@ep.test', s1.t0)) === 1)
  check('C3 admin (opt-out default) is alerted', (await mailsTo('admin@ep.test', s1.t0)) === 1)
  check('C4 sub_admin (opt-IN default) is NOT alerted', (await mailsTo('sub@ep.test', s1.t0)) === 0)
  check('C5 support (opt-IN default) is NOT alerted', (await mailsTo('support@ep.test', s1.t0)) === 0)
  check('C6 instructor is never an admin-alert recipient', (await mailsTo('instr@ep.test', s1.t0)) === 0)

  /* admin opts out; super_admin untouched. */
  const adminJar = await login('admin@ep.test')
  await call('PATCH', '/admin/auth/me/email-preferences', adminJar, { categories: { enrollmentRequest: false } })
  const s2 = await signup()
  check('C7 after opting out, admin is no longer alerted', (await mailsTo('admin@ep.test', s2.t0)) === 0)
  check('C8 …and super_admin still is', (await mailsTo('super@ep.test', s2.t0)) === 1)

  /* sub_admin opts IN — proves the newly-eligible roles really can subscribe. */
  const subJar = await login('sub@ep.test')
  await call('PATCH', '/admin/auth/me/email-preferences', subJar, { categories: { enrollmentRequest: true } })
  const s3 = await signup()
  check('C9 after opting in, sub_admin IS alerted', (await mailsTo('sub@ep.test', s3.t0)) === 1)

  /* super_admin kills everything with the master switch. */
  const superJar = await login('super@ep.test')
  await call('PATCH', '/admin/auth/me/email-preferences', superJar, { masterEnabled: false })
  const s4 = await signup()
  check('C10 master off silences the alert for super_admin', (await mailsTo('super@ep.test', s4.t0)) === 0)
  check('C11 …while sub_admin, who opted in, still gets it', (await mailsTo('sub@ep.test', s4.t0)) === 1)

  /* THE GUARD THAT MATTERS: sendVerifyEmail is dual-use — it delivers both the
     admin alert and a student's real verification link. The preference gate
     lives on the notification loop, so a student must still be able to get
     their own verification mail even with their own prefs switched off. */
  const student = await UserModel.findOne({ email: s1.email })
  await UserModel.findByIdAndUpdate(student!._id, {
    $set: { isVerified: false, 'emailPrefs.masterEnabled': false },
  })
  check('C12 the signup issued the student a session', s1.jar.has('lms_at'), [...s1.jar.keys()].join(','))
  const t5 = Date.now()
  const resend = await call('POST', '/auth/resend-verification', s1.jar)
  await settle()
  check('C13 DUAL-USE GUARD: the student\'s own verification mail is still sent with master OFF',
    resend.status === 200 && (await mailsTo(s1.email, t5)) >= 1, `${resend.status} ${resend.code}`)
}

/* ═══════════ D — instructor 15-min reminder ═══════════ */
section('D. The instructor 15-min reminder honours the preference and still marks the class handled')
{
  const course = await CourseModel.create({
    title: 'Forex', slug: 'forex-ep', description: 'd', instructorId: instructor._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
  })
  const mkClass = () => LiveClassModel.create({
    title: 'Session', courseId: course._id, instructorId: instructor._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() + 15 * 60 * 1000), durationMins: 60,
    type: 'external', isOnline: true, status: 'scheduled', language: 'English',
    sessionCapacity: 30, bookedCount: 0, meetingUrl: 'https://meet.google.com/ep-test',
    reminderInstructor15MinSent: false,
  })
  const instrJar = await login('instr@ep.test')
  const setPref = (patch: unknown) => call('PATCH', '/admin/auth/me/email-preferences', instrJar, patch)

  /* Default (opted in) → mail sent, class marked handled. */
  await setPref({ masterEnabled: true, categories: { classReminder: true } })
  const c1 = await mkClass()
  let t0 = Date.now()
  await runInstructor15MinReminders(); await settle()
  check('D1 by default the instructor gets the 15-min reminder', (await mailsTo('instr@ep.test', t0)) === 1)
  check('D2 …and the class is marked as reminded',
    (await LiveClassModel.findById(c1._id).lean())?.reminderInstructor15MinSent === true)

  /* Opted out → no mail, but STILL marked handled so the job stops re-fetching. */
  await setPref({ categories: { classReminder: false } })
  const c2 = await mkClass()
  t0 = Date.now()
  await runInstructor15MinReminders(); await settle()
  check('D3 after opting out, NO reminder is sent', (await mailsTo('instr@ep.test', t0)) === 0)
  check('D4 …but the class is still marked handled (no re-fetch every cycle)',
    (await LiveClassModel.findById(c2._id).lean())?.reminderInstructor15MinSent === true)

  /* Master off silences it too, even with the category left on. */
  await setPref({ masterEnabled: false, categories: { classReminder: true } })
  const c3 = await mkClass()
  t0 = Date.now()
  await runInstructor15MinReminders(); await settle()
  check('D5 master off silences the reminder even with the category on', (await mailsTo('instr@ep.test', t0)) === 0)
  check('D6 …and that class is marked handled as well',
    (await LiveClassModel.findById(c3._id).lean())?.reminderInstructor15MinSent === true)

  /* Turning it back on restores delivery. */
  await setPref({ masterEnabled: true })
  const c4 = await mkClass()
  t0 = Date.now()
  await runInstructor15MinReminders(); await settle()
  check('D7 switching notifications back on restores the reminder', (await mailsTo('instr@ep.test', t0)) === 1)
}

} catch (err) {
  fail++
  lines.push(`\n  FATAL  ${(err as Error).stack ?? String(err)}`)
} finally {
  console.log(lines.join('\n'))
  console.log(`\nemailprefs.suite — ${pass} passed, ${fail} failed`)
  await rm(MAILDIR, { recursive: true, force: true }).catch(() => {})
  await mongoose.connection.dropDatabase().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}
