/* ─────────────────────────────────────────────────────
   Duplicate accounts — the edges (accountmerge.suite covers the main road).

   Over HTTP, against a real database:
     A. who may: every duplicates endpoint refused to a student, an instructor,
        a sub-admin, support staff and an academy admin; open to a super admin;
     B. bad input is refused, never half-done: ids, picks, confirmation;
     C. finding: three accounts on one phone are one group; a placeholder
        number groups nobody; a dismissed group comes back when a new account
        joins it; the academy filter; a merged account is never a candidate;
     D. a chain — A into B, then B into C — the oldest address still signs in,
        to C; undoing B→C hands it back to B;
     E. the closed account's OWN password does not open the kept account;
        forgot-password with the old address goes to the kept account;
     F. the CS Portal knows the student by the old address or id: course
        access, "view as student" and the CS name/team all reach the kept
        account; a guest checkout with the old address buys on it too;
     G. the closed account is gone from the Express Members list and the
        programme student picker; a programme roster given the old address
        holds the kept account;
     H. signing up again with the closed address is refused, the kept
        account untouched;
     I. statuses: a pending account kept, an approved one closed — approval
        comes across by default; a blocked account can be closed;
     J. undo after the student carried on: what they did since stays;
     K. two merges sharing an account at once: one wins; undo while locked: refused;
     L. a big account (1,500 lesson rows, half clashing; 300 bookings; 400
        notifications): preview, merge and undo in reasonable time, undo exact.
   Run: bun --no-env-file src/tests/accountmerge.edge.suite.ts
───────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_accountmerge_edge'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.OTP_DEV_ECHO = '1'
process.env.RATE_LIMIT_AUTH_MAX = '5000'
process.env.RATE_LIMIT_API_MAX  = '50000'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.FINANCE_API_URL = ''
process.env.JWT_ACCESS_SECRET  ??= 'accountmerge-edge-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'accountmerge-edge-refresh-secret-0123456789'
const CRM_SECRET = 'accountmerge-edge-crm-secret-0123456789'
process.env.SALES_CRM_SECRET = CRM_SECRET

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
const { Types } = mongoose
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const svc = await import('@/services/accountMerge.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_accountmerge_edge') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
for (const n of mongoose.modelNames()) await mongoose.model(n).createIndexes().catch(() => {})
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const ROOT = `http://127.0.0.1:${(server.address() as { port: number }).port}`
type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown; secret?: string } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  if (opts.secret) headers['x-portal-secret'] = opts.secret
  const url = `${ROOT}/api/v1${p}`
  const res = await fetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null; try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1', PW2 = 'OtherHorse22'
const oid = () => new Types.ObjectId()
const raw = (model: string) => mongoose.model(model).collection

async function snapshot(userIds: unknown[]): Promise<string> {
  const models = [...new Set(svc.REFS.map(r => r.model)), 'ChatMessage']
  const out: Record<string, unknown> = {}
  for (const m of models.sort()) out[m] = await raw(m).find({}).sort({ _id: 1 }).toArray()
  out['users'] = (await raw('User').find({ _id: { $in: userIds as never[] } }).sort({ _id: 1 }).toArray())
    .map(u => { const { updatedAt, lastLoginAt, failedLoginAttempts, lockedUntil, lastFailedLoginAt, ...rest } = u as Record<string, unknown>; return rest })
  return JSON.stringify(out)
}

try {
  const dxb = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW), hash2 = await hashPassword(PW2)
  let n = 0
  const make = (o: Record<string, unknown>) => M.UserModel.create({
    passwordHash: hash, isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: dxb._id,
    name: `User ${++n}`, email: `u${n}@edge.local`, role: 'student', ...o,
  } as never) as Promise<any>
  await make({ email: 'sa@edge.local', role: 'super_admin' })
  await make({ email: 'ad@edge.local', role: 'admin' })
  await make({ email: 'sub@edge.local', role: 'sub_admin', program: 'forex' })
  await make({ email: 'sup@edge.local', role: 'support' })
  await make({ email: 'cs@desk.local', role: 'support', name: 'CS Desk' })   // the CS's own LMS account, for "view as student"
  const mentor = await make({ email: 'mentor@edge.local', role: 'instructor' })
  await make({ email: 'stud@edge.local', name: 'Plain Student', phone: '+971501230000' })

  const login = async (email: string, path = '/admin/auth/login', password = PW) => {
    const j: Jar = new Map(); const r = await call('POST', path, { jar: j, body: { email, password } })
    return r.status === 200 ? j : null
  }
  const sa = (await login('sa@edge.local'))!

  /* ── A. Who may ───────────────────────────────────── */
  section('A. who may')
  const a1 = await make({ name: 'Access One', phone: '+971509990001' })
  const a2 = await make({ name: 'Access Two', phone: '0509990001', isVerified: false })
  const endpoints: [string, string, unknown?][] = [
    ['GET', '/admin/duplicates'],
    ['GET', `/admin/duplicates/compare?ids=${a1._id},${a2._id}`],
    ['POST', '/admin/duplicates/preview', { primaryId: String(a1._id), secondaryId: String(a2._id) }],
    ['POST', '/admin/duplicates/merge', { primaryId: String(a1._id), secondaryId: String(a2._id), confirmEmail: a2.email }],
    ['POST', '/admin/duplicates/dismiss', { userIds: [String(a1._id), String(a2._id)] }],
    ['DELETE', '/admin/duplicates/dismiss/x'],
    ['GET', '/admin/duplicates/merges'],
    ['POST', `/admin/duplicates/merges/${oid()}/undo`],
  ]
  const studentJar = await login('stud@edge.local', '/auth/login')
  const others: [string, Jar | null][] = [
    ['no session', new Map()],
    ['a student (student cookie)', studentJar],
    ['an instructor', await login('mentor@edge.local')],
    ['a sub-admin', await login('sub@edge.local')],
    ['support staff', await login('sup@edge.local')],
    ['an academy admin', await login('ad@edge.local')],
  ]
  for (const [who, jar] of others) {
    const codes = await Promise.all(endpoints.map(([m, p, b]) => call(m, p, { jar: jar ?? new Map(), body: b }).then(r => r.status)))
    check(`${who}: every endpoint refused (401/403)`, codes.every(c => c === 401 || c === 403), codes.join(','))
  }
  check('nothing changed for the refused callers', (await raw('User').findOne({ _id: a2._id }))?.['isActive'] === true && await raw('AccountMerge').countDocuments() === 0 && await raw('DuplicateDismissal').countDocuments() === 0)
  check('a super admin may list', (await call('GET', '/admin/duplicates', { jar: sa })).status === 200)

  /* ── B. Bad input ─────────────────────────────────── */
  section('B. bad input')
  const bad: [string, string, string, unknown?][] = [
    ['compare with one id',      'GET',  `/admin/duplicates/compare?ids=${a1._id}`],
    ['compare with three ids',   'GET',  `/admin/duplicates/compare?ids=${a1._id},${a2._id},${oid()}`],
    ['compare with a junk id',   'GET',  `/admin/duplicates/compare?ids=${a1._id},nope`],
    ['compare with an unknown id', 'GET', `/admin/duplicates/compare?ids=${a1._id},${oid()}`],
    ['preview with a junk pick', 'POST', '/admin/duplicates/preview', { primaryId: String(a1._id), secondaryId: String(a2._id), picks: { name: 'both' } }],
    ['preview with a junk id',   'POST', '/admin/duplicates/preview', { primaryId: 'x', secondaryId: String(a2._id) }],
    ['merge with no confirmation', 'POST', '/admin/duplicates/merge', { primaryId: String(a1._id), secondaryId: String(a2._id) }],
    ['merge confirming with the KEPT email', 'POST', '/admin/duplicates/merge', { primaryId: String(a1._id), secondaryId: String(a2._id), confirmEmail: a1.email }],
    ['merge an account with itself', 'POST', '/admin/duplicates/merge', { primaryId: String(a1._id), secondaryId: String(a1._id), confirmEmail: a1.email }],
    ['merge an unknown account', 'POST', '/admin/duplicates/merge', { primaryId: String(a1._id), secondaryId: String(oid()), confirmEmail: 'x@y.z' }],
    ['merge a staff account into a student', 'POST', '/admin/duplicates/merge', { primaryId: String(mentor._id), secondaryId: String(a2._id), confirmEmail: a2.email }],
    ['dismiss one account',      'POST', '/admin/duplicates/dismiss', { userIds: [String(a1._id)] }],
    ['dismiss junk ids',         'POST', '/admin/duplicates/dismiss', { userIds: ['a', 'b'] }],
    ['undo a junk id',           'POST', '/admin/duplicates/merges/nope/undo'],
    ['undo an unknown merge',    'POST', `/admin/duplicates/merges/${oid()}/undo`],
  ]
  for (const [label, m, p, b] of bad) {
    const r = await call(m, p, { jar: sa, body: b })
    check(`${label}: refused with a 4xx`, r.status >= 400 && r.status < 500, why(r))
  }
  check('nothing was merged or dismissed by any of them', await raw('AccountMerge').countDocuments() === 0 && await raw('DuplicateDismissal').countDocuments() === 0
    && (await raw('User').findOne({ _id: a2._id }))?.['isActive'] === true)

  /* ── C. Finding ──────────────────────────────────── */
  section('C. finding')
  const t1 = await make({ name: 'Trio A', phone: '+971 52 111 2233' })
  const t2 = await make({ name: 'Trio B', enrollmentApplication: { phone: '0521112233' } })
  const t3 = await make({ name: 'Trio C', phone: '521112233', organizationId: blr._id })
  await make({ name: 'Fake One', phone: '0000000000' }); await make({ name: 'Fake Two', phone: '0000000000' })
  await make({ name: 'Staff Phone', role: 'admin', phone: '+971521112233' })
  const groups = async (q = '') => (await call('GET', `/admin/duplicates${q}`, { jar: sa })).body?.data?.groups ?? []
  let gs = await groups()
  const trio = gs.find((g: any) => g.accounts.some((a: any) => a.id === String(t1._id)))
  check('three accounts typed three ways on one phone: one group of three', trio?.accounts.length === 3, JSON.stringify(trio?.accounts?.map((a: any) => a.phone)))
  check('a placeholder number (0000000000) groups nobody', !gs.some((g: any) => g.accounts.some((a: any) => a.name.startsWith('Fake'))))
  check('staff on the same phone is not in the group', !trio?.accounts.some((a: any) => a.email.includes('staff') || a.name === 'Staff Phone'))
  check('the academy filter finds a group with one account in that academy', (await groups(`?organizationId=${blr._id}`)).some((g: any) => g.key === trio?.key))
  check('…and not groups without one', !(await groups(`?organizationId=${blr._id}`)).some((g: any) => g.accounts.some((a: any) => a.id === String(a1._id))))
  await call('POST', '/admin/duplicates/dismiss', { jar: sa, body: { userIds: [t1, t2, t3].map(u => String(u._id)) } })
  check('dismissed: hidden', !(await groups()).some((g: any) => g.key === trio?.key))
  const t4 = await make({ name: 'Trio D', phone: '00971521112233' })
  gs = await groups()
  check('a fourth account on the phone: the group is back, with all four', gs.find((g: any) => g.accounts.some((a: any) => a.id === String(t4._id)))?.accounts.length === 4)

  /* ── D. A chain of merges ───────────────────────── */
  section('D. chain')
  const cA = await make({ name: 'Chain', email: 'chain@gamil.com', phone: '+971555000111', isVerified: false })
  const cB = await make({ name: 'Chain', email: 'chain@gmial.com', phone: '0555000111', isVerified: false })
  const cC = await make({ name: 'Chain', email: 'chain@gmail.com', phone: '555000111' })
  const merge = (keep: any, close: any, picks?: object) => call('POST', '/admin/duplicates/merge', { jar: sa, body: { primaryId: String(keep._id), secondaryId: String(close._id), confirmEmail: close.email, ...(picks ? { picks } : {}) } })
  const m1 = await merge(cB, cA)
  const m2 = await merge(cC, cB)
  check('A into B, then B into C: both succeed', m1.status === 200 && m2.status === 200, why(m1) + ' | ' + why(m2))
  check('A now points at C directly', String((await raw('User').findOne({ _id: cA._id }))?.['mergedInto']) === String(cC._id))
  /* One browser per account signed in to, so the device check (a new device waits for an admin) stays out of the way. */
  const browsers = new Map<string, string>()
  const meVia = async (email: string, password = PW, browser = email) => {
    const j: Jar = new Map(browsers.has(browser) ? [['lms_device', browsers.get(browser)!]] : [])
    const r = await call('POST', '/auth/login', { jar: j, body: { email, password } })
    if (j.get('lms_device')) browsers.set(browser, j.get('lms_device')!)
    if (r.status !== 200) return `login ${why(r)}`
    return (await call('GET', '/auth/me', { jar: j })).body?.data?.user?.email
  }
  const viaA = await meVia('chain@gamil.com', PW, 'C'), viaB = await meVia('chain@gmial.com', PW, 'C')
  check('the oldest address (A) signs in to C', viaA === 'chain@gmail.com', String(viaA))
  check('B\'s address signs in to C', viaB === 'chain@gmail.com', String(viaB))
  const u2 = await call('POST', `/admin/duplicates/merges/${m2.body.data.mergeId}/undo`, { jar: sa })
  check('undo B→C', u2.status === 200 && u2.body.data.notes.length === 0, why(u2))
  check('A points at B again, B is open', String((await raw('User').findOne({ _id: cA._id }))?.['mergedInto']) === String(cB._id) && (await raw('User').findOne({ _id: cB._id }))?.['isActive'] === true)
  const viaA2 = await meVia('chain@gamil.com', PW, 'B')
  check('A\'s address signs in to B now', viaA2 === 'chain@gmial.com', String(viaA2))
  const m3 = await merge(cC, cB)
  check('merging B into C again works after the undo', m3.status === 200, why(m3))

  /* ── E. Passwords ───────────────────────────────── */
  section('E. passwords')
  const pK = await make({ name: 'Pass Keep', email: 'pass@gmail.com', phone: '+971555000222' })
  const pC = await make({ name: 'Pass Close', email: 'pass@gamil.com', phone: '0555000222', passwordHash: hash2, isVerified: false })
  const own = await meVia('pass@gamil.com', PW2, 'pC')
  check('before: the closed-to-be account opens with its own password', own === 'pass@gamil.com', String(own))
  await merge(pK, pC)
  const oldPw = await meVia('pass@gamil.com', PW2, 'pC')
  check('after: its OWN old password no longer opens anything', String(oldPw).startsWith('login 401'), String(oldPw))
  /* From the same phone the student used before: its device came across with the merge. */
  const keptPw = await meVia('pass@gamil.com', PW, 'pC')
  check('the kept account\'s password with the old address, on the student\'s own phone, opens the kept account', keptPw === 'pass@gmail.com', String(keptPw))
  const fresh = await meVia('pass@gamil.com', PW, 'a-new-browser')
  check('…a browser never seen before still waits for device approval, as before', String(fresh).includes('DEVICE_PENDING'), String(fresh))
  const before = await raw('AuthToken').countDocuments({ userId: pK._id })
  check('forgot password with the old address: accepted', (await call('POST', '/auth/forgot-password', { body: { email: 'pass@gamil.com' } })).status === 200)
  check('…and the reset is for the KEPT account', await raw('AuthToken').countDocuments({ userId: pK._id }) === before + 1 && await raw('AuthToken').countDocuments({ userId: pC._id }) === 0)
  const otp = await call('POST', '/auth/otp/request', { body: { email: 'pass@gamil.com' } })
  check('a login code with the old address is for the kept account', otp.status === 200 && await raw('AuthToken').countDocuments({ userId: pK._id, purpose: 'otp-login' }) === 1, why(otp))

  /* ── F. CS Portal and guest checkout ────────────── */
  section('F. CS Portal and guest checkout')
  const forex = await M.CourseModel.create({ title: 'Forex', slug: 'forex-edge', description: 'd', instructorId: mentor._id, price: 680, priceAED: 2500, priceINR: 65000,
    isFree: false, status: 'published', language: 'English', organizationId: dxb._id, program: '4x-trading', sharedAcademies: true } as never) as any
  const fK = await make({ name: 'Portal Keep', email: 'portal@gmail.com', phone: '+971555000333' })
  const fC = await make({ name: 'Portal Close', email: 'portal@gamil.com', phone: '0555000333', isVerified: false })
  await raw('Enrollment').insertOne({ userId: fC._id, courseId: forex._id, organizationId: dxb._id, status: 'active', progressPercent: 20 })
  await merge(fK, fC)
  const ca = await call('POST', '/service/students/course-access', { secret: CRM_SECRET, body: { email: 'portal@gamil.com' } })
  check('course access by the old address: the kept account, with the moved course', ca.status === 200 && ca.body?.data?.student?.email === 'portal@gmail.com'
    && ca.body?.data?.courses?.some((c: any) => c.courseId === String(forex._id)), why(ca) + JSON.stringify(ca.body?.data?.student))
  const sv = await call('POST', '/service/students/view', { secret: CRM_SECRET, body: { email: 'portal@gamil.com', byName: 'CS', byEmail: 'cs@desk.local' } })
  check('"view as student" by the old address: allowed, not "disabled"', sv.status === 200 && !!sv.body?.data?.url, why(sv))
  const imp = await raw('ImpersonationSession').find({}).sort({ _id: -1 }).limit(1).toArray()
  check('…and it views the KEPT account', String(imp[0]?.['targetId']) === String(fK._id), JSON.stringify(imp[0]?.['targetId']))
  const cs1 = await call('POST', '/service/student-cs', { secret: CRM_SECRET, body: { students: [{ email: 'portal@gamil.com', code: 'S1', cs: 'Riya', team: 'Alpha', open: false }] } })
  check('CS name/team sent for the old address lands on the kept account', cs1.status === 200 && (await raw('User').findOne({ _id: fK._id }))?.['tetraCs']?.name === 'Riya', why(cs1) + JSON.stringify(cs1.body?.data))
  const cs2 = await call('POST', '/service/student-cs', { secret: CRM_SECRET, body: { students: [{ email: 'nobody@x.y', lmsUserId: String(fC._id), code: 'S1', cs: 'Sam', team: 'Beta', open: false }] } })
  check('…and for the old LMS id too', cs2.status === 200 && (await raw('User').findOne({ _id: fK._id }))?.['tetraCs']?.name === 'Sam', JSON.stringify(cs2.body?.data))
  check('the closed account is given nothing', !(await raw('User').findOne({ _id: fC._id }))?.['tetraCs'])
  const gc = await call('POST', '/public/checkout/prepare', { jar: new Map(), body: { slug: 'forex-edge', name: 'Portal', email: 'portal@gamil.com', phone: '+971555000333', country: 'United Arab Emirates' } })
  check('guest checkout with the old address: the kept account, which already has the course', gc.body?.error?.code === 'ALREADY_ENROLLED', why(gc))
  check('…no new account was made for it', await raw('User').countDocuments({ email: 'portal@gamil.com' }) === 1)

  /* ── G. Lists ───────────────────────────────────── */
  section('G. lists and pickers')
  const xK = await make({ name: 'Express Keep', email: 'exp@gmail.com', phone: '+971555000444', signupType: 'express' })
  const xC = await make({ name: 'Express Close', email: 'exp@gamil.com', phone: '0555000444', signupType: 'express', isVerified: false })
  await merge(xK, xC)
  const ex = await call('GET', '/admin/express-members?status=all&per_page=100', { jar: sa })
  const exEmails = (ex.body?.data ?? []).map((u: any) => u.email)
  check('Express Members: the kept account listed, the closed one not', ex.status === 200 && exEmails.includes('exp@gmail.com') && !exEmails.includes('exp@gamil.com'), why(ex) + exEmails.join(','))
  const pick = await call('GET', '/admin/programs/students?q=exp@g', { jar: sa })
  const pickEmails = (pick.body?.data ?? []).map((u: any) => u.email)
  check('programme student picker: the closed account is not offered', pick.status === 200 && pickEmails.includes('exp@gmail.com') && !pickEmails.includes('exp@gamil.com'), why(pick) + pickEmails.join(','))
  const { resolveStudents } = await import('@/services/program.service.ts')
  const res = await resolveStudents(['exp@gamil.com', 'exp@gmail.com'], null)
  check('a roster given the old AND new address holds the kept account once', res.ids.length === 1 && String(res.ids[0]) === String(xK._id) && res.missing.length === 0, JSON.stringify(res))
  const req = await call('GET', '/admin/enrollment-requests?status=all&per_page=100', { jar: sa })
  check('Requests: the closed account is not listed', req.status === 200 && !(req.body?.data ?? []).some((u: any) => u.email === 'exp@gamil.com'), why(req))

  /* ── H. Signing up again with the closed address ── */
  section('H. sign-up with the closed address')
  const code = await call('POST', '/auth/register/code', { body: { email: 'pass@gamil.com' } })
  const keptBefore = JSON.stringify(await raw('User').findOne({ _id: pK._id }, { projection: { updatedAt: 0, lastLoginAt: 0 } }))
  const reg = await call('POST', '/auth/register', { body: { name: 'Someone Else', email: 'pass@gamil.com', emailCode: code.body?.data?.devCode, signupType: 'full',
    enrollmentApplication: { phone: '+971501234567', homeCountry: 'United Arab Emirates', city: 'Dubai', programs: ['4x-trading'] } } })
  check('refused (the address is closed)', reg.status === 403 && reg.body?.error?.code === 'ACCOUNT_DISABLED', why(reg))
  check('the kept account is untouched', JSON.stringify(await raw('User').findOne({ _id: pK._id }, { projection: { updatedAt: 0, lastLoginAt: 0 } })) === keptBefore)

  /* ── I. Statuses ────────────────────────────────── */
  section('I. statuses')
  const sK = await make({ name: 'Status Keep', email: 'st@gmail.com', phone: '+971555000555', enrollmentStatus: 'pending', categories: [] })
  const sC = await make({ name: 'Status Close', email: 'st@gamil.com', phone: '0555000555', enrollmentStatus: 'approved', categories: ['digital-marketing'],
    approvedByEmail: 'ad@edge.local', approvedAt: new Date(), isActive: false, isVerified: false })
  const pv = await call('POST', '/admin/duplicates/preview', { jar: sa, body: { primaryId: String(sK._id), secondaryId: String(sC._id) } })
  check('pending kept, approved closed: approval comes across by default', pv.body?.data?.picks?.approval === 'secondary', JSON.stringify(pv.body?.data?.picks))
  const ms = await merge(sK, sC)
  const sKafter = await raw('User').findOne({ _id: sK._id })
  check('a blocked account can be closed into another', ms.status === 200, why(ms))
  check('the kept account is approved, with the programme, and its approver', sKafter?.['enrollmentStatus'] === 'approved' && sKafter?.['categories']?.includes('digital-marketing') && sKafter?.['approvedByEmail'] === 'ad@edge.local')
  check('the kept account stays active', sKafter?.['isActive'] === true)

  /* ── J. Undo after carrying on ──────────────────── */
  section('J. undo after the student carried on')
  const jK = await make({ name: 'Carry Keep', email: 'carry@gmail.com', phone: '+971555000666' })
  const jC = await make({ name: 'Carry Close', email: 'carry@gamil.com', phone: '0555000666', isVerified: false })
  const lcOld = oid(), lcNew = oid()
  await raw('ClassBooking').insertOne({ userId: jC._id, liveClassId: lcOld, status: 'booked' })
  const mj = await merge(jK, jC)
  await raw('ClassBooking').insertOne({ userId: jK._id, liveClassId: lcNew, status: 'booked' })   // booked after the merge
  await raw('Notification').insertOne({ userId: jK._id, title: 'after' })
  const uj = await call('POST', `/admin/duplicates/merges/${mj.body.data.mergeId}/undo`, { jar: sa })
  check('undo succeeds', uj.status === 200, why(uj))
  check('the moved booking went back to the closed account', await raw('ClassBooking').countDocuments({ userId: jC._id, liveClassId: lcOld }) === 1)
  check('what the kept account did after the merge stays with it', await raw('ClassBooking').countDocuments({ userId: jK._id, liveClassId: lcNew }) === 1 && await raw('Notification').countDocuments({ userId: jK._id, title: 'after' }) === 1)

  /* ── K. Concurrency ─────────────────────────────── */
  section('K. concurrency')
  const kA = await make({ name: 'Race', email: 'race@gamil.com', phone: '+971555000777', isVerified: false })
  const kB = await make({ name: 'Race', email: 'race@gmial.com', phone: '0555000777', isVerified: false })
  const kC = await make({ name: 'Race', email: 'race@gmail.com', phone: '555000777' })
  const race = await Promise.all([merge(kB, kA), merge(kC, kB)])
  const ok = race.filter(r => r.status === 200).length
  check('two merges sharing an account at once: exactly one wins', ok === 1 && race.some(r => r.status === 409), race.map(why).join(' | '))
  check('no account is half-closed', (await raw('User').find({ _id: { $in: [kA._id, kB._id, kC._id] }, isActive: false }).toArray()).length === 1)
  await raw('Mutex').insertOne({ key: `account-merge:${kC._id}`, expiresAt: new Date(Date.now() + 60_000) })
  const lockedMerge = await merge(kC, kA)
  check('while an account is locked (a merge running), another merge is refused (409)', lockedMerge.status === 409 && lockedMerge.body?.error?.code === 'MERGE_IN_PROGRESS', why(lockedMerge))
  await raw('Mutex').deleteMany({})

  /* ── M. Secondary email ─────────────────────────── */
  section('M. secondary email')
  const eK = await make({ name: 'Second Keep', email: 'second@gmail.com', phone: '+971555000999' })
  const eC = await make({ name: 'Second Close', email: 'second@gamil.com', phone: '0555000999', isVerified: false })
  const eBefore = await snapshot([eK._id, eC._id])
  const me1 = await merge(eK, eC)   // the option not sent: saved by default
  const keptE = await raw('User').findOne({ _id: eK._id })
  check('by default the closed account\'s email is saved on the kept one', me1.status === 200 && me1.body?.data?.keptSecondaryEmail === true
    && keptE?.['secondaryEmails']?.length === 1 && keptE['secondaryEmails'][0].email === 'second@gamil.com' && keptE['secondaryEmails'][0].source === 'merge'
    && String(keptE['secondaryEmails'][0].mergeId) === me1.body.data.mergeId, JSON.stringify(keptE?.['secondaryEmails']))
  check('the sign-in address is unchanged', keptE?.['email'] === 'second@gmail.com')
  const sr = await call('GET', '/admin/users?role=student&search=second@gamil&per_page=50', { jar: sa })
  check('the Students search finds the kept account by the secondary email', sr.status === 200 && (sr.body?.data ?? []).some((u: any) => u.email === 'second@gmail.com'), why(sr))
  check('…and the admin sees it on the student', (sr.body?.data ?? []).find((u: any) => u.email === 'second@gmail.com')?.secondaryEmails?.[0]?.email === 'second@gamil.com')
  const hist = (await call('GET', '/admin/duplicates/merges', { jar: sa })).body?.data?.find((m: any) => m.id === me1.body.data.mergeId)
  check('Merge history says it was saved', hist?.keptSecondaryEmail === true)
  await call('POST', `/admin/duplicates/merges/${me1.body.data.mergeId}/undo`, { jar: sa })
  check('undo removes it — both accounts exactly as before', (await snapshot([eK._id, eC._id])) === eBefore)
  const me2 = await call('POST', '/admin/duplicates/merge', { jar: sa, body: { primaryId: String(eK._id), secondaryId: String(eC._id), confirmEmail: eC.email, keepSecondaryEmail: false } })
  check('with the option off nothing is saved', me2.status === 200 && me2.body?.data?.keptSecondaryEmail === false && !(await raw('User').findOne({ _id: eK._id }))?.['secondaryEmails'], why(me2))
  check('…and signing in with the old address still works (it follows the merge)', await meVia('second@gamil.com', PW, 'eK') === 'second@gmail.com')
  const bad2 = await call('POST', '/admin/duplicates/merge', { jar: sa, body: { primaryId: String(a1._id), secondaryId: String(a2._id), confirmEmail: a2.email, keepSecondaryEmail: 'yes' } })
  check('a non-true/false option is refused (422)', bad2.status === 422, why(bad2))
  /* A chain carries them: X1 into X2 (saved), then X2 into X3 (saved) → X3 has both. */
  const x1 = await make({ name: 'Ex', email: 'ex@gamil.com', phone: '+971555001000', isVerified: false })
  const x2 = await make({ name: 'Ex', email: 'ex@gmial.com', phone: '0555001000', isVerified: false })
  const x3 = await make({ name: 'Ex', email: 'ex@gmail.com', phone: '555001000' })
  await merge(x2, x1); await merge(x3, x2)
  const x3s = ((await raw('User').findOne({ _id: x3._id }))?.['secondaryEmails'] ?? []).map((e: any) => e.email).sort()
  check('a chain carries earlier secondary emails across', JSON.stringify(x3s) === JSON.stringify(['ex@gamil.com', 'ex@gmial.com']), JSON.stringify(x3s))
  /* Merging back the other way never lists an account's own address as its secondary. */
  const y1 = await make({ name: 'Why', email: 'why@gmail.com', phone: '+971555001100' })
  const y2 = await make({ name: 'Why', email: 'why@gamil.com', phone: '0555001100', isVerified: false })
  const my = await merge(y2, y1)
  await call('POST', `/admin/duplicates/merges/${my.body.data.mergeId}/undo`, { jar: sa })
  await merge(y1, y2)
  const y1s = ((await raw('User').findOne({ _id: y1._id }))?.['secondaryEmails'] ?? []).map((e: any) => e.email)
  check('an account never has its own address as a secondary email', !y1s.includes('why@gmail.com') && y1s.includes('why@gamil.com'), JSON.stringify(y1s))

  /* ── L. A big account ───────────────────────────── */
  section('L. a big account')
  const bK = await make({ name: 'Big Keep', email: 'big@gmail.com', phone: '+971555000888' })
  const bC = await make({ name: 'Big Close', email: 'big@gamil.com', phone: '0555000888', isVerified: false })
  const course = oid()
  const lessons = Array.from({ length: 1500 }, () => oid())
  await raw('LessonProgress').insertMany(lessons.map((l, i) => ({ userId: bC._id, lessonId: l, courseId: course, isCompleted: i % 2 === 0, watchTimeSecs: i })))
  await raw('LessonProgress').insertMany(lessons.slice(0, 750).map(l => ({ userId: bK._id, lessonId: l, courseId: course, isCompleted: false, watchTimeSecs: 1 })))
  await raw('ClassBooking').insertMany(Array.from({ length: 300 }, () => ({ userId: bC._id, liveClassId: oid(), status: 'attended' })))
  await raw('Notification').insertMany(Array.from({ length: 400 }, (_, i) => ({ userId: bC._id, title: `n${i}` })))
  const bigBefore = await snapshot([bK._id, bC._id])
  let t = Date.now()
  const bp = await call('POST', '/admin/duplicates/preview', { jar: sa, body: { primaryId: String(bK._id), secondaryId: String(bC._id) } })
  const previewMs = Date.now() - t
  const lp = bp.body?.data?.items?.find((i: any) => i.label === 'Lesson progress')
  /* 750 rows only on the closed account move. Of the 750 on both, the closed account's copy is further
     along (completed, or watched longer) in 749 — it moves and the kept one's drops; in one (a tie) the
     kept one's stays. So 1,499 moved, 750 dropped. */
  check(`preview counts it right (1,499 moved, 750 dropped) — ${previewMs} ms`, lp?.moved === 1499 && lp?.dropped === 750, JSON.stringify(lp))
  check('preview under 15 s', previewMs < 15_000, `${previewMs} ms`)
  t = Date.now()
  const bm = await merge(bK, bC)
  const mergeMs = Date.now() - t
  check(`merge succeeds — ${mergeMs} ms`, bm.status === 200 && mergeMs < 60_000, why(bm))
  check('every lesson row on the kept account, one per lesson, completed where either was', await raw('LessonProgress').countDocuments({ userId: bK._id }) === 1500
    && await raw('LessonProgress').countDocuments({ userId: bC._id }) === 0
    && await raw('LessonProgress').countDocuments({ userId: bK._id, isCompleted: true }) === 750)
  t = Date.now()
  const bu = await call('POST', `/admin/duplicates/merges/${bm.body.data.mergeId}/undo`, { jar: sa })
  const undoMs = Date.now() - t
  check(`undo succeeds — ${undoMs} ms`, bu.status === 200 && bu.body.data.notes.length === 0 && undoMs < 60_000, why(bu))
  check('…exactly as before', (await snapshot([bK._id, bC._id])) === bigBefore)
  check('no lock is left behind', await raw('Mutex').countDocuments() === 0)
} catch (err) {
  fail++
  lines.push(`  FAIL  suite crashed — ${(err as Error)?.stack ?? err}`)
} finally {
  console.log(lines.join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  server.close()
  await mongoose.connection.db?.dropDatabase().catch(() => {})
  await mongoose.disconnect()
  process.exit(fail ? 1 : 0)
}
