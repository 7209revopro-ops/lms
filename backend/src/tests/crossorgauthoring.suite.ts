/* ─────────────────────────────────────────────────────────────
   Cross-academy classes — AUTHORING, over HTTP.

   WHY THIS SUITE EXISTS, and it is the whole point: four cross-org suites were
   green while the feature was unreachable. Every one of them authored its
   cohorts through the service (`new LiveClassService().create(...)`) or
   straight into the model (`LiveClassModel.create(...)`). Not one went through
   the route.

   And the route DROPPED the field. Three times over:
     · `liveCreateSchema` had no `guestCohorts`, and validate() assigns
       result.data over the body on a non-strict object, so zod stripped it;
     · `#createOne` forwarded an explicit 18-field whitelist that named neither
       `guestCohorts` nor `overflowSeats`;
     · `update()` only ever READ cohorts, to compute a capacity delta.
   Each drop answered 201 or 200 and logged nothing. An admin filling in a form
   would have got a single-academy class and no way to tell.

   So every assertion here goes over the wire, and the ones that matter re-read
   the STORED DOCUMENT afterwards rather than trusting the response body.

   THE INVARIANT, checked after every mutation:
     hostSeatsLeft + Σ guestCohorts[].seatsLeft + overflowSeatsLeft + bookedCount
       === sessionCapacity

   Run: bun run test:crossorgauthoring
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_crossorgauthoring'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
/* PINNED OFF, and that is deliberate. "A cohort can be authored while the
   feature is dark, and no guest can see, book or enter" is phase 2's contract,
   and authoring is exactly what this suite exercises — so off is the state
   under test, not a convenience.

   It also has to be pinned rather than inherited: the flag is read ONCE at
   module load, and a shell that exports CROSS_ORG_CLASSES=true would silently
   retune three assertions. Every import below is therefore a top-level
   `await import`, never a static one — a static import hoists above these
   assignments and captures the operator's environment instead. */
process.env.CROSS_ORG_CLASSES = ''
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
const {
  UserModel, OrganizationModel, CourseModel, SectionModel, LiveClassModel, EnrollmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_crossorgauthoring') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise(r => server.once('listening', r))
const port = (server.address() as { port: number }).port
type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.jar?.size) headers['Cookie'] = [...opts.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  const r = await fetch(`http://127.0.0.1:${port}/api/v1${p}`, {
    method, headers, ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  })
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const [k, v] = (pair ?? '').split('=')
    if (k && v && opts.jar) opts.jar.set(k.trim(), v.trim())
  }
  let body: any = null
  try { body = await r.json() } catch {}
  return { status: r.status, body }
}
const why = (r: { status: number; body: any }) =>
  `${r.status} ${r.body?.error?.code ?? ''} ${String(r.body?.error?.message ?? '').slice(0, 60)}`
const PW = 'TestPass123'

