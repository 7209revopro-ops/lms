/* ─────────────────────────────────────────────────────────────
   Re-host knock-to-join Meet rooms under the LMS host mailbox.

   Why. A class's Meet room is made one of two ways (googleMeet.service.ts
   createGoogleMeetLink): normally a Meet-API room owned by the host mailbox
   (support@), set OPEN, mentor + staff as co-hosts — recorded on the class as
   `meetSpace`. If that step fails (the 2 Oct imports hit Google's rate limit)
   it falls back to a plain Calendar event, and that room cannot be opened by
   the LMS afterwards: verify-meet-access --reopen gets 403 on every one. The
   class carries no `meetSpace` — that is how they are found here.

   What it does, per upcoming class with a Meet code and no `meetSpace`:
     1. makes a NEW room the normal way (host mailbox, OPEN, co-hosts — the
        mentor gets Google's calendar invite);
     2. keeps it ONLY if Google says it is OPEN and owned by the host mailbox —
        otherwise withdraws it and leaves the class untouched;
     3. writes it to the class only if the class's link is still the old one;
     4. tells booked students in the app (and their digest) that the joining
        link changed — the same notice an admin's link edit sends;
     5. deletes the old Calendar event from the fallback calendar so the
        mentor's old invite disappears (Google tells them).
   Join links, the class page and the mentor's 10-minute WhatsApp all read
   the class's link at the time, so they pick up the new room by themselves.

   Read-only unless --apply. Old links are saved to a backup JSON first.

   Usage (from backend/, on the server — needs the Google keys):
     bun src/scripts/rehost-meet-rooms.ts                    dry run: list them
     bun src/scripts/rehost-meet-rooms.ts --apply --limit=3  try three first
     bun src/scripts/rehost-meet-rooms.ts --apply            all of them
   Classes starting within --skip-mins (default 60) are left alone, so a link
   never changes under a class about to start.
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import fs from 'node:fs'
import { google } from 'googleapis'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const APPLY     = args.has('apply')
const LIMIT     = Number(args.get('limit') ?? 0) || Infinity
const SKIP_MINS = Number(args.get('skip-mins') ?? 60)
const PACE_MS   = Number(args.get('pace-ms') ?? 2500)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const { LiveClassModel, UserModel, ClassBookingModel } = await import('@/models/schema.ts')
const { createGoogleMeetLink, effectiveMeetEmail, staffMeetCohosts, syncMeetSpace } = await import('@/services/googleMeet.service.ts')
const { notifySessionEdited } = await import('@/controllers/liveClass.controller.ts')

const host = (process.env['GOOGLE_MEET_HOST_EMAIL'] || process.env['GOOGLE_CALENDAR_ID'] || '').trim().toLowerCase()
const fallbackCalendar = process.env['GOOGLE_CALENDAR_ID'] ?? 'primary'
const dubai = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

const classes = await LiveClassModel.find({
  googleMeetCode: { $nin: [null, ''] },
  meetSpace:      { $exists: false },
  type:           { $in: [null, 'external'] },
  status:         { $nin: ['cancelled', 'ended'] },
  scheduledStart: { $gte: new Date(Date.now() + SKIP_MINS * 60_000) },
}).sort({ scheduledStart: 1 })
  .select('title scheduledStart durationMins meetingUrl googleMeetCode instructorId status type')
  .lean() as any[]

console.log('═'.repeat(70))
console.log(`  Re-host knock-to-join Meet rooms under ${host || '(no host mailbox configured!)'}`)
console.log('═'.repeat(70))
console.log(`  ${APPLY ? 'APPLY' : 'DRY RUN — nothing changes'} · ${classes.length} class(es) without a host-mailbox room, starting more than ${SKIP_MINS} min from now\n`)
if (APPLY && !host) { console.error('GOOGLE_MEET_HOST_EMAIL / GOOGLE_CALENDAR_ID not set — cannot make host-mailbox rooms.'); process.exit(1) }

const backupFile = `rehost-meet-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
if (APPLY) {
  fs.writeFileSync(backupFile, JSON.stringify(classes.map(c => ({ id: String(c._id), title: c.title, start: c.scheduledStart, meetingUrl: c.meetingUrl, googleMeetCode: c.googleMeetCode })), null, 1))
  console.log(`  old links saved to ${backupFile}\n`)
}

/* The fallback calendar, read with the same OAuth login that made the old events. */
const oauth = new google.auth.OAuth2(process.env['GOOGLE_CLIENT_ID'], process.env['GOOGLE_CLIENT_SECRET'])
oauth.setCredentials({ refresh_token: process.env['GOOGLE_REFRESH_TOKEN'] })
const calendar = google.calendar({ version: 'v3', auth: oauth })
async function removeOldEvent(start: Date, code: string): Promise<'deleted' | 'not found' | 'failed'> {
  try {
    const res = await calendar.events.list({ calendarId: fallbackCalendar, singleEvents: true, maxResults: 50,
      timeMin: new Date(start.getTime() - 60_000).toISOString(), timeMax: new Date(start.getTime() + 60_000).toISOString() })
    const ev = res.data.items?.find(e => e.hangoutLink?.includes(code))
    if (!ev?.id) return 'not found'
    await calendar.events.delete({ calendarId: fallbackCalendar, eventId: ev.id, sendUpdates: 'all' })
    return 'deleted'
  } catch { return 'failed' }
}

