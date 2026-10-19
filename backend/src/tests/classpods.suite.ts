/* ─────────────────────────────────────────────────────────────
   Class pods: an HRMS meeting pod for every online Dubai class
   (services/classPod.service.ts), against a real database and a stand-in
   HRMS that checks the signature and never gives one pod to two.

     A. who gets one: online, Dubai mentor, not cancelled or over — not an
        in-person class, a Bangalore mentor's, Moiz's or Akhil CP's;
     B. held from 15 minutes before to the end; the next class at the same
        time gets the next pod;
     C. moved: re-held, its pod kept when free; cancelled or made in person:
        let go;
     D. every pod taken: "no pod free", the mentor and the Dubai admins told
        once, tried again later;
     E. the HRMS down: kept as an error and put right when it is back;
        a booking cancelled on the HRMS side, or held for a deleted class:
        put right by the sweep;
     F. the Pods page: the pods, who has each, the mentor's own marked;
     G. not configured: nothing happens.

   The HRMS half is proven on its side (hrms-backend src/scripts/classPodCheck.ts).

   Run: CLASSPODS_DATABASE_URL=mongodb://127.0.0.1:<port>/lms_classpods bun --no-env-file src/tests/classpods.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.CLASSPODS_DATABASE_URL ?? 'mongodb://localhost:27017/lms_classpods'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.DOTENV_CONFIG_PATH = '/nonexistent/classpods-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'classpods-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'classpods-suite-refresh-secret-0123456789'

import crypto from 'node:crypto'

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)
const j = (v: unknown) => JSON.stringify(v).slice(0, 300)

/* ── A stand-in HRMS ── */
const SECRET = 'classpods-suite-shared-secret-0123456789abcdef'
const ORG = 'hrms-dubai-org'
let down = false
const rooms = ['Pod 4', 'Pod 6', 'Pod 7', 'Pod 8', 'Pod 9', 'Pod 10', 'Pod 11', 'Pod 5'].map((name, i) => ({ id: `room${i}`, name }))
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
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_classpods') {
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

step('G. Not configured');
check('no HRMS settings: nothing is asked', await pods.syncClassPod(await cls('Early', mo, 1), NOW) === 'off' && bookings.length === 0)
Object.assign(process.env, { HRMS_API_URL: `${HRMS_URL}/api/v1`, HRMS_CLIENT_ID: 'lms', HRMS_INTEGRATION_SECRET: SECRET, HRMS_ORG_ID: ORG })
delete process.env.HRMS_CLASS_PODS; delete process.env.POD_EXCLUDED_MENTORS; delete process.env.POD_LEAD_MINUTES
pods.resetPodCache()

step('A. Who gets one');
const a1 = await cls('Wave theory', mo, 2)
check('an online class of a Dubai mentor: a pod', await pods.syncClassPod(a1, NOW) === 'booked' && (await podOf(a1))?.roomName === 'Pod 4', j(await podOf(a1)))
const offline = await cls('In the classroom', mo, 2, { isOnline: false })
const cancelled = await cls('Called off', mo, 2, { status: 'cancelled' })
const byMoiz = await cls('Moiz class', moiz, 2)
const byAkhil = await cls('Akhil class', akhil, 2)
const byRavi = await cls('Bangalore class', ravi, 2)
const over = await cls('Yesterday', mo, -30)
for (const [id, why] of [[offline, 'in person'], [cancelled, 'cancelled'], [byMoiz, 'Moiz'], [byAkhil, 'Akhil CP'], [byRavi, 'a Bangalore mentor'], [over, 'over']] as const) {
  check(`no pod: ${why}`, await pods.syncClassPod(id, NOW) === 'none' && heldBy(id).length === 0)
}

