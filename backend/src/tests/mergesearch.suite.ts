/* ─────────────────────────────────────────────────────────────
   Duplicates → Merge any two accounts: the search (2026-11-25)
   GET /admin/duplicates/search — student accounts in any state, by name,
   email (or a secondary one) or phone however typed; never staff, never an
   account already merged away; super admin only.
   Run: bun --no-env-file src/tests/mergesearch.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_mergesearch'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.JWT_ACCESS_SECRET  ??= 'mergesearch-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'mergesearch-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_mergesearch') { console.error('REFUSING TO RUN'); process.exit(1) }
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
  if (jar) for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const PW = 'CorrectHorse1'

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  await M.UserModel.create({ name: 'Root', email: 'root@ms.local', passwordHash: hash, role: 'super_admin', isActive: true })
  await M.UserModel.create({ name: 'Ada Admin', email: 'ada@ms.local', passwordHash: hash, role: 'admin', isActive: true, organizationId: org._id })
  const st = (name: string, email: string, extra: Record<string, unknown> = {}) => M.UserModel.create({ name, email, passwordHash: hash, role: 'student', isActive: true, organizationId: org._id, ...extra } as any)
  const pend = await st('Narender kumar', 'narencafe@yahoo.com', { enrollmentStatus: 'pending', enrollmentApplication: { phone: '+971 50 123 4298' } })
  const appr = await st('Narender Kumar', 'narencafe@gmail.com', { enrollmentStatus: 'approved', enrollmentApplication: { phone: '+971501234298' } })
  await st('Other Person', 'other@ms.local', { enrollmentStatus: 'approved', secondaryEmails: [{ email: 'old.naren@ms.local', source: 'merge', addedAt: new Date() }] })
  await st('Narender Gone', 'gone@ms.local', { enrollmentStatus: 'approved', mergedInto: appr._id, isActive: false })
  await M.UserModel.create({ name: 'Narender Staff', email: 'nstaff@ms.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })

  const root: Jar = new Map(), ada: Jar = new Map()
  check('(root signs in)', (await call('POST', '/admin/auth/login', root, { email: 'root@ms.local', password: PW })).status === 200)
  check('(ada signs in)', (await call('POST', '/admin/auth/login', ada, { email: 'ada@ms.local', password: PW })).status === 200)
  const ids = (r: any) => (r.body?.data ?? []).map((a: any) => a.email).sort()

  const byName = await call('GET', '/admin/duplicates/search?q=narender', root)
  check('by name: the pending AND the approved account', JSON.stringify(ids(byName)) === JSON.stringify(['narencafe@gmail.com', 'narencafe@yahoo.com']), JSON.stringify(ids(byName)))
  check('…never a staff account, nor one already merged away', !ids(byName).includes('nstaff@ms.local') && !ids(byName).includes('gone@ms.local'))
  const byEmail = await call('GET', '/admin/duplicates/search?q=cafe@yahoo', root)
  check('by part of an email', JSON.stringify(ids(byEmail)) === JSON.stringify(['narencafe@yahoo.com']), JSON.stringify(ids(byEmail)))
  const bySecondary = await call('GET', '/admin/duplicates/search?q=old.naren', root)
  check('by a secondary email', JSON.stringify(ids(bySecondary)) === JSON.stringify(['other@ms.local']), JSON.stringify(ids(bySecondary)))
  const byPhone = await call('GET', '/admin/duplicates/search?q=0501234298', root)
  check('by phone, however it was typed (spaces, +971)', JSON.stringify(ids(byPhone)) === JSON.stringify(['narencafe@gmail.com', 'narencafe@yahoo.com']), JSON.stringify(ids(byPhone)))
  const twoWords = await call('GET', '/admin/duplicates/search?q=narender%20yahoo', root)
  check('every word must match', JSON.stringify(ids(twoWords)) === JSON.stringify(['narencafe@yahoo.com']), JSON.stringify(ids(twoWords)))
  const status = (byName.body?.data ?? []).find((a: any) => a.email === 'narencafe@yahoo.com')?.enrollmentStatus
  check('each says its status', status === 'pending', String(status))
  check('empty search: nothing', ((await call('GET', '/admin/duplicates/search?q=', root)).body?.data ?? []).length === 0)
  check('an admin is refused (super admin only)', (await call('GET', '/admin/duplicates/search?q=narender', ada)).status === 403)
  const cmp = await call('GET', `/admin/duplicates/compare?ids=${pend._id},${appr._id}`, root)
  check('the picked pair opens Review & merge (compare)', cmp.status === 200 && cmp.body?.data?.accounts?.length === 2, String(cmp.status))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
