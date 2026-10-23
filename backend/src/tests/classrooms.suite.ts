/* ─────────────────────────────────────────────────────────────
   Pods for office staff only, and rooms for offline classes (2026-10-19,
   services/classPod.service.ts), against a real database and a stand-in HRMS:

     H. the HRMS says where the mentor works: office in Dubai — a pod; works
        from home, not in Dubai, left, not in the HRMS — none, and a pod held
        is let go; found only by name (email differs) — a pod; the HRMS not
        answering where — nothing taken away;
     R. offline classes: the room picked on the class, else the first free of
        Class Room 1, Class Room 2, Ball Room 1, Meeting Room 3; an old "Room
        1" / "2" / "Ball room" tried first; the picked room taken — "no room",
        not another; off site — none; written on the class; the admins told;
        no rooms in the HRMS — none, quietly;
     P. the Pods page's mentors as the HRMS knows them; the room picker's
        free / taken.

   Run: CLASSROOMS_DATABASE_URL=mongodb://127.0.0.1:<port>/lms_classrooms bun --no-env-file src/tests/classrooms.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.CLASSROOMS_DATABASE_URL ?? 'mongodb://localhost:27017/lms_classrooms'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.DOTENV_CONFIG_PATH = '/nonexistent/classrooms-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'classrooms-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'classrooms-suite-refresh-secret-0123456789'

import crypto from 'node:crypto'

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)
const j = (v: unknown) => String(JSON.stringify(v)).slice(0, 300)

/* ── A stand-in HRMS ── */
const SECRET = 'classrooms-suite-shared-secret-0123456789abcdef'
const ORG = 'hrms-dubai-org'
let down = false
const rooms = ['Pod 4', 'Pod 6', 'Pod 7', 'Pod 8', 'Pod 9', 'Pod 10', 'Pod 11', 'Pod 5', 'Class Room 1', 'Class Room 2', 'Ball Room 1', 'Meeting Room 3'].map((name, i) => ({ id: `room${i}`, name }))
/* Where people work, as the stand-in HRMS knows them: by email; `byName` only by their exact name. */
const staff: Record<string, { workMode: 'office' | 'wfh'; location: 'dubai' | 'india' | null; status: string; name: string; email: string }> = {}
let staffDown = false
let staffAsked = 0
type B = { id: string; roomId: string; start: Date; end: Date; title: string; holder: string; classRef: string | null; status: 'booked' | 'cancelled' }
const bookings: B[] = []
let seq = 0
const live = () => bookings.filter((b) => b.status === 'booked')
const clash = (roomId: string, s: Date, e: Date, except?: string) => live().some((b) => b.roomId === roomId && b.id !== except && b.start < e && b.end > s)
const view = (b: B) => ({ id: b.id, roomId: b.roomId, roomName: rooms.find((r) => r.id === b.roomId)!.name, start: b.start.toISOString(), end: b.end.toISOString(), title: b.title, holder: b.holder, classRef: b.classRef })
const signedBad = (method: string, url: string, h: Record<string, unknown>, raw: string) => {
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  const want = crypto.createHmac('sha256', SECRET).update([method, url, String(h['x-delta-timestamp']), String(h['x-delta-nonce']), hash].join('\n')).digest('hex')
  return h['x-delta-client'] !== 'lms' || h['x-delta-signature'] !== want
}
const { createServer } = await import('node:http')
const hrms = createServer(async (req, res) => {
  const send = (status: number, data: unknown, message = 'ok') => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: status < 400, message, data })) }
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString()
  if (down) return send(503, null, 'down')
  if (signedBad(req.method!, req.url!, req.headers as never, raw)) return send(401, null, 'Unauthorized')
  const u = new URL(req.url!, 'http://x')
  if (u.searchParams.get('organizationId') !== ORG) return send(400, null, 'organizationId is required')
  const p = u.pathname.replace('/api/v1/integrations', '')
  if (req.method === 'POST' && p === '/directory/work-modes') {
    staffAsked++
    if (staffDown) return send(503, null, 'down')
    const people = JSON.parse(raw).people as Array<{ email: string; name?: string }>
    return send(200, people.map((q) => {
      const byEmail = staff[q.email.toLowerCase()]
      const byName = !byEmail && q.name ? Object.values(staff).find((s) => s.name.toLowerCase() === q.name!.toLowerCase()) : undefined
      const s = byEmail ?? byName
      return { email: q.email, matchedBy: byEmail ? 'email' : byName ? 'name' : null, hrmsEmail: s?.email ?? null, hrmsName: s?.name ?? null,
        workMode: s?.workMode ?? null, location: s?.location ?? null, status: s?.status ?? null, designation: s ? 'Mentor' : null }
    }))
  }
  if (req.method === 'GET' && p === '/meetings/pods') {
    const names = (u.searchParams.get('names') ?? '').split(',')
    return send(200, names.flatMap((n) => rooms.filter((r) => r.name === n).map((r) => ({ ...r, capacity: 4, location: '' }))))
  }
  if (req.method === 'GET' && p === '/meetings/pod-bookings') {
    const ids = (u.searchParams.get('rooms') ?? '').split(','), from = new Date(u.searchParams.get('from')!), to = new Date(u.searchParams.get('to')!)
    return send(200, live().filter((b) => ids.includes(b.roomId) && b.start < to && b.end > from).map(view))
  }
  if (req.method === 'GET' && p === '/meetings/class-pods') {
    const from = new Date(u.searchParams.get('from')!)
    return send(200, live().filter((b) => b.classRef && b.end > from).map((b) => ({ ref: b.classRef, bookingId: b.id, roomId: b.roomId, start: b.start.toISOString(), end: b.end.toISOString() })))
  }
  const m = p.match(/^\/meetings\/class-pods\/(.+)$/)
  if (m && req.method === 'DELETE') {
    let n = 0
    for (const b of live()) if (b.classRef === m[1]) { b.status = 'cancelled'; n++ }
    return send(200, { released: n })
  }
  if (m && req.method === 'PUT') {
    const body = JSON.parse(raw)
    const s = new Date(body.start), e = new Date(body.end)
    const have = live().find((b) => b.classRef === m[1])
    if (have && body.rooms.includes(have.roomId) && have.start.getTime() === s.getTime() && have.end.getTime() === e.getTime()) {
      have.title = body.title; have.holder = body.label
      return send(200, { ok: true, booking: view(have), changed: false })
    }
    for (const roomId of body.rooms as string[]) {
      if (clash(roomId, s, e, have?.id)) continue
      if (have) have.status = 'cancelled'
      const b: B = { id: `b${++seq}`, roomId, start: s, end: e, title: body.title, holder: body.label, classRef: m[1]!, status: 'booked' }
      bookings.push(b)
      return send(200, { ok: true, booking: view(b), changed: true })
    }
    if (have) have.status = 'cancelled'
    return send(200, { ok: false, reason: 'no_room', message: 'No pod is free' })
  }
  return send(404, null, 'Not found')
})
await new Promise<void>((resolve) => hrms.listen(0, '127.0.0.1', resolve))
const HRMS_URL = `http://127.0.0.1:${(hrms.address() as { port: number }).port}`

