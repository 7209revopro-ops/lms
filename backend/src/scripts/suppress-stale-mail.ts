/* ─────────────────────────────────────────────────────────────────────────────
   Suppress a stale mail backlog — without touching current mail.

   Both queues select work with no floor on age:

     emailoutboxes  { status: 'pending',  nextAttemptAt: { $lte: now } }
     criticalmails  { sentAt: null, supersededAt: null, dueAt: { $lte: now } }

   So after an outage or a restart, every message that fell due while the
   sender was down is "due" at once and goes out in a burst — reminders for
   yesterday's class, notices about changes that have already happened. A
   notification about the past is worse than no notification.

   This drops everything older than a cutoff and leaves everything newer
   alone, so today's mail still sends normally.

     DRY RUN (default)   bun src/scripts/suppress-stale-mail.ts
     with a window       bun src/scripts/suppress-stale-mail.ts --hours=12
     APPLY               bun src/scripts/suppress-stale-mail.ts --hours=12 --apply

   Rows are never deleted. Outbox rows become `failed` with a reason, and
   critical-mail rows get `supersededAt` — the field the queue already uses to
   mean "no longer relevant" — so both remain auditable.
───────────────────────────────────────────────────────────────────────────── */
import 'dotenv/config'
import mongoose from 'mongoose'

const args    = process.argv.slice(2)
const apply   = args.includes('--apply')
const hoursAr = args.find(a => a.startsWith('--hours='))
const HOURS   = Number(hoursAr?.split('=')[1] ?? 6)

if (!Number.isFinite(HOURS) || HOURS <= 0) {
  console.error('--hours must be a positive number')
  process.exit(1)
}

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1) }

await mongoose.connect(url)
const db     = mongoose.connection.db!
const cutoff = new Date(Date.now() - HOURS * 3600 * 1000)

console.log(`\ndatabase : ${db.databaseName}`)
console.log(`cutoff   : ${cutoff.toISOString()}  (anything older than ${HOURS}h)`)
console.log(`mode     : ${apply ? 'APPLY — rows will be updated' : 'DRY RUN — nothing will change'}\n`)

/* ── Email outbox ──────────────────────────────────────────────────────────
   Keyed on createdAt, not nextAttemptAt: a row that has been retried carries a
   recent nextAttemptAt but is still about something that happened yesterday. */
const outbox = db.collection('emailoutboxes')
const outboxStale = { status: 'pending', createdAt: { $lt: cutoff } }

const [outboxPending, outboxStaleCount] = await Promise.all([
  outbox.countDocuments({ status: 'pending' }),
  outbox.countDocuments(outboxStale),
])
console.log('email outbox')
console.log(`  pending total      : ${outboxPending}`)
console.log(`  stale (> ${HOURS}h)      : ${outboxStaleCount}`)
console.log(`  KEPT (will send)   : ${outboxPending - outboxStaleCount}`)

if (outboxStaleCount > 0) {
  const sample = await outbox.find(outboxStale).sort({ createdAt: 1 }).limit(3)
    .project({ to: 1, subject: 1, createdAt: 1 }).toArray()
  for (const s of sample) {
    console.log(`    e.g. ${new Date(s['createdAt']).toISOString()}  ${String(s['subject']).slice(0, 58)}`)
  }
}

/* ── Critical mail ─────────────────────────────────────────────────────────
   Keyed on dueAt — the moment the message was meant to go out. */
const critical = db.collection('criticalmails')
const criticalStale = { sentAt: null, supersededAt: null, dueAt: { $lt: cutoff } }

const [criticalPending, criticalStaleCount] = await Promise.all([
  critical.countDocuments({ sentAt: null, supersededAt: null }),
  critical.countDocuments(criticalStale),
])
console.log('\ncritical mail')
console.log(`  unsent total       : ${criticalPending}`)
console.log(`  stale (> ${HOURS}h)      : ${criticalStaleCount}`)
console.log(`  KEPT (will send)   : ${criticalPending - criticalStaleCount}`)

if (criticalStaleCount > 0) {
  const sample = await critical.find(criticalStale).sort({ dueAt: 1 }).limit(3)
    .project({ email: 1, kind: 1, title: 1, dueAt: 1 }).toArray()
  for (const s of sample) {
    console.log(`    e.g. ${new Date(s['dueAt']).toISOString()}  ${s['kind']}  ${String(s['title'] ?? '').slice(0, 44)}`)
  }
}

if (!apply) {
  console.log(`\nDry run. Re-run with --apply to suppress ${outboxStaleCount + criticalStaleCount} message(s).\n`)
  await mongoose.disconnect()
  process.exit(0)
}

const stampedAt = new Date()
const [o, c] = await Promise.all([
  outbox.updateMany(outboxStale, {
    $set: {
      status:    'failed',
      lastError: `suppressed: stale backlog, older than ${HOURS}h (swept ${stampedAt.toISOString()})`,
    },
  }),
  critical.updateMany(criticalStale, { $set: { supersededAt: stampedAt } }),
])

console.log(`\nsuppressed  outbox: ${o.modifiedCount}   critical: ${c.modifiedCount}`)
console.log('Current mail is untouched and will send on the next tick.\n')

await mongoose.disconnect()
process.exit(0)
