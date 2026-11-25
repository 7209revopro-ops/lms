/* ─────────────────────────────────────────────────────────────
   restore-mentor-classes — put a mentor's CANCELLED classes back on
   (2026-11-25: Akhil CP's 10:30 PM MBT · Malayalam classes)

   The reverse of cancel-mentor-classes.ts. Every class of the mentor in the
   range that is cancelled and still ahead goes back to SCHEDULED: the cancel
   reason, who and when are cleared, and its bookings stand as they were — a
   student booked before the cancel is booked again. The class keeps its Meet
   room and link (cancelling withdrew only the calendar invite), so students
   join as usual; the mentor gets it back on their daily schedule email and
   reminders, not as a calendar invite.

   Each student booked on any of them gets ONE email and ONE in-app message
   listing their classes that are back on. Nothing on WhatsApp.

   RUN ON THE SERVER:
     cd ~/lms/backend
     bun src/scripts/restore-mentor-classes.ts --mentor "Akhil CP"            # preview — changes nothing
     bun src/scripts/restore-mentor-classes.ts --mentor "Akhil CP" --commit   # restore + tell students (type RESTORE)
   Options:
     --email akhil@…          pick one mentor when the name matches several
     --to 2026-11-30          last day, UAE time (default 2026-11-30)
     --from 2026-11-25        first day, UAE time (default today); never before now
   Report: restore-mentor-report.txt in the backend folder.
───────────────────────────────────────────────────────────── */
import * as fs from 'fs'
import mongoose from 'mongoose'

const argv = process.argv.slice(2)
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const COMMIT = argv.includes('--commit')
const die = (msg: string): never => { console.error(`\n✖ ${msg}\n`); process.exit(1) }

