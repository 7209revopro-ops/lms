/* ─────────────────────────────────────────────────────────────
   Cross-academy classes — the roster split (plan phase 4).

   A shared class has one room and TWO rosters. Each academy administers its
   own seats and sees only its own students.

   This is the phase that must land before the class is ever bookable by a
   guest, and the reason is this suite's first section: the bookings query has
   no organisation term of its own, it populates name and email, and it feeds
   the list, the stats strip AND the CSV export. Without the split, one shared
   class puts every guest academy's student into the host's download.

   The negatives matter as much as the positives. Managing the CLASS stays with
   its owner; only SEATS are shared, and only a seat stamped with your own
   academy.

   Run: bun run test:crossorgclass:roster
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_crossorgclass_roster'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
/* PINNED ON. A roster only needs SPLITTING when two academies can hold seats
   in one room, and that state exists only with the feature switched on — with
   it off, servedClassFilter does not widen and a guest academy cannot reach the
   class at all, which is its own correct behaviour and is asserted in
   upcomingfeed.suite.ts. The NARROWING this suite is really about (each academy
   sees only its own seats, the owner included) applies in both states. */
process.env.CROSS_ORG_CLASSES = 'true'
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
  UserModel, OrganizationModel, CourseModel, SectionModel, LiveClassModel, ClassBookingModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_crossorgclass_roster') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

