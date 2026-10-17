/* ─────────────────────────────────────────────────────────────
   clear-email-outbox — clear the email queue / log (EmailOutbox) (the user, 2026-10-17:
   "we don't need to send the pending mail"). The drain sends only rows whose status is
   'pending', so clearing a pending email = marking it failed with the reason "cleared",
   which means it is never sent. The rows are kept (auditable), unless you purge them.

   RUN ON THE SERVER, from the backend folder (the .env with DATABASE_URL is there).

   PREVIEW BY DEFAULT — shows what is waiting and what it would do; changes nothing.
     bun src/scripts/clear-email-outbox.ts
   Clear the pending (not urgent) emails — they will never be sent:
     bun src/scripts/clear-email-outbox.ts --clear-pending --commit
   Options
     --include-urgent     also clear urgent mail (sign-in codes, password resets, verify,
                          welcome). Left alone by default — people are waiting for those.
     --before <date>      only emails queued before this day (YYYY-MM-DD)
     --subject <text>     only emails whose subject contains this text
     --purge-log          ALSO delete the log rows already sent or failed (and the ones just
                          cleared), before --before if given. Gone for good — a backup of who/
                          subject/when (not the bodies) is written first.
     --undo <file>        put the emails a --clear-pending run cleared back to pending (they'd
                          be sent again by the drain). Add --commit to do it.

   Every --commit writes an undo file to the home folder first.
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { writeFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const die = (m: string): never => { console.error(m); process.exit(1) }

const commit = flag('commit')
const clearPending = flag('clear-pending')
const includeUrgent = flag('include-urgent')
const purgeLog = flag('purge-log')
const undoFile = opt('undo')
const before = opt('before')
const subject = opt('subject')
if (before && !/^\d{4}-\d{2}-\d{2}$/.test(before)) die('--before takes a day, YYYY-MM-DD')

const DB_URL = process.env['DATABASE_URL'] ?? die('DATABASE_URL is not set (run from the backend folder so .env loads).')
await mongoose.connect(DB_URL, { autoIndex: false, autoCreate: false })
const { EmailOutboxModel } = await import('@/models/schema.ts')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

try {
  if (undoFile) {
    const saved = JSON.parse(readFileSync(undoFile, 'utf8')) as { cleared?: string[] }
    const ids = (saved.cleared ?? []).filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id))
    const still = await EmailOutboxModel.countDocuments({ _id: { $in: ids }, status: 'failed', lastError: /^cleared:/ })
    console.log(`${ids.length} in the file; ${still} still cleared (a purged one can't come back).`)
    if (commit) {
      const r = await EmailOutboxModel.updateMany({ _id: { $in: ids }, status: 'failed', lastError: /^cleared:/ },
        { $set: { status: 'pending', nextAttemptAt: new Date() }, $unset: { lastError: 1 } })
      console.log(`Put back to pending: ${r.modifiedCount}. The drain will send them.`)
    } else console.log('Preview only — add --commit to put them back.')
    process.exit(0)
  }

  const narrow: Record<string, unknown> = {}
  if (before) narrow['createdAt'] = { $lt: new Date(`${before}T00:00:00Z`) }
  if (subject) narrow['subject'] = { $regex: esc(subject), $options: 'i' }

  // What is there now.
  const [pending, urgent, sent, failed] = await Promise.all([
    EmailOutboxModel.countDocuments({ status: 'pending' }),
    EmailOutboxModel.countDocuments({ status: 'pending', priority: { $gt: 0 } }),
    EmailOutboxModel.countDocuments({ status: 'sent' }),
    EmailOutboxModel.countDocuments({ status: 'failed' }),
  ])
  console.log(`Email queue now: ${pending} pending (${urgent} urgent) · ${sent} sent (kept 30 days) · ${failed} failed`)
  const top = await EmailOutboxModel.aggregate([
    { $match: { status: 'pending', ...narrow } },
    { $group: { _id: '$subject', n: { $sum: 1 }, oldest: { $min: '$createdAt' } } },
    { $sort: { n: -1 } }, { $limit: 15 },
  ])
  if (top.length) {
    console.log('\nPending, by subject (top 15):')
    for (const t of top) console.log(`  ${String(t.n).padStart(6)}  ${String(t._id).slice(0, 90)}  (oldest ${new Date(t.oldest).toISOString().slice(0, 16).replace('T', ' ')})`)
  }

  const toClear = { status: 'pending', ...narrow, ...(includeUrgent ? {} : { priority: { $not: { $gt: 0 } } }) }
  const clearCount = clearPending ? await EmailOutboxModel.countDocuments(toClear) : 0
  const purgeMatch = { status: { $in: ['sent', 'failed'] }, ...narrow }
  if (clearPending) console.log(`\n--clear-pending: ${clearCount} pending email(s) would be cleared — never sent${includeUrgent ? ' (urgent included)' : ' (urgent mail left alone)'}.`)
  if (purgeLog) console.log(`--purge-log: ${await EmailOutboxModel.countDocuments(purgeMatch)} sent/failed row(s)${clearPending ? ` + the ${clearCount} just cleared` : ''} would be deleted for good.`)
  if (!clearPending && !purgeLog) {
    console.log('\nNothing asked. Add --clear-pending (stop the pending emails) and/or --purge-log (delete the log), then --commit.')
    process.exit(0)
  }
  if (!commit) { console.log('\nPreview only — add --commit to do it.'); process.exit(0) }

  const file = join(homedir(), `email-outbox-clear-${stamp}.json`)
  const backup: { cleared: string[]; purged: { _id: string; to: string; subject: string; status: string; createdAt: unknown }[] } = { cleared: [], purged: [] }
  if (clearPending) backup.cleared = (await EmailOutboxModel.find(toClear, { _id: 1 }).lean()).map((r: any) => String(r._id))
  writeFileSync(file, JSON.stringify(backup))
  if (clearPending) {
    const r = await EmailOutboxModel.updateMany({ _id: { $in: backup.cleared.map((id) => new mongoose.Types.ObjectId(id)) }, status: 'pending' },
      { $set: { status: 'failed', lastError: `cleared: not sent — cleared by clear-email-outbox ${new Date().toISOString().slice(0, 10)}` } })
    console.log(`Cleared ${r.modifiedCount} pending email(s) — they will not be sent.`)
  }
  if (purgeLog) {
    const rows = (await EmailOutboxModel.find(purgeMatch, { to: 1, subject: 1, status: 1, createdAt: 1 }).lean()) as any[]
    backup.purged = rows.map((r) => ({ _id: String(r._id), to: r.to, subject: r.subject, status: r.status, createdAt: r.createdAt }))
    writeFileSync(file, JSON.stringify(backup))
    const r = await EmailOutboxModel.deleteMany({ _id: { $in: rows.map((x) => x._id) } })
    console.log(`Deleted ${r.deletedCount} log row(s).`)
  }
  console.log(`Undo / backup file: ${file}${backup.cleared.length ? `\n  put the cleared ones back: bun src/scripts/clear-email-outbox.ts --undo ${file} --commit` : ''}`)
} finally {
  await mongoose.disconnect()
}
