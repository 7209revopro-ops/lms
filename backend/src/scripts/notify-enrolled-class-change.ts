/* ─────────────────────────────────────────────────────────────
   Tell the students ENROLLED in a class's course who have NOT booked it that
   the class changed — for an edit made before that started happening on its
   own (6617f86). The booked students were told at the time and are not
   messaged again.

   Exactly the live path's enrolled branch (liveClass.controller.ts
   notifyBookedStudents): the same audience (enrolledAudienceFor — the class's
   academies, not dropped, not blocked from the module, approved, active), the
   same in-app notice, and the same email + WhatsApp class_update_v1 through
   the critical-mail queue — flushed at once rather than after the buffer.

   The old time is read from the notices the booked students got for the
   edit (CriticalMail.oldStart), so nothing is typed in by hand.

   Dry run by default. --apply sends.

   Usage (from backend/):
     bun src/scripts/notify-enrolled-class-change.ts --class <liveClassId> --kind rescheduled
     bun src/scripts/notify-enrolled-class-change.ts --class <liveClassId> --kind rescheduled --apply
   --kind: rescheduled | cancelled
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import mongoose, { Types } from 'mongoose'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const CLASS_ID = arg('--class')
const KIND = arg('--kind') as 'rescheduled' | 'cancelled' | undefined
if (!CLASS_ID || !Types.ObjectId.isValid(CLASS_ID) || (KIND !== 'rescheduled' && KIND !== 'cancelled')) {
  console.error('usage: --class <liveClassId> --kind rescheduled|cancelled [--apply]'); process.exit(1)
}

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const M = await import('@/models/schema.ts')
const { enrolledAudienceFor } = await import('@/controllers/liveClass.controller.ts')
const { parkCriticalMail, flushCriticalMail } = await import('@/jobs/criticalmail.job.ts')
const { NotificationService } = await import('@/services/notification.service.ts')
const { academyClock } = await import('@/utils/academyClock.ts')
const { ensureOrgSlugs, orgSlugFor } = await import('@/utils/orgSlugs.ts')
const { SCHEDULE_LINK } = await import('@/utils/clientLinks.ts')
const done = async (code: number) => { await mongoose.disconnect(); process.exit(code) }

const live = await M.LiveClassModel.findById(CLASS_ID).select('title scheduledStart status').lean<{ title: string; scheduledStart: Date; status: string }>()
if (!live) { console.error('Class not found'); await done(1) }
if (KIND === 'rescheduled' && live!.status !== 'scheduled') { console.error(`Class is ${live!.status}, not scheduled`); await done(1) }
if (KIND === 'cancelled' && live!.status !== 'cancelled') { console.error(`Class is ${live!.status}, not cancelled`); await done(1) }

/* The time before the edit, from what the booked students were sent. */
const prior = await M.CriticalMailModel.findOne({ liveClassId: CLASS_ID, kind: KIND, audience: { $ne: 'enrolled' } })
  .sort({ createdAt: -1 }).select('oldStart createdAt').lean<{ oldStart?: Date; createdAt: Date }>()
const oldStart = prior?.oldStart ?? live!.scheduledStart
const newStart = live!.scheduledStart
if (KIND === 'rescheduled' && !prior?.oldStart) { console.error('No earlier time on record for this class — refusing to guess.'); await done(1) }

const booked = await M.ClassBookingModel.find({ liveClassId: CLASS_ID, status: { $in: ['booked', 'attended'] } }).select('userId').lean<Array<{ userId: unknown }>>()
const audience = await enrolledAudienceFor(CLASS_ID!, new Set(booked.map(b => String(b.userId))))
/* Never twice: anyone already sent an enrolled notice of this kind for this class. */
const already = new Set((await M.CriticalMailModel.find({ liveClassId: CLASS_ID, kind: KIND, audience: 'enrolled' }).select('userId').lean<Array<{ userId: unknown }>>()).map(r => String(r.userId)))
const todo = audience.filter(u => !already.has(String(u._id)))
const phones = new Set((await M.UserModel.find({ _id: { $in: todo.map(u => u._id) }, 'enrollmentApplication.phone': { $exists: true, $nin: ['', null] } }).select('_id').lean()).map(u => String(u._id)))

await ensureOrgSlugs()
const sample = todo[0] ? orgSlugFor((todo[0] as { organizationId?: unknown }).organizationId) : undefined
console.log(`\n${live!.title} — ${KIND}`)
console.log(`  was: ${academyClock(oldStart, sample).full}`)
console.log(`  now: ${academyClock(newStart, sample).full}`)
console.log(`  booked (already told, not messaged again): ${booked.length}`)
console.log(`  enrolled, not booked: ${audience.length}   already sent earlier: ${audience.length - todo.length}   to send now: ${todo.length}   with a phone: ${phones.size}`)

if (!APPLY) { console.log('\nDry run — nothing sent. Re-run with --apply.'); await done(0) }

const notifications = new NotificationService()
let inApp = 0, parked = 0
for (const u of todo as Array<{ _id: unknown; name?: string; email?: string; organizationId?: unknown }>) {
  const slug = orgSlugFor(u.organizationId)
  const title = KIND === 'cancelled' ? `Class cancelled: ${live!.title}` : `Class time changed: ${live!.title}`
  const body = KIND === 'cancelled'
    ? `This class in your course on ${academyClock(oldStart, slug).full} has been cancelled.`
    : `This class in your course has moved from ${academyClock(oldStart, slug).full} to ${academyClock(newStart, slug).full}.`
  try { await notifications.create(String(u._id), { kind: 'system', title, body, link: SCHEDULE_LINK }); inApp++ }
  catch (err) { console.log(`  in-app failed for ${u.email}: ${(err as Error).message}`) }
  if (!u.email) continue
  await parkCriticalMail({ liveClassId: CLASS_ID!, userId: String(u._id), email: u.email, name: u.name ?? '',
    kind: KIND!, title: live!.title, audience: 'enrolled', scheduledStart: newStart, oldStart, newStart })
  parked++
}
const flushed = await flushCriticalMail({ liveClassId: CLASS_ID! })
console.log(`\nIn-app: ${inApp}   Email queued: ${parked}   Sent now: ${flushed.sent}   Folded to digest (daily cap): ${flushed.folded}   Failed: ${flushed.failed}`)
/* Let the WhatsApp outbox deliveries started by the flush finish. */
await new Promise(r => setTimeout(r, 4000))
await done(flushed.failed ? 1 : 0)