/* ── Minimal HTTP harness, same shape as the sibling suites ── */
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
  const setCookie = r.headers.getSetCookie?.() ?? []
  for (const c of setCookie) {
    const [pair] = c.split(';')
    const [k, v] = (pair ?? '').split('=')
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

  const dAdmin = await mk('d.admin@t.local', 'admin', dubai)
  const bAdmin = await mk('b.admin@t.local', 'admin', blr)
  const teacher = await mk('teach@t.local', 'instructor', dubai)

  const mkCourse = (t: string, org: any) => CourseModel.create({
    title: t, slug: `${t}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: 'x', price: 0, isFree: true, status: 'published', language: 'English',
    organizationId: org._id, instructorId: teacher._id, category: 'ai', program: 'ai',
  })
  const dCourse = await mkCourse('dxb', dubai)
  const bCourse = await mkCourse('blr', blr)
  const dSec = await SectionModel.create({ courseId: dCourse._id, title: 'M2', order: 2 })
  const bSec = await SectionModel.create({ courseId: bCourse._id, title: 'M2', order: 2 })

  const dStudent = await mk('d.student@t.local', 'student', dubai, { enrollmentStatus: 'approved' })
  const bStudent = await mk('b.student@t.local', 'student', blr, { enrollmentStatus: 'approved' })

  /* A Dubai-owned class that also serves Bangalore. Seats: host 5, guest 5. */
  const shared = await LiveClassModel.create({
    courseId: dCourse._id, sectionId: dSec._id, instructorId: teacher._id,
    title: 'Shared DM module 2', type: 'external', meetingUrl: 'https://meet.example/x',
    scheduledStart: new Date(Date.now() + 86_400_000), durationMins: 60,
    organizationId: dubai._id, sessionCapacity: 12, bookedCount: 0,
    hostSeatsLeft: 5, overflowSeatsLeft: 2,
    guestCohorts: [{ organizationId: blr._id, courseId: bCourse._id, sectionId: bSec._id, seatFloor: 5, seatsLeft: 5 }],
  })

  /* One seat per academy, each stamped with its own door — the state phase 6b
     will produce, created directly so phase 4 can be proven before it. */
  const dSeat = await ClassBookingModel.create({
    userId: dStudent._id, liveClassId: shared._id, status: 'booked',
    seatPoolKind: 'host', seatOrganizationId: dubai._id, seatCourseId: dCourse._id, seatSectionId: dSec._id,
  })
  const bSeat = await ClassBookingModel.create({
    userId: bStudent._id, liveClassId: shared._id, status: 'booked',
    seatPoolKind: 'guest', seatOrganizationId: blr._id, seatCourseId: bCourse._id, seatSectionId: bSec._id,
  })
  await LiveClassModel.updateOne({ _id: shared._id }, { $set: { bookedCount: 2, hostSeatsLeft: 4 } })
  await LiveClassModel.updateOne({ _id: shared._id }, { $set: { 'guestCohorts.0.seatsLeft': 4 } })

  /* A Dubai-only class with an UNSTAMPED seat — every booking that exists
     today looks like this. */
  const plain = await LiveClassModel.create({
    courseId: dCourse._id, instructorId: teacher._id, title: 'Dubai only',
    type: 'external', meetingUrl: 'https://meet.example/y',
    scheduledStart: new Date(Date.now() + 86_400_000), durationMins: 60,
    organizationId: dubai._id, sessionCapacity: 10, bookedCount: 1,
  })
  const legacySeat = await ClassBookingModel.create({
    userId: dStudent._id, liveClassId: plain._id, status: 'booked',
  })

  const login = async (email: string) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${email} → ${why(r)}`)
    return jar
  }
  const D = await login('d.admin@t.local')
  const B = await login('b.admin@t.local')

  const ids = (body: any) => (body?.data ?? []).map((b: any) => String(b.id ?? b._id))

  /* ═══════════════════════════════════════════════════════ */
  section('Each academy sees only its own seats on a shared class')
  {
    const dList = await call('GET', `/admin/bookings?liveClassId=${shared._id}`, { jar: D })
    const dIds  = ids(dList.body)
    check('the OWNING academy sees its own seat', dIds.includes(String(dSeat._id)), why(dList))
    check('and NOT the guest academy-s student',
      !dIds.includes(String(bSeat._id)), `${why(dList)} got ${dIds.length} rows`)

    const bList = await call('GET', `/admin/bookings?liveClassId=${shared._id}`, { jar: B })
    const bIds  = ids(bList.body)
    check('the GUEST academy can reach the shared class at all', bList.status === 200, why(bList))
    check('and sees its own student', bIds.includes(String(bSeat._id)), why(bList))
    check('but NOT the host academy-s student',
      !bIds.includes(String(dSeat._id)), `${why(bList)} got ${bIds.length} rows`)
  }

  /* ═══════════════════════════════════════════════════════ */
  section('An unstamped seat belongs to the host, and only the host')
  {
    const dList = await call('GET', `/admin/bookings?liveClassId=${plain._id}`, { jar: D })
    check('the owner still sees legacy seats with no stamp',
      ids(dList.body).includes(String(legacySeat._id)), why(dList))

    /* The Dubai-only class does not serve Bangalore at all, so this is an
       out-of-scope request and answers empty rather than 403. */
    const bList = await call('GET', `/admin/bookings?liveClassId=${plain._id}`, { jar: B })
    check('the other academy sees nothing on a class that is not shared with it',
      ids(bList.body).length === 0, `${why(bList)} got ${ids(bList.body).length} rows`)
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Seats may be managed by their own academy — and only their own')
  {
    const ok = await call('PATCH', `/admin/bookings/${bSeat._id}/attendance`, {
      jar: B, body: { status: 'attended' },
    })
    check('the guest academy marks ITS OWN student present', ok.status === 200, why(ok))

    const nope = await call('PATCH', `/admin/bookings/${dSeat._id}/attendance`, {
      jar: B, body: { status: 'attended' },
    })
    check('but cannot touch the host academy-s student', nope.status === 404, why(nope))

    /* THE ASYMMETRY IS DELIBERATE AND WORTH STATING.

       The host OWNS the room. It can cancel the class out from under both
       cohorts, so withholding authority over a single seat in it would be a
       fiction. callerMayManageSeat therefore keeps callerMayManageSession as
       its first test, and the owner passes it.

       What the host does NOT get is the guest academy's student LIST — the
       roster read above narrows the owner to its own seats. Authority over the
       room, no visibility of the other academy's people. A host acting on a
       guest's seat has to already know the id, which means it came from the
       guest academy asking them to. */
    const hostOnGuest = await call('PATCH', `/admin/bookings/${bSeat._id}/attendance`, {
      jar: D, body: { status: 'missed' },
    })
    check('the HOST keeps authority over seats in the room it owns',
      hostOnGuest.status === 200, why(hostOnGuest))

    const hostRoster = await call('GET', `/admin/bookings?liveClassId=${shared._id}`, { jar: D })
    check('but still cannot SEE the guest academy-s student in its roster',
      !ids(hostRoster.body).includes(String(bSeat._id)), why(hostRoster))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Bulk marking decides per seat, not once per class')
  {
    const bulk = await call('PATCH', '/admin/bookings/bulk-attendance', {
      jar: B, body: { ids: [String(bSeat._id), String(dSeat._id)], status: 'missed' },
    })
    const after = await ClassBookingModel.findById(dSeat._id).lean() as any
    check('the guest academy-s bulk request does not sweep up the host-s student',
      String(after.status) === 'booked', `host seat is now ${after.status}`)
    check('and the response does not confirm the foreign id exists',
      bulk.status === 200, why(bulk))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('The class itself is still the owner-s — sharing widens reads, not writes')
  {
    const edit = await call('PATCH', `/admin/live-classes/${shared._id}`, {
      jar: B, body: { title: 'Renamed by the guest academy' },
    })
    check('a guest academy cannot rename the shared class', edit.status === 404, why(edit))

    const del = await call('DELETE', `/admin/live-classes/${shared._id}`, { jar: B })
    check('nor delete it', del.status === 404, why(del))

    const ownerEdit = await call('PATCH', `/admin/live-classes/${shared._id}`, {
      jar: D, body: { title: 'Renamed by the owner' },
    })
    check('the owner still can', ownerEdit.status === 200, why(ownerEdit))
  }

  console.log(lines.join('\n'))
  console.log(`\ncrossorgclass.roster.suite — ${pass} passed, ${failures.length} failed`)
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
