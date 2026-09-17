/* ─────────────────────────────────────────────────────────────
   Cross-academy instructors — the boundary, tested from both sides.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_crossorg_suite, dropped on exit).

   The feature deliberately puts a hole in a security boundary, so this suite
   is mostly about what must NOT come through it. Every assertion is one of:

     · the hole works      — a lent instructor is visible and usable in the
                             borrowing academy;
     · the hole is exactly the right size — the borrowing academy's ADMIN may
                             administer a lent instructor (the product owner's
                             decision), a SUB-ADMIN may not;
     · nothing else moved  — students, admins, support, orders and enrolments
                             stay strictly scoped, and an unshared instructor
                             stays invisible.

   The `$and` regression at the end is the one a reviewer would most likely
   miss: user.repository.ts already assigns `filter.$or` for search, so a
   widening that assigned `$or` again would silently drop the caller's search
   terms and the endpoint would quietly stop filtering.

   Run: bun run test:crossorg
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_crossorg_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.R2_ACCOUNT_ID = ''; process.env.R2_ACCESS_KEY_ID = ''
process.env.R2_SECRET_ACCESS_KEY = ''; process.env.R2_PUBLIC_URL = ''
delete process.env.GOOGLE_CLIENT_ID
delete process.env.GOOGLE_CLIENT_SECRET
delete process.env.GOOGLE_REFRESH_TOKEN
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
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
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_crossorg_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
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
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${String(r.body?.error?.message ?? '').slice(0, 70)}`
const PW = 'CorrectHorse1'

/** Every user id in a paginated admin list response, whatever the envelope. */
function idsOf(body: any): string[] {
  const rows = body?.data?.items ?? body?.data?.users ?? body?.data ?? []
  return (Array.isArray(rows) ? rows : []).map((u: any) => String(u.id ?? u._id))
}

