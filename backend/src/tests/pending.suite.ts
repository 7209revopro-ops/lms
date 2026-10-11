/* ─────────────────────────────────────────────────────────────
   What is pending, for the Root portal's Pending page (GET /service/pending,
   services/portalPending.service.ts; the user, 2026-10-11: every portal's own
   sidebar badges, and who each is waiting on).

   Pinned here, against a real database, with two academies:

     A. only the Root portal's secret: none or a wrong one 401, the sales
        CRM's 403;
     B. the kinds are the admin sidebar's badges in its order — Requests,
        Support, Messages — and each shared total is the super admin's own
        badge ("All Orgs": both academies), read from the very endpoints the
        sidebar polls;
     C. every person's count is their own badge: a Dubai admin Dubai's, a
        Bangalore admin Bangalore's, a department head their department's,
        a mentor their unread chat — each checked against that person's own
        endpoint; a custom role that may not list tickets gets no tickets;
     D. who is left out: inactive staff on shared kinds, a department head with
        no department, students, people with nothing waiting; an inactive
        mentor with unread chat is shown, as inactive; sorted by total.

   Run: bun --no-env-file src/tests/pending.suite.ts
   (PENDING_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.PENDING_DATABASE_URL ?? 'mongodb://localhost:27017/lms_pending'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.DOTENV_CONFIG_PATH = '/nonexistent/pending-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'pending-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'pending-suite-refresh-secret-0123456789'
delete process.env.PERMISSIONS_MODE   // enforced, as in production
const CRM_SECRET  = 'pending-suite-crm-secret-0123456789'
const ROOT_SECRET = 'pending-suite-root-secret-0123456789'
process.env.SALES_CRM_SECRET = CRM_SECRET
process.env.ROOT_ERP_SECRET  = ROOT_SECRET

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_pending') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar?: Jar, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  if (jar) for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW)
  const mk = (name: string, email: string, role: string, org: any, extra: Record<string, unknown> = {}) =>
    M.UserModel.create({ name, email, passwordHash: hash, role, isActive: true, ...(org ? { organizationId: org._id } : {}), ...extra })

  const root       = await mk('Root', 'root@pd.local', 'super_admin', null)
  await mk('Old Root', 'oldroot@pd.local', 'super_admin', null, { isActive: false })
  const dubaiAdm   = await mk('Dubai Admin', 'dubai.admin@pd.local', 'admin', dubai)
  const blrAdm     = await mk('Blr Admin', 'blr.admin@pd.local', 'admin', blr)
  const desk       = await mk('Help Desk', 'desk@pd.local', 'support', dubai)
  const forexHead  = await mk('Forex Head', 'forex.head@pd.local', 'sub_admin', dubai, { program: 'forex' })
  const dmHead     = await mk('DM Head', 'dm.head@pd.local', 'sub_admin', dubai, { program: 'digital_marketing' })
  await mk('No Dept', 'nodept@pd.local', 'sub_admin', dubai)
  await mk('Gone Admin', 'gone.admin@pd.local', 'admin', dubai, { isActive: false })
  const noTickets  = await M.RoleModel.create({ name: 'Requests only', permissions: [{ resource: 'support', list: false, read: false, create: false, update: false, delete: false }] })
  const narrow     = await mk('Narrow Desk', 'narrow@pd.local', 'support', dubai, { customRoleId: noTickets._id })
  const anna       = await mk('Anna Mentor', 'anna@pd.local', 'instructor', dubai)
  const ben        = await mk('Ben Mentor', 'ben@pd.local', 'instructor', blr, { isActive: false })
  await mk('Cara Mentor', 'cara@pd.local', 'instructor', dubai)

  let n = 0
  const student = (org: any, extra: Record<string, unknown>) =>
    mk(`Student ${++n}`, `s${n}@pd.local`, 'student', org, extra)
  const applying = (org: any, programs: string[], extra: Record<string, unknown> = {}) =>
    student(org, { enrollmentStatus: 'pending', categories: [], enrollmentApplication: { programs }, ...extra })
  // Dubai: two Forex applicants and one Digital Marketing; Bangalore: two Forex.
  const s1 = await applying(dubai, ['forex-beginner'])
  await applying(dubai, ['forex-advanced'])
  const s3 = await applying(dubai, ['dm-seo'])
  await applying(blr, ['forex-beginner'])
  const s5 = await applying(blr, ['forex-beginner'])
  // Not waiting: an express member's pending row, an approved and a rejected student.
  await applying(dubai, ['forex-beginner'], { signupType: 'express' })
  await student(dubai, { enrollmentStatus: 'approved', category: '4x-trading', categories: ['4x-trading'] })
  await applying(dubai, ['forex-beginner'], { enrollmentStatus: 'rejected' })

  const ticket = (u: any, org: any, program: string, adminUnread: boolean) => M.SupportTicketModel.create({
    userId: u._id, organizationId: org._id, subject: 'Help please', category: 'course', program, status: 'open', adminUnread,
    messages: [{ senderRole: 'student', senderId: u._id, body: 'Help', createdAt: new Date() }], lastMessageAt: new Date(), lastSenderRole: 'student',
  })
  await ticket(s1, dubai, '4x-trading', true)
  await ticket(s3, dubai, 'digital-marketing', true)
  await ticket(s1, dubai, '4x-trading', false)          // opened by an admin since
  await ticket(s5, blr, '4x-trading', true)

  const chat = (st: any, mentor: any, org: any, unread: number) => M.ChatConversationModel.create({
    organizationId: org._id, studentId: st._id, instructorId: mentor._id, lastMessageAt: new Date(),
    lastSenderRole: 'student', instructorUnread: unread, studentUnread: 0,
  })
  await chat(s1, anna, dubai, 2)
  await chat(s3, anna, dubai, 1)
  await chat(s5, ben, blr, 4)
  await chat(s1, ben, dubai, 0)

  step('A · only the Root portal')
  check('no secret: 401', (await call('GET', '/service/pending')).status === 401)
  check('a wrong secret: 401', (await call('GET', '/service/pending', undefined, undefined, { 'x-portal-secret': 'guess' })).status === 401)
  const crm = await call('GET', '/service/pending', undefined, undefined, { 'x-portal-secret': CRM_SECRET })
  check("the sales CRM's secret: 403", crm.status === 403, why(crm))
  const r = await call('GET', '/service/pending', undefined, undefined, { 'x-portal-secret': ROOT_SECRET })
  check("the Root portal's: 200", r.status === 200 && r.body?.success === true, why(r))
  const kinds: any[] = r.body?.data?.kinds ?? []
  const people: any[] = r.body?.data?.people ?? []
  const kind = (k: string) => kinds.find(x => x.key === k)
  const person = (email: string) => people.find(p => p.email === email)

  step("B · the sidebar's badges, as the super admin sees them")
  check('Requests, Support, Messages — in the sidebar\'s order, with its labels',
    kinds.map(k => `${k.key}:${k.label}`).join(',') === 'enrolment_requests:Requests,support_tickets:Support,chat_messages:Messages', JSON.stringify(kinds))
  check('Requests and Support wait on a role (shared); Messages on a named mentor',
    kind('enrolment_requests')?.shared === true && kind('support_tickets')?.shared === true && kind('chat_messages')?.shared === undefined)
  const login = async (email: string) => {
    const jar: Jar = new Map()
    const l = await call('POST', '/admin/auth/login', jar, { email, password: PW })
    if (l.status !== 200) throw new Error(`login ${email}: ${why(l)}`)
    return jar
  }
  const requestsBadge = async (jar: Jar) => (await call('GET', '/admin/enrollment-requests?status=pending&per_page=100', jar)).body?.meta?.total_count
  const supportBadge  = async (jar: Jar) => (await call('GET', '/support/admin/stats', jar)).body?.data?.unread
  const rootJar = await login('root@pd.local')
  const rootReq = await requestsBadge(rootJar), rootSup = await supportBadge(rootJar)
  check(`Requests total = the super admin's badge, both academies (${rootReq})`, kind('enrolment_requests')?.total === rootReq && rootReq === 5, JSON.stringify(kind('enrolment_requests')))
  check(`Support total = the super admin's badge, both academies (${rootSup})`, kind('support_tickets')?.total === rootSup && rootSup === 3, JSON.stringify(kind('support_tickets')))
  const withDubai = await call('GET', '/admin/enrollment-requests?status=pending', rootJar, undefined, { 'x-organization-id': String(dubai._id) })
  const withBlr   = await call('GET', '/admin/enrollment-requests?status=pending', rootJar, undefined, { 'x-organization-id': String(blr._id) })
  check('…which is Dubai\'s and Bangalore\'s added together', withDubai.body?.meta?.total_count + withBlr.body?.meta?.total_count === kind('enrolment_requests')?.total)
  check('Messages total = every mentor\'s unread (an inactive one\'s too)', kind('chat_messages')?.total === 7, JSON.stringify(kind('chat_messages')))

  step('C · each person: their own badge')
  for (const [email, label] of [
    ['root@pd.local', 'super admin: both academies'],
    ['dubai.admin@pd.local', 'Dubai admin: Dubai'],
    ['blr.admin@pd.local', 'Bangalore admin: Bangalore'],
    ['desk@pd.local', 'Dubai support: Dubai'],
    ['forex.head@pd.local', 'Forex head: Dubai\'s Forex'],
    ['dm.head@pd.local', 'DM head: Dubai\'s Digital Marketing'],
  ] as const) {
    const jar = email === 'root@pd.local' ? rootJar : await login(email)
    const req = await requestsBadge(jar), sup = await supportBadge(jar)
    const p = person(email)
    check(`${label} — Requests ${req}, Support ${sup}`, p && (p.counts.enrolment_requests ?? 0) === req && (p.counts.support_tickets ?? 0) === sup && p.total === req + sup && p.active === true,
      JSON.stringify(p))
  }
  check('the numbers themselves: 5/3, 3/2, 2/1, 3/2, 2/1, 1/1',
    [['root@pd.local', 5, 3], ['dubai.admin@pd.local', 3, 2], ['blr.admin@pd.local', 2, 1], ['desk@pd.local', 3, 2], ['forex.head@pd.local', 2, 1], ['dm.head@pd.local', 1, 1]]
      .every(([e, a, b]) => person(e as string)?.counts.enrolment_requests === a && person(e as string)?.counts.support_tickets === b))
  const annaJar = await login('anna@pd.local')
  const annaBadge = (await call('GET', '/chat/staff/unread-count', annaJar)).body?.data?.count
  check(`a mentor: their own Messages badge (${annaBadge})`, person('anna@pd.local')?.counts.chat_messages === annaBadge && annaBadge === 3 && person('anna@pd.local')?.total === 3, JSON.stringify(person('anna@pd.local')))
  const narrowJar = await login('narrow@pd.local')
  const narrowList = await call('GET', '/support/admin', narrowJar)
  const np = person('narrow@pd.local')
  check('a custom role that may not list tickets: Requests only (it cannot open the Support list: 403)',
    narrowList.status === 403 && np?.counts.enrolment_requests === 3 && np?.counts.support_tickets === undefined && np?.total === 3, `${why(narrowList)} ${JSON.stringify(np)}`)

  step('D · who is left out, and the order')
  check('inactive staff: not given shared work', !person('oldroot@pd.local') && !person('gone.admin@pd.local'))
  check('a department head with no department: nothing (the routes refuse them)', !person('nodept@pd.local'))
  check('an inactive mentor with unread chat: shown, as inactive', person('ben@pd.local')?.active === false && person('ben@pd.local')?.counts.chat_messages === 4 && person('ben@pd.local')?.total === 4, JSON.stringify(person('ben@pd.local')))
  check('a mentor with nothing unread: omitted', !person('cara@pd.local'))
  check('no students', !people.some(p => /^s\d+@/.test(p.email)))
  check('nobody with a total of 0', people.every(p => p.total > 0))
  check('totals add up their counts, no *_overdue in them', people.every(p => p.total === Object.entries(p.counts).filter(([k]) => !k.endsWith('_overdue')).reduce((s, [, v]) => s + (v as number), 0)))
  check('sorted by total, highest first', people.every((p, i) => i === 0 || people[i - 1].total >= p.total), people.map(p => `${p.email}:${p.total}`).join(' '))
  check('each with id, name, lowercase email and active', people.every(p => /^[0-9a-f]{24}$/.test(p.id) && typeof p.name === 'string' && p.email === p.email.toLowerCase() && typeof p.active === 'boolean'))
  check('the people: exactly the nine expected',
    people.map(p => p.email).sort().join(',') === ['root@pd.local', 'dubai.admin@pd.local', 'blr.admin@pd.local', 'desk@pd.local', 'forex.head@pd.local', 'dm.head@pd.local', 'narrow@pd.local', 'anna@pd.local', 'ben@pd.local'].sort().join(','),
    people.map(p => p.email).join(','))
  check('the root admin\'s id is theirs', person('root@pd.local')?.id === String(root._id) && person('dubai.admin@pd.local')?.id === String(dubaiAdm._id))
  void blrAdm; void desk; void forexHead; void dmHead; void narrow
} catch (err) {
  fail++; console.log(`  \x1b[31m✗ suite threw — ${(err as Error).message}\n${(err as Error).stack}\x1b[0m`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)

export {}
