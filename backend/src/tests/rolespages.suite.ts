/* ─────────────────────────────────────────────────────────────
   Roles & Permissions — the pages added 2026-10-17.
     A. seeding: system roles get the new rows (an edited row is never changed);
        a custom role gets them all off
     B. a custom role without a page: its routes are refused; with Read it may
        look; adding needs Create
     C. no custom role, or a super admin: everything as before
     D. the mentor list (GET /admin/mentor-calendar) opens with Programs' Read too
     E. audit logs, instructor reviews, assignment review are guarded too
     F. /admin/auth/me gives the custom role's permissions (for the sidebar)
   Run: bun --no-env-file src/tests/rolespages.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_rolespages'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.JWT_ACCESS_SECRET  ??= 'rolespages-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'rolespages-refresh-secret-0123456789abcdef'
export {}
let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { seedDefaultRoles } = await import('@/utils/seedRoles.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_rolespages') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar | null, body?: unknown) {
  const h: Record<string, string> = {}
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0 && jar) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: any) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`
const PW = 'CorrectHorse1'
const row = (resource: string, p: Partial<Record<'read' | 'list' | 'list_basic' | 'create' | 'update' | 'delete' | 'impersonate', boolean>> = {}) =>
  ({ resource, create: false, read: false, update: false, delete: false, list: false, list_basic: false, impersonate: false, ...p })

try {
  section('A · seeding')
  /* An old Academic Admin: before the new pages, with one row edited by hand. */
  await M.RoleModel.create({ name: 'Academic Admin', description: 'old', isSystem: true, permissions: [row('users', { read: true, list: true }), row('courses', { read: true })] })
  const custom = await M.RoleModel.create({ name: 'Sales viewer', isSystem: false, permissions: [row('users', { read: true, list: true })] })
  await seedDefaultRoles()
  const aa = await M.RoleModel.findOne({ name: 'Academic Admin' }).lean() as any
  const r = (role: any, res: string) => (role.permissions as any[]).find(p => p.resource === res)
  check('the system role gains the new pages', r(aa, 'programs')?.read === true && r(aa, 'audit-logs')?.read === true && r(aa, 'audit-logs')?.update === false)
  check('...an edited row is left as it was', r(aa, 'courses')?.read === true && r(aa, 'courses')?.create === false)
  const cu = await M.RoleModel.findById(custom._id).lean() as any
  check('a custom role gains them, all off', r(cu, 'programs') && !r(cu, 'programs').read && !r(cu, 'programs').create)
  await seedDefaultRoles()
  check('seeding twice adds nothing twice', ((await M.RoleModel.findOne({ name: 'Academic Admin' }).lean() as any).permissions as any[]).filter((p: any) => p.resource === 'programs').length === 1)

  section('B · a custom role, page by page')
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string, extra: Record<string, unknown> = {}) => M.UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: dubai._id, ...extra })
  /* Programs: Read only. No devices, no audit logs. */
  await M.RoleModel.updateOne({ _id: custom._id, 'permissions.resource': 'programs' }, { $set: { 'permissions.$.read': true, 'permissions.$.list': true } })
  await mk('limited@rp.local', 'admin', { customRoleId: custom._id })
  await mk('plain@rp.local', 'admin')
  await mk('super@rp.local', 'super_admin', { customRoleId: custom._id })
  const login = async (email: string) => { const j: Jar = new Map(); const x = await call('POST', '/admin/auth/login', j, { email, password: PW }); if (x.status !== 200) throw new Error(`${email} ${why(x)}`); return j }
  const lim = await login('limited@rp.local'), plain = await login('plain@rp.local'), sup = await login('super@rp.local')
  check('Programs with Read: may look', (await call('GET', '/admin/programs', lim)).status === 200)
  const mkProg = await call('POST', '/admin/programs', lim, { title: 'x' })
  check('...may not make one (needs Create)', mkProg.status === 403 && mkProg.body?.error?.code === 'PERMISSION_DENIED', why(mkProg))
  check('Devices without Read: refused', (await call('GET', '/admin/devices', lim)).status === 403)
  check('Send message without Create: refused', (await call('POST', '/admin/messages/preview', lim, {})).status === 403)
  check('Class verification without Read: refused', (await call('GET', '/admin/class-verification', lim)).status === 403)
  check('Exams without Read: refused', (await call('GET', `/admin/exams/${new mongoose.Types.ObjectId()}/attempts`, lim)).status === 403)
  check('Enrolment requests without Read: refused', (await call('GET', '/admin/enrollment-requests', lim)).status === 403)

  section('C · no custom role, or a super admin: as before')
  check('an admin with no custom role: devices open', (await call('GET', '/admin/devices', plain)).status === 200)
  check('a super admin with a custom role: devices open', (await call('GET', '/admin/devices', sup)).status === 200)

  section('D · the mentor list')
  check('Programs\' Read opens GET /admin/mentor-calendar', (await call('GET', `/admin/mentor-calendar?from=${new Date().toISOString()}&to=${new Date(Date.now() + 864e5).toISOString()}`, lim)).status === 200)
  check('...but not the calendar\'s meetings', (await call('POST', '/admin/mentor-calendar/meetings', lim, {})).status === 403)

  section('E · the other pages')
  check('audit logs: refused', (await call('GET', '/audit-logs', lim)).status === 403)
  check('instructor reviews: refused', (await call('GET', '/instructor-reviews/admin/leaderboard', lim)).status === 403)
  check('assignment review: refused', (await call('GET', '/class-assignments/review', lim)).status === 403)
  check('...all open to the admin with no custom role', (await call('GET', '/audit-logs', plain)).status === 200 && (await call('GET', '/class-assignments/review', plain)).status === 200)

  section('F · /admin/auth/me')
  const me = await call('GET', '/admin/auth/me', lim)
  const pr = (me.body?.data?.permissions ?? []).find((p: any) => p.resource === 'programs')
  check('a custom role: its permissions', pr?.read === true && pr?.create === false, JSON.stringify(pr))
  check('no custom role: none', !('permissions' in ((await call('GET', '/admin/auth/me', plain)).body?.data ?? {})))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
