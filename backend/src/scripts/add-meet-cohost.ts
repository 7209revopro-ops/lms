/* ─────────────────────────────────────────────────────────────
   add-meet-cohost — make the staff account a co-host of every UPCOMING Google
   Meet class the app made. New classes get it as they are created
   (googleMeet.service.ts → staffMeetCohosts); this catches up the ones made
   before. The account is GOOGLE_MEET_STAFF_COHOSTS, by default
   deltatradinguniverse@gmail.com.

   RUN ON THE SERVER, from the backend folder: the Google service-account key
   and the .env are there, and nowhere else.

   PREVIEW BY DEFAULT — lists what it would do and changes nothing.
     bun src/scripts/add-meet-cohost.ts
   Add the co-host:
     bun src/scripts/add-meet-cohost.ts --commit
   Options
     --limit <n>      only the first n classes (try a few first)
     --email <addr>   add this co-host instead of the configured one

   Safe to run again: a meeting that already has the co-host is skipped.
   Writes nothing to the database — only to Google Meet.

   Google takes co-hosts through the API only on meetings the app itself made
   (they carry `meetSpace`). A meeting Google Calendar made, or a link pasted by
   hand, cannot be changed from here; those are listed so staff can add the
   co-host in Meet by hand.
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const opt  = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const die  = (msg: string): never => { console.error(`\n✖ ${msg}\n`); process.exit(1) }

const COMMIT = flag('commit')
const LIMIT  = opt('limit') !== undefined ? Number(opt('limit')) : Infinity
if (!(LIMIT > 0)) die('--limit must be a positive number.')
const EMAIL  = opt('email')?.trim().toLowerCase()
if (EMAIL !== undefined && !/^[^@\s]+@[^@\s]+$/.test(EMAIL)) die(`"${opt('email')}" is not an email address.`)

const DB_URL = process.env['DATABASE_URL'] ?? die('DATABASE_URL is not set (run from the backend folder so .env loads).')
/* Read-only on the database: never build indexes or create collections. */
mongoose.set('autoIndex', false)
mongoose.set('autoCreate', false)
await mongoose.connect(DB_URL, { autoIndex: false, autoCreate: false })

const { LiveClassModel, UserModel } = await import('@/models/schema.ts')
const { staffMeetCohosts, addStaffCohostsToSpace } = await import('@/services/googleMeet.service.ts')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const when  = (d: Date) => new Date(d).toLocaleString('en-GB', {
  timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
})

type Row = {
  _id: unknown; title: string; scheduledStart: Date; instructorId?: unknown
  googleMeetCode?: string; meetingUrl?: string
  meetSpace?: { name?: string; host?: string; cohost?: string; calendarEventId?: string }
}

let exitCode = 0
try {
  const emails = EMAIL ? [EMAIL] : staffMeetCohosts()
  if (emails.length === 0) die('No staff co-host is configured (GOOGLE_MEET_STAFF_COHOSTS is "off").')

  const all = await LiveClassModel.find({
    status:         { $ne: 'cancelled' },
    scheduledStart: { $gte: new Date() },
    $or: [{ googleMeetCode: { $exists: true, $nin: [null, ''] } }, { meetingUrl: /meet\.google\.com/ }],
  }).select('title scheduledStart instructorId googleMeetCode meetingUrl meetSpace').sort({ scheduledStart: 1 }).lean<Row[]>()

  const auto   = all.filter(c => c.meetSpace?.name && c.meetSpace?.host)
  const byHand = all.filter(c => !(c.meetSpace?.name && c.meetSpace?.host))
  const pasted = byHand.filter(c => !c.googleMeetCode)

  const teachers = new Map((await UserModel.find({ _id: { $in: [...new Set(byHand.map(c => String(c.instructorId)))] } })
    .select('email').lean<Array<{ _id: unknown; email?: string }>>()).map(u => [String(u._id), u.email ?? '']))

  console.log(`\nStaff co-host: ${emails.join(', ')}`)
  console.log(`Upcoming Google Meet classes: ${all.length}`)
  console.log(`  made by the app — co-host can be added here: ${auto.length}`)
  console.log(`  need it added by hand in Meet:               ${byHand.length}` +
    ` (${byHand.length - pasted.length} made by Google Calendar, ${pasted.length} link pasted by hand)`)

  if (byHand.length) {
    console.log('\nAdd the co-host by hand in Meet (host settings → co-hosts) for these:')
    for (const c of byHand) {
      console.log(`  ${when(c.scheduledStart)}  ${c.title}  · ${teachers.get(String(c.instructorId)) || '—'}  · ${c.googleMeetCode || c.meetingUrl || ''}`)
    }
  }

  const todo = auto.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined)
  if (!COMMIT) {
    console.log(`\nPreview only — nothing was changed. Add --commit to make ${emails.join(', ')} co-host of ` +
      `${todo.length} meeting${todo.length === 1 ? '' : 's'}${todo.length < auto.length ? ` (the first ${todo.length} of ${auto.length})` : ''}.\n`)
  } else {
    console.log(`\nAdding ${emails.join(', ')} as co-host to ${todo.length} meeting${todo.length === 1 ? '' : 's'}…`)
    let added = 0, present = 0
    const failed: string[] = []
    for (const [i, c] of todo.entries()) {
      try {
        const r = await addStaffCohostsToSpace({ name: c.meetSpace!.name!, host: c.meetSpace!.host! }, emails)
        if (r.failed.length) failed.push(`${when(c.scheduledStart)}  ${c.title}  (${c.meetSpace!.name})`)
        else if (r.added.length) added++
        else present++
      } catch (err) {
        /* No usable Google credentials here — every meeting would fail the same way. */
        if (i === 0) throw err
        failed.push(`${when(c.scheduledStart)}  ${c.title}  (${c.meetSpace!.name}): ${(err as Error).message}`)
      }
      if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${todo.length}`)
      await sleep(250)                                   // stay well inside Google's per-user rate limit
    }
    console.log(`\nDone: co-host added to ${added}, already there on ${present}, failed on ${failed.length}.`)
    if (failed.length) {
      console.log('Failed (the reason is in the warnings above; run again to retry — it skips the ones already done):')
      for (const f of failed) console.log(`  ${f}`)
      exitCode = 1
    }
    console.log('')
  }
} catch (err) {
  console.error(`\n✖ ${(err as Error).message ?? String(err)}\n`)
  exitCode = 1
} finally {
  await mongoose.disconnect()
}
process.exit(exitCode)
