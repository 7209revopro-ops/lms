/* ─────────────────────────────────────────────────────────────
   What auto-cancel WOULD have cancelled (2026-11-18)

   While AUTO_CANCEL_EMPTY is 'report' (the default), the every-minute job
   (services/classOutcome.service.ts runAutoCancelEmpty) only notes each online
   class that had no bookings 10 minutes before its start. This lists them —
   read-only — so you can check them before switching it on.

   Run on the server, from the backend folder:
     bun src/scripts/auto-cancel-report.ts            # the last 7 days
     bun src/scripts/auto-cancel-report.ts --days 2
   And, to switch it on: AUTO_CANCEL_EMPTY=on in .env, then pm2 restart lms-backend.
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const die = (m: string): never => { console.error(m); process.exit(1) }
const DB_URL = process.env['DATABASE_URL'] ?? die('DATABASE_URL is not set (run from the backend folder so .env loads).')
const i = process.argv.indexOf('--days')
const days = i > 0 ? Number(process.argv[i + 1]) : 7
if (!Number.isFinite(days) || days <= 0) die('--days takes a number of days')

await mongoose.connect(DB_URL)
const { LiveClassModel, UserModel, ClassBookingModel } = await import('@/models/schema.ts')
const since = new Date(Date.now() - days * 864e5)
const rows = await LiveClassModel.find({ emptyWouldCancel: true, scheduledStart: { $gte: since } })
  .sort({ scheduledStart: 1 }).select('title scheduledStart instructorId status bookedCount').lean() as any[]
const mentors = new Map((await UserModel.find({ _id: { $in: rows.map(r => r.instructorId) } }).select('name').lean() as any[]).map(u => [String(u._id), u.name]))
const fmt = (d: Date) => new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

console.log(`Auto-cancel report — the last ${days} day${days === 1 ? '' : 's'} (mode now: ${process.env['AUTO_CANCEL_EMPTY'] || 'report'})\n`)
if (!rows.length) console.log('Nothing: no online class had zero bookings 10 minutes before its start.')
let joinedAnyway = 0
for (const r of rows) {
  /* Seats taken after the check (an admin booking late) — or students who joined: the cases on-mode would have hurt. */
  const seats = await ClassBookingModel.countDocuments({ liveClassId: r._id, status: { $in: ['booked', 'attended'] } })
  if (seats) joinedAnyway++
  console.log(`${fmt(r.scheduledStart)} GST  ${String(r.title).slice(0, 60).padEnd(60)}  ${(mentors.get(String(r.instructorId)) ?? '?').padEnd(18)}  now: ${r.status}${seats ? `  ⚠ ${seats} seat(s) after the check` : ''}`)
}
console.log(`\n${rows.length} class${rows.length === 1 ? '' : 'es'} would have been cancelled${joinedAnyway ? ` — ${joinedAnyway} of them got a seat afterwards (check these)` : ''}.`)
await mongoose.disconnect()
