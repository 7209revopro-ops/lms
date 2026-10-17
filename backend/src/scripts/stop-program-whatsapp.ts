/* ─────────────────────────────────────────────────────────────
   Stop a programme's WhatsApp messages — now, and for its classes still to
   run (the user, 2026-10-17). One programme only; nothing else is touched.

     1. every WhatsApp still WAITING to go to one of its students (any
        template) is closed — status failed, "stopped: programme <title>"
     2. its bookings (classes not over yet) are marked as already reminded —
        5-minute, "has started", day-before, today — so the reminder jobs send
        nothing more for them (the in-app reminders for those go too)
     3. its classes are marked as review-requested, so no "rate your mentor"
   The programme itself, its classes and its students are left as they are.

   Find it by its link code (/p/<code>), id, or title.
   Dry run by default — shows what it would stop. --apply stops it.

   Usage (from backend/):
     bun src/scripts/stop-program-whatsapp.ts --program 27mc4uq5
     bun src/scripts/stop-program-whatsapp.ts --program 27mc4uq5 --apply
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import mongoose, { Types } from 'mongoose'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const REF = arg('--program')
if (!REF) { console.error('usage: --program <link code | id | title> [--apply]'); process.exit(1) }

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const M = await import('@/models/schema.ts')
const { normalizeWhatsAppNumber } = await import('@/utils/normalizeWhatsAppNumber.ts')
const done = async (code: number) => { await mongoose.disconnect(); process.exit(code) }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const found = await M.ProgramModel.find({ $or: [
  { joinCode: REF.toLowerCase() },
  ...(Types.ObjectId.isValid(REF) ? [{ _id: new Types.ObjectId(REF) }] : []),
  { title: new RegExp(`^\\s*${esc(REF.trim()).replace(/\s+/g, '\\s+')}\\s*$`, 'i') },
] }).lean<any[]>()
if (found.length !== 1) { console.error(found.length ? `${found.length} programmes match — use its link code` : 'No programme found'); await done(1) }
const p = found[0]

const classes = await M.LiveClassModel.find({ programId: p._id }).select('title scheduledStart durationMins status').lean<any[]>()
const notOver = classes.filter(c => c.status !== 'cancelled' && c.status !== 'ended'
  && new Date(c.scheduledStart).getTime() + (c.durationMins ?? 60) * 60_000 > Date.now() - 3 * 3600_000)
const students = await M.UserModel.find({ _id: { $in: p.studentIds ?? [] } }).select('enrollmentApplication.phone').lean<any[]>()
const phones = [...new Set(students.map(u => normalizeWhatsAppNumber(u.enrollmentApplication?.phone)).filter(Boolean))] as string[]
const waiting = { status: 'pending', to: { $in: phones } }
const pendingCount = await M.WhatsAppOutboxModel.countDocuments(waiting)
const bookingsQ = { liveClassId: { $in: notOver.map(c => c._id) }, status: 'booked' }
const bookings = await M.ClassBookingModel.countDocuments(bookingsQ)

console.log(`\n${p.title}  (${p.status}, ${p.studentIds?.length ?? 0} students, link /p/${p.joinCode ?? '—'})`)
console.log(`  WhatsApps waiting to its students: ${pendingCount}`)
console.log(`  classes not over yet: ${notOver.length}   bookings on them: ${bookings}`)
notOver.forEach(c => console.log(`    ${new Date(c.scheduledStart).toISOString().slice(0, 16)} UTC  ${c.status}  ${c.title}`))

if (!APPLY) { console.log('\nDry run — nothing stopped. Re-run with --apply.'); await done(0) }

const w = await M.WhatsAppOutboxModel.updateMany(waiting, { $set: { status: 'failed', lastError: `stopped: programme "${p.title}" — not sent` } })
const b = await M.ClassBookingModel.updateMany(bookingsQ, { $set: {
  reminderDayBeforeSent: true, reminderDayOfSent: true, reminderPreSessionSent: true, reminder5MinSent: true,
  reminderAtTimeSent: true, todaysWhatsAppSent: true } })
const r = await M.LiveClassModel.updateMany({ programId: p._id }, { $set: { reviewRequestSent: true } })
console.log(`\nStopped: ${w.modifiedCount} waiting WhatsApps; ${b.modifiedCount} bookings marked reminded; ${r.modifiedCount} classes: no review request.`)
await done(0)
