/* ─────────────────────────────────────────────────────────────
   cancel-mentor-classes — cancel every class one mentor has in a date range
   (2026-11-20: Arya, today to 30 Nov)

   Every class of the mentor still to start in the range — online and in
   person, booked or not — is CANCELLED (never deleted, so admins still see
   it), with a reason students see, cause admin. Its Meet / calendar event is
   withdrawn by the normal cancel path (Google tells the mentor). A class
   already started or over is left alone; one already cancelled is skipped.

   Each student booked on any of them gets ONE email and ONE in-app message
   listing their cancelled classes, with a link to book others. Nothing on
   WhatsApp; students who were not booked are not messaged. Google is paced —
   one class a second.

   RUN ON THE SERVER:
     cd ~/lms/backend
     bun src/scripts/cancel-mentor-classes.ts --mentor "Arya"                 # preview — changes nothing
     bun src/scripts/cancel-mentor-classes.ts --mentor "Arya" --commit        # cancel + tell students (type CANCEL)
   Options:
     --email arya@…           pick one mentor when the name matches several
     --to 2026-11-30          last day, UAE time (default 2026-11-30)
     --from 2026-11-20        first day, UAE time (default today); never before now
     --reason "…"             what students read (default below)
   Report: cancel-mentor-report.txt in the backend folder.
───────────────────────────────────────────────────────────── */
import * as fs from 'fs'
import mongoose from 'mongoose'

const argv = process.argv.slice(2)
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const COMMIT = argv.includes('--commit')
const die = (msg: string): never => { console.error(`\n✖ ${msg}\n`); process.exit(1) }

