/* ─────────────────────────────────────────────────────────────
   Stored asset URLs must leave the API through the proxy.

   The media bucket is private now, so a stored `pub-*.r2.dev/<key>` URL 401s
   in a browser. @/utils/response.ts rewrites every one of them to `/assets/…`
   on the way out — but ONLY for responses that go through its sendSuccess.

   Three route files had quietly grown their own local copy of that helper.
   The failure was invisible from the server side: the JSON looked perfectly
   correct, the browser simply could not fetch the URL, and the avatar fell
   back to a letter. Instructor photos appeared in the admin users table and
   not in the student class-schedule filter — from the same database row.

   So this asserts the rule two ways, because either alone is weak:

     · BEHAVIOUR — the endpoint that was broken now emits a proxy URL;
     · STRUCTURE — no route file defines its own sendSuccess. The behavioural
       test only covers the endpoints it thinks to call, and the next local
       helper will be added to a route nobody thought to test.

   Run: bun run test:asseturls
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_asseturls'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.BACKEND_PUBLIC_URL  = 'http://127.0.0.1:8000'

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
const { readdir, readFile } = await import('node:fs/promises')
const path = (await import('node:path')).default

const app = (await import('@/app.ts')).default
const {
  UserModel, CourseModel, OrganizationModel, LiveClassModel, EnrollmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_asseturls') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path_: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path_}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';')
    const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* empty */ }
  return { status: res.status, body, text }
}

const PW = 'CorrectHorse1'
let seq = 0
const email = (tag: string) => `${tag}-${Date.now()}-${seq++}@au.local`

/* A stored value of exactly the shape the private bucket left behind. */
const STORED_AVATAR = 'https://pub-141ff6250c1340699608dcd12e1c2c92.r2.dev/avatars/probe.png'

