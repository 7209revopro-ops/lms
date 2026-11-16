/* ─────────────────────────────────────────────────────────────
   meet-autorecord — switch Google Meet AUTO-RECORDING on for every UPCOMING
   Google Meet class (the user, 2026-11-16: "record all the meetings"). New
   classes get it as they are made (googleMeet.service.ts → meetAutoRecord);
   this catches up the ones made before.

   RUN ON THE SERVER, from the backend folder: the Google service-account key
   and the .env are there, and nowhere else.

   PREVIEW BY DEFAULT — lists what it would do and changes nothing.
     bun src/scripts/meet-autorecord.ts
   Switch it on:
     bun src/scripts/meet-autorecord.ts --commit
   Options
     --limit <n>   only the first n classes (try a few first)
     --off         switch auto-recording OFF instead (undo)

   Safe to run again: Google just keeps the setting. Writes nothing to the
   database — only to Google Meet. Goes one room a second, so Google's
   per-user rate limit is never hit (the 13 Nov removal tripped it).

   Each room is changed as its owner: the host mailbox for a room the app made
   (meetSpace), a Workspace instructor for a room on their own calendar, else
   the OAuth account. A link pasted by hand cannot be changed; those are listed.
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const opt  = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const die  = (msg: string): never => { console.error(`\n✖ ${msg}\n`); process.exit(1) }

const COMMIT = flag('commit')
const ON     = !flag('off')
const LIMIT  = opt('limit') !== undefined ? Number(opt('limit')) : Infinity
if (!(LIMIT > 0)) die('--limit must be a positive number.')

const DB_URL = process.env['DATABASE_URL'] ?? die('DATABASE_URL is not set (run from the backend folder so .env loads).')
/* Read-only on the database: never build indexes or create collections. */
mongoose.set('autoIndex', false)
mongoose.set('autoCreate', false)
await mongoose.connect(DB_URL, { autoIndex: false, autoCreate: false })

const { LiveClassModel, UserModel } = await import('@/models/schema.ts')
const { setMeetAutoRecordFor } = await import('@/services/googleMeet.service.ts')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const when  = (d: Date) => new Date(d).toLocaleString('en-GB', {
  timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
})

type Row = {
  _id: unknown; title: string; scheduledStart: Date; instructorId?: unknown
  googleMeetCode?: string; meetingUrl?: string
  meetSpace?: { name?: string; host?: string }
}

let exitCode = 0
try {
  const all = await LiveClassModel.find({
    status:         { $ne: 'cancelled' },
    scheduledStart: { $gte: new Date() },
    $or: [{ googleMeetCode: { $exists: true, $nin: [null, ''] } }, { meetingUrl: /meet\.google\.com/ }],
  }).select('title scheduledStart instructorId googleMeetCode meetingUrl meetSpace').sort({ scheduledStart: 1 }).lean<Row[]>()

  const app      = all.filter(c => c.meetSpace?.name && c.meetSpace?.host)
  const calendar = all.filter(c => !(c.meetSpace?.name && c.meetSpace?.host) && c.googleMeetCode)
  const pasted   = all.filter(c => !(c.meetSpace?.name && c.meetSpace?.host) && !c.googleMeetCode)

  const teachers = new Map((await UserModel.find({ _id: { $in: [...new Set(all.map(c => String(c.instructorId)))] } })
    .select('email').lean<Array<{ _id: unknown; email?: string }>>()).map(u => [String(u._id), u.email ?? '']))

  console.log(`\nAuto-recording ${ON ? 'ON' : 'OFF'} — upcoming Google Meet classes: ${all.length}`)
  console.log(`  rooms the app made (as the host mailbox):     ${app.length}`)
  console.log(`  rooms Google Calendar made (as their owner):  ${calendar.length}`)
  console.log(`  links pasted by hand — cannot be changed:     ${pasted.length}`)
  if (pasted.length) {
    console.log('\nSwitch recording on by hand in Meet for these (or record from the meeting):')
    for (const c of pasted) console.log(`  ${when(c.scheduledStart)}  ${c.title}  · ${teachers.get(String(c.instructorId)) || '—'}  · ${c.meetingUrl ?? ''}`)
  }

  const todo = [...app, ...calendar].sort((a, b) => +new Date(a.scheduledStart) - +new Date(b.scheduledStart))
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined)
  if (!COMMIT) {
    console.log(`\nPreview only — nothing was changed. Add --commit to switch auto-recording ${ON ? 'ON' : 'OFF'} on ` +
      `${todo.length} room${todo.length === 1 ? '' : 's'} (about ${Math.ceil(todo.length * 1.3 / 60)} min).\n`)
  } else {
    console.log(`\nSwitching auto-recording ${ON ? 'ON' : 'OFF'} on ${todo.length} room${todo.length === 1 ? '' : 's'}…`)
    let done = 0
    const failed: string[] = []
    for (const [i, c] of todo.entries()) {
      const why = await setMeetAutoRecordFor({
        meetSpace:       c.meetSpace?.name && c.meetSpace?.host ? { name: c.meetSpace.name, host: c.meetSpace.host } : null,
        googleMeetCode:  c.googleMeetCode ?? null,
        instructorEmail: teachers.get(String(c.instructorId)) || null,
      }, ON)
      if (why) {
        failed.push(`${when(c.scheduledStart)}  ${c.title}  (${c.meetSpace?.name ?? c.googleMeetCode}): ${why}`)
        /* The same refusal on the first rooms means a setting is missing (scope, licence) — stop, don't hammer Google. */
        if (i === 2 && failed.length === 3) { console.log('\nThe first three all failed — stopping. Fix the reason below and run again.'); break }
      } else done++
      if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${todo.length}`)
      await sleep(1_000)
    }
    console.log(`\nDone: auto-recording ${ON ? 'ON' : 'OFF'} on ${done}, failed on ${failed.length}.`)
    if (failed.length) {
      console.log('Failed (run again to retry — it is safe to repeat):')
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