const MENTOR = opt('mentor') ?? die('Say whose classes: --mentor "Arya"')
const EMAIL  = opt('email')?.trim().toLowerCase()
const REASON = opt('reason') ?? 'The mentor is not available for this class'
const DAY = /^\d{4}-\d{2}-\d{2}$/
const todayUae = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10)
const FROM = opt('from') ?? todayUae
const TO   = opt('to') ?? '2026-11-30'
if (!DAY.test(FROM) || !DAY.test(TO)) die('--from / --to must look like 2026-11-30')
/* UAE days (UTC+4, no DST) → UTC instants. */
const fromAt = new Date(`${FROM}T00:00:00+04:00`)
const toAt   = new Date(`${TO}T23:59:59.999+04:00`)
if (toAt < fromAt) die(`--to ${TO} is before --from ${FROM}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const DB_URL = process.env['DATABASE_URL'] ?? process.env['MONGODB_URI'] ?? die('DATABASE_URL is not set (run from the backend folder so .env loads).')
mongoose.set('autoIndex', false); mongoose.set('autoCreate', false)
await mongoose.connect(DB_URL, { autoIndex: false, autoCreate: false })
const { LiveClassModel, ClassBookingModel, UserModel } = await import('@/models/schema.ts')

/* ── the mentor ── */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const people = await UserModel.find({
  ...(EMAIL ? { email: EMAIL } : { name: new RegExp(esc(MENTOR.trim()), 'i') }),
  role: { $ne: 'student' },
}).select('name email role isActive').lean() as any[]
if (!people.length) die(`No staff member matches ${EMAIL ? `email ${EMAIL}` : `"${MENTOR}"`}.`)
/* Of several matches, only those with classes in the range matter. */
const withClasses: any[] = []
for (const p of people) {
  const n = await LiveClassModel.countDocuments({ instructorId: p._id, scheduledStart: { $gte: fromAt, $lte: toAt } })
  if (n) withClasses.push({ ...p, n })
}
if (!withClasses.length) die(`${people.map(p => `${p.name} <${p.email}>`).join(', ')} — no classes between ${FROM} and ${TO}.`)
if (withClasses.length > 1) {
  console.log(`\n"${MENTOR}" matches more than one mentor with classes in ${FROM} → ${TO}:`)
  for (const p of withClasses) console.log(`  ${p.name.padEnd(28)} ${p.email.padEnd(36)} ${p.n} classes`)
  die('Pick one:  --email <their email>')
}
const mentor = withClasses[0]

/* ── the classes ── */
const now = new Date()
const all = await LiveClassModel.find({ instructorId: mentor._id, scheduledStart: { $gte: fromAt, $lte: toAt } })
  .select('title scheduledStart status isOnline courseId').populate('courseId', 'title').sort({ scheduledStart: 1 }).lean() as any[]
const already = all.filter(c => c.status === 'cancelled')
const started = all.filter(c => c.status !== 'cancelled' && (c.status !== 'scheduled' || new Date(c.scheduledStart) <= now))
const target  = all.filter(c => c.status === 'scheduled' && new Date(c.scheduledStart) > now)

const seats = await ClassBookingModel.find({ liveClassId: { $in: target.map(c => c._id) }, status: { $in: ['booked', 'attended'] } })
  .select('liveClassId userId').lean() as any[]
const seatsOf = new Map<string, any[]>()
for (const b of seats) seatsOf.set(String(b.liveClassId), [...(seatsOf.get(String(b.liveClassId)) ?? []), b])
const students = new Set(seats.map(b => String(b.userId)))

const dubai  = (t: Date | string) => new Date(new Date(t).getTime() + 4 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')
const pretty = (t: Date | string) => new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
const line   = (c: any) => `${dubai(c.scheduledStart)}  ${c.title} · ${c.isOnline === false ? 'in person' : 'online'}`

const out: string[] = []
out.push(`${mentor.name} <${mentor.email}> — classes ${FROM} → ${TO} (UAE) — ${COMMIT ? 'CANCELLING' : 'preview, nothing changed'}`)
out.push('')
out.push(`To cancel:                     ${target.length}  · ${seats.length} bookings · ${students.size} students to tell`)
if (already.length) out.push(`Already cancelled (skipped):   ${already.length}`)
if (started.length) out.push(`Started or over (left alone):  ${started.length}`)
out.push(`Reason students see:           "${REASON}"`)
out.push('')
out.push(`WILL BE CANCELLED (${target.length}):`)
for (const c of target) out.push(`  ${line(c)} · ${(seatsOf.get(String(c._id)) ?? []).length} booked`)
if (started.length) { out.push(''); out.push('LEFT ALONE (started or over):'); for (const c of started) out.push(`  ${line(c)} · ${c.status}`) }

if (COMMIT && target.length) {
  const ok = prompt(`\nThis CANCELS ${target.length} classes of ${mentor.name} on the LIVE LMS and tells ${students.size} students. Type CANCEL to continue:`)
  if (ok !== 'CANCEL') { await mongoose.disconnect(); die('Stopped — nothing changed.') }

  const { LiveClassService } = await import('@/services/liveClass.service.ts')
  const svc = new LiveClassService()
  const actor = await UserModel.findOne({ role: 'super_admin', isActive: { $ne: false } }).sort({ createdAt: 1 }).select('name email').lean() as any
  if (!actor) die('No super admin to record the cancellations against.')

  let cancelled = 0, n = 0
  const failed: string[] = []
  const cancelledIds = new Set<string>()
  for (const c of target) {
    try {
      await svc.update(String(c._id), {
        status: 'cancelled', cancelReason: REASON, cancelledAt: new Date(), cancelledBy: String(actor._id),
        cancelledByName: actor.name ?? actor.email, cancelCause: 'admin',
      } as any)
      cancelled++; cancelledIds.add(String(c._id))
    } catch (e) { failed.push(`cancel ${line(c)} — ${(e as Error).message}`) }
    if (++n % 10 === 0) console.log(`  ${n}/${target.length}`)
    await sleep(1000)
  }

  /* One message per student, listing their cancelled classes. */
  const { NotificationService } = await import('@/services/notification.service.ts')
  const { sendAdminMessageEmail } = await import('@/services/email.service.ts')
  const { SCHEDULE_LINK, scheduleUrl } = await import('@/utils/clientLinks.ts')
  const notes = new NotificationService()
  const byStudent = new Map<string, any[]>()
  for (const c of target) if (cancelledIds.has(String(c._id)))
    for (const b of seatsOf.get(String(c._id)) ?? []) byStudent.set(String(b.userId), [...(byStudent.get(String(b.userId)) ?? []), c])
  const users = await UserModel.find({ _id: { $in: [...byStudent.keys()].map(id => new mongoose.Types.ObjectId(id)) }, isActive: { $ne: false } })
    .select('name email').lean() as any[]
  let told = 0, emailed = 0
  for (const u of users) {
    const list = byStudent.get(String(u._id)) ?? []
    const items = list.map(c => `• ${c.title} — ${pretty(c.scheduledStart)} (UAE time)`).join('\n')
    const title = list.length === 1 ? 'A class you booked has been cancelled' : `${list.length} classes you booked have been cancelled`
    const why = REASON.replace(/\.$/, '')
    try {
      await notes.create(String(u._id), { kind: 'system', title, body: `${why}, so ${list.length === 1 ? 'this class' : 'these classes'} will not run:\n${items}\n\nPlease book another class on your schedule.`, link: SCHEDULE_LINK })
      told++
    } catch (e) { failed.push(`in-app ${u.email} — ${(e as Error).message}`) }
    if (u.email) {
      try {
        await sendAdminMessageEmail(u.email, title,
          `Hi ${u.name ?? 'there'},\n\n${why}, so ${list.length === 1 ? 'this class you booked' : 'these classes you booked'} will not run:\n\n${items}\n\nThe other classes for your module are on your schedule — please book the one that suits you.`,
          { label: 'Book another class', url: scheduleUrl() })
        emailed++
      } catch (e) { failed.push(`email ${u.email} — ${(e as Error).message}`) }
    }
  }
  out.push('')
  out.push(`DONE: ${cancelled} cancelled · ${told} students told in the app · ${emailed} emailed · ${failed.length} problems`)
  for (const f of failed) out.push(`  ✖ ${f}`)
}

const text = out.join('\n')
fs.writeFileSync('cancel-mentor-report.txt', text + '\n')
const lines = text.split('\n')
console.log('\n' + (lines.length > 100 ? lines.slice(0, 100).join('\n') + `\n   … ${lines.length - 100} more lines in cancel-mentor-report.txt` : text))
if (!COMMIT) console.log(`\nPreview only — nothing changed. To do it, add --commit\n`)
await mongoose.disconnect()
process.exit(0)
