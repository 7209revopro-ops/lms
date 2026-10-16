/* ─────────────────────────────────────────────────────────────
   Who was in a class's Google Meet room, from Google — READ ONLY.

   The LMS records a join only when a student comes in through its own link
   (ClassBooking.attendanceSource 'click'). Anyone who opened the Meet link
   directly (e.g. from WhatsApp) is in Google's records only. This reads them:
   every conference of the class's room (Meet API conferenceRecords), every
   participant (name, signed in or not, first join, last leave), and their
   minutes in the room (participantSessions) — then matches each to a student
   by name, and writes a CSV next to the LMS's own attended / missed list.

   Needs the room to be one the LMS made (LiveClass.meetSpace) and the service
   account key (backend/google-service-account.json) — so: ON THE SERVER.
   Changes nothing.

   Usage (from backend/):
     bun src/scripts/meet-attendance.ts --class <liveClassId>
   Writes .logs/reports/meet-attendance-<liveClassId>.csv
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import fs from 'node:fs'
import path from 'node:path'
import mongoose, { Types } from 'mongoose'
import { google } from 'googleapis'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const CLASS_ID = arg('--class')
if (!CLASS_ID || !Types.ObjectId.isValid(CLASS_ID)) { console.error('usage: --class <liveClassId>'); process.exit(1) }

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const M = await import('@/models/schema.ts')
const done = async (code: number) => { await mongoose.disconnect(); process.exit(code) }

const cls = await M.LiveClassModel.findById(CLASS_ID).select('title scheduledStart durationMins meetSpace programId').lean<any>()
if (!cls) { console.error('Class not found'); await done(1) }
if (!cls.meetSpace?.name || !cls.meetSpace?.host) { console.error('This class has no Meet room the LMS made (no meetSpace) — Google cannot be asked.'); await done(1) }

const key = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'google-service-account.json'), 'utf-8'))
const auth = new google.auth.JWT({ email: key.client_email, key: key.private_key, subject: cls.meetSpace.host,
  scopes: ['https://www.googleapis.com/auth/meetings.space.created'] })
const API = 'https://meet.googleapis.com/v2'
async function all<T>(url: string, field: string): Promise<T[]> {
  const out: T[] = []
  let page = ''
  do {
    const r: any = await auth.request({ url: `${url}${url.includes('?') ? '&' : '?'}pageSize=250${page ? `&pageToken=${page}` : ''}`, method: 'GET' })
    out.push(...((r.data?.[field] ?? []) as T[]))
    page = r.data?.nextPageToken ?? ''
  } while (page)
  return out
}

const confs = await all<any>(`${API}/conferenceRecords?filter=${encodeURIComponent(`space.name = "${cls.meetSpace.name}"`)}`, 'conferenceRecords')
console.log(`\n${cls.title} — ${new Date(cls.scheduledStart).toISOString()}  room ${cls.meetSpace.name}`)
console.log(`Conferences held in the room: ${confs.length}`)

type P = { name: string; signedIn: boolean; first: Date; last: Date; minutes: number }
const people = new Map<string, P>()
for (const c of confs) {
  const parts = await all<any>(`${API}/${c.name}/participants`, 'participants')
  for (const p of parts) {
    const display = p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName ?? '(unknown)'
    const id = p.signedinUser?.user ?? `anon:${display.toLowerCase()}`
    const sessions = await all<any>(`${API}/${p.name}/participantSessions`, 'participantSessions')
    const mins = sessions.reduce((n, s) => n + (s.startTime && s.endTime ? (Date.parse(s.endTime) - Date.parse(s.startTime)) / 60000 : 0), 0)
    const first = new Date(p.earliestStartTime), last = new Date(p.latestEndTime ?? p.earliestStartTime)
    const had = people.get(id)
    people.set(id, had
      ? { ...had, first: first < had.first ? first : had.first, last: last > had.last ? last : had.last, minutes: had.minutes + mins }
      : { name: display, signedIn: !!p.signedinUser, first, last, minutes: mins })
  }
}

/* Match to students by name (Meet names are what people typed or their Google name — best effort). */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
const onProgram = cls.programId ? new Set(((await M.ProgramModel.findById(cls.programId).select('studentIds').lean<any>())?.studentIds ?? []).map(String)) : new Set<string>()
const bookings = new Map((await M.ClassBookingModel.find({ liveClassId: cls._id }).select('userId status').lean<any[]>()).map(b => [String(b.userId), b.status]))
const students = await M.UserModel.find({ role: 'student' }).select('name email enrollmentApplication.phone tetraCs organizationId').lean<any[]>()
const byName = new Map<string, any[]>()
for (const s of students) { const k = norm(s.name ?? ''); if (k) byName.set(k, [...(byName.get(k) ?? []), s]) }

const dubai = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const lines = [['Meet name', 'Signed in to Google', 'First joined (Dubai)', 'Last left (Dubai)', 'Minutes in room', 'Matched student', 'Email', 'Phone', 'Team', 'CS', 'On the programme', 'LMS record'].join(',')]
let matched = 0, onProg = 0, lmsMissed = 0
const rows = [...people.values()].sort((a, b) => b.minutes - a.minutes)
for (const p of rows) {
  const hits = byName.get(norm(p.name)) ?? []
  const s = hits.length === 1 ? hits[0] : null
  if (s) matched++
  const inProg = s ? onProgram.has(String(s._id)) : false
  if (inProg) onProg++
  const lms = s ? (bookings.get(String(s._id)) ?? 'not booked') : ''
  if (lms === 'missed') lmsMissed++
  lines.push([p.name, p.signedIn ? 'yes' : 'no', dubai(p.first), dubai(p.last), Math.round(p.minutes),
    s?.name ?? (hits.length > 1 ? `(${hits.length} students with this name)` : ''), s?.email ?? '', s?.enrollmentApplication?.phone ?? '',
    s?.tetraCs?.team ?? '', s?.tetraCs?.name ?? '', s ? (inProg ? 'yes' : 'no') : '', lms].map(esc).join(','))
}
const out = path.join(process.cwd(), '.logs', 'reports', `meet-attendance-${CLASS_ID}.csv`)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, lines.join('\n'), 'utf8')

console.log(`People in the room (Google): ${rows.length}   matched to a student by name: ${matched}`)
console.log(`  of them on the programme: ${onProg}   …that the LMS marked "missed" (joined by the Meet link): ${lmsMissed}`)
console.log(`  10+ minutes in the room: ${rows.filter(p => p.minutes >= 10).length}`)
console.log(`\nCSV: ${out}`)
await done(0)