const mongoose = (await import('mongoose')).default
const { UserModel, LiveClassModel, OrganizationModel, NotificationModel, EmailOutboxModel } = await import('@/models/schema.ts') as any
process.env.ADMIN_URL = 'https://admin.example.test'
const mails = (subject: RegExp) => EmailOutboxModel.find({ subject }).lean()
const pods = await import('@/services/classPod.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_classrooms') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.dropDatabase()

const NOW = new Date('2026-10-19T08:00:00Z')          // noon in Dubai
const hrs = (h: number) => new Date(NOW.getTime() + h * 3600_000)
const dubai = (await OrganizationModel.collection.insertOne({ name: 'Delta Dubai', slug: 'dubai', currency: 'AED' })).insertedId
const blr = (await OrganizationModel.collection.insertOne({ name: 'Delta Bangalore', slug: 'bangalore', currency: 'INR' })).insertedId
const user = async (name: string, email: string, org: unknown, role = 'instructor') =>
  (await UserModel.collection.insertOne({ name, email, role, organizationId: org, isActive: true })).insertedId
const mo = await user('Mentor Mo', 'mo@deltainstitutions.com', dubai)
const sara = await user('Sara', 'sara@deltainstitutions.com', dubai)
const moiz = await user('Moiz', 'moiz@deltainstitutions.com', dubai)
const akhil = await user('Akhil CP', 'akhilcp@deltainstitutions.com', dubai)
const ravi = await user('Ravi', 'ravi@deltainstitutions.com', blr)
const admin = await user('Dubai Admin', 'admin@deltainstitutions.com', dubai, 'admin')
const blrAdmin = await user('Bangalore Admin', 'badmin@deltainstitutions.com', blr, 'admin')
const course = new mongoose.Types.ObjectId()
const cls = async (title: string, mentor: unknown, startH: number, extra: Record<string, unknown> = {}) =>
  String((await LiveClassModel.collection.insertOne({
    title, courseId: course, instructorId: mentor, scheduledStart: hrs(startH), durationMins: 60, status: 'scheduled', isOnline: true,
    organizationId: dubai, type: 'external', ...extra,
  })).insertedId)