const tally = { rehosted: 0, notOpen: 0, failed: 0, changed: 0, oldEventDeleted: 0 }
let done = 0
for (const c of classes) {
  if (done >= LIMIT) break
  const start = new Date(c.scheduledStart)
  const inst = c.instructorId ? await UserModel.findById(c.instructorId).select('name email meetEmail').lean() as any : null
  const booked = await ClassBookingModel.countDocuments({ liveClassId: c._id, status: { $in: ['booked', 'attended'] } })
  const line = `${dubai(start).padEnd(22)} ${String(c.title).slice(0, 32).padEnd(32)} ${String(inst?.name ?? '—').slice(0, 18).padEnd(18)} booked ${String(booked).padStart(3)}`
  if (!APPLY) { console.log(`  · ${line}  ${c.meetingUrl}`); continue }
  done++

  let made: Awaited<ReturnType<typeof createGoogleMeetLink>> | undefined
  for (let attempt = 1; attempt <= 2 && !made; attempt++) {
    try {
      made = await createGoogleMeetLink({
        title: c.title, startISO: start.toISOString(), durationMins: c.durationMins,
        instructorEmail: inst?.email ?? undefined, instructorMeetEmail: effectiveMeetEmail(inst),
        staffCohosts: staffMeetCohosts(),
      })
    } catch (err: any) {
      if (attempt === 1) { await sleep(30_000); continue }
      console.log(`  ❌ ${line}  Google failed: ${(err?.message ?? 'error').slice(0, 60)}`)
    }
  }
  if (!made) { tally.failed++; await sleep(PACE_MS); continue }

  /* Only a host-mailbox room that Google confirms OPEN is worth switching to. */
  if (!made.meetSpace || made.meetSpace.host !== host || made.accessType !== 'OPEN') {
    console.log(`  ⚠  ${line}  new room not OPEN/host-owned (${made.accessType ?? 'unknown'}, ${made.meetSpace ? 'host ' + made.meetSpace.host : 'calendar fallback'}) — left as it was`)
    if (made.meetSpace) await syncMeetSpace(made.meetSpace, { cancelled: true }).catch(() => {})
    tally.notOpen++; await sleep(PACE_MS); continue
  }

  const saved = await LiveClassModel.findOneAndUpdate(
    { _id: c._id, meetingUrl: c.meetingUrl, status: { $nin: ['cancelled', 'ended'] } },
    { $set: { meetingUrl: made.meetingUrl, googleMeetCode: made.meetingCode, meetSpace: made.meetSpace } },
    { new: true },
  )
  if (!saved) {
    console.log(`  ⚠  ${line}  class changed meanwhile — new room withdrawn, class untouched`)
    await syncMeetSpace(made.meetSpace, { cancelled: true }).catch(() => {})
    tally.changed++; await sleep(PACE_MS); continue
  }

  await notifySessionEdited({ liveClassId: String(c._id), title: c.title, linkChanged: true, minorChanges: [] })
    .catch(err => console.log(`     (student notice failed: ${err?.message ?? err})`))
  const old = await removeOldEvent(start, c.googleMeetCode)
  if (old === 'deleted') tally.oldEventDeleted++
  tally.rehosted++
  console.log(`  ✅ ${line}  → ${made.meetingUrl}  (old invite ${old})`)
  await sleep(PACE_MS)
}

console.log('\n  Summary:')
if (!APPLY) console.log(`     ${classes.length} would get a new OPEN room. Re-run with --apply (try --limit=3 first).`)
else {
  console.log(`     ${tally.rehosted} re-hosted (OPEN, co-hosts set, booked students told)`)
  console.log(`     ${tally.oldEventDeleted} old calendar invites removed`)
  if (tally.notOpen) console.log(`     ${tally.notOpen} skipped — Google did not give an OPEN host room (re-run later)`)
  if (tally.failed)  console.log(`     ${tally.failed} failed — Google error (re-run later; done ones are skipped)`)
  if (tally.changed) console.log(`     ${tally.changed} skipped — the class changed while running`)
  console.log(`     backup of old links: ${backupFile}`)
}
process.exit(0)
