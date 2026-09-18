/* ─────────────────────────────────────────────────────────────
   Delete live classes for ONE organisation + ONE programme only.

   A live class has no org/programme of its own — it links to a Course, and the
   Course carries organizationId and program. So "Dubai Forex classes" means:
   live classes whose courseId is a course where
       organizationId = <dubai>  AND  program ∈ {4x-trading, forex}
   Nothing else is touched — Digital Marketing / JURA / AI classes, other orgs,
   courses, students and enrolments all stay.

   Same safety model as clear-class-schedule.ts:
     · report-only unless --apply
     · --apply also needs --confirm=<exact count> (a stale number aborts)
     · every deleted row is backed up to .logs/deleted/ BEFORE removal
     · dependants (bookings, feedback, homework, per-student assignments,
       handoffs) are reported; --cascade removes them too, each backed up

   Usage (from backend/):
     bun src/scripts/clear-forex-classes.ts
     bun src/scripts/clear-forex-classes.ts --apply --confirm=NN --cascade
   Options: --org=dubai  --program=4x-trading  (defaults shown)
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const ORG_SLUG = (args.get('org') ?? 'dubai').toLowerCase()
/* Accept both spellings that have been used for the Forex programme. */
const PROGRAMS = (args.get('program') ?? '4x-trading,forex').split(',').map(s => s.trim()).filter(Boolean)
const APPLY    = args.has('apply')
const CASCADE  = args.has('cascade')
const CONFIRM  = args.has('confirm') ? Number(args.get('confirm')) : undefined

const DEPENDANTS = [
  { model: 'ClassBooking',    label: 'student bookings' },
  { model: 'ClassFeedback',   label: 'class feedback' },
  { model: 'SessionHomework', label: 'session homework' },
  { model: 'ClassAssignment', label: 'per-student class assignments' },
  { model: 'ClassHandoff',    label: 'class handoffs' },
] as const

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const db = mongoose.connection.db!
await import('@/models/schema.ts')
const { OrganizationModel, CourseModel, LiveClassModel } = await import('@/models/schema.ts')

console.log('═'.repeat(66))
console.log(`  Mode:     ${APPLY ? 'APPLY — ROWS WILL BE DELETED' : 'REPORT ONLY'}`)
console.log(`  Database: ${db.databaseName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Target:   live classes  ·  org "${ORG_SLUG}"  ·  program ${PROGRAMS.join(' / ')}`)
console.log('═'.repeat(66))

/* ── resolve org ── */
const org = await OrganizationModel.findOne({ slug: ORG_SLUG }).select('_id name').lean()
if (!org) {
  console.error(`\n❌ No organisation with slug "${ORG_SLUG}". Aborting.`)
  await mongoose.disconnect(); process.exit(1)
}

/* ── resolve the matching courses, and show them so the target is auditable ── */
const courses = await CourseModel.find({
  organizationId: org._id,
  program: { $in: PROGRAMS },
}).select('_id title program').lean()

console.log(`\n  Org: ${(org as any).name} (${ORG_SLUG})`)
console.log(`  Matching courses (${courses.length}):`)
if (courses.length === 0) {
  console.log('     — none — so there are no classes to clear under this filter.')
  /* Show what forex courses exist elsewhere, so a mis-set org is obvious. */
  const elsewhere = await CourseModel.find({ program: { $in: PROGRAMS } })
    .select('title organizationId').lean()
  if (elsewhere.length) {
    console.log(`\n  (Forex-programme courses DO exist, but not under "${ORG_SLUG}":)`)
    for (const c of elsewhere.slice(0, 15)) console.log(`     · ${c.title}  org=${String((c as any).organizationId ?? 'none')}`)
  }
  await mongoose.disconnect(); process.exit(0)
}
for (const c of courses) console.log(`     · ${String(c.title).slice(0, 44).padEnd(44)} [${c.program}]`)

/* ── live classes for those courses ── */
const courseIds = courses.map(c => c._id)
const targetClasses = await LiveClassModel.find({ courseId: { $in: courseIds } })
  .select('_id title scheduledStart status').lean()
const total = targetClasses.length
console.log(`\n  Live classes for those courses: ${total}`)
for (const lc of targetClasses.slice(0, 20) as any[]) {
  const when = lc.scheduledStart ? new Date(lc.scheduledStart).toISOString().slice(0, 16) : '—'
  console.log(`     ${when}  ${String(lc.status ?? '').padEnd(9)} ${String(lc.title).slice(0, 40)}`)
}
if (total > 20) console.log(`     …and ${total - 20} more`)

if (total === 0) {
  console.log('\n  Nothing to delete.\n')
  await mongoose.disconnect(); process.exit(0)
}

/* ── dependants tied to exactly these classes ── */
const classIds = targetClasses.map(c => c._id)
const deps: { model: string; label: string; count: number }[] = []
for (const d of DEPENDANTS) {
  const c = await mongoose.model(d.model).countDocuments({ liveClassId: { $in: classIds } })
  if (c > 0) deps.push({ model: d.model, label: d.label, count: c })
}
if (deps.length) {
  console.log('\n  Rows attached to these classes (would be orphaned):')
  for (const d of deps) console.log(`     ${String(d.count).padStart(6)}  ${d.label}  (${d.model})`)
  console.log(CASCADE ? '\n  --cascade is set: these are deleted too (each backed up first).'
                      : '\n  Left in place. Add --cascade to remove them as well.')
}

/* ── interlock ── */
if (!APPLY) {
  console.log(`\n  Nothing was deleted.`)
  console.log(`  To delete, re-run with:  --apply --confirm=${total}${CASCADE ? ' --cascade' : ''}\n`)
  await mongoose.disconnect(); process.exit(0)
}
if (CONFIRM !== total) {
  console.error(`\n❌ --confirm=${CONFIRM ?? '(missing)'} does not match the ${total} classes found.`)
  console.error(`   Re-run with --confirm=${total} if that is what you mean to delete.\n`)
  await mongoose.disconnect(); process.exit(1)
}

/* ── backup + delete ── */
const dir = join(process.cwd(), '.logs', 'deleted')
mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const { EJSON } = mongoose.mongo.BSON

async function backupAndDelete(modelName: string, q: Record<string, unknown>, label: string) {
  const model = mongoose.model(modelName)
  const rows = await model.collection.find(q).toArray()
  if (rows.length === 0) { console.log(`    ${label}: none`); return }
  const file = join(dir, `${model.collection.collectionName}_forex-${ORG_SLUG}_${stamp}.ejson.gz`)
  writeFileSync(file, gzipSync(Buffer.from(
    EJSON.stringify({ collection: model.collection.collectionName, takenAt: new Date().toISOString(), documents: rows }, { relaxed: false }), 'utf8')))
  const res = await model.deleteMany(q)
  console.log(`    ${label}: ${res.deletedCount} deleted  (backup: ${file.split(/[\\/]/).pop()})`)
}

console.log('\n  Working…')
if (CASCADE) {
  for (const d of deps) await backupAndDelete(d.model, { liveClassId: { $in: classIds } }, d.label)
}
await backupAndDelete('LiveClass', { _id: { $in: classIds } }, `Dubai Forex live classes`)

const left = await LiveClassModel.countDocuments({ courseId: { $in: courseIds } })
console.log(`\n  Remaining Dubai-Forex live classes: ${left}`)
if (!CASCADE && deps.length) {
  console.log(`  ⚠  ${deps.reduce((a, d) => a + d.count, 0)} attached row(s) now reference deleted classes — re-run with --cascade to clear them.`)
}
console.log(`  Backups in ${dir}\n`)

await mongoose.disconnect()
process.exit(0)
