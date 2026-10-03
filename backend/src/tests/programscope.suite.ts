/* ─────────────────────────────────────────────────────────────
   A student approved into ONE programme, then enrolled on a course belonging
   to ANOTHER. Which programme are they in, and whose student table do they
   show up in?

   The two things are decided by two different fields, which is the whole
   subtlety:

     · the student's PROGRAMME is `user.categories[]`  ('digital-marketing', 'ai', …)
     · a course's PROGRAMME is  `course.program`       — the SAME vocabulary
     · a sub_admin's SCOPE is   `user.program`         ('digital_marketing', …)
       — a THIRD spelling, translated to the other two by injectCategoryScope

   The student tables (/admin/users, /admin/enrollment-requests) filter on
   `categories`. The course roster (/admin/courses/:id/students) filters on the
   course. So enrolling on a course can put a student in front of an admin
   through one door and not the other — and nothing about enrolling writes
   `categories` except one path with a condition on it.

   This suite runs the whole matrix rather than one example: five ways to be
   approved into Digital Marketing × four ways to then get onto an AI course,
   and for each one asks what the AI sub-admin can actually see.

   Run: bun run test:programscope
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_programscope'
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
const {
  UserModel, CourseModel, EnrollmentModel, OrganizationModel, OrderModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_programscope') {
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

/* Students are capped at two devices; every login here is a fresh jar, so each
   account keeps its own remembered browser. */
const deviceOf = new Map<string, [string, string]>()
async function login(email: string, portal: 'client' | 'admin' = 'admin'): Promise<Jar> {
  const jar: Jar = new Map()
  const known = deviceOf.get(email)
  if (known) jar.set(known[0], known[1])
  const r = await call('POST', portal === 'admin' ? '/admin/auth/login' : '/auth/login',
    { jar, body: { email, password: PW } })
  if (r.status !== 200) throw new Error(`login ${email} (${portal}): ${r.status} ${JSON.stringify(r.body)}`)
  for (const [k, v] of jar) if (k.startsWith('lms_device')) deviceOf.set(email, [k, v])
  return jar
}

const catsOf = async (id: unknown): Promise<string[]> => {
  const u = await UserModel.findById(id).select('categories category').lean() as any
  return (u?.categories?.length ? u.categories : u?.category ? [u.category] : []) as string[]
}

