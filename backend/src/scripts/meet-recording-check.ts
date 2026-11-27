/* ─────────────────────────────────────────────────────────────
   meet-recording-check — WHY a Google Meet class has no recording on the LMS
   (the user, 2026-11-27: every meeting is auto-recorded, yet 0 of 60 ended
   classes had one). For each Meet class that ended in the last 48 hours it
   asks Google, as the room's owner, exactly what the recording job asks
   (reminders.job.ts runRecordingPoller → googleMeet.service.ts
   fetchMeetRecordingUrl) and prints where it stops:

     no call held          nobody opened the room around the class time
     held, NOT recorded    a call was held; Google has no recording of it
     still being made      recorded; the file is not finished yet
     READY                 the file is in the owner's Drive — and whether the
                           LMS can read it there and it is shared by link
     ERROR                 Google refused; the reason is printed

   READ ONLY: it changes nothing in Google (it does NOT share the file — the
   job does that) and nothing in the database.

   RUN ON THE SERVER, from the backend folder: the Google service-account key
   and the .env are there, and nowhere else.
     bun src/scripts/meet-recording-check.ts
   Options
     --hours <n>   look back n hours instead of 48
     --limit <n>   only the latest n classes
───────────────────────────────────────────────────────────── */
import fs from 'fs'
import path from 'path'
import mongoose from 'mongoose'
import { google } from 'googleapis'

const argv = process.argv.slice(2)
const opt  = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const die  = (msg: string): never => { console.error(`\n✖ ${msg}\n`); process.exit(1) }

const HOURS = opt('hours') !== undefined ? Number(opt('hours')) : 48
const LIMIT = opt('limit') !== undefined ? Number(opt('limit')) : Infinity
if (!(HOURS > 0)) die('--hours must be a positive number.')
if (!(LIMIT > 0)) die('--limit must be a positive number.')

const DB_URL = process.env['DATABASE_URL'] ?? die('DATABASE_URL is not set (run from the backend folder so .env loads).')
let key: { client_email: string; private_key: string }
try {
  key = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'google-service-account.json'), 'utf-8'))
} catch {
  key = die('google-service-account.json is not in this folder — run it on the server, from the backend folder.')
}

/* The same scopes the LMS asks for (googleMeet.service.ts makeServiceAccountAuth): Google refuses the whole token
   when one is missing from the domain-wide delegation entry, so asking for the same set tests the same thing. */
const MEET_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/meetings.space.settings',
  'https://www.googleapis.com/auth/meetings.space.created',
]
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const MEET_API = 'https://meet.googleapis.com/v2'
const as = (email: string, scopes: string[]) => new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes, subject: email })
const reason = (err: unknown): string => {
  const e = err as { response?: { status?: number; data?: { error?: { message?: string } | string; error_description?: string } }; message?: string }
  const d = e?.response?.data
  const msg = (typeof d?.error === 'object' ? d.error?.message : d?.error_description ?? d?.error) ?? e?.message ?? String(err)
  return `${e?.response?.status ?? ''} ${msg}`.trim().slice(0, 220)
}

/* Read-only on the database: never build indexes or create collections. */
mongoose.set('autoIndex', false)
mongoose.set('autoCreate', false)
await mongoose.connect(DB_URL, { autoIndex: false, autoCreate: false })
const { LiveClassModel } = await import('@/models/schema.ts')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const when  = (d: Date) => new Date(d).toLocaleString('en-GB', {
  timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
})

type Row = {
  title: string; scheduledStart: Date; durationMins?: number; status?: string; recordingUrl?: string
  googleMeetCode?: string; meetSpace?: { name?: string; host?: string }
}

