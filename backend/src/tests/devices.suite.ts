/* ─────────────────────────────────────────────────────────────
   The two-device whitelist — the rule every OTHER suite now works around.

   Eight suites used to fail because they signed the same student in from a
   fresh cookie jar each time, which the server correctly read as a parade of
   new browsers. The fix was to carry the `lms_device` cookie the way a browser
   does. That fix is only legitimate if the rule it accommodates is still being
   enforced — otherwise every one of those green suites is green because the
   feature quietly stopped working.

   So this suite deliberately does NOT reuse a device. It asserts the refusals:
   a second browser is held, a third is refused outright, a revoked one stays
   out, and refresh will not resurrect any of them.

   Run: bun run test:devices
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_devices_suite'
await import('./financeStandIn.ts')   // approving a student asks finance first; this one knows everybody
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
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, DeviceModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { MAX_APPROVED_DEVICES } = await import('@/services/device.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_devices_suite') {
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

/* A BRAND NEW browser every time — the opposite of what the other suites do. */
const newBrowser = (): Jar => new Map()
const signIn = (jar: Jar, email: string) =>
  call('POST', '/auth/login', { jar, body: { email, password: PW } })
const code = (r: { body: any }) => r.body?.error?.code

try {
  const org = await OrganizationModel.create({
    name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string) => UserModel.create({
    name: email, email, passwordHash: hash, role, isActive: true,
    organizationId: org._id, ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}),
  })

  const student = await mk('dev.student@t.local', 'student')
  await mk('dev.admin@t.local', 'admin')

  const adminJar = newBrowser()
  await call('POST', '/admin/auth/login', { jar: adminJar, body: { email: 'dev.admin@t.local', password: PW } })

  /* ═══════════════════════════════════════════════ */
  section('A · the first browser is adopted as the main device')
  {
    const b1 = newBrowser()
    const r  = await signIn(b1, 'dev.student@t.local')
    check('the first sign-in succeeds', r.status === 200, `got ${r.status} ${code(r)}`)
    check('and it is handed a device cookie to come back with', b1.has('lms_device'))
    check('the session works', (await call('GET', '/auth/me', { jar: b1 })).status === 200)

    const row = await DeviceModel.findOne({ userId: student._id }).lean()
    check('the device is recorded as approved, with no admin involved',
      (row as any)?.status === 'approved', (row as any)?.status)

    /* Returning on the SAME browser must not spend another slot. */
    const again = await signIn(b1, 'dev.student@t.local')
    check('signing in again on that browser still works', again.status === 200, `got ${again.status} ${code(again)}`)
    const n = await DeviceModel.countDocuments({ userId: student._id })
    check('and does not register a second device', n === 1, String(n))
  }

  /* ═══════════════════════════════════════════════ */
  section('B · a SECOND browser is held for an admin  ← what the other suites tripped over')
  const b2 = newBrowser()
  {
    const r = await signIn(b2, 'dev.student@t.local')
    check('the second browser is refused', r.status === 403, `got ${r.status}`)
    check('with DEVICE_PENDING — held, not rejected', code(r) === 'DEVICE_PENDING', code(r))
    check('NO session cookie is issued to it', !b2.has('lms_at') && !b2.has('lms_rt'),
      [...b2.keys()].join(','))
    check('but it IS given a device cookie, so the admin has something to approve',
      b2.has('lms_device'))
    check('and the API refuses it', (await call('GET', '/auth/me', { jar: b2 })).status === 401)

    const pending = await DeviceModel.findOne({ userId: student._id, status: 'pending' }).lean()
    check('a pending row exists for the admin to act on', !!pending)
  }

  /* ═══════════════════════════════════════════════ */
  section('C · the admin approves it, and only then does it work')
  {
    const list = await call('GET', '/admin/devices?status=pending', { jar: adminJar })
    check('the admin can list pending devices', list.status === 200, `got ${list.status}`)

    const rows = list.body?.data?.rows ?? list.body?.data ?? []
    const row  = rows[0]
    check('the pending device is in that list', !!row, JSON.stringify(rows).slice(0, 160))

    const id = row?.id ?? row?._id
    const ok = await call('PATCH', `/admin/devices/${id}/approve`, { jar: adminJar })
    check('approval succeeds', ok.status === 200, `got ${ok.status} ${code(ok)}`)

    const retry = await signIn(b2, 'dev.student@t.local')
    check('the same browser now signs in', retry.status === 200, `got ${retry.status} ${code(retry)}`)
    check('and its session works', (await call('GET', '/auth/me', { jar: b2 })).status === 200)
  }

  /* ═══════════════════════════════════════════════ */
  section('D · a THIRD browser is refused outright — the cap is real')
  {
    check('the cap under test is two', MAX_APPROVED_DEVICES === 2, String(MAX_APPROVED_DEVICES))
    const approved = await DeviceModel.countDocuments({ userId: student._id, status: 'approved' })
    check('the student is at the cap', approved === 2, String(approved))

    const b3 = newBrowser()
    const r  = await signIn(b3, 'dev.student@t.local')
    check('the third browser is refused', r.status === 403, `got ${r.status}`)
    check('with DEVICE_LIMIT, not DEVICE_PENDING — waiting would never help',
      code(r) === 'DEVICE_LIMIT', code(r))
    check('and no session cookie', !b3.has('lms_at'))

    /* And the admin cannot approve past the cap either. */
    const pending = await DeviceModel.findOne({ userId: student._id, status: 'pending' }).lean()
    const forced = await call('PATCH', `/admin/devices/${String((pending as any)?._id)}/approve`, { jar: adminJar })
    check('the admin cannot approve a third device either', forced.status === 409, `got ${forced.status}`)
    check('and is told why', code(forced) === 'DEVICE_LIMIT', code(forced))
  }

  /* ═══════════════════════════════════════════════ */
  section('E · revoking a device puts it back outside')
  {
    const target = await DeviceModel.findOne({ userId: student._id, status: 'approved' }).lean()
    const rev = await call('PATCH', `/admin/devices/${String((target as any)._id)}/revoke`, { jar: adminJar })
    check('revoke succeeds', rev.status === 200, `got ${rev.status}`)

    const jar: Jar = new Map([['lms_device', String((target as any).deviceId)]])
    const r = await signIn(jar, 'dev.student@t.local')
    check('that browser can no longer sign in', r.status === 403, `got ${r.status}`)
    check('and is told its access was removed', code(r) === 'DEVICE_REVOKED', code(r))
  }

  /* ═══════════════════════════════════════════════ */
  section('F · refresh re-checks the device — a live session does not outlive approval')
  {
    /* An access token lasts fifteen minutes. Refresh is where the door closes,
       so that is where the check has to hold. */
    const still = await DeviceModel.findOne({ userId: student._id, status: 'approved' }).lean()
    const jar: Jar = new Map([['lms_device', String((still as any).deviceId)]])
    const login = await signIn(jar, 'dev.student@t.local')
    check('the surviving device signs in', login.status === 200, `got ${login.status} ${code(login)}`)

    const before = await call('POST', '/auth/refresh', { jar })
    check('refresh works while the device is approved', before.status === 200, `got ${before.status}`)

    await DeviceModel.updateOne({ _id: (still as any)._id }, { $set: { status: 'revoked' } })
    const after = await call('POST', '/auth/refresh', { jar })
    check('and stops the moment it is revoked', after.status === 401, `got ${after.status}`)
    check('with DEVICE_REVOKED', code(after) === 'DEVICE_REVOKED', code(after))

    /* The hole worth naming: no cookie at all must not read as "approved". */
    const naked: Jar = new Map([...jar].filter(([k]) => k !== 'lms_device'))
    const bare = await call('POST', '/auth/refresh', { jar: naked })
    check('a refresh with NO device cookie is refused, not waved through',
      bare.status === 401, `got ${bare.status}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('G · none of this applies to admins')
  {
    const a1 = newBrowser(), a2 = newBrowser(), a3 = newBrowser()
    const body = { email: 'dev.admin@t.local', password: PW }
    const r1 = await call('POST', '/admin/auth/login', { jar: a1, body })
    const r2 = await call('POST', '/admin/auth/login', { jar: a2, body })
    const r3 = await call('POST', '/admin/auth/login', { jar: a3, body })
    check('an admin may sign in from a third browser', r3.status === 200, `got ${r3.status} ${code(r3)}`)
    check('all three admin sessions are live',
      r1.status === 200 && r2.status === 200 && r3.status === 200)
    check('the admin API answers on the newest one',
      (await call('GET', '/admin/users', { jar: a3 })).status === 200)
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
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