step('B. Held from 15 minutes before; the next class the next pod');
const h1 = heldBy(a1)[0]!
check('from 15 minutes before it starts to its end', h1.start.getTime() === hrs(2).getTime() - 15 * 60_000 && h1.end.getTime() === hrs(3).getTime(), j(view(h1)))
check('…labelled with the mentor, titled with the class', h1.holder === 'LMS class · Mentor Mo' && h1.title === 'Class: Wave theory')
const a2 = await cls('Price action', sara, 2.5)
check('another overlapping it: Pod 6', await pods.syncClassPod(a2, NOW) === 'booked' && (await podOf(a2))?.roomName === 'Pod 6')
check('nothing changed, asked again: the same booking', await pods.syncClassPod(a1, NOW) === 'booked' && heldBy(a1).length === 1 && heldBy(a1)[0]!.id === h1.id)

step('C. Moved, cancelled, made in person');
await LiveClassModel.updateOne({ _id: a1 }, { $set: { scheduledStart: hrs(2.25) } })
const sweep1 = await pods.runPodSweep(NOW)
const m1 = heldBy(a1)[0]!
check('moved 15 minutes: re-held by the sweep, Pod 4 kept', sweep1.synced >= 1 && m1.id !== h1.id && m1.roomId === 'room0' && h1.status === 'cancelled', j({ sweep1, m1: view(m1) }))
await LiveClassModel.updateOne({ _id: a2 }, { $set: { status: 'cancelled' } })
await pods.runPodSweep(NOW)
check('cancelled: its pod let go, the class no longer says it has one', heldBy(a2).length === 0 && !(await podOf(a2)))
await LiveClassModel.updateOne({ _id: a1 }, { $set: { isOnline: false } })
await pods.runPodSweep(NOW)
check('made in person: let go', heldBy(a1).length === 0 && !(await podOf(a1)))
await LiveClassModel.updateOne({ _id: a1 }, { $set: { isOnline: true } })
await pods.runPodSweep(NOW)
check('online again: held again', heldBy(a1).length === 1 && (await podOf(a1))?.state === 'booked')
await LiveClassModel.updateOne({ _id: a1 }, { $set: { instructorId: moiz } })
await pods.runPodSweep(NOW)
check('given to Moiz: let go', heldBy(a1).length === 0 && !(await podOf(a1)))

step('D. Every pod taken');
const full: string[] = []
for (let i = 0; i < 7; i++) full.push(await cls(`Busy ${i}`, i % 2 ? mo : sara, 5))
await pods.runPodSweep(NOW)
check('seven classes at 17:00: seven pods, all different, never Pod 5', new Set(full.map((id) => heldBy(id)[0]?.roomId)).size === 7 && !live().some((b) => b.roomId === 'room7'), j(full.map((id) => heldBy(id)[0]?.roomId)))
const eighth = await cls('One too many', mo, 5.5)
check('an eighth at the same time: no pod free', await pods.syncClassPod(eighth, NOW) === 'no_room' && (await podOf(eighth))?.state === 'no_room')
const told = await NotificationModel.find({ title: /No pod free for "One too many"/ }).lean()
const whom = told.map((n: any) => String(n.userId)).sort()
check('the Dubai admin told in the app — not Bangalore\'s admin, not the mentor', whom.includes(String(admin)) && !whom.includes(String(blrAdmin)) && !whom.includes(String(mo)), j(whom))
const lostMail = await mails(/No pod for your class now: One too many/)
check('the mentor told by email', lostMail.length === 1 && lostMail[0].to === 'mo@deltainstitutions.com' && /Every meeting pod is booked/.test(lostMail[0].html), j(lostMail.map((m: any) => m.to)))
await pods.syncClassPod(eighth, NOW)
check('…once, not every time it is tried', (await NotificationModel.countDocuments({ title: /No pod free for "One too many"/ })) === told.length && (await mails(/No pod for your class now: One too many/)).length === 1)
const quiet = await pods.runPodSweep(NOW)
check('the sweep leaves it until it is due a retry', (await podOf(eighth))?.state === 'no_room' && quiet.synced === 0, j(quiet))
const freed = heldBy(full[0]!)[0]!
freed.status = 'cancelled'                             // somebody freed a pod on the HRMS side
await LiveClassModel.updateOne({ _id: full[0] }, { $set: { status: 'cancelled' } })
await pods.runPodSweep(new Date(NOW.getTime() + 11 * 60_000))
check('a pod freed, ten minutes on: the waiting class gets it', (await podOf(eighth))?.state === 'booked' && heldBy(eighth)[0]?.roomId === freed.roomId, j(await podOf(eighth)))
const gotMail = await mails(/Your pod for One too many/)
check('…and its mentor is emailed the pod, with Join now and the joining link', gotMail.length === 1 && gotMail[0].html.includes(`https://admin.example.test/live-classes/${eighth}/join`) && gotMail[0].html.includes('Join now'), j(gotMail.map((m: any) => m.subject)))

