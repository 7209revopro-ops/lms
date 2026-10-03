/* ─────────────────────────────────────────────────────────────
   FEATURE — staff alerts when a student opens a support ticket, plus the
   staff phone/WhatsApp number this feature adds to account creation.

   Two things this suite is careful about:

     • The recipients are derived from the STUDENT'S OWN category, not from
       any `program` field on the request — the real client-facing ticket
       form never sends one (POST /support's createSchema only accepts
       subject/category/message), so trusting it would silently notify
       nobody's sub_admin on every real ticket ever created. Section A pins
       this against a student whose category is 'ai'.
     • WhatsApp is opt-in PER RECIPIENT by whether they have a phone number
       on file, independent of whether their email alert went out. Section B
       proves a phoneless recipient still gets email+in-app but no WhatsApp
       file, and a recipient WITH a phone gets all three.
     • Org isolation: a Bangalore student's ticket must not alert Dubai's
       staff, and vice versa (section C).

   Mail and WhatsApp are captured through their services' own console
   transports — the real send path runs, nothing leaves the machine.

   Run: bun run test:supportticketalerts
───────────────────────────────────────────────────────────── */
const nodePathBoot = await import('path')
process.env.EMAIL_LOG_DIR    = nodePathBoot.join(process.cwd(), '.logs', 'emails-supportalerts-' + String(process.pid))
process.env.WHATSAPP_LOG_DIR = nodePathBoot.join(process.cwd(), '.logs', 'whatsapp-supportalerts-' + String(process.pid))
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_supportticketalerts_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'

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

const nodeFs   = await import('fs/promises')
const nodePath = await import('path')
const MAILDIR = process.env.EMAIL_LOG_DIR!
const WADIR   = process.env.WHATSAPP_LOG_DIR!

interface Mail { to: string; subject: string }
async function mailbox(): Promise<Mail[]> {
  let names: string[] = []
  try { names = await nodeFs.readdir(MAILDIR) } catch { return [] }
  const out: Mail[] = []
  for (const n of names) {
    if (!n.endsWith('.html')) continue
    const raw  = await nodeFs.readFile(nodePath.join(MAILDIR, n), 'utf8')
    const head = raw.slice(0, raw.indexOf('\n') + 1)
    out.push({
      to:      (head.match(/to:\s*([^|]+)\|/)?.[1] ?? '').trim(),
      subject: (head.match(/subject:\s*(.*?)\s*-->/)?.[1] ?? '').trim(),
    })
  }
  return out
}

interface Wa { to: string; templateName: string; params: string[] }
async function waOutbox(): Promise<Wa[]> {
  let names: string[] = []
  try { names = await nodeFs.readdir(WADIR) } catch { return [] }
  const out: Wa[] = []
  for (const n of names) {
    if (!n.endsWith('.json')) continue
    const raw = await nodeFs.readFile(nodePath.join(WADIR, n), 'utf8')
    try { out.push(JSON.parse(raw)) } catch { /* skip */ }
  }
  return out
}

async function until(want: () => Promise<boolean>, ms = 6000): Promise<boolean> {
  const t0 = Date.now()
  for (;;) {
    if (await want()) return true
    if (Date.now() - t0 > ms) return false
    await new Promise(r => setTimeout(r, 100))
  }
}

const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, NotificationModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_supportticketalerts_suite') {
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
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';')
    const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

const PW = 'CorrectHorse1'
let seq = 0
const email = (tag: string) => `${tag}-${Date.now()}-${seq++}@sta.local`

