/* Mentor KPIs in the LMS admin (2026-11-09): who may see whose KPIs — an instructor their own, an admin or sub-admin
   their academy's mentors, a super admin every mentor, a student or support nobody's — and what is asked of Root (by
   address, with this server's secret); a correction only for a mentor within reach, sent with who asked; Root not
   opened yet → "not open yet", a mentor not in the month → "missing", neither an error.
   Run: bun --no-env-file src/tests/mentorkpis.suite.ts */
process.env.DATABASE_URL = process.env.MENTORKPIS_DB_URL || 'mongodb://localhost:27017/lms_mentorkpis'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'mentorkpis-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'mentorkpis-suite-refresh-secret-0123456789'
process.env.ROOT_ERP_SECRET = 'mentorkpis-suite-root-secret'
export {}
const http = await import('node:http')
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const j = (v: unknown) => JSON.stringify(v).slice(0, 400)

/* The stand-in Root. */
let open = true
const asked: { method: string; path: string; secret: string; body: any }[] = []
const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => (raw += c))
  req.on('end', () => {
    const u = new URL(req.url ?? '/', 'http://x')
    const body = raw ? JSON.parse(raw) : null
    asked.push({ method: req.method ?? '', path: u.pathname + u.search, secret: String(req.headers['x-portal-secret'] ?? ''), body })
    const send = (s: number, b: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }
    if (req.headers['x-portal-secret'] !== process.env.ROOT_ERP_SECRET) return send(401, { success: false, message: 'Invalid service credential' })
    if (!open) return send(409, { success: false, message: "Mentor KPIs aren't open to the CS Portal yet" })
    if (u.pathname === '/api/v1/service/mentor-kpis/mentor') {
      if (u.searchParams.get('email') === 'new@d.local') return send(404, { success: false, message: "No such mentor in CS Portal's mentor report for that month" })
      return send(200, { success: true, data: { mentor: { email: u.searchParams.get('email'), score: 77 } } })
    }
    if (u.pathname === '/api/v1/service/mentor-kpis/scores') {
      return send(200, { success: true, data: { mentors: String(u.searchParams.get('emails') ?? '').split(',').map(e => ({ email: e })) } })
    }
    if (u.pathname === '/api/v1/service/mentor-kpis/corrections') return send(201, { success: true, data: { status: 'pending', ...body } })
    send(404, { success: false, message: 'Not found' })
  })
})
await new Promise<void>(ok => fake.listen(0, '127.0.0.1', () => ok()))
process.env.ROOT_ERP_API_URL = `http://127.0.0.1:${(fake.address() as { port: number }).port}/api/v1`

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const K = await import('@/services/mentorKpis.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_mentorkpis') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const dubai = new mongoose.Types.ObjectId(), bangalore = new mongoose.Types.ObjectId()
  const person = (name: string, email: string, role: string, org: unknown, extra: Record<string, unknown> = {}) =>
    ({ _id: new mongoose.Types.ObjectId(), name, email, role, organizationId: org, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...extra })
  const ann = person('Ann', 'Ann@D.local', 'instructor', dubai)
  const bob = person('Bob', 'bob@d.local', 'instructor', dubai)
  const raj = person('Raj', 'raj@b.local', 'instructor', bangalore)
  const off = person('Off', 'off@d.local', 'instructor', dubai, { isActive: false })
  const adm = person('Ada', 'ada@d.local', 'admin', dubai)
  const sub = person('Sue', 'sue@d.local', 'sub_admin', dubai)
  const sup = person('Sam', 'sam@x.local', 'super_admin', null)
  const help = person('Hal', 'hal@d.local', 'support', dubai)
  await M.UserModel.collection.insertMany([ann, bob, raj, off, adm, sub, sup, help] as any)
  const as = (u: any) => ({ id: String(u._id), email: u.email, role: u.role, organizationId: u.organizationId ? String(u.organizationId) : undefined })
  const last = () => asked[asked.length - 1]!
  const refused = async (p: Promise<unknown>, status: number) => { try { await p; return false } catch (e) { return e instanceof K.KpiError && e.status === status } }

  const mine: any = await K.myKpis(as(ann), '2026-10')
  check('an instructor: their own month, asked by address (lower case) with the shared secret', mine?.mentor?.email === 'ann@d.local'
    && last().path === '/api/v1/service/mentor-kpis/mentor?email=ann%40d.local&month=2026-10' && last().secret === process.env.ROOT_ERP_SECRET, j(last()))
  check("…can't see a colleague's, has no team view", await refused(K.mentorKpis(as(ann), 'bob@d.local', '2026-10'), 403) && await refused(K.teamKpis(as(ann), '2026-10'), 403))
  check('an admin has no "own" KPIs (403) — they see the team', await refused(K.myKpis(as(adm), '2026-10'), 403))

  await K.teamKpis(as(adm), '2026-10')
  const dubaiTeam = new URL(`http://x${last().path}`).searchParams.get('emails')!.split(',').sort()
  check("an admin: their academy's active mentors (not Bangalore's, not the inactive one)", j(dubaiTeam) === j(['ann@d.local', 'bob@d.local']), j(dubaiTeam))
  await K.teamKpis(as(sub), '2026-10')
  check('a sub-admin: the same', new URL(`http://x${last().path}`).searchParams.get('emails')!.split(',').length === 2)
  await K.teamKpis(as(sup), '2026-10')
  check('a super admin: every academy', new URL(`http://x${last().path}`).searchParams.get('emails')!.split(',').sort().join() === 'ann@d.local,bob@d.local,raj@b.local')
  check('support: nobody (403)', await refused(K.teamKpis(as(help), '2026-10'), 403))
  check("an admin opens their academy's mentor, not another academy's", ((await K.mentorKpis(as(adm), 'BOB@d.local', '2026-10')) as any)?.mentor?.email === 'bob@d.local'
    && await refused(K.mentorKpis(as(adm), 'raj@b.local', '2026-10'), 403))

  const asked1: any = await K.askKpiCorrection(as(adm), { email: 'bob@d.local', month: '2026-10', metric: 'classes_held', action: 'set_value', value: 40, reason: 'Cover classes', evidence: 'Timetable' })
  check('a correction for their mentor: sent with who asked', asked1?.status === 'pending' && last().method === 'POST' && last().body?.raisedBy?.email === 'ada@d.local'
    && last().body?.raisedBy?.name === 'Ada' && last().body?.value === 40, j(last().body))
  check('an instructor for themselves; not for another academy; no reason → 400',
    ((await K.askKpiCorrection(as(ann), { email: 'ann@d.local', month: '2026-10', metric: 'on_time_start', action: 'leave_out', reason: 'Join links down' })) as any)?.value === null
    && await refused(K.askKpiCorrection(as(adm), { email: 'raj@b.local', month: '2026-10', metric: 'classes_held', action: 'leave_out', reason: 'x' }), 403)
    && await refused(K.askKpiCorrection(as(ann), { email: 'ann@d.local', month: '2026-10', metric: 'classes_held', action: 'leave_out', reason: '' }), 400))

  await M.UserModel.collection.insertOne(person('New', 'new@d.local', 'instructor', dubai) as any)
  check('a mentor not in the month: "missing", not an error', ((await K.mentorKpis(as(adm), 'new@d.local', '2026-10')) as any)?.missing === true)
  open = false
  check('Root not opened yet: "not open yet", not an error', ((await K.myKpis(as(ann), '2026-10')) as any)?.closed === true)
  const was = process.env.ROOT_ERP_SECRET
  process.env.ROOT_ERP_SECRET = ''
  check('the Root link not set up: says so (503)', await refused(K.myKpis(as(ann), '2026-10'), 503))
  process.env.ROOT_ERP_SECRET = was
} finally {
  fake.close()
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
