/* ─────────────────────────────────────────────────────────────
   Class recordings — the admin library.

   Two properties matter and both are about scope:

     - a super admin sees EVERY academy's recordings
     - anyone else sees only their own, and cannot reach another academy's by
       guessing an id

   Plus: the LMS stores a recording ID, never a URL. A stored URL would need a
   CLT admin token no LMS admin holds, and a presigned link would expire in the
   database — so playback is minted on demand and that is asserted here.

   Run: bun run test:recordings
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_recordings'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.CLT_S2S_SECRET      = 'rec-secret'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

/* Wait for something written OUTSIDE the request the test just made.

   Audit rows are written fire-and-forget from res.on('finish'), and the writer
   dynamic-imports the tenancy helper and resolves the actor's academy before
   inserting — so the row lands some time after the response has been read. A
   fixed sleep encodes a guess at how long that takes: 300ms held while this
   suite ran on its own and lost under the full chain, where the write arrived
   only after the suite had disconnected, and both assertions failed on a race
   rather than on behaviour. Polling waits exactly as long as it needs to, and
   still fails honestly once the deadline passes. */
async function waitFor<T>(read: () => Promise<T>, ms = 5000): Promise<T | null> {
  const until = Date.now() + ms
  for (;;) {
    const got = await read()
    if (got) return got
    if (Date.now() >= until) return null
    await new Promise(r => setTimeout(r, 25))
  }
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const { createServer } = await import('node:http')
const { createHmac } = await import('node:crypto')

/* Stand-in for CLT: records what it was asked for, so the playback call can be
   inspected rather than assumed. */
let lastPlaybackPath = ''
const fakeClt = createServer((req, res) => {
  let b = ''
  req.on('data', c => { b += c })
  req.on('end', () => {
    lastPlaybackPath = req.url ?? ''
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ url: 'https://r2.example/presigned/abc?sig=xyz', expiresIn: 3600 }))
  })
})
await new Promise<void>(r => fakeClt.listen(0, () => r()))
process.env.CLT_BASE_URL = `http://127.0.0.1:${(fakeClt.address() as { port: number }).port}`

const app = (await import('@/app.ts')).default
const { LiveClassModel, OrganizationModel, CourseModel, UserModel, AuditLogModel } =
  await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_recordings') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers }
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