const podOf = async (id: string) => (await LiveClassModel.findById(id).select('pod').lean())?.pod as any
const heldBy = (id: string) => live().filter((b) => b.classRef === id)

Object.assign(process.env, { HRMS_API_URL: `${HRMS_URL}/api/v1`, HRMS_CLIENT_ID: 'lms', HRMS_INTEGRATION_SECRET: SECRET, HRMS_ORG_ID: ORG })
delete process.env.HRMS_CLASS_PODS; delete process.env.HRMS_CLASS_ROOMS; delete process.env.POD_EXCLUDED_MENTORS; delete process.env.POD_LEAD_MINUTES
pods.resetPodCache()
const roomOf = async (id: string) => (await LiveClassModel.findById(id).select('room location').lean()) as any
const person = (email: string, name: string, workMode: 'office' | 'wfh', location: 'dubai' | 'india' | null = 'dubai', status = 'active') => { staff[email] = { email, name, workMode, location, status } }
person('mo@deltainstitutions.com', 'Mentor Mo', 'office')
person('sara@deltainstitutions.com', 'Sara', 'office')

step('H. Office staff in Dubai only')
const w1 = await cls('Mo online', mo, 2)
check('office in Dubai: a pod', await pods.syncClassPod(w1, NOW) === 'booked' && heldBy(w1).length === 1, j(await podOf(w1)))
const mary = await user('Mary Roy', 'mary@deltainstitutions.com', dubai)
person('mary@deltainstitutions.com', 'Mary Roy', 'wfh', 'india')
const w2 = await cls('Mary online', mary, 2)
check('works from home (India): no pod', await pods.syncClassPod(w2, NOW) === 'none' && heldBy(w2).length === 0)
const nadia = await user('Nadia', 'nadia@deltainstitutions.com', dubai)
person('nadia@deltainstitutions.com', 'Nadia', 'office', 'india')
check('office but in India: no pod', await pods.syncClassPod(await cls('Nadia online', nadia, 2), NOW) === 'none')
const gone = await user('Gone Guy', 'gone@deltainstitutions.com', dubai)
person('gone@deltainstitutions.com', 'Gone Guy', 'office', 'dubai', 'resigned')
check('left: no pod', await pods.syncClassPod(await cls('Gone online', gone, 2), NOW) === 'none')
const ghost = await user('Ghost', 'ghost@deltainstitutions.com', dubai)
check('not in the HRMS: no pod', await pods.syncClassPod(await cls('Ghost online', ghost, 2), NOW) === 'none')
const libin = await user('Libin Paul', 'libin@deltainstitutions.com', dubai)
person('libinpaul@deltainstitutions.com', 'Libin Paul', 'office')
const w3 = await cls('Libin online', libin, 2)
check('found by name only (email differs), office in Dubai: a pod', await pods.syncClassPod(w3, NOW) === 'booked', j(await podOf(w3)))
// Sara had a pod; HR marks her work-from-home: the next look (after the cache) lets it go.
const w4 = await cls('Sara online', sara, 5)
await pods.syncClassPod(w4, NOW)
staff['sara@deltainstitutions.com'].workMode = 'wfh'
pods.resetPodCache()
await pods.runPodSweep(NOW)
check('marked work-from-home: the pod she held is let go', heldBy(w4).length === 0 && !(await podOf(w4)), j(await podOf(w4)))
// The HRMS can't say where people work: nothing taken away, nothing given for it.
staff['sara@deltainstitutions.com'].workMode = 'office'
pods.resetPodCache()
await pods.syncClassPod(w4, NOW)
staffDown = true
staff['mo@deltainstitutions.com'].workMode = 'wfh'
pods.resetPodCache()
await pods.runPodSweep(NOW)
check('the HRMS not answering where people work: pods stay held', heldBy(w1).length === 1 && heldBy(w4).length === 1)
staffDown = false
staff['mo@deltainstitutions.com'].workMode = 'office'
pods.resetPodCache()
const asked = staffAsked
await pods.runPodSweep(NOW); await pods.runPodSweep(NOW)
check('asked once per ten minutes, not every sweep', staffAsked - asked === 1, String(staffAsked - asked))

