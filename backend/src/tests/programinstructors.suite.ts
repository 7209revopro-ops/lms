/* ─────────────────────────────────────────────────────────────
   The class forms' instructor picker asks for one programme's instructors:
   GET /admin/users?role=instructor&category=<course programme>.

     A  admins and super admins get exactly that programme — by `category` or
        any of `categories`, a lent instructor of the other academy included,
        nobody without the programme
     B  a sub-admin's own department wins over the parameter: asking for
        another department's instructors never reveals them
     C  the course picker a sub-admin sees is their own department's courses

   Run: bun run test:programinstructors
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_programinstructors_suite'
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
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, CourseModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_programinstructors_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers }
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

const PW = 'CorrectHorse1'
let seq = 0
const names = (r: { body: any }) => ((r.body?.data ?? []) as any[]).map(u => u.name).sort()
const same  = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

try {
  const dubai = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash  = await hashPassword(PW)
  const mk = (name: string, role: string, extra: Record<string, unknown> = {}) => UserModel.create({
    name, email: `u${seq++}@pi.local`, passwordHash: hash, role, isActive: true, isVerified: true,
    organizationId: dubai._id, ...extra,
  })
  const login = async (u: any) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email: u.email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${u.name}: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }

  await mk('Fx Teacher',     'instructor', { category: '4x-trading' })
  await mk('Fx Multi',       'instructor', { category: 'ai', categories: ['ai', '4x-trading'] })
  await mk('Dm Teacher',     'instructor', { category: 'digital-marketing' })
  await mk('Ai Teacher',     'instructor', { category: 'ai' })
  await mk('No Programme',   'instructor')
  await mk('Lent Fx',        'instructor', { category: '4x-trading', organizationId: blr._id, sharedAcrossOrgs: true })
  await mk('Unlent Blr Fx',  'instructor', { category: '4x-trading', organizationId: blr._id })

  const admin  = await mk('Admin', 'admin')
  const superA = await mk('Super', 'super_admin', { organizationId: undefined })
  const fxSub  = await mk('Fx Sub', 'sub_admin', { program: 'forex' })
  const dmSub  = await mk('Dm Sub', 'sub_admin', { program: 'digital_marketing' })
  const ADMIN = await login(admin), SUPER = await login(superA), FX = await login(fxSub), DM = await login(dmSub)

  const teacher = await UserModel.findOne({ name: 'Fx Teacher' })
  for (const [title, program] of [['Forex Course', '4x-trading'], ['DM Course', 'digital-marketing'], ['AI Course', 'ai']]) {
    await CourseModel.create({
      title, slug: `c-${seq++}`, description: 'd', instructorId: teacher!._id, price: 0, isFree: true,
      status: 'published', language: 'English', organizationId: dubai._id, program,
    })
  }

  const FX_ALL = ['Fx Multi', 'Fx Teacher', 'Lent Fx']

  /* ═══ A ═══ */
  section('A. Admins get exactly the course programme\'s instructors')
  {
    const r = await call('GET', '/admin/users?role=instructor&per_page=200&category=4x-trading', { jar: ADMIN })
    check('A1 admin: Forex = single-category + multi-category + lent from the other academy', r.status === 200 && same(names(r), FX_ALL), JSON.stringify(names(r)))
    check('A2 nobody without the programme (no DM/AI/no-programme/un-lent)', !names(r).some((n: string) => /Dm|Ai Teacher|No Programme|Unlent/.test(n)))
    const dm = await call('GET', '/admin/users?role=instructor&per_page=200&category=digital-marketing', { jar: ADMIN })
    check('A3 admin: DM gives the DM instructor only', same(names(dm), ['Dm Teacher']), JSON.stringify(names(dm)))
    const all = await call('GET', '/admin/users?role=instructor&per_page=200', { jar: ADMIN })
    check('A4 no programme asked → every instructor this academy may use', names(all).includes('No Programme') && names(all).includes('Dm Teacher') && names(all).includes('Lent Fx'), JSON.stringify(names(all)))
    const sup = await call('GET', '/admin/users?role=instructor&per_page=200&category=4x-trading', { jar: SUPER, headers: { 'x-organization-id': String(dubai._id) } })
    check('A5 super admin switched to Dubai: same Forex list', same(names(sup), FX_ALL), JSON.stringify(names(sup)))
  }

  /* ═══ B ═══ */
  section('B. A sub-admin\'s department wins over the parameter')
  {
    const own = await call('GET', '/admin/users?role=instructor&per_page=200&category=4x-trading', { jar: FX })
    check('B1 Forex head asking for Forex: Forex instructors', own.status === 200 && same(names(own), FX_ALL), JSON.stringify(names(own)))
    const peek = await call('GET', '/admin/users?role=instructor&per_page=200&category=digital-marketing', { jar: FX })
    check('B2 Forex head asking for DM never sees the DM instructor', !names(peek).includes('Dm Teacher'), JSON.stringify(names(peek)))
    const none = await call('GET', '/admin/users?role=instructor&per_page=200', { jar: FX })
    check('B3 Forex head with no parameter: still Forex only', same(names(none), FX_ALL), JSON.stringify(names(none)))
    const dm = await call('GET', '/admin/users?role=instructor&per_page=200&category=4x-trading', { jar: DM })
    check('B4 DM head asking for Forex never sees a Forex instructor', !names(dm).some((n: string) => /Fx/.test(n)), JSON.stringify(names(dm)))
  }

  /* ═══ C ═══ */
  section('C. The course picker is the sub-admin\'s own department')
  {
    const fx = await call('GET', '/admin/courses?per_page=200', { jar: FX })
    const titles = ((fx.body?.data ?? []) as any[]).map(c => c.title).sort()
    check('C1 Forex head sees Forex courses only', same(titles, ['Forex Course']), JSON.stringify(titles))
    const peek = await call('GET', '/admin/courses?per_page=200&program=digital-marketing', { jar: FX })
    const peekTitles = ((peek.body?.data ?? []) as any[]).map(c => c.title)
    check('C2 asking for DM courses never reveals them', !peekTitles.includes('DM Course'), JSON.stringify(peekTitles))
    const adm = await call('GET', '/admin/courses?per_page=200', { jar: ADMIN })
    check('C3 an admin sees every programme\'s courses', ((adm.body?.data ?? []) as any[]).length === 3, String((adm.body?.data ?? []).length))
  }
} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  server.close()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
