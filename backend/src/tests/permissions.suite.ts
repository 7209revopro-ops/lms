/* ─────────────────────────────────────────────────────────────
   P-10 — custom roles actually restrict something now.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_perm_suite), dropped on exit. The real `lms` database is never opened.

   The finding was that `customRoleId` and a full permission matrix were
   written to the database and read by NOTHING — a "Read-only Support" role
   could be built, ticked down to `read`, assigned, and change precisely
   nothing. Worse than having no such screen, because it invites reliance on a
   control that does not exist.

   The property that matters most here is NOT that restrictions apply — it is
   that a custom role can only ever NARROW. If it replaced the base-role check,
   assign-role would become a privilege-escalation primitive. That is what
   phase E proves.

   Run: bun run test:permissions
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_perm_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
delete process.env.PERMISSIONS_MODE          /* default: enforce */

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
const { UserModel, OrganizationModel, RoleModel, PERMISSION_RESOURCES } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_perm_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

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
  if (opts.jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}

const PW = 'CorrectHorse1'
/** Build a full matrix with only the named resource/actions enabled. */
const matrix = (grants: Record<string, string[]>) =>
  PERMISSION_RESOURCES.map(r => ({
    resource: r as string,
    create:      grants[r]?.includes('create')      ?? false,
    read:        grants[r]?.includes('read')        ?? false,
    update:      grants[r]?.includes('update')      ?? false,
    delete:      grants[r]?.includes('delete')      ?? false,
    list:        grants[r]?.includes('list')        ?? false,
    list_basic:  grants[r]?.includes('list_basic')  ?? false,
    impersonate: grants[r]?.includes('impersonate') ?? false,
  }))

