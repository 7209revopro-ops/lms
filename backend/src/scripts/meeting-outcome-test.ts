/* ─────────────────────────────────────────────────────────────
   Meeting outcomes — a test meeting (the user, 2026-10-27: "a test meeting, so
   when Amjad sir opens the LMS or the commission portal the pop-up shows").

   Makes one student meeting with a mentor that is already over and asks for an
   outcome (askOutcome, as a Tetra Commission booking does) — so their next look
   at LMS admin or Tetra Commission shows the pop-up (services/meetingOutcome.service.ts).
   Put straight in the database: no invitation is mailed to anybody. Its only
   attendee is a made-up address no student has, so when the form is filled
   nothing lands on a real student and no CS is told.

   Needs the meeting-outcome code deployed (LMS backend + admin, Tetra Commission).

   Usage (from backend/, on the server):
     bun src/scripts/meeting-outcome-test.ts                      dry run: the mentor it finds, what it would make, the test meetings already there
     bun src/scripts/meeting-outcome-test.ts --write              make it (mentor: anyone called Amjad)
     bun src/scripts/meeting-outcome-test.ts --mentor=<email or name> [--write]
     bun src/scripts/meeting-outcome-test.ts --remove [--write]   the test meetings — removed with --write
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'

const args = process.argv.slice(2)
const write = args.includes('--write')
const remove = args.includes('--remove')
const wanted = (args.find((a) => a.startsWith('--mentor='))?.slice('--mentor='.length) ?? 'amjad').trim()

const TEST_EMAIL = 'meeting-outcome-test@delta.invalid'
const TITLE = 'TEST — meeting outcome pop-up (ignore)'

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const mongoose = (await import('mongoose')).default
const { UserModel, MentorMeetingModel } = await import('@/models/schema.ts')
const when = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const done = async (code = 0) => { await mongoose.disconnect(); process.exit(code) }

const tests = await MentorMeetingModel.find({ 'attendees.email': TEST_EMAIL }).sort({ scheduledStart: 1 }).lean()
const mentorsOf = new Map((await UserModel.find({ _id: { $in: tests.map((t) => t.mentorId) } }).select('name email').lean()).map((u) => [String(u._id), u]))
const show = (t: (typeof tests)[number]) => {
  const m = mentorsOf.get(String(t.mentorId))
  const state = t.outcome ? `filled: ${t.outcome.stage} by ${t.outcome.filledByName} (${t.outcome.filledVia})` : t.cancelledAt ? 'cancelled' : 'waiting for the outcome'
  console.log(`  ${String(t._id)}  ${when(new Date(t.scheduledStart))}  ${m?.name ?? '?'} <${m?.email ?? '?'}>  — ${state}`)
}
console.log(`Test meetings there now: ${tests.length}`)
tests.forEach(show)

if (remove) {
  if (!write) {
    console.log(`\nDry run — nothing removed. Run again with --remove --write to remove ${tests.length === 1 ? 'it' : `these ${tests.length}`}.`)
    await done()
  }
  const r = await MentorMeetingModel.deleteMany({ 'attendees.email': TEST_EMAIL, title: TITLE })
  console.log(`\nRemoved ${r.deletedCount}.`)
  await done()
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mentors = await UserModel.find({
  role: 'instructor',
  ...(wanted.includes('@') ? { email: wanted.toLowerCase() } : { $or: [{ name: new RegExp(esc(wanted), 'i') }, { email: new RegExp(esc(wanted), 'i') }] }),
}).select('name email organizationId isActive').lean()

if (mentors.length !== 1) {
  console.error(mentors.length ? `\n${mentors.length} mentors match "${wanted}" — say which with --mentor=<email>:` : `\nNo mentor matches "${wanted}".`)
  for (const m of mentors) console.error(`  ${m.name} <${m.email}>${m.isActive === false ? ' (inactive)' : ''}`)
  await done(1)
}
const mentor = mentors[0]!
// Over already: started 45 minutes ago, 30 minutes long.
const start = new Date(Date.now() - 45 * 60_000)
const doc = {
  mentorId: mentor._id,
  organizationId: mentor.organizationId,
  title: TITLE,
  kind: 'student' as const,
  category: 'other' as const,
  scheduledStart: start,
  durationMins: 30,
  meetingUrl: '',
  isOnline: true,
  location: '',
  attendees: [{ name: 'Test student (ignore)', email: TEST_EMAIL }],
  notes: 'Made by scripts/meeting-outcome-test.ts to try the meeting-outcome pop-up. Remove with --remove --write.',
  bookedByEmail: mentor.email,
  bookedVia: 'portal' as const,
  askOutcome: true,
  outcome: null,
}

console.log(`\nMentor: ${mentor.name} <${mentor.email}>`)
console.log(`${write ? "Making" : "Would make"}: "${TITLE}" — ${when(start)}, 30 minutes (over), with "Test student (ignore)" <${TEST_EMAIL}>, asking for an outcome.`)
console.log(`They see the pop-up in LMS admin (signed in as ${mentor.email}) and in Tetra Commission (signed in with the same email), within a minute or two.`)

if (!write) {
  console.log('\nDry run — nothing made. Run again with --write to make it.')
  await done()
}
const made = await MentorMeetingModel.create(doc)
console.log(`\nMade ${String(made._id)}. When you are done: bun src/scripts/meeting-outcome-test.ts --remove --write`)
await done()
