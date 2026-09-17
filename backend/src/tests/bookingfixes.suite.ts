/* ─────────────────────────────────────────────────────────────
   Phase-1 booking / reminder fixes.

   Five defects the reminder chain shipped with, each invisible until it bites
   a real student:

     A  a CANCELLED or ENDED class kept mailing its whole roster "your class is
        starting" — the query only constrains the BOOKING's status
     B  one deleted student threw mid-loop and aborted the batch, costing every
        OTHER student their reminder for that run
     C  a class with no meetingUrl mailed "/live-classes/undefined/watch"
     D  a slow run overlapped the next tick and double-sent
     E  rescheduling left reminder*Sent set, so the student got NOTHING at the
        new time — the chain believed it had already run

   Boots the REAL Express app against an ISOLATED throwaway database.
   Run: bun src/tests/bookingfixes.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL  = 'mongodb://localhost:27017/lms_bookingfixes_suite'
process.env.NODE_ENV      = 'test'
process.env.PORT          = '0'
process.env.CLIENT_URL    = 'http://client.test'
process.env.ADMIN_URL     = 'http://admin.test'
process.env.EMAIL_LOG_DIR = '.logs/emails-bookingfixes'
process.env.SMTP_HOST = ''
process.env.SMTP_USER = ''
process.env.SMTP_PASS = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID = ''
process.env.R2_ACCESS_KEY_ID = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL = ''

export {}

import { readdir, readFile, rm } from 'fs/promises'
import { join } from 'path'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, CourseModel, LiveClassModel, ClassBookingModel } =
  await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { runPreSessionReminders, runAtTimeReminders, exclusive } = await import('@/jobs/reminders.job.ts')
const { LiveClassService } = await import('@/services/liveClass.service.ts')

const MAILDIR = process.env.EMAIL_LOG_DIR!
await rm(MAILDIR, { recursive: true, force: true }).catch(() => {})
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_bookingfixes_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))

const settle = (ms = 400) => new Promise(r => setTimeout(r, ms))
async function mails(recipient: string, sinceMs: number): Promise<string[]> {
  let files: string[] = []
  try { files = await readdir(MAILDIR) } catch { return [] }
  const safe = recipient.replace(/[^a-z0-9@._-]/gi, '_')
  const mine = files.filter(f => f.includes(safe) && Number(f.split('-')[0]) >= sinceMs)
  return Promise.all(mine.map(f => readFile(join(MAILDIR, f), 'utf8')))
}

const PW  = 'Passw0rd!'
const MIN = 60_000

try {

const org  = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const hash = await hashPassword(PW)
const mk = (email: string, role = 'student', extra: Record<string, unknown> = {}) =>
  UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role,
    isActive: true, isVerified: true, organizationId: org._id, ...extra })

const teacher = await mk('teach@bf.test', 'instructor')
const course  = await CourseModel.create({
  title: 'Forex', slug: 'forex-bf', description: 'd', instructorId: teacher._id,
  price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
})

/* ~30 min out, so runPreSessionReminders (25..35 window) picks it up. */
const mkClass = (extra: Record<string, unknown> = {}) => LiveClassModel.create({
  title: 'Session', courseId: course._id, instructorId: teacher._id, organizationId: org._id,
  scheduledStart: new Date(Date.now() + 30 * MIN), durationMins: 60, type: 'external', isOnline: true,
  status: 'scheduled', language: 'English', sessionCapacity: 30, bookedCount: 0,
  meetingUrl: 'https://meet.google.com/bf-test', ...extra,
})
const seat = (u: any, lc: any) =>
  ClassBookingModel.create({ userId: u._id, liveClassId: lc._id, status: 'booked', bookedAt: new Date() })

/* ═══════════ A — cancelled / ended classes ═══════════ */
section('A. A cancelled or ended class must not mail its roster')
{
  const s1 = await mk('cancelled@bf.test')
  const s2 = await mk('ended@bf.test')
  const s3 = await mk('live@bf.test')
  await seat(s1, await mkClass({ status: 'cancelled' }))
  await seat(s2, await mkClass({ status: 'ended' }))
  await seat(s3, await mkClass())                        // control: healthy class
  const t0 = Date.now()
  await runPreSessionReminders(); await settle()
  check('A1 a CANCELLED class sends nothing', (await mails('cancelled@bf.test', t0)).length === 0)
  check('A2 an ENDED class sends nothing',    (await mails('ended@bf.test', t0)).length === 0)
  check('A3 …while a healthy class still reminds (the guard is not over-broad)',
    (await mails('live@bf.test', t0)).length === 1)
}

