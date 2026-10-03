/* ─────────────────────────────────────────────────────────────
   Where does a student go after you reject them?

   Rejecting flips the account to `signupType: 'express'` on purpose: the
   person keeps a browsing login instead of losing the account outright, and
   they appear under Express Members. That part is wanted and stays.

   What was not wanted is that the requests list excluded EVERY express
   account — including the ones it had just demoted itself. So the Rejected tab
   rendered "No rejected requests" however many there were, and the stored
   reason, the rejecting admin and the Re-approve button the table already knew
   how to draw were all unreachable.

   The second half is worse and only surfaces once you get past the first: the
   approve handler set enrollmentStatus back to 'approved' but left signupType
   at 'express'. A re-approved student would have vanished from the Approved
   tab too — approved, invisible, and still listed as an Express Member.

   Run: bun run test:rejectedrequests
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_rejectedreq'
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
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, CourseModel, EnrollmentModel, OrganizationModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_rejectedreq') {
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
let seq = 0
const email = (tag: string) => `${tag}-${Date.now()}-${seq++}@rr.local`
const emails = (r: { body: any }) => (r.body?.data ?? []).map((x: any) => x.email)

try {
  const org = await OrganizationModel.create({
    name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const hash = await hashPassword(PW)

  await UserModel.create({
    name: 'Admin', email: 'a@rr.local', passwordHash: hash, role: 'admin',
    isActive: true, organizationId: org._id,
  })
  const aJar: Jar = new Map()
  await call('POST', '/admin/auth/login', { jar: aJar, body: { email: 'a@rr.local', password: PW } })

  /* A student who filled in the FULL form — the shape the Requests pipeline is
     for, and the only shape a rejection can demote. */
  const mkFull = (e: string) => UserModel.create({
    name: 'Full Student', email: e, passwordHash: hash, role: 'student',
    isActive: true, isVerified: true, signupType: 'full',
    enrollmentStatus: 'pending', organizationId: org._id,
    fullRegistrationSubmittedAt: new Date(),
    enrollmentApplication: { phone: '+971500000000', homeCountry: 'UAE', gender: 'Male' },
  })

  const e1 = email('rejected')
  const student = await mkFull(e1)
  const id = String(student._id)

  /* ═══════════════════════════════════════════════ */
  section('A · rejecting still demotes the account — that behaviour is wanted')
  {
    const r = await call('PATCH', `/admin/enrollment-requests/${id}/reject`, {
      jar: aJar, body: { reason: 'Documents did not match the passport.' },
    })
    check('the reject call succeeds', r.status === 200, `${r.status} ${JSON.stringify(r.body?.error ?? '')}`)

    const after = await UserModel.findById(id).lean() as any
    check('the account becomes express, so the student keeps a login',
      after?.signupType === 'express', String(after?.signupType))
    check('and is marked rejected', after?.enrollmentStatus === 'rejected', String(after?.enrollmentStatus))
    check('the reason is stored', after?.rejectionReason === 'Documents did not match the passport.',
      String(after?.rejectionReason))
    check('with who rejected it', !!after?.rejectedByEmail, String(after?.rejectedByEmail))
    check('and when', !!after?.rejectedAt, String(after?.rejectedAt))

    /* Historical fact, not current state — erasing it left nothing to say a
       rejected account had ever been more than an express signup. */
    check('the record that they completed the full form SURVIVES',
      !!after?.fullRegistrationSubmittedAt, String(after?.fullRegistrationSubmittedAt))
  }

  /* ═══════════════════════════════════════════════ */
  section('B · the bug: the Rejected tab could not see them')
  {
    const r = await call('GET', '/admin/enrollment-requests?status=rejected&per_page=100', { jar: aJar })
    check('the rejected tab answers', r.status === 200, String(r.status))
    check('and the rejected student is IN it', emails(r).includes(e1), emails(r).join(' | '))
    check('so the tab is not empty', (r.body?.meta?.total_count ?? 0) >= 1,
      String(r.body?.meta?.total_count))

    const row = (r.body?.data ?? []).find((x: any) => x.email === e1)
    check('the row carries the reason, for the table to show',
      row?.rejectionReason === 'Documents did not match the passport.', String(row?.rejectionReason))
    check('and who rejected it', !!(row?.rejectedByName || row?.rejectedByEmail),
      `${row?.rejectedByName} ${row?.rejectedByEmail}`)
    check('and the date', !!row?.rejectedAt, String(row?.rejectedAt))
  }

  /* ═══════════════════════════════════════════════ */
  section('C · and they are STILL an express member')
  {
    const r = await call('GET', '/admin/express-members?per_page=100', { jar: aJar })
    check('the express members list answers', r.status === 200, String(r.status))
    check('the rejected student appears there too — both places, as intended',
      emails(r).includes(e1), emails(r).join(' | '))
  }

  /* ═══════════════════════════════════════════════ */
  section('D · the other tabs did not change')
  {
    const pending = await call('GET', '/admin/enrollment-requests?status=pending&per_page=100', { jar: aJar })
    check('a rejected student is not in Pending', !emails(pending).includes(e1), emails(pending).join(' | '))

    const approved = await call('GET', '/admin/enrollment-requests?status=approved&per_page=100', { jar: aJar })
    check('nor in Approved', !emails(approved).includes(e1), emails(approved).join(' | '))

    const all = await call('GET', '/admin/enrollment-requests?status=all&per_page=100', { jar: aJar })
    check('but IS in All — "all" means all', emails(all).includes(e1), emails(all).join(' | '))

    /* An express-BORN member never went through this pipeline, so the
       exclusion that hid them must still hold. This is the assertion that
       stops the fix from simply deleting the filter. */
    const eb = email('express-born')
    await UserModel.create({
      name: 'Express Born', email: eb, passwordHash: hash, role: 'student',
      isActive: true, signupType: 'express', enrollmentStatus: 'pending',
      organizationId: org._id, enrollmentApplication: { homeCountry: 'UAE' },
    })
    const p2 = await call('GET', '/admin/enrollment-requests?status=pending&per_page=100', { jar: aJar })
    check('an express-born member is still kept OUT of Pending',
      !emails(p2).includes(eb), emails(p2).join(' | '))
    const a2 = await call('GET', '/admin/enrollment-requests?status=all&per_page=100', { jar: aJar })
    check('and out of All', !emails(a2).includes(eb), emails(a2).join(' | '))
  }

  /* ═══════════════════════════════════════════════ */
  section('E · re-approving puts the student back properly')
  {
    const r = await call('PATCH', `/admin/enrollment-requests/${id}/approve`, {
      jar: aJar, body: { categories: ['digital-marketing'] },
    })
    check('the re-approve call succeeds', r.status === 200, `${r.status} ${JSON.stringify(r.body?.error ?? '')}`)

    const after = await UserModel.findById(id).lean() as any
    check('the student is approved again', after?.enrollmentStatus === 'approved', String(after?.enrollmentStatus))
    check('the demotion is UNDONE — signupType is full again',
      after?.signupType === 'full', String(after?.signupType))
    check('the rejection reason is cleared', !after?.rejectionReason, String(after?.rejectionReason))
    check('and the programme was assigned', (after?.categories ?? []).includes('digital-marketing'),
      JSON.stringify(after?.categories))

    /* The half-fix — status flipped, type left express — produces an account
       that is approved and invisible. Both list assertions below catch it. */
    const approved = await call('GET', '/admin/enrollment-requests?status=approved&per_page=100', { jar: aJar })
    check('they are visible in Approved, not lost', emails(approved).includes(e1), emails(approved).join(' | '))

    const rejected = await call('GET', '/admin/enrollment-requests?status=rejected&per_page=100', { jar: aJar })
    check('and no longer in Rejected', !emails(rejected).includes(e1), emails(rejected).join(' | '))

    const ex = await call('GET', '/admin/express-members?per_page=100', { jar: aJar })
    check('and no longer an Express Member — they are a full student again',
      !emails(ex).includes(e1), emails(ex).join(' | '))
  }

  /* ═══════════════════════════════════════════════ */
  section('F · what re-approval does NOT do')
  {
    /* Rejection deletes every course enrolment and decrements the counters.
       Re-approval restores the account, not the seats. Asserted so the panel
       keeps telling admins the truth about it. */
    const s2 = await mkFull(email('seats'))
    const teacher = await UserModel.create({
      name: 'T', email: email('t'), passwordHash: hash, role: 'instructor',
      isActive: true, organizationId: org._id,
    })
    const course = await CourseModel.create({
      title: 'Seat Course', slug: `seat-${Date.now()}`, description: 'd',
      instructorId: teacher._id, price: 0, isFree: true, status: 'published',
      language: 'English', organizationId: org._id, enrolledCount: 0,
    })
    await EnrollmentModel.create({ userId: s2._id, courseId: course._id, status: 'active' })
    check('the student starts with a seat',
      await EnrollmentModel.countDocuments({ userId: s2._id }) === 1)

    await call('PATCH', `/admin/enrollment-requests/${String(s2._id)}/reject`, {
      jar: aJar, body: { reason: 'Payment not received.' },
    })
    check('rejecting removes it', await EnrollmentModel.countDocuments({ userId: s2._id }) === 0)

    await call('PATCH', `/admin/enrollment-requests/${String(s2._id)}/approve`, {
      jar: aJar, body: { categories: ['digital-marketing'] },
    })
    check('re-approving does NOT bring the seat back — the panel says so too',
      await EnrollmentModel.countDocuments({ userId: s2._id }) === 0)
    const back = await UserModel.findById(s2._id).lean() as any
    check('but the account itself is fully restored',
      back?.enrollmentStatus === 'approved' && back?.signupType === 'full',
      `${back?.enrollmentStatus}/${back?.signupType}`)
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
