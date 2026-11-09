/* ─────────────────────────────────────────────────────────────
   delete-mentor-meeting — remove mentor meetings silently (the user, 2026-11-09: CS Portal's
   test meeting requests "delete silently from LMS"). Cancelling a meeting emails everyone on it;
   this deletes the meeting itself, so nobody is told and it leaves the calendars here. A Google
   Calendar event made for its Meet link (if any) is not touched.

   RUN ON THE SERVER, from the backend folder (the .env with DATABASE_URL is there).

   PREVIEW BY DEFAULT — shows the meetings; changes nothing.
     bun src/scripts/delete-mentor-meeting.ts --id <meetingId> [--id <another>]
   Delete them (a backup file goes to the home folder first):
     bun src/scripts/delete-mentor-meeting.ts --id <meetingId> --commit
   Put them back:
     bun src/scripts/delete-mentor-meeting.ts --undo <file> --commit
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { writeFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EJSON } from 'bson'

const argv = process.argv.slice(2)
const die = (m: string): never => { console.error(m); process.exit(1) }
const commit = argv.includes('--commit')
const ids = argv.flatMap((a, i) => (a === '--id' && argv[i + 1] ? [argv[i + 1]] : []))
const undoIdx = argv.indexOf('--undo')
const undoFile = undoIdx >= 0 ? argv[undoIdx + 1] : undefined

const DB_URL = process.env['DATABASE_URL'] ?? die('DATABASE_URL is not set (run from the backend folder so .env loads).')
await mongoose.connect(DB_URL, { autoIndex: false, autoCreate: false })
const { MentorMeetingModel } = await import('@/models/schema.ts')
const meetings = MentorMeetingModel.collection
console.log(`Database: ${mongoose.connection.db!.databaseName}${commit ? '' : '   (preview — add --commit to change it)'}\n`)

try {
  if (undoFile) {
    const saved = EJSON.parse(readFileSync(undoFile, 'utf8')) as { meetings: any[] }
    console.log(`${saved.meetings.length} meeting(s) ${commit ? 'put back' : 'would be put back'}.`)
    if (commit) for (const m of saved.meetings) await meetings.updateOne({ _id: m._id }, { $setOnInsert: m }, { upsert: true })
  } else {
    if (!ids.length) die('Say which: --id <meetingId> (one or more)')
    const oids = ids.map((id) => (mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : die(`Not a meeting id: ${id}`)))
    const found = await meetings.find({ _id: { $in: oids } }).toArray()
    for (const id of ids) if (!found.some((m) => String(m._id) === id)) console.log(`  ${id}: not found`)
    for (const m of found as any[]) {
      console.log(`  ${m._id} · ${m.title} · ${new Date(m.scheduledStart).toISOString()} · ${m.durationMins} min · ${(m.attendees ?? []).map((a: any) => a.name).join(', ')} · booked by ${m.bookedByEmail}${m.cancelledAt ? ' · cancelled' : ''}`)
    }
    if (!found.length) console.log('\nNothing to delete.')
    else if (commit) {
      const file = join(homedir(), `delete-mentor-meeting-undo-${Date.now()}.json`)
      writeFileSync(file, EJSON.stringify({ meetings: found }))
      const r = await meetings.deleteMany({ _id: { $in: found.map((m) => m._id) } })
      console.log(`\n${r.deletedCount} deleted — nobody emailed.\nUndo file: ${file}\n  bun src/scripts/delete-mentor-meeting.ts --undo ${file} --commit`)
    } else console.log(`\n${found.length} would be deleted. Add --commit to do it.`)
  }
} finally {
  await mongoose.disconnect()
}