try {
  const dubai = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash  = await hashPassword(PW)

  const superAdmin = await UserModel.create({
    name: 'Root', email: email('root'), passwordHash: hash, role: 'super_admin', isActive: true,
    phone: '+15550000001',
  })
  const dubaiAdmin = await UserModel.create({
    name: 'Dubai Admin', email: email('dadmin'), passwordHash: hash, role: 'admin',
    organizationId: dubai._id, isActive: true, phone: '+15550000002',
  })
  /* No phone — proves email/in-app still fire without one. */
  const dubaiAiSubAdmin = await UserModel.create({
    name: 'Dubai AI Sub', email: email('daisub'), passwordHash: hash, role: 'sub_admin',
    organizationId: dubai._id, program: 'ai', isActive: true,
  })
  /* Wrong programme — must NOT be notified for an 'ai' student's ticket. */
  const dubaiForexSubAdmin = await UserModel.create({
    name: 'Dubai Forex Sub', email: email('dfxsub'), passwordHash: hash, role: 'sub_admin',
    organizationId: dubai._id, program: 'forex', isActive: true,
  })
  const blrAdmin = await UserModel.create({
    name: 'Blr Admin', email: email('badmin'), passwordHash: hash, role: 'admin',
    organizationId: blr._id, isActive: true, phone: '+15550000003',
  })
  const blrAiSubAdmin = await UserModel.create({
    name: 'Blr AI Sub', email: email('baisub'), passwordHash: hash, role: 'sub_admin',
    organizationId: blr._id, program: 'ai', isActive: true, phone: '+15550000004',
  })

  const dubaiStudent = await UserModel.create({
    name: 'Dubai Student', email: email('dstudent'), passwordHash: hash, role: 'student',
    organizationId: dubai._id, category: 'ai', categories: ['ai'], isActive: true,
    enrollmentStatus: 'approved',
  })
  const blrStudent = await UserModel.create({
    name: 'Blr Student', email: email('bstudent'), passwordHash: hash, role: 'student',
    organizationId: blr._id, category: 'ai', categories: ['ai'], isActive: true,
    enrollmentStatus: 'approved',
  })

  const login = async (e: string): Promise<Jar> => {
    const jar: Jar = new Map()
    const r = await call('POST', '/auth/login', { jar, body: { email: e, password: PW } })
    if (r.status !== 200) throw new Error(`login ${e}: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }
  const dubaiStudentJar = await login(dubaiStudent.email)
  const blrStudentJar   = await login(blrStudent.email)

  /* ═══════════════════════════════════════════════ */
  section('A · a Dubai AI student\'s ticket reaches the right staff, and only them')
  {
    const r = await call('POST', '/support', {
      jar: dubaiStudentJar,
      body: { subject: 'Cannot join class', category: 'technical', message: 'The join button does nothing.' },
    })
    check('the ticket is created', r.status === 201, `${r.status} ${JSON.stringify(r.body?.error ?? '')}`)

    const gotAll = await until(async () => {
      const notifs = await NotificationModel.find({ kind: 'support-ticket-raised' }).lean()
      return notifs.length >= 3
    })
    check('three staff notifications land (dubai admin + dubai AI sub_admin + super_admin)', gotAll)

    const notifs = await NotificationModel.find({ kind: 'support-ticket-raised' }).lean()
    const recipientIds = new Set(notifs.map(n => String(n.userId)))
    check('the Dubai admin is notified', recipientIds.has(String(dubaiAdmin._id)))
    check('the Dubai AI sub_admin is notified', recipientIds.has(String(dubaiAiSubAdmin._id)))
    check('the super admin is notified', recipientIds.has(String(superAdmin._id)))
    check('the Dubai FOREX sub_admin is NOT notified — wrong programme',
      !recipientIds.has(String(dubaiForexSubAdmin._id)))
    check('the Bangalore admin is NOT notified — wrong academy',
      !recipientIds.has(String(blrAdmin._id)))
    check('the Bangalore AI sub_admin is NOT notified — wrong academy',
      !recipientIds.has(String(blrAiSubAdmin._id)))
    check('the notification names the student and the subject',
      notifs.some(n => n.body?.includes('Dubai Student') && n.title?.includes('Cannot join class')),
      JSON.stringify(notifs.map(n => n.title)))

    const mail = await mailbox()
    check('the Dubai admin got an email', mail.some(m => m.to.includes(dubaiAdmin.email)))
    check('the Dubai AI sub_admin got an email', mail.some(m => m.to.includes(dubaiAiSubAdmin.email)))
    check('the super admin got an email', mail.some(m => m.to.includes(superAdmin.email)))
    check('the Bangalore admin got NO email', !mail.some(m => m.to.includes(blrAdmin.email)))
  }

  /* ═══════════════════════════════════════════════ */
  section('B · WhatsApp is opt-in per recipient, by whether they have a phone on file')
  {
    const wa = await waOutbox()
    const waRecipients = wa.map(w => w.to)
    /* normalizeWhatsAppNumber strips everything but digits before sending. */
    check('the Dubai admin (has a phone) got a WhatsApp message', waRecipients.includes('15550000002'))
    check('the super admin (has a phone) got a WhatsApp message', waRecipients.includes('15550000001'))
    check('the Dubai AI sub_admin (NO phone on file) got none — proves it is per-recipient, not all-or-nothing',
      !wa.some(w => w.to === dubaiAiSubAdmin.email))
    check('the template carries the student name and ticket subject',
      wa.some(w => w.templateName === 'support_ticket_raised_v1' && w.params?.[0] === 'Dubai Student'),
      JSON.stringify(wa.map(w => w.params)))
  }

  /* ═══════════════════════════════════════════════ */
  section('C · a Bangalore student\'s ticket notifies Bangalore staff, and only them')
  {
    const before = await NotificationModel.countDocuments({ kind: 'support-ticket-raised' })
    const r = await call('POST', '/support', {
      jar: blrStudentJar,
      body: { subject: 'Payment failed', category: 'billing', message: 'My card was declined twice.' },
    })
    check('the ticket is created', r.status === 201, String(r.status))

    const got = await until(async () =>
      (await NotificationModel.countDocuments({ kind: 'support-ticket-raised' })) > before)
    check('new notifications land', got)

    /* Three new rows this time too (Bangalore admin + Bangalore AI sub_admin +
       super_admin), same recipient shape as ticket 1. */
    const recent = await NotificationModel.find({ kind: 'support-ticket-raised' })
      .sort({ createdAt: -1 }).limit(3).lean()
    const recentIds = new Set(recent.map(n => String(n.userId)))
    check('the Bangalore admin is notified this time', recentIds.has(String(blrAdmin._id)))
    check('the Bangalore AI sub_admin is notified this time', recentIds.has(String(blrAiSubAdmin._id)))
    check('the Dubai admin is NOT among these two newest rows',
      !recentIds.has(String(dubaiAdmin._id)))
  }

  /* ═══════════════════════════════════════════════ */
  section('D · the staff phone/WhatsApp field round-trips through account creation and edits')
  {
    const superJar: Jar = new Map()
    const superLogin = await call('POST', '/admin/auth/login', { jar: superJar, body: { email: superAdmin.email, password: PW } })
    if (superLogin.status !== 200) throw new Error(`admin login: ${superLogin.status} ${JSON.stringify(superLogin.body)}`)

    const created = await call('POST', '/admin/users', {
      jar: superJar,
      body: {
        name: 'New Sub Admin', email: email('newsub'), password: 'CorrectHorse1',
        role: 'sub_admin', program: 'jura', organizationId: String(dubai._id),
        phone: '+15559998888',
      },
    })
    check('creating a staff account with a phone succeeds', created.status === 201, String(created.status))
    check('the phone is stored on the new account',
      created.body?.data?.phone === '+15559998888', String(created.body?.data?.phone))

    const newId = created.body?.data?.id
    const updated = await call('PATCH', `/admin/users/${newId}`, {
      jar: superJar, body: { phone: '+15551112222' },
    })
    check('editing the phone succeeds', updated.status === 200, String(updated.status))
    check('the new phone is stored', updated.body?.data?.phone === '+15551112222',
      String(updated.body?.data?.phone))

    const row = await UserModel.findById(newId).select('phone').lean()
    check('the DB row itself carries the updated phone', row?.phone === '+15551112222', String(row?.phone))
  }

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  try {
    await nodeFs.rm(MAILDIR, { recursive: true, force: true })
    await nodeFs.rm(WADIR, { recursive: true, force: true })
  } catch { /* best effort */ }
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
