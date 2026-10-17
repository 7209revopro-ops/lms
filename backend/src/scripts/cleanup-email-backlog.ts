/* ─────────────────────────────────────────────────────────────
   Clear the email backlog of 16–17 Oct 2026 (the user, 2026-10-17).

   Both Gmail mailboxes ran out of their daily allowance on class notices and
   ~8,300 emails queued, with password resets and sign-in codes behind them.
   For every PENDING email this decides:

     · a class reminder ("starting in", "5 minutes", "has started", "not
       joined", "tomorrow") queued over 2 hours ago — its class is over: close
     · a class change (cancelled / moved / new mentor, booked or enrolled
       version) — matched to its class through the critical-mail record it was
       sent from (same address, sent within 10 minutes): keep it when that
       class is still to come, close it when it is over; unmatched: keep
     · a password reset or sign-in code over an hour old — its link or code no
       longer works: close; a newer one, or a verify / welcome email: urgent,
       sent first
     · anything else: left as it is

   Closed = status failed, lastError "cleared 2026-10-17 …" — kept, never sent.
   Dry run by default. --apply changes the queue.

   Usage (from backend/):
     bun src/scripts/cleanup-email-backlog.ts
     bun src/scripts/cleanup-email-backlog.ts --apply
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import mongoose from 'mongoose'

const APPLY = process.argv.includes('--apply')
const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const M = await import('@/models/schema.ts')
const now = Date.now()

const REMINDER = /Starting in|Starts in 5|Class Has Started|has started — join|not joined|^Tomorrow:/i
const CHANGE = /^Class cancelled —|^Class time changed —|^Mentor changed —|Class Cancellation Notice|Class Rescheduled|Class Delay Notice|Instructor Update/i
const SHORT_LIVED = /Reset your Delta password|is your Delta sign-in code/i
const URGENT = /Verify your Delta email|Welcome to Delta|already have an account|sign in to Delta/i

const pending = await M.EmailOutboxModel.find({ status: 'pending' }).select('to subject createdAt priority').lean<any[]>()
console.log(`\nPending emails: ${pending.length}`)

/* Class changes: the critical-mail records they came from, by address. */
const crit = await M.CriticalMailModel.find({ sentAt: { $ne: null, $gte: new Date(now - 4 * 864e5) } })
  .select('email sentAt scheduledStart oldStart newStart kind liveClassId').lean<any[]>()
const critBy = new Map<string, any[]>()
for (const c of crit) critBy.set(String(c.email).toLowerCase(), [...(critBy.get(String(c.email).toLowerCase()) ?? []), c])
const classIds = [...new Set(crit.map(c => String(c.liveClassId)))]
const classes = new Map((await M.LiveClassModel.find({ _id: { $in: classIds } }).select('scheduledStart durationMins').lean<any[]>())
  .map(c => [String(c._id), new Date(c.scheduledStart).getTime() + (c.durationMins ?? 60) * 60_000]))

const close: Array<{ id: unknown; why: string }> = []
const urgent: unknown[] = []
const tally: Record<string, number> = {}
const add = (k: string) => { tally[k] = (tally[k] ?? 0) + 1 }

for (const e of pending) {
  const age = now - new Date(e.createdAt).getTime()
  const subj = String(e.subject ?? '')
  if (REMINDER.test(subj)) {
    if (age > 2 * 3600_000) { close.push({ id: e._id, why: 'cleared 2026-10-17: a reminder for a class that is over' }); add('reminder — class over: close') }
    else add('reminder — recent: keep')
  } else if (CHANGE.test(subj)) {
    const t = new Date(e.createdAt).getTime()
    const match = (critBy.get(String(e.to).toLowerCase()) ?? []).find(c => Math.abs(new Date(c.sentAt).getTime() - t) < 10 * 60_000)
    const end = match ? classes.get(String(match.liveClassId)) : undefined
    if (end === undefined) add('class change — not matched to a class: keep')
    else if (end < now) { close.push({ id: e._id, why: 'cleared 2026-10-17: about a class that is over' }); add('class change — class over: close') }
    else add('class change — class still to come: keep')
  } else if (SHORT_LIVED.test(subj)) {
    if (age > 3600_000) { close.push({ id: e._id, why: 'cleared 2026-10-17: the link or code had expired' }); add('reset / sign-in code — expired: close') }
    else { urgent.push(e._id); add('reset / sign-in code — recent: urgent') }
  } else if (URGENT.test(subj)) {
    urgent.push(e._id); add('verify / welcome / registration: urgent')
  } else add('other: leave')
}

for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`)
console.log(`\nTo close: ${close.length}   To mark urgent: ${urgent.length}   Left in the queue: ${pending.length - close.length}`)

if (!APPLY) { console.log('\nDry run — nothing changed. Re-run with --apply.'); await mongoose.disconnect(); process.exit(0) }

const byWhy = new Map<string, unknown[]>()
for (const c of close) byWhy.set(c.why, [...(byWhy.get(c.why) ?? []), c.id])
for (const [why, ids] of byWhy) {
  await M.EmailOutboxModel.updateMany({ _id: { $in: ids }, status: 'pending' }, { $set: { status: 'failed', lastError: why } })
}
if (urgent.length) await M.EmailOutboxModel.updateMany({ _id: { $in: urgent }, status: 'pending' }, { $set: { priority: 10, nextAttemptAt: new Date() } })
console.log('\nDone.')
await mongoose.disconnect(); process.exit(0)
