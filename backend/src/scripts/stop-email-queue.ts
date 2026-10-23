/* ─────────────────────────────────────────────────────────────
   Stop the email queue — every email still waiting to go is closed, never
   sent, so the mailboxes' allowance goes to new mail only (the user,
   2026-10-17). Kept in the log as failed: "stopped <date>: queue cleared by
   admin, not sent" — any one can still be sent from Email Logs → Send now.

   Urgent emails from the last hour (sign-in codes, verify email, forgot
   password, welcome) are kept by default: people are waiting for them now.
   --keep-minutes N   keep urgent ones from the last N minutes (default 60)
   --all              stop those too

   Dry run by default — prints what it would stop. --apply stops them.

   Usage (from backend/):
     bun src/scripts/stop-email-queue.ts
     bun src/scripts/stop-email-queue.ts --apply
     bun src/scripts/stop-email-queue.ts --all --apply
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import mongoose from 'mongoose'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const ALL = process.argv.includes('--all')
const KEEP_MIN = Number(arg('--keep-minutes') ?? 60)
if (!Number.isFinite(KEEP_MIN) || KEEP_MIN < 0) { console.error('--keep-minutes must be a number of minutes'); process.exit(1) }

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const M = await import('@/models/schema.ts')
const E = M.EmailOutboxModel

const keep = ALL ? null : { status: 'pending', priority: { $gt: 0 }, createdAt: { $gte: new Date(Date.now() - KEEP_MIN * 60_000) } }
const stop = { status: 'pending', ...(keep ? { $nor: [keep] } : {}) }

const pending = await E.countDocuments({ status: 'pending' })
const kept = keep ? await E.countDocuments(keep) : 0
const toStop = await E.countDocuments(stop)
console.log(`\nWaiting to go: ${pending}`)
console.log(`  to stop:  ${toStop}`)
console.log(`  to keep:  ${kept}${keep ? `  (urgent — sign-in code, verify, forgot password, welcome — from the last ${KEEP_MIN} min)` : ''}`)
const kinds = await E.aggregate([{ $match: stop }, { $project: { k: { $regexFind: { input: '$subject', regex: /^[^:—0-9]*/ } } } },
  { $group: { _id: '$k.match', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }])
if (kinds.length) { console.log('\nWhat would stop:'); kinds.forEach((x: any) => console.log(`  ${String(x.n).padStart(6)}  ${String(x._id ?? '').trim().slice(0, 60)}`)) }

if (!APPLY) { console.log('\nDry run — nothing stopped. Re-run with --apply.'); await mongoose.disconnect(); process.exit(0) }

const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
const r = await E.updateMany(stop, { $set: { status: 'failed', lastError: `stopped ${day}: queue cleared by admin, not sent` } })
console.log(`\nStopped: ${r.modifiedCount}.   Still waiting: ${await E.countDocuments({ status: 'pending' })}`)
await mongoose.disconnect(); process.exit(0)
