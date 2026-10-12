/* ─────────────────────────────────────────────────────────────
   Open a shared course's upcoming ONLINE classes to both academies — the
   same thing as turning on "Both academies" on each class's edit form.

   For every class of the course that is upcoming, scheduled, online, linked
   to a module and not yet open to another academy, the other academy is
   added as a guest through the same course and module with no seat floor:
   the free seats become one common pool either academy's students can book.
   Seats already booked stay booked. Nothing is sent to anyone — time, link
   and mentor do not change.

   In-person classes are left alone (a room in Dubai is not for Bangalore).
   The course must already be "Both academies" (Course.sharedAcademies).
   Bangalore students only SEE these classes when CROSS_ORG_CLASSES=true.

   Dry run by default — lists every class it would open. --apply writes,
   after saving the class ids to share-classes-backup-<ts>.json; --undo <file>
   closes those classes to the other academy again (refused, per class, where
   one of its students has already booked).

   Usage (from backend/):
     bun src/scripts/share-classes-both-academies.ts                  # MBT, dry run
     bun src/scripts/share-classes-both-academies.ts --apply
     bun src/scripts/share-classes-both-academies.ts --course <id> [--apply]
     bun src/scripts/share-classes-both-academies.ts --undo share-classes-backup-<ts>.json
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import fs from 'node:fs'
import mongoose, { Types } from 'mongoose'

const MBT = '6a3bdaa925c9f5a007590e0e'   // MARKET BREAK-OUT TRADING PROGRAM (Dubai, shared)
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const UNDO = arg('--undo')
const COURSE = arg('--course') ?? MBT

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const M = await import('@/models/schema.ts')
const { LiveClassService } = await import('@/services/liveClass.service.ts')
const svc = new LiveClassService()
const when = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const done = async (code: number) => { await mongoose.disconnect(); process.exit(code) }

/* ── Undo ── */
if (UNDO) {
  const ids = (JSON.parse(fs.readFileSync(UNDO, 'utf8')) as { classIds: string[] }).classIds
  let ok = 0, failed = 0
  for (const id of ids) {
    try { await svc.update(id, { guestCohorts: [] }); ok++ }
    catch (e) { failed++; console.log(`  could not close ${id}: ${(e as Error).message}`) }
  }
  console.log(`\nClosed to the other academy again: ${ok}. Refused: ${failed}.`)
  await done(failed ? 1 : 0)
}

/* ── Find ── */
if (!Types.ObjectId.isValid(COURSE)) { console.error('Invalid --course id'); await done(1) }
const course = await M.CourseModel.findById(COURSE).select('title sharedAcademies').lean<{ title: string; sharedAcademies?: boolean }>()
if (!course) { console.error('Course not found'); await done(1) }
if (!course!.sharedAcademies) { console.error(`"${course!.title}" is not set to Both academies — share the course first.`); await done(1) }

const sections = await M.SectionModel.find({ courseId: COURSE }).select('title order').sort({ order: 1 }).lean<Array<{ _id: Types.ObjectId; title: string }>>()
const moduleName = new Map(sections.map(s => [String(s._id), s.title]))
const orgs = await M.OrganizationModel.find().select('name').lean<Array<{ _id: Types.ObjectId; name: string }>>()
const orgName = new Map(orgs.map(o => [String(o._id), o.name]))

const classes = await M.LiveClassModel.find({
  courseId: COURSE, status: 'scheduled', scheduledStart: { $gte: new Date() },
  isOnline: { $ne: false }, sectionId: { $exists: true, $ne: null },
  $or: [{ guestCohorts: { $exists: false } }, { guestCohorts: { $size: 0 } }],
}).select('title scheduledStart sectionId organizationId sessionCapacity bookedCount language')
  .sort({ scheduledStart: 1 }).lean<Array<{ _id: Types.ObjectId; title: string; scheduledStart: Date; sectionId: Types.ObjectId; organizationId?: Types.ObjectId; sessionCapacity?: number; bookedCount?: number; language?: string }>>()

console.log(`\n${course!.title}`)
console.log(`Upcoming online classes not yet open to both academies: ${classes.length}\n`)
const perModule = new Map<string, number>()
for (const c of classes) {
  const mod = moduleName.get(String(c.sectionId)) ?? '(unknown module)'
  perModule.set(mod, (perModule.get(mod) ?? 0) + 1)
  const cap = c.sessionCapacity ?? 30, booked = c.bookedCount ?? 0
  console.log(`  ${when(c.scheduledStart)}  ${mod.padEnd(34)} ${(c.language ?? '').padEnd(10)} ${String(booked).padStart(2)}/${cap} booked  host: ${orgName.get(String(c.organizationId)) ?? '?'}`)
}
console.log('\nPer module:')
for (const s of sections) if (perModule.has(s.title)) console.log(`  ${String(perModule.get(s.title)).padStart(4)}  ${s.title}`)

if (!APPLY) {
  console.log('\nDry run — nothing changed. Re-run with --apply to open these classes to both academies.')
  await done(0)
}

/* ── Apply ── */
const backup = `share-classes-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
fs.writeFileSync(backup, JSON.stringify({ courseId: COURSE, at: new Date().toISOString(), classIds: classes.map(c => String(c._id)) }, null, 2))
console.log(`\nBackup of the class ids: ${backup}`)

let ok = 0
const failed: string[] = []
for (const c of classes) {
  const id = String(c._id)
  try {
    /* Exactly what the edit form's "Both academies" switch does
       (liveClass.controller.ts): the other academies through the same course
       and module, floor 0, and every free seat into the common overflow. */
    const guestCohorts = await svc.bothAcademiesCohorts(COURSE, String(c.sectionId), c.organizationId)
    if (guestCohorts.length === 0) continue
    const cap = c.sessionCapacity ?? 30
    await svc.update(id, { guestCohorts, overflowSeats: Math.max(0, cap - (c.bookedCount ?? 0)) })
    ok++
  } catch (e) {
    failed.push(`${when(c.scheduledStart)} ${c.title} (${id}): ${(e as Error).message}`)
  }
}
console.log(`\nOpened to both academies: ${ok} of ${classes.length}.`)
if (failed.length) { console.log(`Failed: ${failed.length}`); failed.forEach(f => console.log('  ' + f)) }
console.log(`Undo: bun src/scripts/share-classes-both-academies.ts --undo ${backup}`)
await done(failed.length ? 1 : 0)