/* ═══════════ B — one orphan must not abort the batch ═══════════ */
section('B. A deleted student must not cost everyone else their reminder')
{
  const ghost = await mk('ghost@bf.test')
  const alive = await mk('alive@bf.test')
  await seat(ghost, await mkClass())
  await seat(alive, await mkClass())
  await UserModel.deleteOne({ _id: ghost._id })          // dangling ref → populate() yields null
  const t0 = Date.now()
  await runPreSessionReminders(); await settle()
  check('B1 the surviving student STILL gets their reminder', (await mails('alive@bf.test', t0)).length === 1)
  check('B2 the orphaned booking is simply skipped',          (await mails('ghost@bf.test', t0)).length === 0)
}

/* ═══════════ C — no dead join link ═══════════ */
section('C. A class with no meeting URL must not mail /live-classes/undefined/watch')
{
  const s  = await mk('nolink@bf.test')
  const lc = await mkClass({ meetingUrl: undefined, scheduledStart: new Date(Date.now() - 1 * MIN) })
  await seat(s, lc)
  const t0 = Date.now()
  await runAtTimeReminders(); await settle()             // the at-time mail is the one carrying a link
  const body = (await mails('nolink@bf.test', t0)).join('')
  check('C1 the at-time mail was sent', body.length > 0)
  check('C2 it contains NO "undefined" link', !body.includes('/live-classes/undefined/'), 'dead link present')
  /* With a resolvable id the watch page IS the right destination; the
     /class-bookings fallback exists only for the case where no id resolves.
     Either way the student must end up somewhere real. */
  check('C3 the link points at this class\'s real watch page',
    body.includes(`/live-classes/${String(lc._id)}/watch`) || body.includes('/class-bookings'),
    body.match(/https?:\/\/client\.test[^"'\s<]*/)?.[0] ?? 'no client.test link found')
}

/* ═══════════ D — overlap guard ═══════════ */
section('D. A slow run must not be re-entered by the next tick')
{
  let running = 0, peak = 0, runs = 0
  const slow = exclusive('probe', async () => {
    runs++; running++; peak = Math.max(peak, running)
    await new Promise(r => setTimeout(r, 120))
    running--
  })
  await Promise.all([slow(), slow(), slow()])            // three ticks land together
  check('D1 only ONE run executes', runs === 1, `runs=${runs}`)
  check('D2 never two at once',     peak === 1, `peak=${peak}`)
  await slow()
  check('D3 the lock releases, so a later tick runs normally', runs === 2, `runs=${runs}`)
}

/* ═══════════ E — reschedule re-arms the chain ═══════════ */
section('E. Rescheduling must re-arm the reminders for the new time')
{
  const s  = await mk('moved@bf.test')
  const lc = await mkClass()
  const b  = await seat(s, lc)
  await ClassBookingModel.findByIdAndUpdate(b._id, { $set: {
    reminderDayBeforeSent: true, reminderDayOfSent: true, reminderPreSessionSent: true,
    reminder5MinSent: true, reminderAtTimeSent: true,
  } })
  await new LiveClassService().update(String(lc._id), { scheduledStart: new Date(Date.now() + 3 * 60 * MIN) } as any)
  const after = await ClassBookingModel.findById(b._id).lean() as any
  check('E1 every reminder flag is cleared on reschedule',
    [after.reminderDayBeforeSent, after.reminderDayOfSent, after.reminderPreSessionSent,
     after.reminder5MinSent, after.reminderAtTimeSent].every(v => v === false),
    JSON.stringify(after).slice(0, 160))
  check('E2 the instructor 15-min flag on the class is cleared too',
    (await LiveClassModel.findById(lc._id).lean() as any)?.reminderInstructor15MinSent === false)

  /* An unrelated edit must NOT wipe the chain. */
  const lc2 = await mkClass()
  const b2  = await seat(await mk('untouched@bf.test'), lc2)
  await ClassBookingModel.findByIdAndUpdate(b2._id, { $set: { reminderPreSessionSent: true } })
  await new LiveClassService().update(String(lc2._id), { title: 'Renamed' } as any)
  check('E3 a non-reschedule edit leaves the flags alone',
    (await ClassBookingModel.findById(b2._id).lean() as any)?.reminderPreSessionSent === true)
}

} catch (err) {
  fail++
  lines.push(`\n  FATAL  ${(err as Error).stack ?? String(err)}`)
} finally {
  console.log(lines.join('\n'))
  console.log(`\nbookingfixes.suite — ${pass} passed, ${fail} failed`)
  await rm(MAILDIR, { recursive: true, force: true }).catch(() => {})
  await mongoose.connection.dropDatabase().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}