step('R. Rooms for offline classes')
const o1 = await cls('Offline A', mo, 24, { isOnline: false, location: 'AL QUSAIS', room: '' })
check('no room picked: the first free — Class Room 1', await pods.syncClassPod(o1, NOW) === 'booked' && (await podOf(o1))?.roomName === 'Class Room 1' && (await podOf(o1))?.auto === true, j(await podOf(o1)))
check('…written on the class', (await roomOf(o1))?.room === 'Class Room 1')
const o2 = await cls('Offline B', sara, 24, { isOnline: false, location: 'AL QUSAIS', room: '' })
check('another at the same time: Class Room 2', await pods.syncClassPod(o2, NOW) === 'booked' && (await podOf(o2))?.roomName === 'Class Room 2')
const o3 = await cls('Offline C', mo, 30, { isOnline: false, location: 'BALL ROOM' })
check('an old "BALL ROOM": Ball Room 1', await pods.syncClassPod(o3, NOW) === 'booked' && (await podOf(o3))?.roomName === 'Ball Room 1')
const o4 = await cls('Offline D', mo, 34, { isOnline: false, location: 'AL QUSAIS', room: '2' })
check('an old "2": Class Room 2', await pods.syncClassPod(o4, NOW) === 'booked' && (await podOf(o4))?.roomName === 'Class Room 2')
const o5 = await cls('Offline E', mo, 24, { isOnline: false, location: 'AL QUSAIS', room: 'Class Room 1' })
check('Class Room 1 picked but taken then: "no room" — not given another', await pods.syncClassPod(o5, NOW) === 'no_room' && heldBy(o5).length === 0 && /Class Room 1 is booked/.test((await podOf(o5))?.note ?? ''), j(await podOf(o5)))
const told = await NotificationModel.find({ title: /No room free for "Offline E"/ }).lean()
check('…the Dubai admins told (in the app)', told.length >= 1, String(told.length))
const o6 = await cls('Offline F', mo, 40, { isOnline: false, location: 'AL QUSAIS', room: 'Meeting Room 3' })
check('Meeting Room 3 picked: Meeting Room 3', await pods.syncClassPod(o6, NOW) === 'booked' && (await podOf(o6))?.roomName === 'Meeting Room 3' && (await podOf(o6))?.auto === false)
const o7 = await cls('Villa class', mo, 24, { isOnline: false, location: 'VILLA NO : 25 18 TH' })
check('off site: no room', await pods.syncClassPod(o7, NOW) === 'none' && heldBy(o7).length === 0)
const ghostOff = await cls('Ghost offline', ghost, 44, { isOnline: false, location: 'AL QUSAIS' })
check('a mentor not in the HRMS still gets the room (it is the academy\'s)', await pods.syncClassPod(ghostOff, NOW) === 'booked')
await LiveClassModel.updateOne({ _id: o1 }, { $set: { scheduledStart: hrs(50) } })
check('moved: keeps its room when free', await pods.syncClassPod(o1, NOW) === 'booked' && (await podOf(o1))?.roomName === 'Class Room 1' && heldBy(o1).length === 1)
await LiveClassModel.updateOne({ _id: o2 }, { $set: { isOnline: true } })
check('made online: its room let go, a pod instead', await pods.syncClassPod(o2, NOW) === 'booked' && heldBy(o2).length === 1 && /^Pod/.test((await podOf(o2))?.roomName ?? ''), j(await podOf(o2)))
await LiveClassModel.updateOne({ _id: o6 }, { $set: { status: 'cancelled' } })
check('cancelled: its room let go', await pods.syncClassPod(o6, NOW) === 'released' && heldBy(o6).length === 0)