try {
  const hash = await hashPassword(PW)
  const dubai = await OrganizationModel.create({ name: 'DXB', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'BLR', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })

  const mk = (email: string, role: string, org: any, extra: object = {}) =>
    UserModel.create({
      name: email.split('@')[0], email, passwordHash: hash, role,
      isActive: true, isVerified: true, organizationId: org._id, ...extra,
    })

  const teacher = await mk('teach@t.local', 'instructor', dubai)
  const superA  = await mk('super@t.local', 'super_admin', dubai)
  const orgA    = await mk('d.admin@t.local', 'admin', dubai)

  const mkCourse = (t: string, org: any) => CourseModel.create({
    title: t, slug: `${t}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: 'x', price: 0, isFree: true, status: 'published', language: 'English',
    organizationId: org._id, instructorId: teacher._id, category: 'ai', program: 'ai',
  })
  const dCourse = await mkCourse('dxb', dubai)
  const bCourse = await mkCourse('blr', blr)
  const otherB  = await mkCourse('blr2', blr)
  const dSec = await SectionModel.create({ courseId: dCourse._id, title: 'M2', order: 2 })
  const bSec = await SectionModel.create({ courseId: bCourse._id, title: 'M2', order: 2 })
  /* Belongs to a DIFFERENT Bangalore course — the sectionId-in-the-wrong-course case. */
  const strayB = await SectionModel.create({ courseId: otherB._id, title: 'M9', order: 9 })

  /* NOTE for anyone adding a swap test: you cannot. Organization.slug is
     enumerated ['dubai','bangalore'] (schema.ts), so the product has exactly
     two academies — with one as the host there is only ever ONE possible
     guest, and removing one academy while adding another cannot happen. The
     removals-before-adds ordering still matters for the refused-removal case,
     which the section below covers. */

  const bStudent = await mk('b.student@t.local', 'student', blr, { enrollmentStatus: 'approved' })
  await EnrollmentModel.create({ userId: bStudent._id, courseId: bCourse._id, status: 'active' })

  const login = async (email: string, path = '/admin/auth/login') => {
    const jar: Jar = new Map()
    const r = await call('POST', path, { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${email} → ${why(r)}`)
    return jar
  }
  const superJar = await login('super@t.local')
  const orgJar   = await login('d.admin@t.local')
  const studJar  = await login('b.student@t.local', '/auth/login')

  const soon = () => new Date(Date.now() + 86_400_000).toISOString()
  const body = (over: object = {}) => ({
    courseId: String(dCourse._id), title: 'Shared session', scheduledStart: soon(),
    durationMins: 60, type: 'external', sessionCapacity: 30,
    instructorId: String(teacher._id), language: 'English', ...over,
  })
  const cohort = (over: object = {}) => ({
    organizationId: String(blr._id), courseId: String(bCourse._id), seatFloor: 10, ...over,
  })

  /* The invariant, read from the STORED document. */
  const pools = async (id: string) => {
    const d = await LiveClassModel.findById(id)
      .select('sessionCapacity bookedCount hostSeatsLeft overflowSeatsLeft guestCohorts').lean() as any
    const guests = (d.guestCohorts ?? []).reduce((n: number, c: any) => n + c.seatsLeft, 0)
    return {
      cap: d.sessionCapacity, booked: d.bookedCount, host: d.hostSeatsLeft,
      overflow: d.overflowSeatsLeft, cohorts: d.guestCohorts ?? [],
      balances: (d.hostSeatsLeft ?? 0) + guests + (d.overflowSeatsLeft ?? 0) + (d.bookedCount ?? 0)
                === d.sessionCapacity,
    }
  }

  /* ═══════════════════════════════════════════════════════ */
  section('A cohort sent over HTTP is actually stored')
  let sharedId = ''
  {
    const r = await call('POST', '/admin/live-classes', {
      jar: superJar, body: body({ guestCohorts: [cohort({ sectionId: String(bSec._id) })], overflowSeats: 5 }),
    })
    check('super admin can author a shared class', r.status === 201, why(r))
    sharedId = String(r.body?.data?.id ?? r.body?.data?._id ?? '')

    const p = await pools(sharedId)
    /* THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. The response
       body came back 201 even when the field was being stripped. */
    check('the cohort reached the database', p.cohorts.length === 1, `${p.cohorts.length} cohort(s)`)
    check('the guest floor is its own countdown',
      p.cohorts[0]?.seatFloor === 10 && p.cohorts[0]?.seatsLeft === 10,
      JSON.stringify(p.cohorts[0]))
    check('the host keeps capacity minus floors minus overflow',
      p.host === 15, `host ${p.host}`)
    check('the overflow is what was asked for', p.overflow === 5, `overflow ${p.overflow}`)
    check('and the invariant balances', p.balances, JSON.stringify(p))

    const dto = r.body?.data
    check('the DTO reports the academies it serves',
      Array.isArray(dto?.servesAcademies) && dto.servesAcademies.length >= 2,
      JSON.stringify(dto?.servesAcademies))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Authoring while the feature is dark changes nothing for the guest')
  {
    const feed = await call('GET', '/live-classes/upcoming', { jar: studJar })
    const ids = (feed.body?.data ?? []).map((c: any) => String(c.id ?? c._id))
    check('the guest student does not see the class', !ids.includes(sharedId),
      `saw ${ids.length} class(es)`)

    const booked = await call('POST', '/bookings', { jar: studJar, body: { liveClassId: sharedId } })
    check('and cannot book it', booked.status >= 400, why(booked))
    check('and is refused for the RIGHT reason',
      ['WRONG_ACADEMY', 'NOT_ENROLLED', 'CLASS_NOT_FOUND'].includes(booked.body?.error?.code),
      why(booked))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Only a super admin may share a class')
  {
    const r = await call('POST', '/admin/live-classes', {
      jar: orgJar, body: body({ guestCohorts: [cohort()] }),
    })
    check('an org admin is refused', r.status === 403, why(r))
    check('with a code that names the reason',
      r.body?.error?.code === 'CROSS_ACADEMY_FORBIDDEN', why(r))

    /* The gate must key on a NON-EMPTY list, or every ordinary edit by every
       non-super-admin breaks: the modals re-send the whole form each save. */
    const plain = await call('POST', '/admin/live-classes', {
      jar: orgJar, body: body({ guestCohorts: [] }),
    })
    check('but an EMPTY list is not "sharing" and is allowed', plain.status === 201, why(plain))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Every incoherent cohort is refused')
  {
    const cases: Array<[string, object]> = [
      ['the same academy twice',        { guestCohorts: [cohort(), cohort()] }],
      ['the host academy as its own guest',
        { guestCohorts: [cohort({ organizationId: String(dubai._id), courseId: String(dCourse._id) })] }],
      ['a course belonging to another academy',
        { guestCohorts: [cohort({ courseId: String(dCourse._id) })] }],
      ['a module of a different course',
        { guestCohorts: [cohort({ sectionId: String(strayB._id) })] }],
      ['floors larger than the room',  { sessionCapacity: 10, guestCohorts: [cohort({ seatFloor: 20 })] }],
      ['a negative floor',             { guestCohorts: [cohort({ seatFloor: -1 })] }],
      ['a fractional floor',           { guestCohorts: [cohort({ seatFloor: 2.5 })] }],
      ['overflow with nobody to share it', { overflowSeats: 5 }],
      ['cohorts on an in-person class', { isOnline: false, guestCohorts: [cohort()] }],
    ]
    for (const [label, over] of cases) {
      const r = await call('POST', '/admin/live-classes', { jar: superJar, body: body(over) })
      check(`refused: ${label}`, r.status >= 400 && r.status < 500, why(r))
    }

    /* A wrong-academy course and a course that does not exist must be
       INDISTINGUISHABLE, or a Dubai admin can enumerate Bangalore's ids by
       reading the difference. */
    const wrongOrg = await call('POST', '/admin/live-classes', {
      jar: superJar, body: body({ guestCohorts: [cohort({ courseId: String(dCourse._id) })] }) })
    const missing = await call('POST', '/admin/live-classes', {
      jar: superJar, body: body({ guestCohorts: [cohort({ courseId: '6a92a07e661ecd8dcf678899' })] }) })
    check('a wrong-academy course and a missing one answer identically',
      wrongOrg.status === missing.status
      && wrongOrg.body?.error?.code === missing.body?.error?.code,
      `${why(wrongOrg)}  vs  ${why(missing)}`)
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Editing a floor moves seats through the overflow, never a floor')
  {
    const before = await pools(sharedId)
    const up = await call('PATCH', `/admin/live-classes/${sharedId}`, {
      jar: superJar,
      body: { guestCohorts: [{ organizationId: String(blr._id), courseId: String(bCourse._id),
                              sectionId: String(bSec._id), seatFloor: 13 }] },
    })
    check('a super admin can raise a floor', up.status === 200, why(up))
    const a = await pools(sharedId)
    check('the seats came out of the OVERFLOW, not the host floor',
      a.host === before.host && a.overflow === before.overflow - 3,
      `host ${before.host}->${a.host}, overflow ${before.overflow}->${a.overflow}`)
    check('the floor and its countdown moved together',
      a.cohorts[0]?.seatFloor === 13 && a.cohorts[0]?.seatsLeft === 13, JSON.stringify(a.cohorts[0]))
    check('invariant still balances', a.balances, JSON.stringify(a))

    const down = await call('PATCH', `/admin/live-classes/${sharedId}`, {
      jar: superJar,
      body: { guestCohorts: [{ organizationId: String(blr._id), courseId: String(bCourse._id),
                              sectionId: String(bSec._id), seatFloor: 4 }] },
    })
    check('and lower it again', down.status === 200, why(down))
    const b = await pools(sharedId)
    check('the seats went back to the overflow', b.overflow === a.overflow + 9,
      `overflow ${a.overflow}->${b.overflow}`)
    check('invariant still balances', b.balances, JSON.stringify(b))

    /* Raising beyond what the overflow holds must be refused, not absorbed
       by somebody else's floor. */
    const greedy = await call('PATCH', `/admin/live-classes/${sharedId}`, {
      jar: superJar,
      body: { guestCohorts: [{ organizationId: String(blr._id), courseId: String(bCourse._id),
                              sectionId: String(bSec._id), seatFloor: 500 }] },
    })
    check('a floor bigger than the unpromised seats is refused', greedy.status >= 400, why(greedy))
    const c = await pools(sharedId)
    check('and nothing moved', c.balances && c.cohorts[0]?.seatFloor === 4, JSON.stringify(c))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('An ordinary edit by an ordinary admin still works')
  {
    /* The regression this gate is most likely to cause: the edit modal
       re-sends every field, so a title change carries guestCohorts too. */
    const stored = await pools(sharedId)
    const same = stored.cohorts.map((c: any) => ({
      organizationId: String(c.organizationId), courseId: String(c.courseId),
      ...(c.sectionId ? { sectionId: String(c.sectionId) } : {}), seatFloor: c.seatFloor,
    }))
    const r = await call('PATCH', `/admin/live-classes/${sharedId}`, {
      jar: orgJar, body: { title: 'Renamed by the owner', guestCohorts: same },
    })
    check('re-sending unchanged cohorts is not "sharing"', r.status === 200, why(r))
    const after = await pools(sharedId)
    check('and the seats were left alone', after.balances && after.cohorts[0]?.seatFloor === 4,
      JSON.stringify(after))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('A copy of a shared class is still shared')
  {
    const rep = await call('POST', `/admin/live-classes/${sharedId}/repeat`, {
      jar: superJar, body: { weeks: 1 },
    })
    check('repeat succeeds', rep.status === 201, why(rep))
    const copyId = String(rep.body?.data?.[0]?.id ?? rep.body?.data?.[0]?._id ?? '')
    const p = copyId ? await pools(copyId) : null
    check('the copy carries the cohort', !!p && p.cohorts.length === 1,
      p ? `${p.cohorts.length} cohort(s)` : 'no copy id')
    check('and the copy balances too', !!p && p.balances, JSON.stringify(p))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Re-aiming a door moves who may enter, not how many seats')
  {
    /* The diff keyed a cohort on its ACADEMY alone, so changing which of that
       academy's courses the class admitted was accepted with 200 and written
       nowhere. The form said saved; the door never moved. */
    const r = await call('POST', '/admin/live-classes', {
      jar: superJar, body: body({ guestCohorts: [cohort({ sectionId: String(bSec._id) })] }),
    })
    const id = String(r.body?.data?.id ?? '')
    check('a shared class to re-aim', r.status === 201, why(r))

    const before = await pools(id)
    const moved = await call('PATCH', `/admin/live-classes/${id}`, {
      jar: superJar,
      body: { guestCohorts: [{ organizationId: String(blr._id), courseId: String(otherB._id),
                              seatFloor: 10 }] },
    })
    check('re-aiming at another of their courses succeeds', moved.status === 200, why(moved))

    const after = await pools(id)
    check('AND THE STORED DOOR ACTUALLY MOVED',
      String(after.cohorts[0]?.courseId) === String(otherB._id),
      `courseId ${String(after.cohorts[0]?.courseId).slice(-6)}, expected ${String(otherB._id).slice(-6)}`)
    check('dropping the module clears it rather than storing an empty one',
      after.cohorts[0]?.sectionId == null, String(after.cohorts[0]?.sectionId))
    check('and not one seat moved',
      after.cohorts[0]?.seatsLeft === before.cohorts[0]?.seatsLeft
      && after.host === before.host && after.overflow === before.overflow,
      JSON.stringify({ before, after }))
    check('invariant holds', after.balances, JSON.stringify(after))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('A refused cohort change leaves the WHOLE edit unapplied')
  {
    const r = await call('POST', '/admin/live-classes', {
      jar: superJar,
      body: body({ title: 'Original title', sessionCapacity: 20,
                   guestCohorts: [cohort({ seatFloor: 5 })], overflowSeats: 0 }),
    })
    const id = String(r.body?.data?.id ?? '')

    /* The patch used to be written BEFORE the seats moved, so a refused seat
       step returned 409 with the title change already live — the admin was
       told the save failed while half of it had happened. */
    const bad = await call('PATCH', `/admin/live-classes/${id}`, {
      jar: superJar,
      body: { title: 'Renamed while failing',
              guestCohorts: [{ organizationId: String(blr._id), courseId: String(bCourse._id),
                               seatFloor: 500 }] },
    })
    check('an impossible floor is refused', bad.status >= 400, why(bad))

    const { LiveClassModel: LCM } = await import('@/models/schema.ts')
    const doc = await LCM.findById(id).select('title').lean() as any
    check('AND THE TITLE WAS NOT CHANGED', doc.title === 'Original title', doc.title)
    check('invariant holds', (await pools(id)).balances)
  }

  /* ═══════════════════════════════════════════════════════ */
  section('The two class-shape rules hold however the patch is phrased')
  {
    const r = await call('POST', '/admin/live-classes', {
      jar: superJar, body: body({ guestCohorts: [cohort()] }),
    })
    const id = String(r.body?.data?.id ?? '')

    /* Neither rule used to look at the STORED class, only at the request, so
       a patch mentioning one field could produce a state create() refuses. */
    const inPerson = await call('PATCH', `/admin/live-classes/${id}`, {
      jar: superJar, body: { isOnline: false },
    })
    check('an already-shared class cannot be turned in-person', inPerson.status >= 400, why(inPerson))

    const gate = await call('PATCH', `/admin/live-classes/${id}`, {
      jar: superJar, body: { sectionId: String(dSec._id) },
    })
    check('nor gated to a module while a guest names none', gate.status >= 400, why(gate))
    check('and the class is untouched', (await pools(id)).cohorts.length === 1)
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Removed seats go back to the OVERFLOW, not to the host')
  {
    /* The old removal test asserted only the invariant, which balances just as
       well if the seats land in the wrong pool. */
    const r = await call('POST', '/admin/live-classes', {
      jar: superJar,
      body: body({ sessionCapacity: 30, guestCohorts: [cohort({ seatFloor: 8 })], overflowSeats: 2 }),
    })
    const id = String(r.body?.data?.id ?? '')
    const before = await pools(id)

    const gone = await call('PATCH', `/admin/live-classes/${id}`, {
      jar: superJar, body: { guestCohorts: [] },
    })
    check('the academy is removed', gone.status === 200, why(gone))
    const after = await pools(id)
    check('its 8 seats went to the overflow', after.overflow === before.overflow + 8,
      `overflow ${before.overflow} -> ${after.overflow}`)
    check('and the host floor did not move', after.host === before.host,
      `host ${before.host} -> ${after.host}`)
    check('invariant holds', after.balances, JSON.stringify(after))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Removing an academy')
  {
    const gone = await call('PATCH', `/admin/live-classes/${sharedId}`, {
      jar: superJar, body: { guestCohorts: [] },
    })
    check('a cohort holding no seats can be removed', gone.status === 200, why(gone))
    const p = await pools(sharedId)
    check('its seats returned to the overflow', p.cohorts.length === 0 && p.balances,
      JSON.stringify(p))
  }

  console.log(lines.join('\n'))
  console.log(`\ncrossorgauthoring.suite — ${pass} passed, ${failures.length} failed`)
  if (failures.length) console.error('\nFAILURES:\n' + failures.map(f => '  · ' + f).join('\n'))
  server.close()
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  process.exit(failures.length ? 1 : 0)
} catch (err) {
  console.error(err)
  try { server.close(); await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect() } catch {}
  process.exit(1)
}
