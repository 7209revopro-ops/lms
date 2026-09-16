/* ─────────────────────────────────────────────────────────────
   LMS ↔ CLT Connect — Phase 4: the student join endpoint.

   Phase 3 proved the entitlement RULES. This proves the ENDPOINT that exposes
   them: that each refusal reaches the browser as the right status with the
   right code, and that the one recoverable case (arriving early) carries the
   Retry-After the watch page counts down from.

   Driven over real HTTP against the booted app, because the thing under test
   is the response, not the function.

   Run: bun run test:integration4
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_integration4'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'

import { generateKeyPairSync } from 'node:crypto'
const { privateKey } = generateKeyPairSync('ed25519')
process.env.INTEGRATION_JWT_PRIVATE_KEY =
  Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64')
process.env.INTEGRATION_JWT_KID = 'test-p4'

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
const { createServer } = await import('node:http')

/* Stand-in for CLT so room provisioning resolves. */
const fakeClt = createServer((req, res) => {
  let b = ''
  req.on('data', c => { b += c })
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ courseId: 9, roomName: JSON.parse(b || '{}').roomName, courseCode: 'LMS9' }))
  })
})
await new Promise<void>(r => fakeClt.listen(0, () => r()))
process.env.CLT_BASE_URL   = `http://127.0.0.1:${(fakeClt.address() as { port: number }).port}`
process.env.CLT_S2S_SECRET = 'phase4-secret'

const app = (await import('@/app.ts')).default
const {
  LiveClassModel, OrganizationModel, CourseModel, UserModel, ClassBookingModel,
  EnrollmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_integration4') {
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
  if (opts.jar) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';'); const i = pair!.indexOf('=')
      if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
    }
  }
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body, headers: res.headers }
}

const PW = 'CorrectHorse1'

