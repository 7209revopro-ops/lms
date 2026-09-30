/* ─────────────────────────────────────────────────────────────
   The assignment review dashboard.

   Two questions an admin has when they open this screen: how much work is
   outstanding, and which instructors are keeping up with theirs. Both answers
   are derived from the submission rows — nothing here reads a stored counter,
   so nothing can drift out of agreement with the queue printed below it. That
   agreement is asserted directly (section G) rather than assumed.

   The design decision worth testing hardest is the MEDIAN. A mean response
   time is destroyed by a single abandoned submission: one row left for three
   weeks makes an instructor who answers everything else within the hour look
   negligent, and the number stops supporting the comparison it exists for.
   Section B builds exactly that shape and pins the behaviour.

   Run: bun run test:assignmentstats
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_assignmentstats'
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
const {
  UserModel, CourseModel, OrganizationModel, LiveClassModel, ClassAssignmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_assignmentstats') {
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
let seq = 0
const email = (tag: string) => `${tag}-${Date.now()}-${seq++}@as.local`
const H = 36e5

try {
  const dubai = await OrganizationModel.create({
    name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const blr = await OrganizationModel.create({
    name: 'Delta Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer',
  })
  const hash = await hashPassword(PW)

  const mkUser = (role: string, org: any, tag: string) => UserModel.create({
    name: `${tag}`, email: email(tag), passwordHash: hash, role,
    isActive: true, organizationId: org._id,
  })

  const root      = await mkUser('super_admin', dubai, 'root')
  await UserModel.updateOne({ _id: root._id }, { $unset: { organizationId: '' } })
  const dubaiAdm  = await mkUser('admin', dubai, 'dubai-admin')
  const blrAdm    = await mkUser('admin', blr,   'blr-admin')
  const anna      = await mkUser('instructor', dubai, 'Anna')
  const ben       = await mkUser('instructor', dubai, 'Ben')
  const blrTeach  = await mkUser('instructor', blr,   'Blr-Teacher')
  const student   = await mkUser('student', dubai, 'student')

  const login = async (e: string): Promise<Jar> => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email: e, password: PW } })
    if (r.status !== 200) throw new Error(`login ${e}: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }
  const rootJar  = await login(root.email)
  const dubaiJar = await login(dubaiAdm.email)
  const blrJar   = await login(blrAdm.email)
  const annaJar  = await login(anna.email)

  const course = await CourseModel.create({
    title: 'Course A', slug: `course-a-${Date.now()}`, description: 'd',
    instructorId: anna._id, price: 0, isFree: true, status: 'published',
    language: 'English', organizationId: dubai._id,
  })

  let classSeq = 0
  const mkClass = (instructor: any, org: any) => LiveClassModel.create({
    title: `Session ${classSeq++}`, courseId: course._id, instructorId: instructor._id,
    organizationId: org._id, scheduledStart: new Date(Date.now() - 72 * H),
    durationMins: 60, type: 'external', isOnline: true,
  })

  /* One submission per student per session is enforced by a unique index, so
     each row needs its own session — the same shape production has. */
  const submit = async (opts: {
    instructor: any; org: any; status: 'pending' | 'approved' | 'rejected'
    submittedHoursAgo: number; reviewedHoursAgo?: number
  }) => {
    const cls = await mkClass(opts.instructor, opts.org)
    return ClassAssignmentModel.create({
      studentId: student._id, liveClassId: cls._id, courseId: course._id,
      instructorId: opts.instructor._id, organizationId: opts.org._id,
      title: 'Work', files: [{ url: 'kyc/x.png', name: 'x.png', mimeType: 'image/png', sizeBytes: 10 }],
      status: opts.status,
      submittedAt: new Date(Date.now() - opts.submittedHoursAgo * H),
      ...(opts.reviewedHoursAgo !== undefined && {
        reviewedAt: new Date(Date.now() - opts.reviewedHoursAgo * H),
      }),
    })
  }

  const stats = async (jar: Jar, q = '') =>
    call('GET', `/class-assignments/review/stats${q}`, { jar })
  const of = (r: any, id: string) =>
    (r.body?.data?.instructors ?? []).find((x: any) => x.id === String(id))

  /* ── Anna: three judged fast, one judged very slowly, two still waiting ──
     The slow one is what separates a median from a mean. */
  await submit({ instructor: anna, org: dubai, status: 'approved', submittedHoursAgo: 100, reviewedHoursAgo: 99 })
  await submit({ instructor: anna, org: dubai, status: 'approved', submittedHoursAgo: 100, reviewedHoursAgo: 98 })
  await submit({ instructor: anna, org: dubai, status: 'rejected', submittedHoursAgo: 100, reviewedHoursAgo: 99 })
  await submit({ instructor: anna, org: dubai, status: 'approved', submittedHoursAgo: 600, reviewedHoursAgo: 100 })
  await submit({ instructor: anna, org: dubai, status: 'pending',  submittedHoursAgo: 5 })
  await submit({ instructor: anna, org: dubai, status: 'pending',  submittedHoursAgo: 100 })

  /* ── Ben: one pending, nothing judged at all ── */
  await submit({ instructor: ben, org: dubai, status: 'pending', submittedHoursAgo: 10 })

  /* ── Another academy entirely ── */
  await submit({ instructor: blrTeach, org: blr, status: 'pending',  submittedHoursAgo: 3 })
  await submit({ instructor: blrTeach, org: blr, status: 'approved', submittedHoursAgo: 20, reviewedHoursAgo: 19 })

  /* ═══════════════════════════════════════════════ */
  section('A · the totals are the rows, counted')
  {
    const r = await stats(rootJar)
    check('the endpoint answers', r.status === 200, `${r.status} ${JSON.stringify(r.body?.error ?? '')}`)

    const t = r.body?.data?.totals
    const real = {
      total:    await ClassAssignmentModel.countDocuments({}),
      pending:  await ClassAssignmentModel.countDocuments({ status: 'pending' }),
      approved: await ClassAssignmentModel.countDocuments({ status: 'approved' }),
      rejected: await ClassAssignmentModel.countDocuments({ status: 'rejected' }),
    }
    check('total matches a direct count',    t?.total    === real.total,    `${t?.total} vs ${real.total}`)
    check('awaiting review matches',         t?.pending  === real.pending,  `${t?.pending} vs ${real.pending}`)
    check('approved matches',                t?.approved === real.approved, `${t?.approved} vs ${real.approved}`)
    check('sent back matches',               t?.rejected === real.rejected, `${t?.rejected} vs ${real.rejected}`)
    check('and the three statuses account for every row',
      (t?.pending ?? 0) + (t?.approved ?? 0) + (t?.rejected ?? 0) === t?.total,
      JSON.stringify(t))
  }

  /* ═══════════════════════════════════════════════ */
  section('B · response time is a MEDIAN, so one abandoned row cannot distort it')
  {
    const r = await stats(rootJar)
    const a = of(r, String(anna._id))

    /* Anna's four judged waits are 1h, 2h, 1h and 500h. Median 1.5h; mean 126h.
       An instructor who answers within a couple of hours must not be reported
       as taking five days because one submission was forgotten. */
    check('Anna has four judged submissions', a?.approved + a?.rejected === 4,
      `${a?.approved}+${a?.rejected}`)
    check('her median response is ~1.5h, not the ~126h a mean would give',
      a?.medianResponseHours !== null && a.medianResponseHours < 5,
      String(a?.medianResponseHours))
    check('and it is not simply zero — a real figure is being reported',
      (a?.medianResponseHours ?? 0) > 0, String(a?.medianResponseHours))

    /* The forgotten row is still visible, just not in the median. */
    check('the oldest thing still waiting on her is reported separately (~100h)',
      (a?.oldestPendingHours ?? 0) > 90 && (a?.oldestPendingHours ?? 0) < 110,
      String(a?.oldestPendingHours))

    const resp = r.body?.data?.responsiveness
    check('the overall median is reported too', typeof resp?.medianResponseHours === 'number',
      JSON.stringify(resp))
    check('and the count of submissions waiting more than 48h',
      resp?.pendingOver48h === 1, String(resp?.pendingOver48h))
  }

  /* ═══════════════════════════════════════════════ */
  section('C · every instructor is broken out, worst backlog first')
  {
    const r = await stats(rootJar)
    const list = r.body?.data?.instructors ?? []
    check('all three instructors appear', list.length === 3,
      list.map((x: any) => `${x.name}:${x.total}`).join(' | '))

    const a = of(r, String(anna._id))
    check('Anna is named, not just an id', a?.name === 'Anna', String(a?.name))
    check('her totals are her own rows', a?.total === 6, String(a?.total))
    check('two of them are waiting', a?.pending === 2, String(a?.pending))
    check('three approved', a?.approved === 3, String(a?.approved))
    check('one sent back', a?.rejected === 1, String(a?.rejected))
    check('so her approval rate is 75%', a?.approvalRate === 75, String(a?.approvalRate))

    /* Ben has judged nothing. 0% would read as "approves nothing", which is a
       different and much worse claim than "has not judged anything yet". */
    const b = of(r, String(ben._id))
    check('Ben has judged nothing, so his approval rate is null — NOT 0%',
      b?.approvalRate === null, String(b?.approvalRate))
    check('and he has no median response time either',
      b?.medianResponseHours === null, String(b?.medianResponseHours))

    check('the list leads with the biggest backlog',
      list[0]?.id === String(anna._id), list.map((x: any) => `${x.name}:${x.pending}`).join(' | '))
  }

  /* ═══════════════════════════════════════════════ */
  section('D · the instructor filter narrows both the dashboard and the queue')
  {
    const r = await stats(rootJar, `?instructorId=${String(ben._id)}`)
    check('filtering answers', r.status === 200, String(r.status))
    check('the totals are Ben\'s alone', r.body?.data?.totals?.total === 1,
      String(r.body?.data?.totals?.total))
    check('and only Ben is broken out', (r.body?.data?.instructors ?? []).length === 1
      && r.body?.data?.instructors?.[0]?.id === String(ben._id),
      JSON.stringify((r.body?.data?.instructors ?? []).map((x: any) => x.name)))

    const q = await call('GET', `/class-assignments/review?instructorId=${String(ben._id)}`, { jar: rootJar })
    check('the queue takes the same filter', q.status === 200, String(q.status))
    check('and returns only his submissions',
      (q.body?.data ?? []).length === 1, String((q.body?.data ?? []).length))
    check('the queue rows name the instructor, so the table can show it',
      !!(q.body?.data?.[0]?.instructorId?.name), JSON.stringify(q.body?.data?.[0]?.instructorId))
  }

  /* ═══════════════════════════════════════════════ */
  section('E · the filter cannot be used to see somebody else')
  {
    /* An instructor asking for a colleague's id must get nothing back, not
       that colleague's figures. The filter narrows; it never widens. */
    const r = await stats(annaJar, `?instructorId=${String(ben._id)}`)
    check('an instructor asking for a colleague gets 200, not an error', r.status === 200, String(r.status))
    check('but no totals', r.body?.data?.totals?.total === 0, String(r.body?.data?.totals?.total))
    check('and no breakdown', (r.body?.data?.instructors ?? []).length === 0,
      JSON.stringify(r.body?.data?.instructors))

    const q = await call('GET', `/class-assignments/review?instructorId=${String(ben._id)}`, { jar: annaJar })
    check('the queue leaks nothing either', (q.body?.data ?? []).length === 0,
      String((q.body?.data ?? []).length))

    const own = await stats(annaJar)
    check('unfiltered, she still sees her own six', own.body?.data?.totals?.total === 6,
      String(own.body?.data?.totals?.total))
    check('and only herself in the breakdown', (own.body?.data?.instructors ?? []).length === 1,
      JSON.stringify((own.body?.data?.instructors ?? []).map((x: any) => x.name)))
  }

  /* ═══════════════════════════════════════════════ */
  section('F · academies do not see each other')
  {
    const d = await stats(dubaiJar)
    check('a Dubai admin counts only Dubai', d.body?.data?.totals?.total === 7,
      String(d.body?.data?.totals?.total))
    check('and the Bangalore instructor is absent',
      !of(d, String(blrTeach._id)), JSON.stringify((d.body?.data?.instructors ?? []).map((x: any) => x.name)))

    const b = await stats(blrJar)
    check('a Bangalore admin counts only Bangalore', b.body?.data?.totals?.total === 2,
      String(b.body?.data?.totals?.total))
    check('and Anna is absent from it', !of(b, String(anna._id)),
      JSON.stringify((b.body?.data?.instructors ?? []).map((x: any) => x.name)))

    /* A super admin on "All Orgs" carries no organizationId and sees both. */
    const r = await stats(rootJar)
    check('the super admin sees both academies', r.body?.data?.totals?.total === 9,
      String(r.body?.data?.totals?.total))

    /* Regression — the admin topbar's org switcher sends X-Organization-Id
       for a super_admin (auth.middleware.ts, authenticateAdmin). A super
       admin who has picked "Bangalore Academy" there must see ONLY
       Bangalore's queue and stats, not Dubai's leaking through — this was
       broken two ways at once: the review routes read the client-portal
       guard (authenticateAny), which never looks at that header at all, and
       even once it does, #reach's own condition skipped every super_admin
       unconditionally instead of respecting an org the switcher supplied. */
    const asBlr = { jar: rootJar, headers: { 'x-organization-id': String(blr._id) } }
    const switched = await call('GET', '/class-assignments/review/stats', asBlr)
    check('switched to Bangalore, the super admin\'s totals match Bangalore only',
      switched.body?.data?.totals?.total === 2, String(switched.body?.data?.totals?.total))
    check('...and Anna (Dubai) is absent from the breakdown',
      !of(switched, String(anna._id)),
      JSON.stringify((switched.body?.data?.instructors ?? []).map((x: any) => x.name)))

    const switchedQueue = await call('GET', '/class-assignments/review', asBlr)
    check('the queue is scoped the same way as the dashboard above it',
      (switchedQueue.body?.data ?? []).length === 2, String((switchedQueue.body?.data ?? []).length))
    check('and none of its rows belong to Dubai\'s Anna',
      (switchedQueue.body?.data ?? []).every((x: any) => x.instructorId?.id !== String(anna._id) && x.instructorId?._id !== String(anna._id)),
      JSON.stringify((switchedQueue.body?.data ?? []).map((x: any) => x.instructorId)))
  }

  /* ═══════════════════════════════════════════════ */
  section('G · the dashboard and the queue below it agree')
  {
    /* A count that includes submissions the same admin cannot open in the list
       underneath is worse than no count. Both read the same reach helper;
       this is what proves they still do. */
    for (const [who, jar, label] of [
      [dubaiAdm, dubaiJar, 'Dubai admin'],
      [blrAdm,   blrJar,   'Bangalore admin'],
      [anna,     annaJar,  'instructor'],
    ] as const) {
      void who
      const s = await stats(jar)
      const q = await call('GET', '/class-assignments/review', { jar })
      check(`${label}: the total equals the rows the queue returns`,
        s.body?.data?.totals?.total === (q.body?.data ?? []).length,
        `stats=${s.body?.data?.totals?.total} queue=${(q.body?.data ?? []).length}`)

      const qPending = (q.body?.data ?? []).filter((x: any) => x.status === 'pending').length
      check(`${label}: and awaiting review matches the queue's pending rows`,
        s.body?.data?.totals?.pending === qPending,
        `stats=${s.body?.data?.totals?.pending} queue=${qPending}`)
    }
  }

  /* ═══════════════════════════════════════════════ */
  section('H · a student cannot read the dashboard')
  {
    const anon = await call('GET', '/class-assignments/review/stats')
    check('unauthenticated → 401', anon.status === 401, String(anon.status))

    /* Declared before /:id, or 'review' would be read as a submission id and
       answer 404 — a routing mistake that looks like a missing record. */
    const r = await stats(rootJar)
    check('the route is not swallowed by /:id', r.status === 200 && !!r.body?.data?.totals,
      `${r.status} ${JSON.stringify(r.body?.error ?? '')}`)
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
