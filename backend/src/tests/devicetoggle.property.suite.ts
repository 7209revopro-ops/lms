/* ─────────────────────────────────────────────────────────────
   Device limit + switch, property/fuzz.

   devicetoggle.suite walks named scenarios. This one generates random
   interleavings of "flip the switch" and "sign in from some browser" and
   checks each outcome against an exact model of what should happen:

     switch OFF                          → always in, nothing recorded
     switch ON, browser already approved → in
     switch ON, browser already pending  → out (DEVICE_PENDING)
     switch ON, browser unknown, 0 approved → in, auto-approved as the main
     switch ON, browser unknown, ≥1 approved → out, recorded as pending

   The interleaving is the point. A switch that is only ever flipped between
   clean states is easy to get right; a switch flipped in the middle of a
   student's device history is where the bugs are — a browser first seen
   while the limit was off, a pending row created before it was turned off,
   an approved device that must survive both.

   Invariants checked on every single step, not just at the end:

     P1  the outcome matches the model, request by request
     P2  no device row is ever created while the switch is off
     P3  a student never ends up with more than two approved devices
     P4  staff are never affected, whatever the switch says
     P5  an approved device stays approved across any number of flips

   Seeded, so a failure names the seed and the step that broke.

   Run: bun run test:devicetoggle-prop
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_devicetoggleprop_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_LOG_DIR = '.logs/emails-devicetoggleprop'
process.env.RATE_LIMIT_AUTH_MAX = '100000'
process.env.RATE_LIMIT_API_MAX  = '100000'
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''
/* No caching: the fuzz flips the switch far faster than any TTL, and the
   cache's own expiry is covered by devicetoggle.suite section K. Leaving it
   on here would only test the cache. */
process.env.SETTINGS_CACHE_TTL_MS = '0'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, DeviceModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const settings = await import('@/services/settings.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_devicetoggleprop_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

const PW = 'FuzzDev1234'

async function login(email: string, deviceId: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cookie': `lms_device=${deviceId}`,
      'user-agent': `Mozilla/5.0 ${deviceId}`,
    },
    body: JSON.stringify({ email, password: PW }),
  })
  const text = await res.text()
  let body: any = {}; try { body = JSON.parse(text) } catch {}
  return { status: res.status, code: String(body?.error?.code ?? '') }
}

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

const staff = await mk('staff@fz.local', 'admin')

section('Random interleavings of switch flips and sign-ins')
{
  const broke: string[] = []
  let steps = 0, offLogins = 0, blocked = 0, autoApproved = 0, flips = 0

  for (let seed = 1; seed <= 25; seed++) {
    const rand = rng(seed)
    await DeviceModel.deleteMany({})
    await settings.setDeviceLimitEnabled(true)

    const student = await mk(`fz${seed}@fz.local`, 'student', { enrollmentStatus: 'approved' })
    const devices = ['d1', 'd2', 'd3', 'd4'].map(d => `${seed}-${d}`)

    /* The model, mirroring device.service.ts. */
    const approved = new Set<string>()
    const pending  = new Set<string>()
    let on = true

    const stepCount = 10 + Math.floor(rand() * 12)
    for (let i = 0; i < stepCount; i++) {
      steps++

      if (rand() < 0.22) {
        on = !on
        await settings.setDeviceLimitEnabled(on)
        flips++
        continue
      }

      /* Occasionally check staff are untouched by any of this. */
      if (rand() < 0.12) {
        const r = await login(staff.email, `${seed}-staffbrowser-${i}`)
        if (r.status !== 200) {
          broke.push(`seed ${seed} step ${i}: staff blocked (${r.status} ${r.code}) with switch ${on ? 'ON' : 'OFF'}`)
        }
        continue
      }

      const dev = devices[Math.floor(rand() * devices.length)]!
      const before = await DeviceModel.countDocuments({})
      const res = await login(student.email, dev)
      const after = await DeviceModel.countDocuments({})

      /* ── the model's verdict ── */
      let expectOk: boolean
      if (!on) {
        expectOk = true
        offLogins++
        /* P2 — nothing recorded while off. */
        if (after !== before) {
          broke.push(`seed ${seed} step ${i}: a device row was written while the switch was OFF (${before} -> ${after})`)
        }
      } else if (approved.has(dev)) {
        expectOk = true
      } else if (pending.has(dev)) {
        expectOk = false
      } else if (approved.size === 0) {
        expectOk = true
        approved.add(dev)
        autoApproved++
      } else {
        expectOk = false
        pending.add(dev)
      }
      if (on && !expectOk) blocked++

      /* P1 — the actual outcome, request by request. */
      const actualOk = res.status === 200
      if (actualOk !== expectOk) {
        broke.push(`seed ${seed} step ${i}: device ${dev}, switch ${on ? 'ON' : 'OFF'} — expected ${expectOk ? 'IN' : 'OUT'}, got ${res.status} ${res.code}`)
      }

      /* P3 — never more than two approved. */
      const approvedRows = await DeviceModel.countDocuments({ userId: student._id, status: 'approved' })
      if (approvedRows > 2) {
        broke.push(`seed ${seed} step ${i}: ${approvedRows} approved devices`)
      }

      /* P5 — an approved device is never silently demoted by a flip. */
      for (const a of approved) {
        const row = await DeviceModel.findOne({ userId: student._id, deviceId: a }).lean() as any
        if (row && row.status !== 'approved') {
          broke.push(`seed ${seed} step ${i}: approved device ${a} became ${row.status}`)
        }
      }
    }
  }

  check(`P1-P5 ${steps} randomised steps across 25 seeds hold every invariant`,
    broke.length === 0, broke.slice(0, 5).join(' | '))

  /* A fuzz that never exercised the interesting branches would pass for the
     wrong reason. */
  check('the run actually flipped the switch', flips > 20, String(flips))
  check('...signed in while it was off', offLogins > 20, String(offLogins))
  check('...blocked while it was on', blocked > 15, String(blocked))
  check('...and auto-approved a main device', autoApproved >= 25, String(autoApproved))
}

/* ═══════════ concurrency ═══════════ */
section('Two admins flipping at the same moment leave a coherent state')
{
  await settings.setDeviceLimitEnabled(true)
  const results = await Promise.all([
    settings.setDeviceLimitEnabled(false),
    settings.setDeviceLimitEnabled(true),
    settings.setDeviceLimitEnabled(false),
    settings.setDeviceLimitEnabled(true),
  ])
  check('C1 every concurrent write resolves', results.length === 4)

  /* The upsert must not have produced two rows racing each other. */
  const { SystemSettingModel } = await import('@/models/schema.ts')
  const rows = await SystemSettingModel.countDocuments({ key: settings.SETTING_DEVICE_LIMIT })
  check('C2 there is exactly one settings row, not one per writer', rows === 1, String(rows))

  const final = await settings.isDeviceLimitEnabled()
  check('C3 the stored value is a real boolean, not a half-written document',
    typeof final === 'boolean', String(final))

  await settings.setDeviceLimitEnabled(true)
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
console.log(`\ndevicetoggle.property.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