try {
  /* ═══════════════════════════════════════════════ */
  section('A · no route file may define its own sendSuccess')
  {
    /* The structural half. A local copy compiles, type-checks and returns
       correct-looking JSON — nothing fails until a human looks at an avatar.
       Scanning the source is the only check that catches the NEXT one. */
    const dir = path.join(process.cwd(), 'src', 'routes')
    const files = (await readdir(dir)).filter(f => f.endsWith('.ts'))
    check('there are route files to scan', files.length > 5, String(files.length))

    const offenders: string[] = []
    for (const f of files) {
      const src = await readFile(path.join(dir, f), 'utf8')
      /* A DEFINITION, not a call or an import. */
      if (/^\s*(export\s+)?(async\s+)?function\s+sendSuccess\s*\(/m.test(src)
        || /^\s*(export\s+)?const\s+sendSuccess\s*=/m.test(src)) {
        offenders.push(f)
      }
    }
    check('none of them shadows the shared helper', offenders.length === 0, offenders.join(', '))

    /* The OTHER shape of the same bypass, which this suite did not look for.

       Shadowing sendSuccess is only one way to skip the rewrite; writing the
       envelope by hand is the other, and it is the one that was actually left
       in the tree. `res.json({ success: true, data: ... })` type-checks, reads
       naturally, and ships raw pub-*.r2.dev URLs straight to the browser.

       Three of them were live when this check was added, two carrying
       avatarUrl: the admin Bookings list (the instructor AND student photo in
       every row) and the admin class-feedback list. A guard written for one
       spelling of a mistake does not cover the other spelling.

       Health and webhook-ack responses are exempt by name -- they carry a
       literal status object, never a stored document. */
    const ENVELOPE_EXEMPT = new Set(['index.routes.ts', 'index.ts', 'webhooks.routes.ts'])
    const handRolled: string[] = []
    for (const f of files) {
      if (ENVELOPE_EXEMPT.has(f)) continue
      const src = await readFile(path.join(dir, f), 'utf8')
      /* res.json( ... success: true ... ) across a few lines, but never an
         error envelope, which legitimately goes out directly. */
      const re = /res\s*\.\s*json\s*\(\s*\{[\s\S]{0,400}?success\s*:\s*true/g
      if (re.test(src)) handRolled.push(f)
    }
    check('none of them hand-rolls a success envelope either',
      handRolled.length === 0, handRolled.join(', '))

    /* And the ones that were offenders now import the shared one, rather than
       having simply deleted the helper and stopped responding. */
    for (const f of ['liveClasses.routes.ts', 'bookings.routes.ts', 'feedback.routes.ts']) {
      const src = await readFile(path.join(dir, f), 'utf8')
      check(`${f} imports the shared sendSuccess`,
        src.includes("from '@/utils/response.ts'") && /import\s*\{[^}]*\bsendSuccess\b/.test(src))
    }
  }

  /* ═══════════════════════════════════════════════ */
  section('B · the rewrite itself')
  {
    const { toAssetUrl } = await import('@/utils/assetUrl.ts')
    check('a public R2 URL becomes a proxy URL',
      String(toAssetUrl(STORED_AVATAR)).includes('/assets/avatars/probe.png'),
      String(toAssetUrl(STORED_AVATAR)))
    /* Paid video and identity scans must NEVER be handed to a public proxy. */
    check('a videos/ key is left alone',
      toAssetUrl('https://pub-x.r2.dev/videos/secret.mp4') === 'https://pub-x.r2.dev/videos/secret.mp4')
    check('a kyc/ key is left alone',
      toAssetUrl('https://pub-x.r2.dev/kyc/passport.png') === 'https://pub-x.r2.dev/kyc/passport.png')
    check('anything that is not an R2 URL passes through',
      toAssetUrl('https://images.unsplash.com/photo.jpg') === 'https://images.unsplash.com/photo.jpg')
  }

  /* ═══════════════════════════════════════════════ */
  section('C · the endpoint that was actually broken')
  {
    const org = await OrganizationModel.create({
      name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
    })
    const hash = await hashPassword(PW)

    const teacher = await UserModel.create({
      name: 'Photo Instructor', email: email('t'), passwordHash: hash, role: 'instructor',
      isActive: true, organizationId: org._id, avatarUrl: STORED_AVATAR,
    })
    const course = await CourseModel.create({
      title: 'Course', slug: `course-${Date.now()}`, description: 'd',
      instructorId: teacher._id, price: 0, isFree: true, status: 'published',
      language: 'English', organizationId: org._id,
    })
    await LiveClassModel.create({
      title: 'Session', courseId: course._id, instructorId: teacher._id,
      organizationId: org._id, scheduledStart: new Date(Date.now() + 6 * 36e5),
      durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
      sessionCapacity: 30, bookedCount: 0,
    })

    const student = await UserModel.create({
      name: 'S', email: email('s'), passwordHash: hash, role: 'student',
      isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org._id,
    })
    await EnrollmentModel.create({ userId: student._id, courseId: course._id, status: 'active' })

    const jar: Jar = new Map()
    const li = await call('POST', '/auth/login', { jar, body: { email: student.email, password: PW } })
    check('the student signs in', li.status === 200, String(li.status))

    const r = await call('GET', '/live-classes', { jar })
    check('the schedule answers', r.status === 200, String(r.status))

    /* Checked on the RAW TEXT, not the parsed object. The rewrite happens on
       the serialised JSON, so a leak anywhere in the payload — a field nobody
       mapped, a nested populate — shows up here and nowhere else. */
    check('NO raw r2.dev URL survives anywhere in the response',
      !r.text.includes('.r2.dev'),
      r.text.split('"').filter(x => x.includes('.r2.dev')).slice(0, 2).join(' | '))

    const row = (r.body?.data ?? [])[0]
    const inst = row?.instructorId
    check('the instructor came through populated', !!inst && typeof inst === 'object',
      JSON.stringify(inst)?.slice(0, 60))
    check('and their avatar is a proxy URL the browser can fetch',
      String(inst?.avatarUrl ?? '').includes('/assets/avatars/probe.png'),
      String(inst?.avatarUrl))
  }

  /* ═══════════════════════════════════════════════ */
  section('D · and the admin side it was always working on')
  {
    /* Both sides read the same stored value. The bug was only ever which
       serializer ran, so asserting they now AGREE is the point. */
    const hash = await hashPassword(PW)
    const org = await OrganizationModel.findOne({ slug: 'dubai' }).lean() as any
    const admin = await UserModel.create({
      name: 'Admin', email: email('a'), passwordHash: hash, role: 'admin',
      isActive: true, organizationId: org._id,
    })
    const aJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: aJar, body: { email: admin.email, password: PW } })

    const r = await call('GET', '/admin/users?role=instructor&per_page=50', { jar: aJar })
    check('the admin list answers', r.status === 200, String(r.status))
    check('it leaks no raw r2.dev URL either', !r.text.includes('.r2.dev'))

    const row = (r.body?.data ?? []).find((u: any) => u.name === 'Photo Instructor')
    check('the same instructor is listed', !!row, String((r.body?.data ?? []).length))
    check('with the SAME proxy URL the student side now gets',
      String(row?.avatarUrl ?? '').includes('/assets/avatars/probe.png'),
      String(row?.avatarUrl))
  }

  /* ═══════════════════════════════════════════════ */
  section('E · the admin Bookings table — hand-rolled envelope, both photos')
  {
    /* The surface in the bug report. Every row carries TWO stored avatars:
       the student who booked, and the session's instructor, reached through a
       nested populate. The route wrote its envelope by hand, so neither was
       ever rewritten -- and section A's original guard could not see it,
       because nothing here shadows sendSuccess. */
    const hash = await hashPassword(PW)
    const org  = await OrganizationModel.findOne({ slug: 'dubai' }).lean() as any
    const lc   = await LiveClassModel.findOne({ title: 'Session' }).lean() as any

    const booker = await UserModel.create({
      name: 'Booking Student', email: email('b'), passwordHash: hash, role: 'student',
      isActive: true, isVerified: true, enrollmentStatus: 'approved',
      organizationId: org._id, avatarUrl: STORED_AVATAR,
    })
    const { ClassBookingModel } = await import('@/models/schema.ts')
    await ClassBookingModel.create({
      userId: booker._id, liveClassId: lc._id, status: 'booked', bookedAt: new Date(),
    })

    const adminRow = await UserModel.findOne({ role: 'admin' }).lean() as any
    const aJar: Jar = new Map()
    const li = await call('POST', '/admin/auth/login', { jar: aJar, body: { email: adminRow.email, password: PW } })
    check('E1 the admin signs in', li.status === 200, String(li.status))

    const r = await call('GET', '/admin/bookings?per_page=50', { jar: aJar })
    check('E2 the bookings list answers', r.status === 200, String(r.status))
    check('E3 no raw r2.dev URL anywhere in it', !r.text.includes('.r2.dev'),
      r.text.split('"').filter(x => x.includes('.r2.dev')).slice(0, 2).join(' | '))

    const row = (r.body?.data ?? [])[0]
    check('E4 the student avatar is proxied',
      String(row?.userId?.avatarUrl ?? '').includes('/assets/avatars/probe.png'),
      String(row?.userId?.avatarUrl))
    /* The nested one, two populates deep -- the instructor shown in the
       INSTRUCTOR column of that table. */
    check('E5 the nested instructor avatar is proxied too',
      String(row?.liveClassId?.instructorId?.avatarUrl ?? '').includes('/assets/avatars/probe.png'),
      String(row?.liveClassId?.instructorId?.avatarUrl))

    /* The hand-rolled envelope also omitted has_next / has_prev, so this
       endpoint answered with a different meta shape from every other
       paginated route. Nothing caught it until it went through the typed
       helper. */
    check('E6 pagination meta is the standard shape',
      r.body?.meta && 'has_next' in r.body.meta && 'has_prev' in r.body.meta,
      JSON.stringify(r.body?.meta))
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