try {
  const org  = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string, extra: object = {}) =>
    UserModel.create({ name: email, email, passwordHash: hash, role, isActive: true, organizationId: org._id, ...extra })

  const readOnly = await RoleModel.create({
    name: 'Read-only Support', isSystem: false,
    permissions: matrix({ users: ['read', 'list'], courses: ['read', 'list'] }),
  })
  const godRole = await RoleModel.create({
    name: 'Everything', isSystem: false,
    permissions: matrix(Object.fromEntries(PERMISSION_RESOURCES.map(r =>
      [r, ['create', 'read', 'update', 'delete', 'list', 'list_basic', 'impersonate']]))),
  })

  const plainAdmin = await mk('plain@t.local', 'admin')
  const cappedAdmin = await mk('capped@t.local', 'admin', { customRoleId: readOnly._id })
  const student     = await mk('student@t.local', 'student', { customRoleId: godRole._id })

  const login = async (email: string) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`)
    return jar
  }

  section('A — an admin with NO custom role is untouched (0 of 79 accounts had one)')
  {
    const jar = await login('plain@t.local')
    check('can list users',   (await call('GET', '/admin/users', { jar })).status === 200)
    check('can list courses', (await call('GET', '/admin/courses', { jar })).status === 200)
    const made = await call('POST', '/admin/categories', { jar, body: { name: `C${Date.now()}` } })
    check('can create a category', made.status === 201, `got ${made.status}`)
  }

  section('B — the SAME admin, capped by a read-only role, is genuinely restricted')
  {
    const jar = await login('capped@t.local')
    check('reads it is allowed still work — users list', (await call('GET', '/admin/users', { jar })).status === 200)
    check('reads it is allowed still work — courses list', (await call('GET', '/admin/courses', { jar })).status === 200)

    const create = await call('POST', '/admin/courses', { jar, body: {
      title: 'Blocked', slug: `blocked-${Date.now()}`, price: 0, isFree: true, status: 'draft', language: 'English',
    } })
    check('creating a course is DENIED', create.status === 403 && create.body?.error?.code === 'PERMISSION_DENIED',
      `got ${create.status} ${create.body?.error?.code}`)

    const cat = await call('POST', '/admin/categories', { jar, body: { name: `X${Date.now()}` } })
    check('a resource with NO grant at all is denied', cat.status === 403, `got ${cat.status}`)

    const del = await call('DELETE', `/admin/users/${plainAdmin._id}`, { jar })
    check('deleting a user is DENIED', del.status === 403, `got ${del.status}`)
    check('...and the user really still exists', !!(await UserModel.findById(plainAdmin._id)))
  }

  section('B2 — coverage spans the whole matrix, not a subset')
  {
    const jar = await login('capped@t.local')
    /* A partially-enforced matrix is worse than none: "why does my no-coupons
       role still let me delete coupons?" Each of these resources is named in
       PERMISSION_RESOURCES and granted nothing by the read-only role. */
    const probes: [string, string, string, unknown][] = [
      ['coupons',  'POST',   '/admin/coupons',        { code: 'X', discountType: 'percent', discountValue: 10 }],
      ['announcements', 'POST', '/admin/announcements', { title: 'X', description: 'Y', startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-02T00:00:00.000Z' }],
      ['orders',   'GET',    '/admin/orders',         undefined],
      ['bookings', 'GET',    '/admin/bookings',       undefined],
      ['reports',  'GET',    '/admin/reports/attendance', undefined],
      ['support',  'GET',    '/support/admin',        undefined],
      ['reviews',  'GET',    '/admin/reviews',        undefined],
    ]
    for (const [name, method, path, body] of probes) {
      const r = await call(method, path, { jar, body })
      check(`${name} is denied when the role grants nothing for it`,
        r.status === 403, `got ${r.status}`)
    }
  }

  section('C — the error names what was refused, so it is actionable')
  {
    const jar = await login('capped@t.local')
    const r = await call('POST', '/admin/courses', { jar, body: {
      title: 'X', slug: `x-${Date.now()}`, price: 0, isFree: true, status: 'draft', language: 'English',
    } })
    check('message names the action and resource',
      /create/.test(r.body?.error?.message ?? '') && /courses/.test(r.body?.error?.message ?? ''),
      r.body?.error?.message)
  }

  section('D — report mode observes without blocking, so impact can be measured first')
  {
    process.env.PERMISSIONS_MODE = 'report'
    const jar = await login('capped@t.local')
    const r = await call('POST', '/admin/categories', { jar, body: { name: `R${Date.now()}` } })
    check('the same request that was denied now passes', r.status === 201, `got ${r.status}`)
    process.env.PERMISSIONS_MODE = 'off'
    const off = await call('POST', '/admin/categories', { jar, body: { name: `O${Date.now()}` } })
    check('mode=off disables the system entirely', off.status === 201, `got ${off.status}`)
    delete process.env.PERMISSIONS_MODE
  }

  section('E — a custom role can only NARROW, never widen  ← the escalation guard')
  {
    /* This student carries the "Everything" role: every resource, every action.
       If custom permissions REPLACED the base-role check, assign-role would be
       a privilege-escalation primitive — hand out this role and a student
       becomes omnipotent. requireRole must still refuse them first. */
    const jar = await login('student@t.local').catch(() => null)
    check('a student cannot even reach the admin portal', jar === null,
      'admin login must refuse a student regardless of custom permissions')

    /* And through the client portal, the admin API must still refuse them. */
    const cJar: Jar = new Map()
    await call('POST', '/auth/login', { jar: cJar, body: { email: 'student@t.local', password: PW } })
    const reach = await call('GET', '/admin/users', { jar: cJar })
    check('an all-permissions custom role grants a student NOTHING',
      reach.status === 401 || reach.status === 403, `got ${reach.status}`)
  }

  section('F — a dangling role assignment fails closed')
  {
    const ghost = await RoleModel.create({ name: 'Ghost', isSystem: false, permissions: matrix({}) })
    const orphan = await mk('orphan@t.local', 'admin', { customRoleId: ghost._id })
    const jar = await login('orphan@t.local')
    await RoleModel.findByIdAndDelete(ghost._id)          /* deleted mid-session */
    const r = await call('GET', '/admin/users', { jar })
    check('a deleted role denies rather than silently granting everything',
      r.status === 403 && r.body?.error?.code === 'ROLE_NOT_FOUND',
      `got ${r.status} ${r.body?.error?.code}`)
    await UserModel.findByIdAndDelete(orphan._id)
  }

  section('G — super_admin is never capped, matching every other guard')
  {
    const su = await mk('su@t.local', 'super_admin', { customRoleId: readOnly._id })
    const jar = await login('su@t.local')
    const r = await call('POST', '/admin/categories', { jar, body: { name: `S${Date.now()}` } })
    check('super_admin bypasses even a read-only custom role', r.status === 201, `got ${r.status}`)
    await UserModel.findByIdAndDelete(su._id)
  }

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
