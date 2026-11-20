/* ─────────────────────────────────────────────────────────────
   A sub admin who also teaches (utils/teaching.ts, 2026-11-20)

     A. setting it: an instructor made Sub admin · CMA with "Also teaches";
        refused on any other role; switched off when the role moves on
     B. a mentor everywhere mentors are found: the instructor list, the public
        list, student chat, time off, meeting outcomes, the Root portal list,
        the daily schedule email
     C. their own mentor screens: /auth/me says so, the class-end questions,
        the mentor chat inbox — a plain sub admin gets none of it
     D. still a sub admin: their department's logs; plain instructors and plain
        sub admins unchanged
   Run: bun --no-env-file src/tests/alsoteaches.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_alsoteaches'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.CLIENT_URL = 'https://app.example.test'
process.env.CLASS_OUTCOME_FROM = '2026-01-01'
process.env.JWT_ACCESS_SECRET  ??= 'alsoteaches-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'alsoteaches-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_alsoteaches') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await M.InstructorScheduleMailModel.createIndexes()
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
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'
const MIN = 60_000

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const staff = (name: string, email: string, role: string, extra: Record<string, unknown> = {}) =>
    M.UserModel.create({ name, email, passwordHash: hash, role, isActive: true, organizationId: org._id, ...extra } as any)
  await M.UserModel.create({ name: 'Root', email: 'root@at.local', passwordHash: hash, role: 'super_admin', isActive: true })
  /* Today an instructor, as Abdul Basit is. */
  const basit  = await staff('Abdul Basit Hashim', 'basit@at.local', 'instructor', { category: 'cma', categories: ['cma'] })
  const plainI = await staff('Ivy Instructor', 'ivy@at.local', 'instructor', { category: 'cma', categories: ['cma'] })
  const lead   = await staff('Lee Lead', 'lead@at.local', 'sub_admin', { program: 'cma', category: 'cma', categories: ['cma'] })
  const adm    = await staff('Ada Admin', 'ada@at.local', 'admin')
  const course = await M.CourseModel.create({ title: 'CMA Part 1', slug: 'cma-1', description: 'd', instructorId: basit._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id, program: 'cma' })
  const student = await M.UserModel.create({ name: 'Ana', email: 'ana@at.local', passwordHash: hash, role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id, category: 'cma', categories: ['cma'] } as any)
  await M.EnrollmentModel.create({ userId: student._id, courseId: course._id, status: 'active', organizationId: org._id } as any)
  /* His class that started 40 minutes ago — the class-end questions are due. */
  const mk = (title: string, who: any, startIn: number) => M.LiveClassModel.create({ title, courseId: course._id, instructorId: who._id, organizationId: org._id, scheduledStart: new Date(Date.now() + startIn), durationMins: 90, type: 'external', isOnline: true, status: 'scheduled', sessionCapacity: 20, bookedCount: 0 })
  await mk('Basit · CMA 1', basit, -40 * MIN)
  await mk('Lee · CMA 2', lead, -40 * MIN)

  const jars: Record<string, Jar> = {}
  for (const who of ['root', 'basit', 'lead']) {
    jars[who] = new Map()
    const r = await call('POST', '/admin/auth/login', jars[who], { email: `${who}@at.local`, password: PW })
    check(`(${who} signs in)`, r.status === 200, why(r))
  }

  section('A · setting it')
  const set = await call('PATCH', `/admin/users/${basit._id}`, jars['root'], { role: 'sub_admin', program: 'cma', alsoTeaches: true, category: 'cma' })
  check('an instructor becomes Sub admin · CMA who also teaches', set.status === 200, why(set))
  const b1 = await M.UserModel.findById(basit._id).lean() as any
  check('…saved: role, department, the switch, and still category CMA', b1.role === 'sub_admin' && b1.program === 'cma' && b1.alsoTeaches === true && b1.category === 'cma', JSON.stringify({ role: b1.role, program: b1.program, alsoTeaches: b1.alsoTeaches, category: b1.category }))
  const onAdmin = await call('PATCH', `/admin/users/${adm._id}`, jars['root'], { alsoTeaches: true })
  check('refused on an admin', onAdmin.status === 400 && onAdmin.body?.error?.code === 'INVALID_ALSO_TEACHES', why(onAdmin))
  const onInstr = await call('PATCH', `/admin/users/${plainI._id}`, jars['root'], { alsoTeaches: true })
  check('refused on an instructor (they already teach)', onInstr.status === 400, why(onInstr))

  section('B · a mentor wherever mentors are found')
  const list = await call('GET', '/admin/users?role=instructor&per_page=50', jars['root'])
  const names = (list.body?.data ?? []).map((u: any) => u.name).sort()
  check('the instructor list: him and Ivy, not the plain sub admin', list.status === 200 && JSON.stringify(names) === JSON.stringify(['Abdul Basit Hashim', 'Ivy Instructor']), `${why(list)} ${JSON.stringify(names)}`)
  const srch = await call('GET', '/admin/users?role=instructor&search=Ana&per_page=50', jars['root'])
  check('a search on the instructor list never returns a student', srch.status === 200 && (srch.body?.data ?? []).length === 0, `${why(srch)} ${JSON.stringify((srch.body?.data ?? []).map((u: any) => u.name))}`)
  const picker = await call('GET', '/admin/users?role=instructor&category=cma&search=basit&per_page=50', jars['root'])
  check('the CMA mentor picker, searched, finds him', JSON.stringify((picker.body?.data ?? []).map((u: any) => u.name)) === JSON.stringify(['Abdul Basit Hashim']), `${why(picker)} ${JSON.stringify((picker.body?.data ?? []).map((u: any) => u.name))}`)
  const pickLead = await call('GET', '/admin/users?role=instructor&per_page=50', jars['lead'])
  check("a CMA sub admin's own picker lists him too", (pickLead.body?.data ?? []).some((u: any) => u.name === 'Abdul Basit Hashim'), `${why(pickLead)} ${JSON.stringify((pickLead.body?.data ?? []).map((u: any) => u.name))}`)
  const pub = await call('GET', '/instructors')
  check('the public instructors list', (pub.body?.data ?? []).some((u: any) => u.name === 'Abdul Basit Hashim') && !(pub.body?.data ?? []).some((u: any) => u.name === 'Lee Lead'), JSON.stringify(pub.body?.data?.map((u: any) => u.name)))
  const { eligibleInstructors } = await import('@/services/chat.service.ts')
  const chatList = (await eligibleInstructors(String(student._id))).map((i: any) => i.name).sort()
  check('a CMA student can message him', chatList.includes('Abdul Basit Hashim') && !chatList.includes('Lee Lead'), JSON.stringify(chatList))
  const { addTimeOff } = await import('@/services/mentorTimeOff.service.ts')
  const off = await addTimeOff({ mentorId: String(basit._id), startsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 10 * 86_400_000 + 3_600_000).toISOString(), reason: 'x' }).then(() => 'ok', e => (e as Error).message)
  check('time off can be marked for him', off === 'ok', off)
  const offLead = await addTimeOff({ mentorId: String(lead._id), startsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 10 * 86_400_000 + 3_600_000).toISOString() }).then(() => 'ok', e => (e as Error).message)
  check('…not for a plain sub admin', offLead !== 'ok', offLead)
  const { outcomeOptions } = await import('@/services/meetingOutcome.service.ts')
  const opts = await outcomeOptions() as any
  check('meeting outcomes list him as a mentor', opts.mentors.some((m: any) => m.email === 'basit@at.local') && !opts.mentors.some((m: any) => m.email === 'lead@at.local'))
  const { mentorPendingForPortal } = await import('@/services/portalMentorPending.service.ts')
  const portal = await mentorPendingForPortal({}) as any
  check("the Root portal's mentor list", portal.mentors.some((m: any) => m.email === 'basit@at.local'), JSON.stringify(portal.mentors?.map((m: any) => m.email)))
  const { runInstructorScheduleMail } = await import('@/jobs/instructorSchedule.job.ts')
  const mailed: string[] = []
  const late = new Date(); late.setUTCHours(19, 30, 0, 0)   /* 11:30 PM UAE — past the mail hour */
  await mk('Basit · tonight', basit, Math.max(late.getTime() - Date.now() + 10 * MIN, 0))
  await runInstructorScheduleMail(late, async (to: string) => { mailed.push(to) })
  check('the daily schedule email reaches him', mailed.includes('basit@at.local'), JSON.stringify(mailed))

  section('C · his own mentor screens')
  const me = await call('GET', '/admin/auth/me', jars['basit'])
  check('/auth/me says he also teaches', me.body?.data?.user?.alsoTeaches === true && me.body?.data?.user?.role === 'sub_admin', JSON.stringify(me.body?.data?.user?.alsoTeaches))
  const pend = await call('GET', '/admin/class-outcomes/pending', jars['basit'])
  check('the class-end questions for his class', pend.status === 200 && pend.body?.data?.classes?.length === 1 && pend.body.data.classes[0].title === 'Basit · CMA 1', `${why(pend)} ${JSON.stringify(pend.body?.data?.classes?.map((c: any) => c.title))}`)
  const pendLead = await call('GET', '/admin/class-outcomes/pending', jars['lead'])
  check('…none for a plain sub admin', pendLead.status === 200 && pendLead.body?.data?.classes?.length === 0, why(pendLead))
  const inbox = await call('GET', '/chat/staff/unread-count', jars['basit'])
  check('his mentor chat inbox opens', inbox.status === 200, why(inbox))
  const inboxLead = await call('GET', '/chat/staff/unread-count', jars['lead'])
  check('…a plain sub admin is refused', inboxLead.status === 403, why(inboxLead))

  section('D · still a sub admin; everyone else unchanged')
  const logs = await call('GET', '/email-logs', jars['basit'])
  check("his department's email logs", logs.status === 200, why(logs))
  const meLead = await call('GET', '/admin/auth/me', jars['lead'])
  check('a plain sub admin: no switch', meLead.body?.data?.user?.alsoTeaches !== true)
  const back = await call('PATCH', `/admin/users/${basit._id}`, jars['root'], { role: 'admin' })
  const b2 = await M.UserModel.findById(basit._id).lean() as any
  check('moved to another role, the switch goes off', back.status === 200 && b2.alsoTeaches !== true, `${why(back)} ${b2.alsoTeaches}`)
  const list2 = await call('GET', '/admin/users?role=instructor&per_page=50', jars['root'])
  check('…and he leaves the instructor list', !(list2.body?.data ?? []).some((u: any) => u.name === 'Abdul Basit Hashim'))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
