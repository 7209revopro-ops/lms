/* ─────────────────────────────────────────────────────────────
   WhatsApp a program's Google Meet link to the commission portal's students —
   every approved, active student Tetra Commission has given a team (User.tetraCs)
   — through the approved class_update_v1 template:

     "Hi {name}, there's an update about your class {program} on {day, time}:
      It is live now. Join directly on Google Meet: {link}"     (or "It starts at …")

   Its button signs them in to their Class Schedule. Students already on the
   program are left out (they were told when it was made). Each student once:
   a re-run skips everyone already sent (bulk_send_log, batch = program-link-<id>).

   Dry run by default — prints the count and a sample. --apply sends.
     --academy dubai|bangalore   only that academy's students (default: both)
     --limit N                   send N (a first test batch)

   Usage (from backend/, ON THE SERVER — WhatsApp is configured there):
     bun src/scripts/send-program-link.ts --program <programId>
     bun src/scripts/send-program-link.ts --program <programId> --apply
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import mongoose, { Types } from 'mongoose'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const PROGRAM = arg('--program')
const ACADEMY = arg('--academy')
const LIMIT = arg('--limit') ? Number(arg('--limit')) : Infinity
if (!PROGRAM || !Types.ObjectId.isValid(PROGRAM)) { console.error('usage: --program <programId> [--apply] [--academy dubai|bangalore] [--limit N]'); process.exit(1) }

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const M = await import('@/models/schema.ts')
const { academyClock } = await import('@/utils/academyClock.ts')
const { ensureOrgSlugs, orgSlugFor } = await import('@/utils/orgSlugs.ts')
const done = async (code: number) => { await mongoose.disconnect(); process.exit(code) }

const p = await M.ProgramModel.findById(PROGRAM).lean<any>()
if (!p) { console.error('Program not found'); await done(1) }
/* The class to join: the one on now, else the next. Its own Meet link. */
const now = new Date()
const cls = await M.LiveClassModel.findOne({
  programId: p._id, status: { $in: ['scheduled', 'live'] },
  $expr: { $gt: [{ $add: ['$scheduledStart', { $multiply: ['$durationMins', 60_000] }] }, now] },
}).sort({ scheduledStart: 1 }).select('title scheduledStart durationMins meetingUrl').lean<any>()
if (!cls) { console.error('This program has no class on now or to come.'); await done(1) }
const link = String(cls.meetingUrl ?? '')
if (!/^https:\/\/meet\.google\.com\//i.test(link)) { console.error(`Its class has no Google Meet link (${link || 'none'}).`); await done(1) }
const live = new Date(cls.scheduledStart) <= now

await ensureOrgSlugs()
const orgs = await M.OrganizationModel.find(ACADEMY ? { slug: ACADEMY } : {}).select('_id slug').lean<any[]>()
if (ACADEMY && !orgs.length) { console.error(`No academy "${ACADEMY}"`); await done(1) }
const members = new Set((p.studentIds ?? []).map(String))
const BATCH = `program-link-${PROGRAM}`
const log = mongoose.connection.db!.collection('bulk_send_log')
const sentBefore = new Set((await log.find({ batch: BATCH }).project({ userId: 1 }).toArray()).map(r => String(r['userId'])))

const students = await M.UserModel.find({
  role: 'student', isActive: { $ne: false }, enrollmentStatus: 'approved',
  'tetraCs.team': { $nin: [null, ''] }, 'enrollmentApplication.phone': { $nin: [null, ''] },
  ...(ACADEMY ? { organizationId: { $in: orgs.map(o => o._id) } } : {}),
}).select('name organizationId enrollmentApplication.phone tetraCs.team').lean<any[]>()
const todo = students.filter(u => !members.has(String(u._id)) && !sentBefore.has(String(u._id)))

const message = (slug: string | undefined) => live
  ? `It is live now. Join directly on Google Meet: ${link}`
  : `It starts at ${academyClock(cls.scheduledStart, slug).time}. Join directly on Google Meet: ${link}`
const when = (slug: string | undefined) => {
  const zone = academyClock(cls.scheduledStart, slug).zone
  const day = new Date(cls.scheduledStart).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone }).replace(/^(\w{3}) /, '$1, ')
  return `${day}, ${academyClock(cls.scheduledStart, slug).time}`
}

const s0 = todo[0] ? orgSlugFor(todo[0].organizationId) : 'dubai'
console.log(`\nProgram: ${p.title}   class: ${new Date(cls.scheduledStart).toISOString()} (${live ? 'LIVE NOW' : 'to come'}), ${cls.durationMins} min`)
console.log(`Link: ${link}`)
console.log(`Commission-portal students with a phone${ACADEMY ? ` (${ACADEMY})` : ''}: ${students.length}   on the program already: ${students.filter(u => members.has(String(u._id))).length}   sent earlier: ${students.filter(u => sentBefore.has(String(u._id))).length}`)
console.log(`To send now: ${Math.min(todo.length, LIMIT)}`)
console.log(`\nSample (class_update_v1):\n  Hi ${todo[0]?.name ?? 'Student'}, there's an update about your class ${p.title} on ${when(s0)}:\n\n  ${message(s0)}\n\n  [button: sign in → Class Schedule]`)
if (!APPLY) { console.log('\nDry run — nothing sent. Re-run with --apply.'); await done(0) }

const { sendClassUpdateWhatsApp } = await import('@/services/whatsapp.service.ts')
const { mintSigninCode } = await import('@/services/signinLink.service.ts')
const { normalizeWhatsAppNumber } = await import('@/utils/normalizeWhatsAppNumber.ts')
let sent = 0, failed = 0
const unusable: string[] = []
for (const u of todo) {
  if (sent >= LIMIT) break
  const slug = orgSlugFor(u.organizationId)
  /* A number WhatsApp cannot take (two numbers run together, too short) is skipped by the sender
     without an error — so it is checked here, reported, and NOT logged as sent: fixed later, a
     re-run reaches them. */
  if (!normalizeWhatsAppNumber(u.enrollmentApplication.phone)) { unusable.push(`${u.name} — ${u.enrollmentApplication.phone}`); continue }
  try {
    const code = await mintSigninCode(String(u._id), '/class-bookings')
    await sendClassUpdateWhatsApp(u.enrollmentApplication.phone, u.name ?? '', p.title, when(slug), message(slug), code)
    await log.insertOne({ batch: BATCH, userId: u._id, at: new Date() })
    sent++
    if (sent % 100 === 0) console.log(`  … ${sent} sent`)
  } catch (err) {
    failed++; console.log(`  failed for ${u.name}: ${(err as Error).message}`)
  }
}
console.log(`\nSent: ${sent}   Failed: ${failed}   Unusable number: ${unusable.length}   (see admin → WhatsApp Logs, template class_update_v1)`)
if (unusable.length) { console.log('Not sent — fix the number in admin, then re-run:'); unusable.forEach(x => console.log('  ' + x)) }
await new Promise(r => setTimeout(r, 3000))
await done(failed ? 1 : 0)