try {
  const dubai = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash  = await hashPassword(PW)

  const mk = (email: string, role: string, org: any) =>
    UserModel.create({ name: email, email, passwordHash: hash, role, isActive: true, organizationId: org })

  const superA  = await mk('super@rec.local', 'super_admin', dubai._id)
  const dubaiA  = await mk('dubai@rec.local', 'admin', dubai._id)
  const blrA    = await mk('blr@rec.local', 'admin', blr._id)
  const teacher = await mk('t@rec.local', 'instructor', dubai._id)

  const course = await CourseModel.create({
    title: 'C', slug: 'c-' + Date.now(), description: 'd', instructorId: teacher._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: dubai._id,
  })

  const mkClass = (title: string, org: any, extra: Record<string, unknown> = {}) =>
    LiveClassModel.create({
      courseId: course._id, instructorId: teacher._id, title,
      scheduledStart: new Date(Date.now() - 86_400_000), durationMins: 60,
      type: 'internal', provider: 'livekit', status: 'ended',
      cltRoomName: `lms-${title}`, sessionCapacity: 30, organizationId: org, ...extra,
    })

  const dubaiRec = await mkClass('dubai-recorded', dubai._id, { cltRecordingId: 101, recordingDurationSecs: 3600 })
  const blrRec   = await mkClass('blr-recorded',   blr._id,   { cltRecordingId: 202 })
  await mkClass('dubai-not-recorded', dubai._id)   // no cltRecordingId

  const jars: Record<string, Jar> = {}
  for (const [k, email] of [['super', 'super@rec.local'], ['dubai', 'dubai@rec.local'], ['blr', 'blr@rec.local']] as const) {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`${k} login failed: ${r.status}`)
    jars[k] = jar
  }

  /* ═══════════════════════════════════════════════ */
  section('A · a super admin sees every academy')
  const all = await call('GET', '/admin/recordings', { jar: jars['super'] })
  check('200', all.status === 200, String(all.status))
  const titles = (all.body?.data ?? []).map((r: any) => r.title)
  check('both academies appear',
    titles.includes('dubai-recorded') && titles.includes('blr-recorded'), JSON.stringify(titles))
  check('a class with NO recording is not listed',
    !titles.includes('dubai-not-recorded'), JSON.stringify(titles))
  check('rows carry the course and instructor for the table',
    all.body.data[0]?.course?.title === 'C' && !!all.body.data[0]?.instructor?.name,
    JSON.stringify(all.body.data[0]))
  check('and a duration where CLT reported one',
    (all.body.data.find((r: any) => r.title === 'dubai-recorded')?.recordingSecs) === 3600)
  check('NO url is stored or returned — it is minted on play',
    all.body.data.every((r: any) => r.url === undefined && r.recordingUrl === undefined))

  section('B · everyone else is scoped to their own academy')
  const dubaiList = await call('GET', '/admin/recordings', { jar: jars['dubai'] })
  const dubaiTitles = (dubaiList.body?.data ?? []).map((r: any) => r.title)
  check('a Dubai admin sees Dubai', dubaiTitles.includes('dubai-recorded'))
  check('and NOT Bangalore', !dubaiTitles.includes('blr-recorded'), JSON.stringify(dubaiTitles))

  const blrList = await call('GET', '/admin/recordings', { jar: jars['blr'] })
  const blrTitles = (blrList.body?.data ?? []).map((r: any) => r.title)
  check('a Bangalore admin sees Bangalore', blrTitles.includes('blr-recorded'))
  check('and NOT Dubai', !blrTitles.includes('dubai-recorded'), JSON.stringify(blrTitles))

  /* ═══════════════════════════════════════════════ */
  section('B2 · the org switcher scopes a super_admin too, not just a scoped admin')
  /* Regression — the admin topbar sends X-Organization-Id for a super_admin
     (authenticateAdmin, auth.middleware.ts). The list route used to check
     `role !== 'super_admin' && orgId && ...`, which skipped the org filter
     for every super_admin unconditionally, switcher selection or not — so
     "Bangalore Academy" selected in the switcher still showed Dubai's
     recordings. Fixed to key off orgId being present, matching every other
     admin listing's reach helper. */
  {
    const switched = await call('GET', '/admin/recordings', {
      jar: jars['super'], headers: { 'x-organization-id': String(blr._id) },
    })
    const switchedTitles = (switched.body?.data ?? []).map((r: any) => r.title)
    check('switched to Bangalore, the super admin sees Bangalore\'s recording',
      switchedTitles.includes('blr-recorded'), JSON.stringify(switchedTitles))
    check('...and NOT Dubai\'s, even though nothing else changed but the header',
      !switchedTitles.includes('dubai-recorded'), JSON.stringify(switchedTitles))

    const unswitched = await call('GET', '/admin/recordings', { jar: jars['super'] })
    const unswitchedTitles = (unswitched.body?.data ?? []).map((r: any) => r.title)
    check('with no header at all ("All Orgs"), the super admin still sees both',
      unswitchedTitles.includes('dubai-recorded') && unswitchedTitles.includes('blr-recorded'),
      JSON.stringify(unswitchedTitles))
  }

  section('C · playback is minted on demand, and scoped')
  const play = await call('POST', `/admin/recordings/${dubaiRec._id}/playback`, { jar: jars['super'] })
  check('a super admin gets a link', play.status === 200, `${play.status} ${JSON.stringify(play.body?.error ?? '')}`)
  check('the link is short-lived', play.body?.data?.expiresIn === 3600, String(play.body?.data?.expiresIn))
  check('the LMS asked CLT for the right recording id',
    lastPlaybackPath === '/api/lms/recordings/101/playback', lastPlaybackPath)

  const crossOrg = await call('POST', `/admin/recordings/${blrRec._id}/playback`, { jar: jars['dubai'] })
  check('a Dubai admin cannot play a Bangalore recording by guessing the id',
    crossOrg.status === 403, `${crossOrg.status} ${crossOrg.body?.error?.code}`)

  const superCross = await call('POST', `/admin/recordings/${blrRec._id}/playback`, { jar: jars['super'] })
  check('but a super admin can — that is the point of the role', superCross.status === 200, String(superCross.status))

  const noRec = await LiveClassModel.findOne({ title: 'dubai-not-recorded' })
  const none = await call('POST', `/admin/recordings/${noRec!._id}/playback`, { jar: jars['super'] })
  check('a class with no recording → 404 NO_RECORDING',
    none.status === 404 && none.body?.error?.code === 'NO_RECORDING',
    `${none.status} ${none.body?.error?.code}`)

  const bad = await call('POST', '/admin/recordings/not-an-id/playback', { jar: jars['super'] })
  check('a malformed id → 400, not 500', bad.status === 400, String(bad.status))

  section('D · watching is audited')
  const log = await waitFor(async () =>
    await AuditLogModel.findOne({ action: 'recording.view' }).sort({ createdAt: -1 }).lean() as any)
  check('a recording.view entry is written', !!log)
  check('naming who watched', log?.actorEmail === 'super@rec.local' || log?.actorEmail === 'dubai@rec.local',
    log?.actorEmail)

  section('E · the listing needs admin rights')
  const anon = await call('GET', '/admin/recordings')
  check('unauthenticated → 401', anon.status === 401, String(anon.status))

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
  fakeClt.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