step('Moved to another pod; far-off classes; the emails');
const p1 = await cls('Moving class', mo, 30, { meetingUrl: 'https://meet.google.com/abc-defg-hij', type: 'external' })
await pods.syncClassPod(p1, NOW)
check('booked Pod 4 (no email: its first pod)', (await podOf(p1))?.roomName === 'Pod 4' && (await mails(/Moving class/)).length === 0)
bookings.push({ id: 'staff1', roomId: 'room0', start: hrs(31.5), end: hrs(33), title: 'Staff', holder: 'HR', classRef: null, status: 'booked' })
await LiveClassModel.updateOne({ _id: p1 }, { $set: { scheduledStart: hrs(32) } })
await pods.syncClassPod(p1, NOW)
const moved2 = await mails(/Your pod for Moving class: Pod 6/)
check('moved to a time Pod 4 is taken: Pod 6, and the mentor emailed it', (await podOf(p1))?.roomName === 'Pod 6' && moved2.length === 1, j(await podOf(p1)))
check('…Join now first (records attendance), the Meet link under it', moved2[0].html.indexOf('Join now') < moved2[0].html.indexOf('Your joining link') && moved2[0].html.includes('https://meet.google.com/abc-defg-hij'))
const far = await cls('Far off', mo, 24 * 20)
await pods.syncClassPod(far, NOW)
bookings.push({ id: 'staff2', roomId: 'room0', start: hrs(24 * 20 - 1), end: hrs(24 * 20 + 2), title: 'Staff', holder: 'HR', classRef: null, status: 'booked' })
heldBy(far)[0]!.status = 'cancelled'
await LiveClassModel.updateOne({ _id: far }, { $set: { scheduledStart: hrs(24 * 20 + 0.5) } })
await pods.syncClassPod(far, NOW)
check('a class 20 days off changes pod: no email (only the next 7 days)', (await mails(/Far off/)).length === 0 && (await podOf(far))?.state === 'booked')
const emails = await import('@/services/email.service.ts')
await emails.sendInstructorClassScheduled('mo@deltainstitutions.com', 'Mo', 'Course', 'Scheduled one', hrs(48), 'https://meet.google.com/xyz-abcd-efg', 'dubai', { classId: 'c123', pod: { state: 'booked', roomName: 'Pod 9' } })
const sched = (await mails(/You've been scheduled: Scheduled one/))[0]
check('"You\'ve been scheduled": the pod, Join now (tracked) and the Meet link under it', !!sched && sched.html.includes('Pod 9') && sched.html.includes('https://admin.example.test/live-classes/c123/join')
  && sched.html.indexOf('Join now') < sched.html.indexOf('Your joining link') && sched.text.includes('Pod: Pod 9'), sched?.text)
await emails.sendInstructor15MinReminder('mo@deltainstitutions.com', 'Mo', 'Soon one', hrs(0.25), 'https://meet.google.com/aaa-bbbb-ccc', 'dubai', { classId: 'c456', pod: { state: 'no_room' } })
const soon = (await mails(/Starting in 15 min: Soon one/))[0]
check('the 15-minute reminder: no pod free said, Join now and the link', !!soon && /None free yet/.test(soon.html) && soon.html.includes('/live-classes/c456/join') && soon.html.includes('https://meet.google.com/aaa-bbbb-ccc'))
const daily = emails.renderInstructorDailySchedule('Mo', hrs(24), [{ kind: 'class', title: 'Tomorrow class', start: hrs(26), durationMins: 60, online: true, joinUrl: 'https://meet.google.com/ttt-uuuu-vvv', trackedJoinUrl: 'https://admin.example.test/live-classes/c789/join', pod: 'Pod 7' }], 'dubai')
check('tomorrow\'s schedule: each class\'s pod, Join now and the link under it', daily.html.includes('Pod 7') && daily.html.indexOf('c789/join') < daily.html.indexOf('ttt-uuuu-vvv') && daily.text.includes('Pod: Pod 7') && daily.text.includes('Join now: https://admin.example.test/live-classes/c789/join'))

step('E. The HRMS down; put right by the sweep');
const e1 = await cls('While down', sara, 8)
down = true
check('the HRMS down: kept as an error, nothing thrown', await pods.syncClassPod(e1, NOW) === 'error' && (await podOf(e1))?.state === 'error')
down = false
await pods.runPodSweep(new Date(NOW.getTime() + 11 * 60_000))
check('back up: the sweep holds it', (await podOf(e1))?.state === 'booked' && heldBy(e1).length === 1)
heldBy(e1)[0]!.status = 'cancelled'                    // cancelled by somebody on the HRMS side
await pods.runPodSweep(NOW)
check('its booking cancelled on the HRMS side: held again', heldBy(e1).length === 1 && (await podOf(e1))?.bookingId === heldBy(e1)[0]!.id)
const gone = await cls('Deleted raw', mo, 9)
await pods.syncClassPod(gone, NOW)
await LiveClassModel.deleteOne({ _id: gone })
await pods.runPodSweep(NOW)
check('deleted without a word (a script): its pod let go by the sweep', heldBy(gone).length === 0)

step('F. The Pods page');
const v = await pods.podsView(hrs(0), hrs(24), String(mo))
check('the seven pods, in order', v.configured && v.pods.map((p) => p.name).join() === 'Pod 4,Pod 6,Pod 7,Pod 8,Pod 9,Pod 10,Pod 11', j(v.pods))
check('who has each, the mentor\'s own marked', v.bookings.length === live().filter((b) => b.roomId !== 'room7' && b.start < hrs(24) && b.end > hrs(0)).length && v.bookings.some((b) => b.mine) && v.bookings.every((b) => !b.mine || heldBy(b.classId!).length === 1), j(v.bookings.slice(0, 2)))

step('The backfill\'s dry run');
const plan = await pods.planPodBackfill(NOW)
const row = (id: string) => plan.find((p) => p.classId === id)
const before = live().length
check('reads only: nothing booked or let go', live().length === before)
check('a class holding its pod keeps it; Moiz\'s skipped, saying why', row(e1)?.outcome === 'keeps' && row(byMoiz)?.outcome === 'skip' && row(byMoiz)?.reason === 'excluded mentor', j([row(e1), row(byMoiz)]))
const fresh = await cls('Not yet held', mo, 20)
const plan2 = await pods.planPodBackfill(NOW)
check('a class with none yet: the pod it would get', plan2.find((p) => p.classId === fresh)?.outcome === 'gets' && plan2.find((p) => p.classId === fresh)?.pod === 'Pod 4', j(plan2.find((p) => p.classId === fresh)))

step('Settings');
process.env.POD_EXCLUDED_MENTORS = 'sara@deltainstitutions.com'
pods.resetPodCache()
await pods.runPodSweep(NOW)
check('the excluded list is a setting: Sara excluded, her pods let go — Moiz no longer', heldBy(e1).length === 0 && pods.whyNoPod({ scheduledStart: hrs(1), durationMins: 60, isOnline: true, status: 'scheduled' } as any, { _id: moiz, email: 'moiz@deltainstitutions.com', organizationId: dubai } as any, String(dubai), NOW) === null)
delete process.env.POD_EXCLUDED_MENTORS

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : ''}`)
hrms.close()
await mongoose.disconnect()
process.exit(fail ? 1 : 0)
