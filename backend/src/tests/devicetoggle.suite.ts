/* ─────────────────────────────────────────────────────────────
   The two-device limit can be switched off — by a super admin only.

   The limit itself: a student's first browser is auto-approved, a second is a
   pending request an admin approves, a third is refused. Staff are exempt.
   devices.suite covers that. This suite covers the SWITCH.

     A  with the limit ON, a second device is blocked — the baseline, so the
        rest of the suite cannot pass vacuously
     B  with it OFF, that same student signs in on device after device
     C  OFF means OFF: no device rows are written while it is off, so the
        approval queue does not fill with requests that blocked nobody
     D  turning it back ON resumes enforcement from the devices recorded
        while it was on
     E  the refresh path honours the switch too — otherwise a student signs
        in and loses the session on the first token refresh
     F  only a super admin can flip it; an org admin is refused
     G  any admin can READ it, because a Devices page showing a queue that
        enforces nothing has to be able to say so
     H  it FAILS CLOSED: absent, malformed, or unreadable settings all mean
        enforced. Only a stored `false` turns a security control off
     I  the change is audited — who turned it off is the whole story
     J  a settings read that THROWS still reports enforced — a database
        blip must not disable a security control
     K  the cached value expires, so a flip reaches other PM2 instances

   Run: bun run test:devicetoggle
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_devicetoggle_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_LOG_DIR = '.logs/emails-devicetoggle'

/* Short enough that section K can watch an entry expire without sleeping for
   fifteen seconds, long enough that every other section's toggle-then-act is
   nowhere near it. */