const MENTOR = opt('mentor') ?? die('Say whose classes: --mentor "Akhil CP"')
const EMAIL  = opt('email')?.trim().toLowerCase()
const DAY = /^\d{4}-\d{2}-\d{2}$/
const todayUae = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10)
const FROM = opt('from') ?? todayUae
const TO   = opt('to') ?? '2026-11-30'
if (!DAY.test(FROM) || !DAY.test(TO)) die('--from / --to must look like 2026-11-30')
const fromAt = new Date(`${FROM}T00:00:00+04:00`)
const toAt   = new Date(`${TO}T23:59:59.999+04:00`)
if (toAt < fromAt) die(`--to ${TO} is before --from ${FROM}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const DB_URL = process.env['DATABASE_URL'] ?? process.env['MONGODB_URI'] ?? die('DATABASE_URL is not set (run from the backend folder so .env loads).')
mongoose.set('autoIndex', false); mongoose.set('autoCreate', false)
await mongoose.connect(DB_URL, { autoIndex: false, autoCreate: false })
const { LiveClassModel, ClassBookingModel, UserModel } = await import('@/models/schema.ts')

/* ── the mentor — "Akhil CP" also finds "Akhil C P" and "Akhil C.P." ── */
const loose = (s: string) => new RegExp(s.replace(/[\s.]+/g, '').split('').map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.]*'), 'i')
const people = await UserModel.find({
  ...(EMAIL ? { email: EMAIL } : { name: loose(MENTOR.trim()) }),
  role: { $ne: 'student' },
}).select('name email role').lean() as any[]
if (!people.length) die(`No staff member matches ${EMAIL ? `email ${EMAIL}` : `"${MENTOR}"`}.`)
const withClasses: any[] = []
for (const p of people) {
  const n = await LiveClassModel.countDocuments({ instructorId: p._id, status: 'cancelled', scheduledStart: { $gte: fromAt, $lte: toAt } })
  if (n) withClasses.push({ ...p, n })
}
if (!withClasses.length) die(`${people.map(p => `${p.name} <${p.email}>`).join(', ')} — no cancelled classes between ${FROM} and ${TO}.`)
if (withClasses.length > 1) {
  console.log(`\n"${MENTOR}" matches more than one mentor with cancelled classes in ${FROM} → ${TO}:`)
  for (const p of withClasses) console.log(`  ${p.name.padEnd(28)} ${p.email.padEnd(36)} ${p.n} cancelled`)
  die('Pick one:  --email <their email>')
}
const mentor = withClasses[0]

/* ── the classes: cancelled and still ahead ── */
const now = new Date()
const all = await LiveClassModel.find({ instructorId: mentor._id, status: 'cancelled', scheduledStart: { $gte: fromAt, $lte: toAt } })
  .select('title scheduledStart isOnline courseId cancelReason cancelledByName cancelledAt cancelCause').sort({ scheduledStart: 1 }).lean() as any[]
const past   = all.filter(c => new Date(c.scheduledStart) <= now)
const target = all.filter(c => new Date(c.scheduledStart) > now)

const seats = await ClassBookingModel.find({ liveClassId: { $in: target.map(c => c._id) }, status: 'booked' }).select('liveClassId userId').lean() as any[]
const seatsOf = new Map<string, any[]>()
for (const b of seats) seatsOf.set(String(b.liveClassId), [...(seatsOf.get(String(b.liveClassId)) ?? []), b])
const students = new Set(seats.map(b => String(b.userId)))

const dubai  = (t: Date | string) => new Date(new Date(t).getTime() + 4 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')
const pretty = (t: Date | string) => new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
const line   = (c: any) => `${dubai(c.scheduledStart)}  ${c.title} · ${c.isOnline === false ? 'in person' : 'online'}`
const why    = (c: any) => `cancelled${c.cancelledByName ? ` by ${c.cancelledByName}` : ''}${c.cancelCause ? ` (${c.cancelCause})` : ''}${c.cancelReason ? ` — "${c.cancelReason}"` : ''}`

const out: string[] = []
out.push(`${mentor.name} <${mentor.email}> — cancelled classes ${FROM} → ${TO} (UAE) — ${COMMIT ? 'RESTORING' : 'preview, nothing changed'}`)
out.push('')
out.push(`To put back on:                ${target.length}  · ${seats.length} bookings · ${students.size} students to tell`)
if (past.length) out.push(`Already past (left as is):     ${past.length}`)
out.push('')
out.push(`WILL BE PUT BACK ON (${target.length}):`)
for (const c of target) out.push(`  ${line(c)} · ${(seatsOf.get(String(c._id)) ?? []).length} booked · ${why(c)}`)

if (COMMIT && target.length) {
  const ok = prompt(`\nThis puts ${target.length} classes of ${mentor.name} back on the LIVE LMS and emails ${students.size} students. Type RESTORE to continue:`)
  if (ok !== 'RESTORE') { await mongoose.disconnect(); die('Stopped — nothing changed.') }

  const { LiveClassService } = await import('@/services/liveClass.service.ts')
  const svc = new LiveClassService()
  let restored = 0
  const failed: string[] = []
  const back = new Set<string>()
  for (const c of target) {
    try {
      await svc.update(String(c._id), { status: 'scheduled' } as any)
      await LiveClassModel.updateOne({ _id: c._id }, { $unset: {
        cancelReason: '', cancelledAt: '', cancelledBy: '', cancelledByName: '', cancelCause: '',
        emptyCheckedAt: '', emptyWouldCancel: '',
      } })
      restored++; back.add(String(c._id))
    } catch (e) { failed.push(`restore ${line(c)} — ${(e as Error).message}`) }
    await sleep(500)
  }

  /* One message per student, listing their classes that are back on. */
  const { NotificationService } = await import('@/services/notification.service.ts')
  const { sendAdminMessageEmail } = await import('@/services/email.service.ts')
  const { SCHEDULE_LINK, scheduleUrl } = await import('@/utils/clientLinks.ts')
  const notes = new NotificationService()
  const byStudent = new Map<string, any[]>()
  for (const c of target) if (back.has(String(c._id)))
    for (const b of seatsOf.get(String(c._id)) ?? []) byStudent.set(String(b.userId), [...(byStudent.get(String(b.userId)) ?? []), c])
  const users = await UserModel.find({ _id: { $in: [...byStudent.keys()].map(id => new mongoose.Types.ObjectId(id)) }, isActive: { $ne: false } })
    .select('name email').lean() as any[]
  let told = 0, emailed = 0
  for (const u of users) {
    const list = byStudent.get(String(u._id)) ?? []
    const items = list.map(c => `• ${c.title} — ${pretty(c.scheduledStart)} (UAE time)`).join('\n')
    const title = list.length === 1 ? 'Your class is back on' : `${list.length} of your classes are back on`
    const body = `${list.length === 1 ? 'This class was cancelled and is running again' : 'These classes were cancelled and are running again'} — your seat is saved, no need to book:\n${items}`
    try { await notes.create(String(u._id), { kind: 'system', title, body, link: SCHEDULE_LINK }); told++ } catch (e) { failed.push(`in-app ${u.email} — ${(e as Error).message}`) }
    if (u.email) {
      try {
        await sendAdminMessageEmail(u.email, title, `Hi ${u.name ?? 'there'},\n\n${body}\n\nYou'll get your joining link before the class as usual.`, { label: 'My bookings', url: scheduleUrl() })
        emailed++
      } catch (e) { failed.push(`email ${u.email} — ${(e as Error).message}`) }
    }
  }
  out.push('')
  out.push(`DONE: ${restored} back on · ${told} students told in the app · ${emailed} emailed · ${failed.length} problems`)
  for (const f of failed) out.push(`  ✖ ${f}`)
}

const text = out.join('\n')
fs.writeFileSync('restore-mentor-report.txt', text + '\n')
console.log('\n' + text)
if (!COMMIT) console.log(`\nPreview only — nothing changed. To do it, add --commit\n`)
await mongoose.disconnect()
process.exit(0)
