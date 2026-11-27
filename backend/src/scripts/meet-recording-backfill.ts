/* ─────────────────────────────────────────────────────────────
   meet-recording-backfill — put older Google Meet recordings on their classes.

   The recording job (reminders.job.ts runRecordingPoller) looks for each
   class's recording for 48 hours only. Classes held before the Google side
   was set up (Drive API + the drive scope, fixed 2026-11-27) were never found,
   and the job will never look at them again. This does for a date range
   exactly what the job does for the last 48 hours, through the same function
   (googleMeet.service.ts fetchMeetRecordingUrl): find the class's finished
   recording in the room owner's Drive, share it "anyone with the link", save
   the link on the class.

   RUN ON THE SERVER, from the backend folder: the Google service-account key
   and the .env are there, and nowhere else.

   PREVIEW BY DEFAULT — lists the classes it would look at and changes nothing.
     bun src/scripts/meet-recording-backfill.ts --from 2026-11-01
   Do it:
     bun src/scripts/meet-recording-backfill.ts --from 2026-11-01 --apply
   Options
     --from <YYYY-MM-DD>  first Dubai day (required)
     --to   <YYYY-MM-DD>  last Dubai day, included (default: yesterday)
     --limit <n>          only the first n classes (try a few first)

   With --apply each recording found is SHARED BY LINK in the mentor's Drive —
   the same as the job does for new ones; the script cannot take that back.
   Classes that already have a recording are left alone, so it is safe to run
   again. One class a second, so Google's per-user limit is never hit.
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const opt  = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const die  = (msg: string): never => { console.error(`\n✖ ${msg}\n`); process.exit(1) }

const APPLY = flag('apply')
const DAY   = /^\d{4}-\d{2}-\d{2}$/
const FROM  = opt('from') ?? die('Say where to start: --from YYYY-MM-DD (a Dubai day).')
if (!DAY.test(FROM)) die('--from must be YYYY-MM-DD.')
const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
const TO = opt('to') ?? yesterday
if (!DAY.test(TO)) die('--to must be YYYY-MM-DD.')
if (TO < FROM) die('--to is before --from.')
const LIMIT = opt('limit') !== undefined ? Number(opt('limit')) : Infinity
if (!(LIMIT > 0)) die('--limit must be a positive number.')

const DB_URL = process.env['DATABASE_URL'] ?? die('DATABASE_URL is not set (run from the backend folder so .env loads).')
/* Never build indexes or create collections from a script. */
mongoose.set('autoIndex', false)
mongoose.set('autoCreate', false)
await mongoose.connect(DB_URL, { autoIndex: false, autoCreate: false })

const { LiveClassModel } = await import('@/models/schema.ts')
const { fetchMeetRecordingUrl } = await import('@/services/googleMeet.service.ts')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const when  = (d: Date) => new Date(d).toLocaleString('en-GB', {
  timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
})

type Row = {
  _id: unknown; title: string; scheduledStart: Date; durationMins: number
  googleMeetCode?: string; meetSpace?: { name?: string; host?: string } | null
  instructorId?: { email?: string } | null
}

let exitCode = 0
try {
  const start = new Date(`${FROM}T00:00:00+04:00`)
  const end   = new Date(new Date(`${TO}T00:00:00+04:00`).getTime() + 86_400_000)
  const now   = Date.now()
  /* The job's own pick (runRecordingPoller), over the range asked for instead of the last 48 hours. */
  const all = (await LiveClassModel.find({
    type:           'external',
    status:         { $ne: 'cancelled' },
    googleMeetCode: { $exists: true, $ne: '' },
    recordingUrl:   { $exists: false },
    scheduledStart: { $gte: start, $lt: end },
  }).select('title scheduledStart durationMins googleMeetCode meetSpace instructorId')
    .populate('instructorId', 'email').sort({ scheduledStart: 1 }).lean<Row[]>())
    .filter(c => new Date(c.scheduledStart).getTime() + (c.durationMins ?? 0) * 60_000 < now)
  const todo = all.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined)

  console.log(`\nGoogle Meet classes held ${FROM} to ${TO} (Dubai) with no recording on the LMS: ${all.length}`)
  if (!APPLY) {
    for (const c of todo.slice(0, 40)) console.log(`  ${when(c.scheduledStart)}  ${c.title}`)
    if (todo.length > 40) console.log(`  … and ${todo.length - 40} more`)
    console.log(`\nPreview only — nothing was changed. Add --apply to look for the recordings of ${todo.length} class${todo.length === 1 ? '' : 'es'}` +
      ` (about ${Math.ceil(todo.length * 1.5 / 60)} min). Each one found is shared by link in the mentor's Drive and saved on the class.\n`)
  } else {
    console.log(`Looking for ${todo.length} recording${todo.length === 1 ? '' : 's'}…\n`)
    let found = 0
    for (const [i, c] of todo.entries()) {
      const url = await fetchMeetRecordingUrl({
        meetSpace:       c.meetSpace?.name && c.meetSpace?.host ? { name: c.meetSpace.name, host: c.meetSpace.host } : null,
        googleMeetCode:  c.googleMeetCode ?? null,
        instructorEmail: c.instructorId?.email ?? null,
        scheduledStart:  c.scheduledStart,
        durationMins:    c.durationMins,
      })
      if (url) {
        /* Only if still empty: the job may have saved one meanwhile. */
        const r = await LiveClassModel.updateOne({ _id: c._id, recordingUrl: { $exists: false } }, { $set: { recordingUrl: url } })
        if (r.modifiedCount) { found++; console.log(`  found  ${when(c.scheduledStart)}  ${c.title}`) }
      }
      if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${todo.length} looked at, ${found} found`)
      await sleep(1_000)
    }
    console.log(`\nDone: ${found} recording${found === 1 ? '' : 's'} put on their classes; ${todo.length - found} had none Google could give` +
      ' (no call held, not recorded, or still processing — the server log says which for each).\n')
  }
} catch (err) {
  console.error(`\n✖ ${(err as Error).message ?? String(err)}\n`)
  exitCode = 1
} finally {
  await mongoose.disconnect()
}
process.exit(exitCode)