process.env.SETTINGS_CACHE_TTL_MS = '600'
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
  UserModel, OrganizationModel, DeviceModel, SystemSettingModel, AuditLogModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const settings = await import('@/services/settings.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_devicetoggle_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, opts: {
  jar?: Jar; body?: unknown; deviceId?: string; ua?: string
} = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.ua) headers['user-agent'] = opts.ua
  const cookies = [...(opts.jar ?? new Map())].map(([k, v]) => `${k}=${v}`)
  /* The device id travels as a cookie the client mints — the same way the
     real browser does it. */
  if (opts.deviceId) cookies.push(`lms_device=${opts.deviceId}`)
  if (cookies.length) headers['cookie'] = cookies.join('; ')

  const res = await fetch(`${BASE}${p}`, {
    method, headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (opts.jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let parsed: any = text; try { parsed = JSON.parse(text) } catch {}
  return { status: res.status, body: parsed }
}

const PW = 'Toggle1234'
const code = (r: any) => String(r.body?.error?.code ?? '')

/** Sign a student in from a named browser. */
const loginFrom = (email: string, deviceId: string) =>
  call('POST', '/auth/login', { body: { email, password: PW }, deviceId, ua: `Mozilla/5.0 ${deviceId}` })

try {

const org = await OrganizationModel.create({
  name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
})
const hash = await hashPassword(PW)

const mk = (email: string, role: string, extra: Record<string, unknown> = {}) =>
  UserModel.create({
    name: email.split('@')[0], email, passwordHash: hash, role,
    isActive: true, isVerified: true, organizationId: org._id, ...extra,
  })

const superAdmin = await mk('super@tg.local', 'super_admin')
const orgAdmin   = await mk('orgadmin@tg.local', 'admin')
const student    = await mk('stu@tg.local', 'student', { enrollmentStatus: 'approved' })

const superJar: Jar = new Map()
const orgJar: Jar   = new Map()
{
  const a = await call('POST', '/admin/auth/login', { jar: superJar, body: { email: superAdmin.email, password: PW } })
  const b = await call('POST', '/admin/auth/login', { jar: orgJar,   body: { email: orgAdmin.email,   password: PW } })
  check('setup: the super admin signs in', a.status === 200, String(a.status))
  check('setup: the org admin signs in',   b.status === 200, String(b.status))
}

const setSwitch = (enabled: boolean, jar: Jar = superJar) =>
  call('PATCH', '/admin/settings/device-limit', { jar, body: { enabled } })

/* ═══════════ A — the baseline ═══════════ */
section('A. With the limit ON, a second device is blocked (the baseline)')
{
  const first  = await loginFrom(student.email, 'dev-A1')
  check('A1 the first device signs in', first.status === 200, `${first.status} ${code(first)}`)

  const second = await loginFrom(student.email, 'dev-A2')
  check('A2 a second device is held for approval', second.status === 403, `${second.status} ${code(second)}`)
  check('A3 with a code the client can act on', code(second) === 'DEVICE_PENDING', code(second))
}

/* ═══════════ B/C — switched off ═══════════ */
section('B/C. With it OFF, any device signs in — and none are recorded')
{
  const r = await setSwitch(false)
  check('B1 the super admin can turn it off', r.status === 200, `${r.status} ${JSON.stringify(r.body?.error ?? '')}`)
  check('B2 and the response says so', r.body?.data?.enabled === false, JSON.stringify(r.body?.data))

  /* Deliberately NOT calling invalidateSetting() here. The API ran in this
     same process, so if setDeviceLimitEnabled did not drop its own cache
     entry the switch would appear not to work — and clearing it by hand from
     the test would hide exactly that bug. */

  const before = await DeviceModel.countDocuments({ userId: student._id })

  for (const d of ['dev-B1', 'dev-B2', 'dev-B3', 'dev-B4']) {
    const res = await loginFrom(student.email, d)
    check(`B3 ${d} signs in with no restriction`, res.status === 200, `${res.status} ${code(res)}`)
  }

  /* Recording devices while the limit is off would fill the approval queue
     with requests that blocked nobody — and every one of them would start
     blocking the moment somebody switched the limit back on. */
  const after = await DeviceModel.countDocuments({ userId: student._id })
  check('C1 no device rows are written while it is off', after === before, `${before} -> ${after}`)
}

/* ═══════════ D — switched back on ═══════════ */
section('D. Turning it back ON resumes enforcement from what was recorded')
{
  const r = await setSwitch(true)
  check('D1 the super admin can turn it back on', r.status === 200, String(r.status))

  /* dev-A1 was approved before the switch was ever touched, so it still is. */
  const known = await loginFrom(student.email, 'dev-A1')
  check('D2 the device approved before still signs in', known.status === 200, `${known.status} ${code(known)}`)

  /* A browser used while the limit was off was never recorded, so it is new. */
  const fresh = await loginFrom(student.email, 'dev-B1')
  check('D3 a browser used while it was off is treated as new',
    fresh.status === 403 && code(fresh) === 'DEVICE_PENDING', `${fresh.status} ${code(fresh)}`)
}

/* ═══════════ E — the refresh path ═══════════ */
section('E. The refresh path honours the switch')
{
  /* Without this, turning the limit off would let a student sign in on a new
     browser and then be thrown out fifteen minutes later on its first token
     refresh — the worst of both behaviours. */
  await setSwitch(false)

  const jar: Jar = new Map()
  const login = await call('POST', '/auth/login', {
    jar, body: { email: student.email, password: PW }, deviceId: 'dev-E1',
  })
  check('E1 an unapproved browser signs in while the limit is off', login.status === 200,
    `${login.status} ${code(login)}`)

  const refreshed = await call('POST', '/auth/refresh', { jar, deviceId: 'dev-E1' })
  check('E2 and its session survives a refresh', refreshed.status === 200,
    `${refreshed.status} ${code(refreshed)}`)

  await setSwitch(true)
}

/* ═══════════ F/G — who may touch it ═══════════ */
section('F/G. Super admin writes; any admin reads')
{
  /* One global switch across every academy: a Dubai admin turning it off
     would be turning it off for Bangalore too. */
  const denied = await setSwitch(false, orgJar)
  check('F1 an org admin cannot flip it', denied.status === 403, String(denied.status))

  const stillOn = await settings.isDeviceLimitEnabled()
  check('F2 and the refusal did not change it', stillOn === true, String(stillOn))

  const read = await call('GET', '/admin/settings/device-limit', { jar: orgJar })
  check('G1 an org admin CAN read it', read.status === 200, String(read.status))
  check('G2 and sees the current state', read.body?.data?.enabled === true, JSON.stringify(read.body?.data))
  check('G3 along with who last changed it', 'updatedByName' in (read.body?.data ?? {}),
    JSON.stringify(read.body?.data))
}

/* ═══════════ H — fail closed ═══════════ */
section('H. Anything other than a stored `false` means ENFORCED')
{
  /* A switch that disables a security control must never be turned off by an
     accident — a missing row, a bad write, a database blip. */
  await SystemSettingModel.deleteMany({ key: settings.SETTING_DEVICE_LIMIT })
  settings.invalidateSetting()
  check('H1 no row at all means enforced', (await settings.isDeviceLimitEnabled()) === true)

  for (const junk of ['false', 0, null, 'off', {}, []] as unknown[]) {
    await SystemSettingModel.updateOne(
      { key: settings.SETTING_DEVICE_LIMIT }, { $set: { value: junk } }, { upsert: true })
    settings.invalidateSetting()
    const on = await settings.isDeviceLimitEnabled()
    check(`H2 the value ${JSON.stringify(junk)} does not disable it`, on === true, String(on))
  }

  await SystemSettingModel.updateOne(
    { key: settings.SETTING_DEVICE_LIMIT }, { $set: { value: false } }, { upsert: true })
  settings.invalidateSetting()
  check('H3 only a real boolean false turns it off',
    (await settings.isDeviceLimitEnabled()) === false)

  await settings.setDeviceLimitEnabled(true, String(superAdmin._id))
  settings.invalidateSetting()
}

/* ═══════════ I — the audit trail ═══════════ */
section('I. Flipping the switch is audited')
{
  await AuditLogModel.deleteMany({})
  await setSwitch(false)
  await new Promise(r => setTimeout(r, 400))

  const rows = await AuditLogModel.find({ action: 'settings.device-limit' }).lean() as any[]
  check('I1 the change is written to the audit log', rows.length === 1, String(rows.length))
  check('I2 naming the super admin who made it',
    String(rows[0]?.actorEmail) === superAdmin.email, String(rows[0]?.actorEmail))
  check('I3 and recording which way it went',
    rows[0]?.meta?.enabled === false, JSON.stringify(rows[0]?.meta))

  const meta = await settings.deviceLimitMeta()
  check('I4 the switch itself remembers who last touched it',
    meta.updatedByName === superAdmin.name, String(meta.updatedByName))

  await setSwitch(true)
}

/* ═══════════ J — a broken settings read must FAIL CLOSED ═══════════ */
section('J. If the settings read itself fails, the limit stays ENFORCED')
{
  /* The single most important property here, and the easiest to get wrong:
     a database blip must not quietly disable a security control. Every other
     fail-closed case (no row, junk value) is covered above by inspecting what
     is stored — this one needs the READ to actually break, so the model's
     findOne is replaced with one that throws. */
  settings.invalidateSetting()
  const realFindOne = SystemSettingModel.findOne
  ;(SystemSettingModel as any).findOne = () => { throw new Error('mongo is down') }
  try {
    const enabled = await settings.isDeviceLimitEnabled()
    check('J1 an unreadable setting still means enforced', enabled === true, String(enabled))
  } finally {
    ;(SystemSettingModel as any).findOne = realFindOne
    settings.invalidateSetting()
  }

  /* And it must not have poisoned the cache with the failure. */
  await settings.setDeviceLimitEnabled(false, String(superAdmin._id))
  check('J2 and the next good read is trusted again',
    (await settings.isDeviceLimitEnabled()) === false)
  await settings.setDeviceLimitEnabled(true, String(superAdmin._id))
}

/* ═══════════ K — the cache actually expires ═══════════ */
section('K. The cached value expires, so a flip reaches the other instances')
{
  /* A write clears the cache in the process that served it — section B proves
     that. Every OTHER PM2 instance only finds out when its own entry expires,
     so a cache without a TTL would mean the switch worked on one instance and
     nowhere else. Writing straight to the collection here is exactly what
     another instance's write looks like from this one: a changed row and no
     local invalidation. */
  check('K1 the TTL is the short one this suite asked for',
    settings.CACHE_TTL_MS === 600, String(settings.CACHE_TTL_MS))

  check('K2 it starts enforced', (await settings.isDeviceLimitEnabled()) === true)

  await SystemSettingModel.updateOne(
    { key: settings.SETTING_DEVICE_LIMIT }, { $set: { value: false } }, { upsert: true })

  check('K3 the cached value is still served immediately after',
    (await settings.isDeviceLimitEnabled()) === true, 'a fresh read here would make K4 vacuous')

  await new Promise(r => setTimeout(r, settings.CACHE_TTL_MS + 250))
  check('K4 and the new value is picked up once the entry expires',
    (await settings.isDeviceLimitEnabled()) === false)

  await settings.setDeviceLimitEnabled(true, String(superAdmin._id))
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\ndevicetoggle.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