try {
  const org = await OrganizationModel.create({
    name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const hash = await hashPassword(PW)

  const mkStaff = (email: string, role: string, program?: string) => UserModel.create({
    name: email, email, passwordHash: hash, role, isActive: true,
    organizationId: org._id, ...(program ? { program } : {}),
  })

  const teacher = await mkStaff('teach@ps.local', 'instructor')
  await mkStaff('super@ps.local',  'super_admin')
  await mkStaff('full@ps.local',   'admin')
  await mkStaff('dmadmin@ps.local', 'sub_admin', 'digital_marketing')
  await mkStaff('aiadmin@ps.local', 'sub_admin', 'ai')

  const mkCourse = (title: string, program: string, price = 0) => CourseModel.create({
    title, slug: `${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}${Math.random()}`,
    description: 'd', instructorId: teacher._id, price, isFree: price === 0,
    status: 'published', language: 'English', organizationId: org._id, program,
  })

  /* NOTE the vocabulary. A COURSE's `program` is stored in the CATEGORY form
     ('digital-marketing', '4x-trading'), which is what the scoped course
     queries compare against and what the live data holds. A sub_admin's own
     `program` field uses the other form ('digital_marketing', 'forex') and is
     translated by injectCategoryScope. Seeding a course with the sub_admin
     spelling produces a course no scope can match — worth knowing, since
     Course.program is a free-form String with no enum to catch it. */
  const dmCourse = await mkCourse('DM Foundations', 'digital-marketing')
  const aiCourse = await mkCourse('AI Foundations', 'ai')
  const aiPaid   = await mkCourse('AI Paid', 'ai', 500)

  const superJar = await login('super@ps.local')
  const fullJar  = await login('full@ps.local')
  const dmJar    = await login('dmadmin@ps.local')
  const aiJar    = await login('aiadmin@ps.local')

  /* A student who has REQUESTED Digital Marketing and is awaiting approval. */
  let n = 0
  const mkPendingStudent = async (tag: string) => UserModel.create({
    name: `S-${tag}`, email: `s-${tag}-${Date.now()}-${n++}@ps.local`, passwordHash: hash,
    role: 'student', isActive: true, organizationId: org._id,
    enrollmentStatus: 'pending', category: 'digital-marketing', categories: ['digital-marketing'],
  })

  /* ═══════════════════════════════════════════════════════════
     A · the sub_admin scopes resolve at all — everything below rests on it */
  section('A · a sub_admin\'s programme becomes their category scope')
  {
    const dm = await call('GET', '/admin/users?role=student&per_page=100', { jar: dmJar })
    const ai = await call('GET', '/admin/users?role=student&per_page=100', { jar: aiJar })
    check('the DM sub-admin can list students', dm.status === 200, String(dm.status))
    check('the AI sub-admin can list students', ai.status === 200, String(ai.status))
    check('both start empty — no students exist yet',
      (dm.body?.data ?? []).length === 0 && (ai.body?.data ?? []).length === 0)
  }

  /* ═══════════════════════════════════════════════════════════
     B · FIVE ways into Digital Marketing — all must land in the same place */
  section('B · five ways to be approved into Digital Marketing')

  const approvedByWay: Record<string, any> = {}

  /* 1 · super_admin approves */
  {
    const s = await mkPendingStudent('super')
    const r = await call('PATCH', `/admin/enrollment-requests/${String(s._id)}/approve`,
      { jar: superJar, body: { categories: ['digital-marketing'] } })
    check('1 super_admin approve succeeds', r.status === 200, String(r.status))
    check('  → categories = [digital-marketing]',
      JSON.stringify(await catsOf(s._id)) === '["digital-marketing"]',
      JSON.stringify(await catsOf(s._id)))
    approvedByWay['super_admin'] = s
  }

  /* 2 · full admin approves */
  {
    const s = await mkPendingStudent('full')
    const r = await call('PATCH', `/admin/enrollment-requests/${String(s._id)}/approve`,
      { jar: fullJar, body: { categories: ['digital-marketing'] } })
    check('2 admin approve succeeds', r.status === 200, String(r.status))
    check('  → categories = [digital-marketing]',
      JSON.stringify(await catsOf(s._id)) === '["digital-marketing"]',
      JSON.stringify(await catsOf(s._id)))
    approvedByWay['admin'] = s
  }

  /* 3 · the DM sub_admin approves — their scope decides the category, so the
         body cannot be used to grant a programme they do not own. */
  {
    const s = await mkPendingStudent('subdm')
    const r = await call('PATCH', `/admin/enrollment-requests/${String(s._id)}/approve`,
      { jar: dmJar, body: { categories: ['ai'] } })   // deliberately asks for AI
    check('3 sub_admin(DM) approve succeeds', r.status === 200, String(r.status))
    check('  → the scope wins: categories = [digital-marketing], NOT the ai it asked for',
      JSON.stringify(await catsOf(s._id)) === '["digital-marketing"]',
      JSON.stringify(await catsOf(s._id)))
    approvedByWay['sub_admin'] = s
  }

  /* 4 · a script writes the account straight in, the way the bulk importers do */
  {
    const s = await UserModel.create({
      name: 'S-script', email: `s-script-${Date.now()}@ps.local`, passwordHash: hash,
      role: 'student', isActive: true, organizationId: org._id,
      enrollmentStatus: 'approved', category: 'digital-marketing', categories: ['digital-marketing'],
    })
    check('4 a script-created account is approved into DM',
      JSON.stringify(await catsOf(s._id)) === '["digital-marketing"]')
    approvedByWay['script'] = s
  }

  /* 5 · self-approval by paying for a DM course */
  {
    const s = await mkPendingStudent('paid')
    const { OrderService } = await import('@/services/order.service.ts')
    const svc: any = new OrderService()
    /* Drive the same private hook the payment webhook reaches. */
    await svc['_autoApproveViaPayment'](String(s._id), String(dmCourse._id))
    const after = await UserModel.findById(s._id).select('enrollmentStatus').lean() as any
    check('5 paying for a DM course approves the account', after?.enrollmentStatus === 'approved',
      String(after?.enrollmentStatus))
    check('  → categories = [digital-marketing]',
      JSON.stringify(await catsOf(s._id)) === '["digital-marketing"]',
      JSON.stringify(await catsOf(s._id)))
    approvedByWay['self_payment'] = s
  }

  /* ═══════════════════════════════════════════════════════════
     C · all five are visible to the DM admin and invisible to the AI admin */
  section('C · before touching AI, the split is clean')
  {
    const dm = await call('GET', '/admin/users?role=student&per_page=100', { jar: dmJar })
    const ai = await call('GET', '/admin/users?role=student&per_page=100', { jar: aiJar })
    const dmIds = new Set((dm.body?.data ?? []).map((u: any) => String(u.id ?? u._id)))
    const aiIds = new Set((ai.body?.data ?? []).map((u: any) => String(u.id ?? u._id)))

    check('the DM admin sees all five students',
      Object.values(approvedByWay).every(s => dmIds.has(String(s._id))), `${dmIds.size} seen`)
    check('the AI admin sees none of them',
      Object.values(approvedByWay).every(s => !aiIds.has(String(s._id))), `${aiIds.size} seen`)
  }

  /* ═══════════════════════════════════════════════════════════
     D · THE QUESTION — four ways onto an AI course, from a DM student */
  section('D · a DM student joins an AI course, four different ways')

  const afterAiJoin: Record<string, any> = {}

  /* a · purchase */
  {
    const s = approvedByWay['super_admin']
    await OrderModel.create({
      userId: s._id, courseId: aiPaid._id, amount: 500, currency: 'AED',
      status: 'paid', organizationId: org._id,
    })
    await EnrollmentModel.create({ userId: s._id, courseId: aiPaid._id, source: 'purchase' })
    const { OrderService } = await import('@/services/order.service.ts')
    const svc: any = new OrderService()
    /* The hook the payment flow calls. It is the ONLY enrolment path that
       writes categories at all. */
    await svc['_autoApproveViaPayment'](String(s._id), String(aiPaid._id))
    afterAiJoin['purchase'] = s
    check('a PURCHASE of an AI course leaves the student in DM only',
      JSON.stringify(await catsOf(s._id)) === '["digital-marketing"]',
      JSON.stringify(await catsOf(s._id)))
  }

  /* b · an admin enrols them */
  {
    const s = approvedByWay['admin']
    const r = await call('POST', `/admin/users/${String(s._id)}/enrollments`,
      { jar: fullJar, body: { courseId: String(aiCourse._id) } })
    check('an ADMIN can enrol a DM student on an AI course', r.status === 201 || r.status === 200,
      String(r.status))
    afterAiJoin['admin_enrol'] = s
    check('  → and that leaves the student in DM only',
      JSON.stringify(await catsOf(s._id)) === '["digital-marketing"]',
      JSON.stringify(await catsOf(s._id)))
  }

  /* c · the student enrols themselves on the free AI course */
  {
    const s = approvedByWay['sub_admin']
    const jar = await login(s.email, 'client')
    const r = await call('POST', '/enrollments', { jar, body: { courseId: String(aiCourse._id) } })
    check('a student can FREE-ENROL themselves on an AI course',
      r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.body?.error ?? '')}`)
    afterAiJoin['free_self'] = s
    check('  → and that leaves the student in DM only',
      JSON.stringify(await catsOf(s._id)) === '["digital-marketing"]',
      JSON.stringify(await catsOf(s._id)))
  }

  /* d · a script writes the enrolment directly */
  {
    const s = approvedByWay['script']
    await EnrollmentModel.create({ userId: s._id, courseId: aiCourse._id, source: 'script' })
    afterAiJoin['script'] = s
    check('a SCRIPT enrolment leaves the student in DM only',
      JSON.stringify(await catsOf(s._id)) === '["digital-marketing"]',
      JSON.stringify(await catsOf(s._id)))
  }

  check('so on every one of the four paths, the programme stays DM — never DM+AI',
    (await Promise.all(Object.values(afterAiJoin).map(s => catsOf(s._id))))
      .every(c => JSON.stringify(c) === '["digital-marketing"]'))

  /* ═══════════════════════════════════════════════════════════
     E · so what can the AI admin actually see? */
  section('E · the AI sub-admin\'s view of a student on their own course')
  {
    /* The student table used to show the AI admin nobody: it matched on
       `categories`, which no enrolment path writes. It now ALSO matches
       students enrolled on a course belonging to the programme, so the table
       and the course roster finally agree about who the AI students are. */
    const ai = await call('GET', '/admin/users?role=student&per_page=100', { jar: aiJar })
    const aiIds = new Set((ai.body?.data ?? []).map((u: any) => String(u.id ?? u._id)))
    check('the STUDENT TABLE now shows every student on an AI course',
      Object.values(afterAiJoin).every(s => aiIds.has(String(s._id))),
      `${aiIds.size} seen`)
    check('all four routes in are covered, not just the admin one',
      aiIds.size === 4, String(aiIds.size))

    /* Their stored programme is untouched — this is a read-side widening. */
    check('and none of them had their categories rewritten to do it',
      (await Promise.all(Object.values(afterAiJoin).map(s => catsOf(s._id))))
        .every(c => JSON.stringify(c) === '["digital-marketing"]'))

    /* Deliberately NOT widened: the approved-requests list answers "who did we
       approve into this programme", which is a question about the approval,
       not about who is studying. It stays on `categories`. */
    const req = await call('GET', '/admin/enrollment-requests?status=approved&per_page=100', { jar: aiJar })
    const reqIds = new Set((req.body?.data ?? []).map((u: any) => String(u.id ?? u._id)))
    check('the approved-REQUESTS list still answers on approvals alone',
      Object.values(afterAiJoin).every(s => !reqIds.has(String(s._id))),
      `${reqIds.size} seen`)

    /* But the COURSE roster is scoped by the course, not the category — so the
       same student IS visible there. This is the door that stays open. */
    const roster = await call('GET', `/admin/courses/${String(aiCourse._id)}/students`, { jar: aiJar })
    check('but the AI COURSE ROSTER answers for the AI admin', roster.status === 200,
      String(roster.status))
    const names = (roster.body?.data?.rows ?? []).map((r: any) => String(r.student?.name)).sort()
    check('  → and it DOES list the DM students enrolled on that course',
      names.includes('S-subdm') && names.includes('S-script'), JSON.stringify(names))

    const paidRoster = await call('GET', `/admin/courses/${String(aiPaid._id)}/students`, { jar: aiJar })
    check('  → including the one who paid',
      (paidRoster.body?.data?.rows ?? []).some((r: any) => r.student?.name === 'S-super'),
      JSON.stringify((paidRoster.body?.data?.rows ?? []).map((r: any) => r.student?.name)))

    check('and the DM admin still sees all five in the student table',
      (await call('GET', '/admin/users?role=student&per_page=100', { jar: dmJar }))
        .body?.data?.length === 5,
      String((await call('GET', '/admin/users?role=student&per_page=100', { jar: dmJar })).body?.data?.length))
  }

  /* ═══════════════════════════════════════════════════════════
     F · the one route that DOES make it DM + AI */
  section('F · what it takes to actually put the student in both programmes')
  {
    const s = approvedByWay['script']
    /* Approving again through the AI admin merges rather than replaces. */
    const r = await call('PATCH', `/admin/enrollment-requests/${String(s._id)}/approve`, { jar: aiJar })
    check('the AI admin can approve a student into their programme', r.status === 200, String(r.status))
    const cats = await catsOf(s._id)
    check('categories MERGE — the student is now DM and AI',
      cats.includes('digital-marketing') && cats.includes('ai'), JSON.stringify(cats))

    const ai = await call('GET', '/admin/users?role=student&per_page=100', { jar: aiJar })
    check('and only NOW does the AI student table show them',
      (ai.body?.data ?? []).some((u: any) => String(u.id ?? u._id) === String(s._id)),
      String((ai.body?.data ?? []).length))

    const dm = await call('GET', '/admin/users?role=student&per_page=100', { jar: dmJar })
    check('while the DM admin keeps seeing them too — it is a merge, not a move',
      (dm.body?.data ?? []).some((u: any) => String(u.id ?? u._id) === String(s._id)))
  }

  /* ═══════════════════════════════════════════════════════════
     G · repeat the whole D matrix a second time on fresh accounts, to be sure
         the answer is the rule and not an artefact of one ordering */
  section('G · same matrix again, fresh accounts, different order')
  {
    const ways = ['script', 'free_self', 'admin_enrol'] as const
    const results: string[] = []
    for (const way of ways) {
      const s = await mkPendingStudent(`rerun-${way}`)
      await call('PATCH', `/admin/enrollment-requests/${String(s._id)}/approve`,
        { jar: superJar, body: { categories: ['digital-marketing'] } })

      if (way === 'script') {
        await EnrollmentModel.create({ userId: s._id, courseId: aiCourse._id, source: 'script' })
      } else if (way === 'free_self') {
        const jar = await login(s.email, 'client')
        await call('POST', '/enrollments', { jar, body: { courseId: String(aiCourse._id) } })
      } else {
        await call('POST', `/admin/users/${String(s._id)}/enrollments`,
          { jar: fullJar, body: { courseId: String(aiCourse._id) } })
      }
      results.push(`${way}:${JSON.stringify(await catsOf(s._id))}`)

      const ai = await call('GET', '/admin/users?role=student&per_page=100', { jar: aiJar })
      check(`  ${way} — now visible to the AI student table`,
        (ai.body?.data ?? []).some((u: any) => String(u.id ?? u._id) === String(s._id)))
      const dm = await call('GET', '/admin/users?role=student&per_page=100', { jar: dmJar })
      check(`  ${way} — and still visible to the DM one`,
        (dm.body?.data ?? []).some((u: any) => String(u.id ?? u._id) === String(s._id)))
    }
    check('every rerun lands on digital-marketing alone',
      results.every(r => r.endsWith('["digital-marketing"]')), results.join('  '))
  }

  /* == H · the widening has edges: "enrolled on our courses", not "everyone" == */
  section('H · what the widened filter must still refuse')
  {
    /* A DM student with no AI enrolment at all. */
    const outsider = await mkPendingStudent('outsider')
    await call('PATCH', `/admin/enrollment-requests/${String(outsider._id)}/approve`,
      { jar: superJar, body: { categories: ['digital-marketing'] } })

    const seesOutsider = async (jar: Jar) =>
      ((await call('GET', '/admin/users?role=student&per_page=100', { jar })).body?.data ?? [])
        .some((u: any) => String(u.id ?? u._id) === String(outsider._id))

    check('a DM student on no AI course is still invisible to the AI admin',
      !(await seesOutsider(aiJar)))
    check('  ...while the DM admin sees them', await seesOutsider(dmJar))

    /* Enrol, then un-enrol: the row is derived, so it must come AND go. */
    const enrolled = await call('POST', `/admin/users/${String(outsider._id)}/enrollments`,
      { jar: fullJar, body: { courseId: String(aiCourse._id) } })
    check('enrolling them on an AI course puts them in the AI table',
      (enrolled.status === 200 || enrolled.status === 201) && await seesOutsider(aiJar),
      String(enrolled.status))

    const row = await EnrollmentModel.findOne({ userId: outsider._id, courseId: aiCourse._id }).lean()
    const removed = await call('DELETE', `/admin/enrollments/${String((row as any)._id)}`, { jar: fullJar })
    check('un-enrolling takes them back out again - nothing is remembered',
      removed.status === 200 && !(await seesOutsider(aiJar)), String(removed.status))
    check('and they are still a DM student throughout',
      JSON.stringify(await catsOf(outsider._id)) === '["digital-marketing"]',
      JSON.stringify(await catsOf(outsider._id)))

    /* The search box and the programme filter have to survive being combined -
       they build different branches of the query. */
    const searched = await call('GET', '/admin/users?role=student&search=S-subdm&per_page=100', { jar: aiJar })
    const names = (searched.body?.data ?? []).map((u: any) => u.name)
    check('search still narrows within the widened programme filter',
      names.length === 1 && names[0] === 'S-subdm', JSON.stringify(names))
    const noMatch = await call('GET', '/admin/users?role=student&search=nobodyhere&per_page=100', { jar: aiJar })
    check('and a search matching nobody returns nobody',
      (noMatch.body?.data ?? []).length === 0, String((noMatch.body?.data ?? []).length))

    /* Only students. Teaching an AI course must not put an instructor in the
       AI admin's instructor list - that list asks a different question. */
    const instructors = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: aiJar })
    check('the instructor list is NOT widened by who teaches the course',
      !(instructors.body?.data ?? []).some((u: any) => String(u.id ?? u._id) === String(teacher._id)),
      String((instructors.body?.data ?? []).length))

    /* One rule, not two: a full admin filtering by programme sees the same set
       the scoped sub-admin sees, rather than a narrower one. */
    const asSuper = await call('GET', '/admin/users?role=student&category=ai&per_page=100', { jar: superJar })
    const asAi    = await call('GET', '/admin/users?role=student&per_page=100', { jar: aiJar })
    const idsOf = (r: any) => new Set((r.body?.data ?? []).map((u: any) => String(u.id ?? u._id)))
    const a = idsOf(asSuper), b = idsOf(asAi)
    check('a super admin filtering by AI sees exactly what the AI admin sees',
      a.size === b.size && [...a].every(id => b.has(id)), `${a.size} vs ${b.size}`)
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