step('P. The Pods page and the room picker')
const v = await pods.podsView(NOW, hrs(24))
check('the rooms listed after the pods', v.pods.filter((p) => p.kind === 'room').map((p) => p.name).join() === 'Class Room 1,Class Room 2,Ball Room 1,Meeting Room 3' && v.pods[0]!.kind === 'pod', j(v.pods))
const m = new Map(v.mentors.map((x) => [x.email, x]))
check('Mo: office · Dubai, gets one', m.get('mo@deltainstitutions.com')?.hrms === 'office' && m.get('mo@deltainstitutions.com')?.getsPod === true, j(m.get('mo@deltainstitutions.com')))
check('Mary: works from home, no pod with the reason', m.get('mary@deltainstitutions.com')?.hrms === 'wfh' && /works from home/.test(m.get('mary@deltainstitutions.com')?.reason ?? ''))
check('Libin: email differs, the HRMS email shown, gets one', m.get('libin@deltainstitutions.com')?.hrms === 'email_differs' && m.get('libin@deltainstitutions.com')?.hrmsEmail === 'libinpaul@deltainstitutions.com' && m.get('libin@deltainstitutions.com')?.getsPod === true)
check('Ghost: not in the HRMS', m.get('ghost@deltainstitutions.com')?.hrms === 'not_found')
const free = await pods.roomAvailability(hrs(24), hrs(25))
const fr = new Map(free.rooms.map((r) => [r.name, r]))
check('the picker: Class Room 1 free again (its class moved), Class Room 2 free (made online)', fr.get('Class Room 1')?.free === true && fr.get('Class Room 2')?.free === true, j(free))
const busyAt = await pods.roomAvailability(hrs(30), hrs(31))
check('…Ball Room 1 taken at its class, saying by whom', busyAt.rooms.find((r) => r.name === 'Ball Room 1')?.free === false && !!busyAt.rooms.find((r) => r.name === 'Ball Room 1')?.holder, j(busyAt))
const own = await pods.roomAvailability(hrs(30), hrs(31), o3)
check('…but free to the class that holds it (editing it)', own.rooms.find((r) => r.name === 'Ball Room 1')?.free === true)

step('No rooms in the HRMS')
process.env.HRMS_CLASS_ROOMS = 'Room That Is Not There'
pods.resetPodCache()
const o8 = await cls('Offline nowhere', mo, 60, { isOnline: false, location: 'AL QUSAIS' })
check('offline classes hold none, quietly (no error)', await pods.syncClassPod(o8, NOW) === 'none' && !(await podOf(o8)))
delete process.env.HRMS_CLASS_ROOMS

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : ''}`)
hrms.close()
await mongoose.disconnect()
process.exit(fail ? 1 : 0)
