/* ─────────────────────────────────────────────────────────────
   Courses shared by both academies (Course.sharedAcademies).

     A. only a super admin can set it (an academy admin's attempt is ignored);
     B. student catalogue: the other academy sees a shared course, never an
        unshared one;
     C. the other academy's admin: sees it in the course list and can read its
        modules, but cannot edit it;
     D. the other academy's admin enrols their own student — even when their
        academy also has a same-titled copy (no WRONG_ACADEMY_COPY);
     E. the roster shows the other academy's admin only their own students;
     F. a student self-enrols in a free shared course from the other academy.
   Run: bun --no-env-file src/tests/sharedcourse.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_sharedcourse'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.GOOGLE_CLIENT_ID = ''; process.env.GOOGLE_REFRESH_TOKEN = ''; process.env.CLT_BASE_URL = ''
process.env.JWT_ACCESS_SECRET  ??= 'sharedcourse-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'sharedcourse-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_sharedcourse') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null; try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'
const ids = (r: any) => ((r.body?.data ?? []) as any[]).map(c => String(c.id ?? c._id))

try {
  const dxb = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (tag: string, role: string, org?: any) => M.UserModel.create({ name: tag, email: `${tag}@sc.local`, passwordHash: hash, role, isActive: true, isVerified: true,
    ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}), ...(org ? { organizationId: org._id } : {}) })
  const sa = await mk('sa', 'super_admin'), dAdmin = await mk('dadmin', 'admin', dxb), bAdmin = await mk('badmin', 'admin', blr)
  const dStu = await mk('dstu', 'student', dxb), bStu = await mk('bstu', 'student', blr), bStu2 = await mk('bstu2', 'student', blr)
  const course = (title: string, org: any, extra: Record<string, unknown> = {}) => M.CourseModel.create({ title, slug: `${title}-${org.slug}`.toLowerCase().replace(/\W+/g, '-'),
    description: 'A course description long enough.', instructorId: sa._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id, ...extra })
  const mbt   = await course('MARKET BREAK-OUT TRADING PROGRAM', dxb)       // will be shared
  const mbtB  = await course('MARKET BREAK-OUT TRADING PROGRAM', blr)       // Bangalore's old copy
  const dOnly = await course('Dubai Only Course', dxb)
  await M.SectionModel.create({ courseId: mbt._id, title: 'MBT 1', order: 1 })
  const adminLogin = async (u: any) => { const j: Jar = new Map(); const r = await call('POST', '/admin/auth/login', { jar: j, body: { email: u.email, password: PW } }); if (r.status !== 200) throw new Error('admin login ' + why(r)); return j }
  const stuLogin = async (u: any) => { const j: Jar = new Map(); const r = await call('POST', '/auth/login', { jar: j, body: { email: u.email, password: PW } }); if (r.status !== 200) throw new Error('login ' + why(r)); return j }
  const SA = await adminLogin(sa), DA = await adminLogin(dAdmin), BA = await adminLogin(bAdmin)

  section('A · only a super admin sets "both academies"')
  const da = await call('PATCH', `/admin/courses/${mbt._id}`, { jar: DA, body: { sharedAcademies: true } })
  check('academy admin PATCH accepted but ignored', da.status === 200 && (await M.CourseModel.findById(mbt._id).lean() as any).sharedAcademies !== true, why(da))
  const s1 = await call('PATCH', `/admin/courses/${mbt._id}`, { jar: SA, body: { sharedAcademies: true } })
  check('super admin sets it', s1.status === 200 && s1.body?.data?.sharedAcademies === true, why(s1))

  section('B · student catalogue')
  const BS = await stuLogin(bStu)
  const cat = await call('GET', '/courses?per_page=50', { jar: BS })
  check('Bangalore student sees the shared Dubai course', ids(cat).includes(String(mbt._id)), why(cat))
  check('…and not the Dubai-only course', !ids(cat).includes(String(dOnly._id)))
  const DS = await stuLogin(dStu)
  const catD = await call('GET', '/courses?per_page=50', { jar: DS })
  check('Dubai student still sees it, and not Bangalore\'s copy', ids(catD).includes(String(mbt._id)) && !ids(catD).includes(String(mbtB._id)))

  section("C · the other academy's admin")
  const list = await call('GET', '/admin/courses?per_page=50&status=all', { jar: BA })
  check('in the Bangalore admin course list', ids(list).includes(String(mbt._id)) && !ids(list).includes(String(dOnly._id)), why(list))
  const outline = await call('GET', `/admin/courses/${mbt._id}/outline`, { jar: BA })
  check('can read its modules', outline.status === 200 && outline.body?.data?.sections?.length === 1, why(outline))
  const edit = await call('PATCH', `/admin/courses/${mbt._id}`, { jar: BA, body: { title: 'Hacked title' } })
  check('cannot edit it (403)', edit.status === 403, why(edit))
  const outlineD = await call('GET', `/admin/courses/${dOnly._id}/outline`, { jar: BA })
  check("cannot read an unshared Dubai course's modules", outlineD.status === 403, why(outlineD))

  section('D · enrols their own student')
  const en = await call('POST', `/admin/users/${bStu2._id}/enrollments`, { jar: BA, body: { courseId: String(mbt._id) } })
  check('201, no WRONG_ACADEMY_COPY although Bangalore has a copy', en.status === 201, why(en))
  await M.EnrollmentModel.create({ userId: dStu._id, courseId: mbt._id, source: 'admin' })

  section('E · roster')
  const rB = await call('GET', `/admin/courses/${mbt._id}/students`, { jar: BA })
  const emailsB = JSON.stringify(rB.body?.data ?? rB.body)
  check('Bangalore admin sees bstu2', rB.status === 200 && emailsB.includes('bstu2@sc.local'), why(rB))
  check("…and not Dubai's student", !emailsB.includes('dstu@sc.local'))
  const rD = await call('GET', `/admin/courses/${mbt._id}/students`, { jar: DA })
  const emailsD = JSON.stringify(rD.body?.data ?? rD.body)
  check('home (Dubai) admin sees both', emailsD.includes('dstu@sc.local') && emailsD.includes('bstu2@sc.local'), why(rD))

  section('F · student self-enrols')
  const self = await call('POST', `/courses/${mbt._id}/enroll`, { jar: BS })
  const selfAlt = self.status === 404 ? await call('POST', `/enrollments`, { jar: BS, body: { courseId: String(mbt._id) } }) : self
  check('Bangalore student enrols in the free shared course', [200, 201].includes(selfAlt.status), why(selfAlt))
  const selfD = await call('POST', `/courses/${dOnly._id}/enroll`, { jar: BS })
  const selfDAlt = selfD.status === 404 ? await call('POST', `/enrollments`, { jar: BS, body: { courseId: String(dOnly._id) } }) : selfD
  check('…but not in a Dubai-only course (403)', selfDAlt.status === 403, why(selfDAlt))
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