let exitCode = 0
try {
  const now = Date.now()
  const all = (await LiveClassModel.find({
    type:           'external',
    status:         { $ne: 'cancelled' },
    googleMeetCode: { $exists: true, $nin: [null, ''] },
    scheduledStart: { $gte: new Date(now - HOURS * 3_600_000), $lt: new Date(now) },
  }).select('title scheduledStart durationMins status recordingUrl googleMeetCode meetSpace').sort({ scheduledStart: -1 }).lean<Row[]>())
    .filter(c => new Date(c.scheduledStart).getTime() + (c.durationMins ?? 0) * 60_000 < now)
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined)

  console.log(`\nGoogle Meet classes over in the last ${HOURS} hours: ${all.length}. Asking Google about each — nothing is changed.\n`)
  const tally = new Map<string, number>()
  const count = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1)

  for (const c of all) {
    const head = `${when(c.scheduledStart)}  ${String(c.title).slice(0, 40).padEnd(40)}  ${c.recordingUrl ? '[on the LMS] ' : ''}`
    const host = c.meetSpace?.host, space = c.meetSpace?.name
    if (!host || !space) { console.log(`${head}not a room the LMS made — skipped (${c.googleMeetCode})`); count('not a room the LMS made'); continue }
    const meet = as(host, MEET_SCOPES)
    try {
      /* Is auto-recording set on the room? Asked first; a refusal here is told and the rest still runs. */
      let auto = '?'
      try {
        const s = await meet.request<{ config?: { artifactConfig?: { recordingConfig?: { autoRecordingGeneration?: string } } } }>({ url: `${MEET_API}/${space}`, method: 'GET' })
        auto = s.data?.config?.artifactConfig?.recordingConfig?.autoRecordingGeneration ?? 'not set'
      } catch (err) { auto = `unreadable (${reason(err)})` }

      const res = await meet.request<{ conferenceRecords?: Array<{ name?: string; startTime?: string }> }>({
        url: `${MEET_API}/conferenceRecords?filter=${encodeURIComponent(`space.name = "${space}"`)}`, method: 'GET',
      })
      const rows  = res.data.conferenceRecords ?? []
      const start = new Date(c.scheduledStart).getTime()
      const end   = start + (c.durationMins ?? 0) * 60_000
      /* The same window the job uses: begun from an hour before the class to its end. */
      const mine  = rows.filter(r => { const t = r.startTime ? Date.parse(r.startTime) : NaN; return t >= start - 3_600_000 && t <= end })
      if (!mine.length) {
        const k = rows.length ? 'no call held in the class window (calls at other times exist)' : 'no call held'
        console.log(`${head}${k} · auto-record: ${auto}`); count(k); await sleep(300); continue
      }
      const recs: Array<{ state?: string; driveDestination?: { file?: string } }> = []
      for (const conf of mine) {
        if (!conf.name) continue
        const r = await meet.request<{ recordings?: Array<{ state?: string; driveDestination?: { file?: string } }> }>({ url: `${MEET_API}/${conf.name}/recordings`, method: 'GET' })
        recs.push(...(r.data.recordings ?? []))
      }
      if (!recs.length) { console.log(`${head}held, NOT recorded (${mine.length} call${mine.length === 1 ? '' : 's'}) · auto-record: ${auto}`); count('held, NOT recorded'); await sleep(300); continue }
      const done = recs.find(r => r.state === 'FILE_GENERATED' && r.driveDestination?.file)
      if (!done) { console.log(`${head}still being made (${recs.map(r => r.state).join(', ')})`); count('still being made'); await sleep(300); continue }

      const fileId = done.driveDestination!.file!.replace(/^files\//, '')
      try {
        const f = await as(host, [DRIVE_SCOPE]).request<{ name?: string; permissions?: Array<{ type?: string }> }>({
          url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,permissions(type)&supportsAllDrives=true`, method: 'GET',
        })
        const shared = (f.data.permissions ?? []).some(p => p.type === 'anyone')
        const k = shared ? 'READY, shared by link' : 'READY, in Drive, not shared yet'
        console.log(`${head}${k} · ${f.data.name ?? fileId}`); count(k)
      } catch (err) {
        console.log(`${head}READY, but Drive refused the LMS: ${reason(err)}`); count('READY, but Drive refused the LMS')
      }
    } catch (err) {
      console.log(`${head}ERROR as ${host.split('@')[1]}: ${reason(err)}`); count(`ERROR: ${reason(err).slice(0, 80)}`)
    }
    await sleep(300)
  }

  console.log('\nIn all:')
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)
  console.log('')
} catch (err) {
  console.error(`\n✖ ${(err as Error).message ?? String(err)}\n`)
  exitCode = 1
} finally {
  await mongoose.disconnect()
}
process.exit(exitCode)
