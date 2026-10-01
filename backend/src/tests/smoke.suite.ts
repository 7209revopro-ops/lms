/* ─────────────────────────────────────────────────────────────
   FUNCTIONAL SWEEP — does the product still work, end to end?

   Every other suite in this directory asks "is this vulnerability closed?".
   This one asks the opposite question: after five rounds of security fixes,
   **does each panel still do its job?** A guard that refuses something it
   should allow is as much a defect as one that allows what it should refuse,
   and the security suites are structurally blind to it — they assert on
   denials.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_smoke_suite), dropped on exit. The real `lms` database is never opened,
   and R2 credentials are blanked so uploads land on local disk and are cleaned
   up rather than being written to the production bucket.

   It records EVERY failure rather than stopping at the first, because the
   point is a complete inventory of what is broken, not the earliest symptom.

   Run: bun run test:smoke
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_smoke_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.BACKEND_PUBLIC_URL = 'http://127.0.0.1:8000'
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''
process.env.RATE_LIMIT_AUTH_MAX          = '500'
process.env.RATE_LIMIT_API_MAX           = '5000'
process.env.RATE_LIMIT_SIGNUP_UPLOAD_MAX = '500'
delete process.env.CHECKOUT_BLOCK_REJECTED
delete process.env.SIGNUP_REQUIRE_VERIFICATION

export {}

let pass = 0
const failures: string[] = []
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else { failures.push(`${label}${detail ? '  — ' + detail : ''}`); lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const fs   = await import('fs/promises')
const path = await import('path')
const app  = (await import('@/app.ts')).default
const { UserModel, OrganizationModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_smoke_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)])
const stored: string[] = []

type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, {
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

/** Multipart upload, exactly as the browser sends it. */
async function upload(p: string, jar: Jar | undefined, field: string, buf: Buffer, type: string, name: string, extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append(field, new Blob([new Uint8Array(buf)], { type }), name)
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  const headers: Record<string, string> = {}
  if (jar?.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res  = await fetch(`${BASE}${p}`, { method: 'POST', body: fd, headers })
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  if (body?.data?.key) stored.push(body.data.key)
  return { status: res.status, body }
}

const ok  = (r: { status: number }) => r.status >= 200 && r.status < 300
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${String(r.body?.error?.message ?? '').slice(0, 70)}`
const PW  = 'CorrectHorse1'

try {
  const dubai = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string, extra: object = {}) =>
    UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, organizationId: dubai._id, ...extra })

  await mk('root@t.local', 'super_admin')
  await mk('admin@t.local', 'admin')
  const teacher = await mk('teacher@t.local', 'instructor')
  await mk('student@t.local', 'student', { enrollmentStatus: 'approved' })

  /* One remembered browser per account.

     Students are limited to two APPROVED devices, and every fresh jar is a
     brand-new device — so a suite that signs the same student in three times
     from three empty jars trips the limit on the third and the rest of the
     journey 401s. That is the whitelist working, not a bug, but it is not
     what these checks are about: they want a signed-in student, not a device
     audit. Replaying the account's device cookie keeps every sign-in the same
     browser, which is what a person actually does.

     Callers can still pass their own jar (the signup flow does, to keep
     register and sign-in on one device). */
  const deviceOf = new Map<string, [string, string]>()

  const login = async (email: string, portal: 'admin' | 'client', jar: Jar = new Map()) => {
    const remembered = deviceOf.get(email)
    if (remembered && ![...jar.keys()].some(k => k.startsWith('lms_device'))) {
      jar.set(remembered[0], remembered[1])
    }
    const r = await call('POST', portal === 'admin' ? '/admin/auth/login' : '/auth/login', { jar, body: { email, password: PW } })
    const dev = [...jar.entries()].find(([k]) => k.startsWith('lms_device'))
    if (dev) deviceOf.set(email, dev)
    return { jar, r }
  }

  /* ══════════ ADMIN PANEL ══════════ */
  section('ADMIN — sign in')
  const { jar: adminJar, r: adminLogin } = await login('admin@t.local', 'admin')
  check('admin can sign in', ok(adminLogin), why(adminLogin))
  const me = await call('GET', '/admin/auth/me', { jar: adminJar })
  check('GET /admin/auth/me returns the session', ok(me), why(me))

  section('ADMIN — dashboard and analytics')
  for (const p of ['/admin/stats', '/admin/analytics/enrollments', '/admin/analytics/top-courses', '/admin/analytics/completion']) {
    const r = await call('GET', p, { jar: adminJar })
    check(`GET ${p}`, ok(r), why(r))
  }

  section('ADMIN — create a staff account  ← the flow from the bug report')
  {
    /* Exactly what AddUserModal does: upload the photo, then create the user. */
    const up = await upload('/uploads/document', adminJar, 'file', PNG, 'image/png', 'avatar.png')
    check('profile photo uploads', ok(up), why(up))
    const avatarUrl = up.body?.data?.url

    const created = await call('POST', '/admin/users', { jar: adminJar, body: {
      name: 'HIBA miss', email: `hiba-${Date.now()}@t.local`, password: 'hiba@123jjj',
      role: 'instructor', program: 'digital_marketing', avatarUrl,
    } })
    check('staff account is created', ok(created), why(created))
    check('...and comes back with an id', !!created.body?.data?.id || !!created.body?.data?._id,
      JSON.stringify(created.body?.data ?? '').slice(0, 100))
  }

  section('ADMIN — users list and edit')
  {
    const list = await call('GET', '/admin/users?page=1&per_page=10', { jar: adminJar })
    check('GET /admin/users', ok(list), why(list))
    const target = await mk(`edit-${Date.now()}@t.local`, 'student', { enrollmentStatus: 'pending' })
    const patched = await call('PATCH', `/admin/users/${target._id}`, { jar: adminJar, body: { name: 'Renamed' } })
    check('PATCH /admin/users/:id', ok(patched), why(patched))
    const del = await call('DELETE', `/admin/users/${target._id}`, { jar: adminJar })
    check('DELETE /admin/users/:id', ok(del), why(del))
  }

  section('ADMIN — categories')
  let categoryId = ''
  {
    const c = await call('POST', '/admin/categories', { jar: adminJar, body: { name: `Cat ${Date.now()}` } })
    check('POST /admin/categories', ok(c), why(c))
    categoryId = c.body?.data?.id ?? c.body?.data?._id ?? ''
    const l = await call('GET', '/admin/categories', { jar: adminJar })
    check('GET /admin/categories', ok(l), why(l))
    if (categoryId) {
      const p = await call('PATCH', `/admin/categories/${categoryId}`, { jar: adminJar, body: { description: 'edited' } })
      check('PATCH /admin/categories/:id', ok(p), why(p))
    }
  }

  section('ADMIN — course lifecycle')
  let courseId = '', sectionId = '', lessonId = ''
  {
    const c = await call('POST', '/admin/courses', { jar: adminJar, body: {
      title: 'Smoke Course', slug: `smoke-${Date.now()}`,
      description: 'A description comfortably past the twenty character minimum.',
      price: 100, priceAED: 350, priceINR: 999, isFree: false, status: 'published',
      language: 'English', instructorId: String(teacher._id),
      ...(categoryId ? { categoryId } : {}),
    } })
    check('POST /admin/courses', ok(c), why(c))
    courseId = c.body?.data?.id ?? ''

    if (courseId) {
      check('GET /admin/courses/:id',      ok(await call('GET', `/admin/courses/${courseId}`, { jar: adminJar })))
      check('GET /admin/courses/:id/outline', ok(await call('GET', `/admin/courses/${courseId}/outline`, { jar: adminJar })))
      const p = await call('PATCH', `/admin/courses/${courseId}`, { jar: adminJar, body: { title: 'Smoke Course v2' } })
      check('PATCH /admin/courses/:id', ok(p), why(p))

      const s = await call('POST', `/admin/courses/${courseId}/sections`, { jar: adminJar, body: {
        title: 'Module 1', description: 'What this module covers',
      } })
      check('POST /admin/courses/:id/sections', ok(s), why(s))
      sectionId = s.body?.data?.id ?? s.body?.data?._id ?? ''

      /* The description used to be validated, accepted, and then dropped by the
         controller — every module came back with '' and the admin card read
         "No description". Assert it round-trips on create, edit and re-read. */
      check('a module description is PERSISTED on create',
        s.body?.data?.description === 'What this module covers',
        `got ${JSON.stringify(s.body?.data?.description)}`)

      if (sectionId) {
        const listed = await call('GET', `/admin/courses/${courseId}/sections`, { jar: adminJar })
        const mine = (listed.body?.data ?? []).find((x: any) => (x.id ?? x._id) === sectionId)
        check('and it comes back when the modules are listed',
          mine?.description === 'What this module covers', `got ${JSON.stringify(mine?.description)}`)

        const edited = await call('PATCH', `/admin/sections/${sectionId}`, { jar: adminJar, body: {
          description: 'Edited description',
        } })
        check('PATCH /admin/sections/:id persists a new description',
          edited.body?.data?.description === 'Edited description',
          `got ${JSON.stringify(edited.body?.data?.description)}`)

        const cleared = await call('PATCH', `/admin/sections/${sectionId}`, { jar: adminJar, body: { description: '' } })
        check('and an empty string CLEARS it rather than being ignored',
          cleared.body?.data?.description === '', `got ${JSON.stringify(cleared.body?.data?.description)}`)

        const titleOnly = await call('PATCH', `/admin/sections/${sectionId}`, { jar: adminJar, body: { title: 'Module 1 renamed' } })
        check('a title-only edit leaves the description alone',
          titleOnly.body?.data?.description === '' && titleOnly.body?.data?.title === 'Module 1 renamed',
          `got ${JSON.stringify(titleOnly.body?.data)}`)

        const l = await call('POST', '/admin/lessons', { jar: adminJar, body: {
          courseId, sectionId, title: 'Lesson 1', type: 'quiz', content: 'Body text', order: 1,
        } })
        check('POST /admin/lessons', ok(l), why(l))
        lessonId = l.body?.data?.id ?? l.body?.data?._id ?? ''
        if (lessonId) {
          check('PATCH /admin/lessons/:id', ok(await call('PATCH', `/admin/lessons/${lessonId}`, { jar: adminJar, body: { title: 'Lesson 1 v2' } })))
          const q = await call('PUT', `/admin/lessons/${lessonId}/quiz`, { jar: adminJar, body: {
            passPercent: 50,
            questions: [{ text: '2+2?', type: 'mcq', choices: ['3', '4'], correctAnswer: '1', points: 1 }],
          } })
          check('PUT /admin/lessons/:id/quiz', ok(q), why(q))
        }
      }
    }
  }

  section('ADMIN — coupons')
  {
    const c = await call('POST', '/admin/coupons', { jar: adminJar, body: {
      code: `SMOKE${Date.now()}`.slice(0, 20), discountType: 'percent', discountValue: 10,
    } })
    check('POST /admin/coupons', ok(c), why(c))
    check('GET /admin/coupons', ok(await call('GET', '/admin/coupons', { jar: adminJar })))
  }

  section('ADMIN — live classes')
  {
    if (courseId) {
      const start = new Date(Date.now() + 86_400_000).toISOString()
      const lc = await call('POST', '/admin/live-classes', { jar: adminJar, body: {
        courseId, title: 'Live Session One', scheduledStart: start, durationMins: 60,
        /* isOnline:false keeps this off the Google Meet path. An online
           external session calls Google for a real Meet link, so the
           suite was making a live third-party API call on every run —
           which is both poor hygiene and exactly why this check failed
           intermittently under load. The Meet failure path is asserted
           separately below. */
        type: 'external', language: 'English',
        instructorId: String(teacher._id), isOnline: false, location: 'Dubai Campus', room: 'A1',
      } })
      check('POST /admin/live-classes', ok(lc), why(lc))
      check('GET /admin/live-classes', ok(await call('GET', '/admin/live-classes', { jar: adminJar })))
    }
  }

  section('ADMIN — a Google outage must not read as "unexpected error"')
  {
    /* Scheduling an ONLINE external session calls Google for a Meet link.
       That call had no error handling, so a rate limit or an expired token
       threw past the error middleware as a generic 500 — which is how this
       surfaced: the suite passed six times standalone and failed inside the
       full chain, where the call is likelier to be throttled.

       Blanking the credentials makes the Google client throw deterministically,
       which is the same shape as a live failure. */
    const saved = {
      id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh: process.env.GOOGLE_REFRESH_TOKEN,
      host: process.env.GOOGLE_MEET_HOST_EMAIL, calendar: process.env.GOOGLE_CALENDAR_ID,
    }
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GOOGLE_REFRESH_TOKEN
    /* The co-hosted path authenticates with the service-account key file, not
       these — without a host mailbox it is skipped and the OAuth path fails. */
    delete process.env.GOOGLE_MEET_HOST_EMAIL
    delete process.env.GOOGLE_CALENDAR_ID

    const r = await call('POST', '/admin/live-classes', { jar: adminJar, body: {
      courseId, title: 'Online Session', scheduledStart: new Date(Date.now() + 172_800_000).toISOString(),
      durationMins: 60, type: 'external', language: 'English',
      instructorId: String(teacher._id), isOnline: true,
    } })
    check('a Meet-link failure is NOT a generic 500', r.status !== 500, why(r))
    check('...it names the cause so the admin can act',
      r.body?.error?.code === 'MEET_LINK_UNAVAILABLE', `${r.status} ${r.body?.error?.code}`)

    if (saved.id)      process.env.GOOGLE_CLIENT_ID     = saved.id
    if (saved.secret)  process.env.GOOGLE_CLIENT_SECRET = saved.secret
    if (saved.refresh) process.env.GOOGLE_REFRESH_TOKEN = saved.refresh
    if (saved.host)     process.env.GOOGLE_MEET_HOST_EMAIL = saved.host
    if (saved.calendar) process.env.GOOGLE_CALENDAR_ID     = saved.calendar
  }

  section('ADMIN — enrolment requests, orders, bookings, reviews, support')
  for (const p of ['/admin/enrollment-requests', '/admin/express-members', '/admin/orders', '/admin/bookings', '/admin/reviews', '/support/admin', '/admin/reports/attendance', '/audit-logs']) {
    const r = await call('GET', p, { jar: adminJar })
    check(`GET ${p}`, ok(r), why(r))
  }

  section('ADMIN — approve a pending applicant')
  {
    const applicant = await mk(`applicant-${Date.now()}@t.local`, 'student', { enrollmentStatus: 'pending' })
    const a = await call('PATCH', `/admin/enrollment-requests/${applicant._id}/approve`, { jar: adminJar, body: { categories: ['ai'] } })
    check('PATCH /admin/enrollment-requests/:id/approve', ok(a), why(a))
    const fresh = await UserModel.findById(applicant._id).lean()
    check('...and the applicant is now approved', (fresh as any)?.enrollmentStatus === 'approved', (fresh as any)?.enrollmentStatus)
  }

  /* ══════════ INSTRUCTOR ══════════ */
  section('INSTRUCTOR — sign in and see own courses')
  {
    const { jar, r } = await login('teacher@t.local', 'admin')
    check('instructor can sign in to the admin portal', ok(r), why(r))
    if (ok(r)) {
      const list = await call('GET', '/admin/courses', { jar })
      check('instructor sees the course list', ok(list), why(list))
      const denied = await call('DELETE', `/admin/users/${teacher._id}`, { jar })
      check('instructor is refused user deletion (still guarded)', denied.status === 403, why(denied))
    }
  }

  /* ══════════ STUDENT / CLIENT ══════════ */
  section('CLIENT — public browsing')
  for (const p of ['/courses', '/categories', '/instructors', '/learning-paths']) {
    const r = await call('GET', p)
    check(`GET ${p} (anonymous)`, ok(r), why(r))
  }

  section('CLIENT — signup with documents, then sign in')
  {
    const passport = await upload('/uploads/signup-doc', undefined, 'file', PNG, 'image/png', 'p.png', { kind: 'kyc' })
    const photo    = await upload('/uploads/signup-doc', undefined, 'file', PNG, 'image/png', 'a.png', { kind: 'photo' })
    check('anonymous signup upload works', ok(passport) && ok(photo), why(passport))

    const email = `newbie-${Date.now()}@t.local`
    /* One browser for signup AND the sign-in that follows — the same person
       at the same machine, which is what this check is about. */
    const newbieJar: Jar = new Map()
    const reg = await call('POST', '/auth/register', { jar: newbieJar, body: {
      name: 'New Person', email, password: PW, signupType: 'full', organizationSlug: 'dubai',
      enrollmentApplication: {
        passportUrl: passport.body?.data?.url, idDocUrl: passport.body?.data?.url,
        photoUrl: photo.body?.data?.url, phone: '+971500000000', homeCountry: 'India',
      },
    } })
    check('full signup succeeds', ok(reg), why(reg))
    const { r: li } = await login(email, 'client', newbieJar)
    check('the new account can sign in', ok(li), why(li))
  }

  section('CLIENT — signed-in student journeys')
  {
    const { jar, r } = await login('student@t.local', 'client')
    check('student can sign in', ok(r), why(r))
    if (ok(r)) {
      for (const p of ['/auth/me', '/enrollments/me', '/notifications', '/streaks/me', '/achievements/me', '/favorites/me', '/bookings/me', '/orders/me', '/checkout/config']) {
        const rr = await call('GET', p, { jar })
        check(`GET ${p}`, ok(rr), why(rr))
      }
      if (courseId) {
        const free = await call('POST', '/enrollments', { jar, body: { courseId } })
        check('paid course refuses free enrolment (402)', free.status === 402, why(free))
      }
    }
  }

  section('CLIENT — free course enrolment end to end')
  {
    const fc = await call('POST', '/admin/courses', { jar: adminJar, body: {
      title: 'Free Course', slug: `free-${Date.now()}`,
      description: 'Another description that clears the twenty character minimum.',
      price: 0, isFree: true, status: 'published', language: 'English', instructorId: String(teacher._id),
    } })
    check('a free course can be published', ok(fc), why(fc))
    const freeId = fc.body?.data?.id
    if (freeId) {
      const { jar } = await login('student@t.local', 'client')
      const e = await call('POST', '/enrollments', { jar, body: { courseId: freeId } })
      check('student enrols in the free course', ok(e), why(e))
      const mine = await call('GET', '/enrollments/me', { jar })
      check('...and it appears in their enrolments', ok(mine), why(mine))
    }
  }

  section('ROBUSTNESS — a malformed id must never reach the database')
  {
    /* `Model.findById('not-an-objectid')` throws a Mongoose CastError. Unless
       a route validates first, that error is not one of the registered error
       classes, so it falls through the middleware as a 500 "unexpected error"
       — and writes a stack trace for what is really just a mistyped URL. That
       is exactly how the certificate download behaved, found by this suite
       calling /certificates/me by mistake.

       A 5xx here is the defect. Any 4xx is fine: which one is a judgement the
       individual route gets to make. */
    const { jar: sJar } = await login('student@t.local', 'client')
    const BAD = 'not-an-objectid'

    const probes: [string, string, Jar | undefined, unknown?][] = [
      ['GET',    `/certificates/${BAD}`,           sJar],
      ['GET',    `/courses/${BAD}`,                undefined],
      ['GET',    `/lessons/${BAD}`,                sJar],
      ['GET',    `/admin/courses/${BAD}`,          adminJar],
      ['GET',    `/admin/users/${BAD}/enrollments`, adminJar],
      ['GET',    `/admin/users/${BAD}/orders`,     adminJar],
      ['GET',    `/admin/live-classes/${BAD}`,     adminJar],
      ['PATCH',  `/admin/courses/${BAD}`,          adminJar, { title: 'x' }],
      ['DELETE', `/admin/courses/${BAD}`,          adminJar],
      ['PATCH',  `/admin/users/${BAD}`,            adminJar, { name: 'x' }],
      ['DELETE', `/admin/users/${BAD}`,            adminJar],
      ['DELETE', `/admin/sections/${BAD}`,         adminJar],
      ['DELETE', `/admin/lessons/${BAD}`,          adminJar],
      ['GET',    `/documents/${BAD}/passport`,     sJar],
      ['GET',    `/learning-paths/${BAD}`,         undefined],
      ['POST',   `/enrollments`,                   sJar, { courseId: BAD }],
      ['GET',    `/quizzes/${BAD}`,                sJar],
      ['GET',    `/assignments/${BAD}`,            sJar],
      ['POST',   `/reviews/${BAD}/helpful`,        sJar],
      ['GET',    `/support/${BAD}`,                sJar],
      ['GET',    `/admin/enrollment-requests`,     adminJar],
    ]

    for (const [method, p, jar, body] of probes) {
      const r = await call(method, p, { jar, ...(body !== undefined ? { body } : {}) })
      check(`${method} ${p.replace(BAD, ':bad')} → ${r.status} (not 5xx)`, r.status < 500, why(r))
    }
  }

  section('ADMIN — teardown deletes cleanly')
  {
    if (lessonId)  check('DELETE /admin/lessons/:id',  ok(await call('DELETE', `/admin/lessons/${lessonId}`,  { jar: adminJar })))
    if (sectionId) check('DELETE /admin/sections/:id', ok(await call('DELETE', `/admin/sections/${sectionId}`, { jar: adminJar })))
    if (courseId)  check('DELETE /admin/courses/:id',  ok(await call('DELETE', `/admin/courses/${courseId}`,  { jar: adminJar })))
    const out = await call('POST', '/admin/auth/logout', { jar: adminJar })
    check('admin can sign out', ok(out), why(out))
  }

} finally {
  let removed = 0
  for (const key of stored) {
    if (typeof key !== 'string' || key.includes('..')) continue
    const rel = key.includes('://') ? key.split('/uploads/')[1] : key
    if (!rel) continue
    try { await fs.unlink(path.join(process.cwd(), 'uploads', rel)); removed++ } catch {}
  }
  lines.push(`\n(cleanup: removed ${removed} local upload fixture(s))`)
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('\n──── EVERY FAILURE, for the fix list ────')
  failures.forEach((f, i) => console.log(`${String(i + 1).padStart(2)}. ${f}`))
}
process.exit(failures.length === 0 ? 0 : 1)