try {
  const org = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string, extra: Record<string, unknown> = {}) =>
    UserModel.create({ name: email, email, passwordHash: hash, role, isActive: true,
      organizationId: org._id, ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}), ...extra })

  const teacher = await mk('teacher@t.local', 'instructor')
  const student = await mk('student@t.local', 'student')
  await mk('nobooking@t.local', 'student')

  const course = await CourseModel.create({
    title: 'C', slug: 'c-' + Date.now(), description: 'd', instructorId: teacher._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
  })

  const mkClass = (over: Record<string, unknown> = {}) => LiveClassModel.create({
    courseId: course._id, instructorId: teacher._id, title: 'Live',
    scheduledStart: new Date(Date.now() + 5 * 60_000), durationMins: 60,
    type: 'internal', provider: 'livekit', sessionCapacity: 30, organizationId: org._id, ...over,
  })

  const jar: Jar = new Map()
  const li = await call('POST', '/auth/login', { jar, body: { email: 'student@t.local', password: PW } })
  if (li.status !== 200) throw new Error(`student login failed: ${li.status}`)

  const noJar: Jar = new Map()
  await call('POST', '/auth/login', { jar: noJar, body: { email: 'nobooking@t.local', password: PW } })

  /* ═══════════════════════════════════════════════ */
  section('A · the endpoint requires a session')
  const anon = await call('POST', `/live-classes/${(await mkClass())._id}/join-ticket`)
  check('an unauthenticated request is refused', anon.status === 401, String(anon.status))

  section('B · a booked student in the window gets a ticket')
  const cls = await mkClass()
  await ClassBookingModel.create({ userId: student._id, liveClassId: cls._id, status: 'booked' })

  /* A seat without an enrolment is what an admin leaves behind by deleting
     the enrolment (booking rows are not touched), and the gate refuses it
     over HTTP exactly as the service does. Until this check existed the
     fixture minted straight after booking with no enrolment at all. */
  const noEnrol = await call('POST', `/live-classes/${cls._id}/join-ticket`, { jar })
  check('a seat whose enrolment is gone → 403 NOT_ENROLLED',
    noEnrol.status === 403 && noEnrol.body?.error?.code === 'NOT_ENROLLED',
    `${noEnrol.status} ${noEnrol.body?.error?.code}`)

  await EnrollmentModel.create({ userId: student._id, courseId: course._id, status: 'active' })
  const ok = await call('POST', `/live-classes/${cls._id}/join-ticket`, { jar })
  check('200', ok.status === 200, `${ok.status} ${JSON.stringify(ok.body?.error ?? '')}`)
  check('a ticket is returned', typeof ok.body?.data?.ticket === 'string' && ok.body.data.ticket.split('.').length === 3)
  check('with its short lifetime', ok.body?.data?.expiresIn === 90, String(ok.body?.data?.expiresIn))
  check('and the room name', ok.body?.data?.roomName === `lms-${cls._id}`, ok.body?.data?.roomName)
  check('and where to redeem it, so the browser hard-codes no address',
    String(ok.body?.data?.joinUrl).endsWith('/api/lms/join'), ok.body?.data?.joinUrl)
  check('the LiveKit token is NOT minted here — that is CLT’s job',
    ok.body?.data?.token === undefined && ok.body?.data?.ws_url === undefined)

  section('C · refusals reach the browser with a usable code')
  const noBooking = await call('POST', `/live-classes/${cls._id}/join-ticket`, { jar: noJar })
  check('no booking → 403', noBooking.status === 403, String(noBooking.status))
  check('with NOT_BOOKED', noBooking.body?.error?.code === 'NOT_BOOKED', noBooking.body?.error?.code)

  const muxCls = await mkClass({ provider: 'mux' })
  await ClassBookingModel.create({ userId: student._id, liveClassId: muxCls._id, status: 'booked' })
  const notLk = await call('POST', `/live-classes/${muxCls._id}/join-ticket`, { jar })
  check('a Mux class → 400 NOT_A_LIVEKIT_CLASS',
    notLk.status === 400 && notLk.body?.error?.code === 'NOT_A_LIVEKIT_CLASS',
    `${notLk.status} ${notLk.body?.error?.code}`)

  const cancelled = await mkClass({ status: 'cancelled' })
  await ClassBookingModel.create({ userId: student._id, liveClassId: cancelled._id, status: 'booked' })
  const canc = await call('POST', `/live-classes/${cancelled._id}/join-ticket`, { jar })
  check('a cancelled class → 409', canc.status === 409, String(canc.status))

  const badId = await call('POST', '/live-classes/not-an-id/join-ticket', { jar })
  check('a malformed id → 400, not 500', badId.status === 400, String(badId.status))

  section('D · arriving early is recoverable, not an error')
  const early = await mkClass({ scheduledStart: new Date(Date.now() + 3 * 60 * 60_000) })
  await ClassBookingModel.create({ userId: student._id, liveClassId: early._id, status: 'booked' })
  const tooEarly = await call('POST', `/live-classes/${early._id}/join-ticket`, { jar })
  check('425 Too Early, not 403', tooEarly.status === 425, String(tooEarly.status))
  check('the body carries retryAfter for the countdown',
    typeof tooEarly.body?.error?.retryAfter === 'number' && tooEarly.body.error.retryAfter > 0,
    String(tooEarly.body?.error?.retryAfter))
  check('and so does the Retry-After header',
    !!tooEarly.headers.get('retry-after'), String(tooEarly.headers.get('retry-after')))
  check('425 is distinguishable from a refusal — the UI must not conflate them',
    tooEarly.status !== 403 && tooEarly.body?.error?.code === 'TOO_EARLY', tooEarly.body?.error?.code)

  section('E · watchAccess tells the client which engine to render')
  /* watchAccess gates on COURSE enrolment (the purchase), which is a separate
     thing from a class booking — a student can book a session only for a
     course they already own. The enrolment was created in section B, where
     the ticket gate now needs it too. */
  const wa = await call('GET', `/live-classes/${cls._id}/watch`, { jar })
  check('watch access succeeds for a booked student', wa.status === 200, String(wa.status))
  check('it reports provider=livekit', wa.body?.data?.provider === 'livekit', String(wa.body?.data?.provider))
  check('and offers NO playback url — the media only exists in the room',
    wa.body?.data?.playbackUrl === undefined, String(wa.body?.data?.playbackUrl))

  const waMux = await call('GET', `/live-classes/${muxCls._id}/watch`, { jar })
  check('a Mux class still reports provider=mux', waMux.body?.data?.provider === 'mux', String(waMux.body?.data?.provider))

  section('F · every ticket is distinct')
  const t1 = await call('POST', `/live-classes/${cls._id}/join-ticket`, { jar })
  const t2 = await call('POST', `/live-classes/${cls._id}/join-ticket`, { jar })
  check('two requests yield two different tickets',
    t1.body?.data?.ticket !== t2.body?.data?.ticket)

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