try {
  const dubai = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash  = await hashPassword(PW)

  const mk = (email: string, role: string, org: any, extra: object = {}) =>
    UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: org._id, ...extra })

  /* Staff on both sides. */
  const dubaiAdmin = await mk('admin.dubai@t.local', 'admin', dubai)
  const blrAdmin   = await mk('admin.blr@t.local',   'admin', blr)
  const blrSub     = await mk('sub.blr@t.local',     'sub_admin', blr, { program: 'ai' })

  /* One lent instructor, one kept. Both OWNED by Dubai.

     `category: 'ai'` on the lent one is deliberate: sub-admins are scoped by
     PROGRAMME as well as academy, and those are independent axes. A
     category-less instructor is invisible to a programme-scoped sub-admin
     whatever the sharing flag says — which is correct, and is asserted below. */
  const lent = await mk('lent@t.local', 'instructor', dubai, { sharedAcrossOrgs: true, category: 'ai', categories: ['ai'] })
  const kept = await mk('kept@t.local', 'instructor', dubai, { category: 'ai', categories: ['ai'] })
  /* Shared, but on a DIFFERENT programme — the AI sub-admin must not see them. */
  const lentOtherProgramme = await mk('lent.dm@t.local', 'instructor', dubai,
    { sharedAcrossOrgs: true, category: 'digital-marketing', categories: ['digital-marketing'] })
  /* A Dubai student — the control for "nothing else crossed". */
  const dubaiStudent = await mk('student.dubai@t.local', 'student', dubai, { enrollmentStatus: 'approved' })

  /* The ADMIN portal login — it sets lms_admin_at, which is what
     authenticateAdmin reads. /auth/login sets the student cookie and every
     admin route would answer 401. */
  const login = async (email: string) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`admin login ${email} → ${why(r)}`)
    return jar
  }
  const DUBAI = await login('admin.dubai@t.local')
  const BLR   = await login('admin.blr@t.local')
  const BLRSUB = await login('sub.blr@t.local')

  const lentId = String(lent._id), keptId = String(kept._id)

  /* ─────────────────────────────────────────────────── */
  section('The hole works — a lent instructor is visible in the borrowing academy')
  {
    const own = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: DUBAI })
    check('the owning academy sees its own instructor', idsOf(own.body).includes(lentId), why(own))
    check('and the one it did not lend', idsOf(own.body).includes(keptId))

    const borrowed = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: BLR })
    check('the borrowing academy sees the LENT instructor', idsOf(borrowed.body).includes(lentId), why(borrowed))
    /* The whole point: sharing is opt-in per instructor, not per academy. */
    check('but NOT the one that was not lent', !idsOf(borrowed.body).includes(keptId),
      'unshared instructor leaked across the boundary')

    const sub = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: BLRSUB })
    check('a borrowing SUB-ADMIN also sees the lent instructor', idsOf(sub.body).includes(lentId), why(sub))
    check('and still not the unshared one', !idsOf(sub.body).includes(keptId))
    /* The two scoping axes compose: sharing crosses the ACADEMY boundary and
       does nothing at all to the PROGRAMME one. Widening one must never
       quietly widen the other. */
    check('and NOT a shared instructor from another programme',
      !idsOf(sub.body).includes(String(lentOtherProgramme._id)),
      'programme scope was widened by the sharing flag')
  }

  /* ─────────────────────────────────────────────────── */
  section('Nothing else crossed the boundary')
  {
    const students = await call('GET', '/admin/users?role=student&per_page=100', { jar: BLR })
    check('a Dubai STUDENT is not visible to Bangalore', !idsOf(students.body).includes(String(dubaiStudent._id)),
      'student list widened — this is the N-07 shape')

    const admins = await call('GET', '/admin/users?role=admin&per_page=100', { jar: BLR })
    check('a Dubai ADMIN is not visible to Bangalore', !idsOf(admins.body).includes(String(dubaiAdmin._id)))

    /* A shared student must be impossible to create at all. */
    let refused = false
    try {
      await UserModel.create({
        name: 'bad', email: 'bad.shared@t.local', passwordHash: hash, role: 'student',
        isActive: true, organizationId: dubai._id, sharedAcrossOrgs: true,
      })
    } catch { refused = true }
    check('a SHARED STUDENT cannot be persisted at all', refused,
      'the schema validator did not refuse a shared non-instructor')
  }

  /* ─────────────────────────────────────────────────── */
  section('The hole is exactly the size that was asked for')
  {
    /* The product owner's decision: CRUD on a lent instructor is open to
       admins of either academy, and closed to sub-admins. */
    const adminEdit = await call('PATCH', `/admin/users/${lentId}`, { jar: BLR, body: { headline: 'Edited by the borrowing academy' } })
    check('a borrowing ADMIN may edit a lent instructor', adminEdit.status === 200, why(adminEdit))

    const subEdit = await call('PATCH', `/admin/users/${lentId}`, { jar: BLRSUB, body: { headline: 'nope' } })
    check('a borrowing SUB-ADMIN may NOT — and gets 403/404, never 200',
      subEdit.status === 403 || subEdit.status === 404, why(subEdit))

    /* The unshared instructor is the control: same academy, same roles, no grant. */
    const keptEdit = await call('PATCH', `/admin/users/${keptId}`, { jar: BLR, body: { headline: 'nope' } })
    check('an UNSHARED instructor is still 404 to the other academy',
      keptEdit.status === 404, why(keptEdit))
    check('and the 404 does not confirm the record exists elsewhere',
      keptEdit.body?.error?.code === 'NOT_FOUND', JSON.stringify(keptEdit.body?.error))

    /* A Dubai student is the other control — the carve-out must not reach it. */
    const studentEdit = await call('PATCH', `/admin/users/${String(dubaiStudent._id)}`, { jar: BLR, body: { headline: 'nope' } })
    check('a Dubai STUDENT is still 404 to a Bangalore admin', studentEdit.status === 404, why(studentEdit))
  }

  /* ─────────────────────────────────────────────────── */
  section('Who may pull the lever')
  {
    const bySub = await call('POST', '/admin/users', { jar: BLRSUB, body: {
      name: 'Sub Made', email: `sub.made.${Date.now()}@t.local`, password: 'CorrectHorse1',
      role: 'instructor', sharedAcrossOrgs: true,
    } })
    /* Rejected, not silently dropped: a quiet success would leave the creator
       believing the instructor is shared when they are not. */
    check('a SUB-ADMIN cannot lend an instructor', bySub.status === 403, why(bySub))

    const byAdmin = await call('POST', '/admin/users', { jar: DUBAI, body: {
      name: 'Admin Made', email: `admin.made.${Date.now()}@t.local`, password: 'CorrectHorse1',
      role: 'instructor', sharedAcrossOrgs: true,
    } })
    check('an ADMIN can', byAdmin.status === 201, why(byAdmin))
    if (byAdmin.status === 201) {
      const made = await UserModel.findById(String(byAdmin.body?.data?.id)).lean() as any
      check('and the flag actually persisted', made?.sharedAcrossOrgs === true, JSON.stringify(made?.sharedAcrossOrgs))
      const seen = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: BLR })
      check('so the other academy sees them immediately', idsOf(seen.body).includes(String(made._id)))
    }

    const sharedStudent = await call('POST', '/admin/users', { jar: DUBAI, body: {
      name: 'Shared Student', email: `shared.student.${Date.now()}@t.local`, password: 'CorrectHorse1',
      role: 'student', sharedAcrossOrgs: true,
    } })
    check('an admin cannot lend a STUDENT', sharedStudent.status === 400, why(sharedStudent))
  }

  /* ─────────────────────────────────────────────────── */
  section('The $and regression — widening must not eat the search filter')
  {
    /* user.repository.ts assigns filter.$or for search. If the org widening
       assigned $or again it would clobber that, and the endpoint would return
       every instructor regardless of the search term — silently. */
    const searched = await call('GET', '/admin/users?role=instructor&search=lent&per_page=100', { jar: BLR })
    const ids = idsOf(searched.body)
    check('searching the borrowing academy still finds the lent instructor', ids.includes(lentId), why(searched))
    check('and the search term is still APPLIED, not dropped',
      !ids.includes(String((await UserModel.findOne({ email: 'admin.blr@t.local' }).lean() as any)._id)),
      'the widening clobbered $or — search is no longer filtering')

    const noMatch = await call('GET', '/admin/users?role=instructor&search=zzzznotarealname&per_page=100', { jar: BLR })
    check('a search that matches nothing returns nothing', idsOf(noMatch.body).length === 0,
      `${idsOf(noMatch.body).length} rows returned for a nonsense search`)
  }

} catch (err) {
  failures.push(`suite threw — ${(err as Error).message}`)
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
