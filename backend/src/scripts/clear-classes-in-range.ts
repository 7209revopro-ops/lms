/* ─────────────────────────────────────────────────────────────
   Delete live classes for ONE organisation + programme(s), inside a
   DATE WINDOW only.

   Built for "remove Dubai Digital-Marketing live classes from 11 Oct to
   7 Nov", but org, programme and both dates are args, so it is the general
   "clear a window of one academy's classes" tool.

   A live class has NO org/programme of its own — it links to a Course, and the
   Course carries organizationId and program. So the target is:
       live classes whose courseId is a course where
          organizationId = <org>  AND  program ∈ <programs>
       AND whose scheduledStart falls inside the window.
   Nothing outside that window, that org or that programme is touched. A class
   OWNED by another org but merely guest-shared into one of these courses is
   NOT caught — only classes these Dubai DM courses own.

   TIMES ARE DUBAI WALL-CLOCK. --from/--to are calendar dates read as
   Asia/Dubai (UTC+4, no DST); BOTH days are included in full. They become a
   half-open UTC range [from 00:00, day-after-to 00:00) computed here, so the
   result never depends on the machine's timezone.

   Same safety model as clear-forex-classes.ts:
     · report-only unless --apply
     · --apply also needs --confirm=<exact count> (a stale number aborts)
     · every deleted row is backed up to .logs/deleted/ BEFORE removal
     · dependants (bookings, feedback, homework, per-student assignments,
       handoffs) are reported; --cascade removes them too, each backed up

   Usage (from backend/):
     bun src/scripts/clear-classes-in-range.ts                 # dry run
     bun src/scripts/clear-classes-in-range.ts --apply --confirm=NN [--cascade]
   Options (defaults shown — the Dubai DM Oct–Nov task):
     --org=dubai  --program=digital-marketing  --from=2026-10-11  --to=2026-11-07
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
const PROGRAMS = (args.get('program') ?? 'digital-marketing').split(',').map(s => s.trim()).filter(Boolean)
const FROM     = args.get('from') ?? '2026-10-11'   // Dubai date, inclusive
const TO       = args.get('to')   ?? '2026-11-07'   // Dubai date, inclusive (whole day)
const APPLY    = args.has('apply')
const CASCADE  = args.has('cascade')
const CONFIRM  = args.has('confirm') ? Number(args.get('confirm')) : undefined

const DUBAI = '+04:00'                       // Asia/Dubai, no DST
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
if (!DATE_RE.test(FROM) || !DATE_RE.test(TO)) {
  console.error(`\n❌ --from and --to must be YYYY-MM-DD. Got from="${FROM}" to="${TO}".\n`)
  process.exit(1)
}
const fromUTC = new Date(`${FROM}T00:00:00.000${DUBAI}`)
const toDay0  = new Date(`${TO}T00:00:00.000${DUBAI}`)
const toUTC   = new Date(toDay0.getTime() + 24 * 60 * 60 * 1000)   // exclusive: start of the day AFTER --to
if (Number.isNaN(fromUTC.getTime()) || Number.isNaN(toUTC.getTime()) || fromUTC >= toUTC) {
  console.error(`\n❌ Bad date window: ${FROM} → ${TO}.\n`)
  process.exit(1)
}
/* Dubai-local label for a stored UTC instant, without relying on process TZ. */
const inDubai = (d: Date) => new Date(d.getTime() + 4 * 3_600_000).toISOString().replace('T', ' ').slice(0, 16)

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

console.log('═'.repeat(72))
console.log(`  Mode:     ${APPLY ? 'APPLY — ROWS WILL BE DELETED' : 'REPORT ONLY'}`)
console.log(`  Database: ${db.databaseName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Target:   live classes · org "${ORG_SLUG}" · program ${PROGRAMS.join(' / ')}`)
console.log(`  Window:   ${FROM} 00:00 → ${TO} 23:59  (Asia/Dubai, both days inclusive)`)
console.log(`            = UTC [${fromUTC.toISOString()}  →  ${toUTC.toISOString()})`)
console.log('═'.repeat(72))

/* ── resolve org ── */
const org = await OrganizationModel.findOne({ slug: ORG_SLUG }).select('_id name').lean()
if (!org) {
  console.error(`\n❌ No organisation with slug "${ORG_SLUG}". Aborting.`)
  await mongoose.disconnect(); process.exit(1)
}

/* ── matching courses (shown, so the target is auditable) ── */
const courses = await CourseModel.find({ organizationId: org._id, program: { $in: PROGRAMS } })
  .select('_id title program').lean()
console.log(`\n  Org: ${(org as any).name} (${ORG_SLUG})`)
console.log(`  Matching courses (${courses.length}):`)
if (courses.length === 0) {
  console.log('     — none under this org + program.')
  /* Show every course in the org with its program string, so a wrong/blank
     --program value is obvious at a glance. */
  const all = await CourseModel.find({ organizationId: org._id }).select('title program').lean()
  console.log(`\n  (All ${all.length} courses in "${ORG_SLUG}", so the right --program is visible:)`)
  for (const c of all.slice(0, 50) as any[]) {
    console.log(`     · [${String(c.program ?? '—').padEnd(18)}] ${String(c.title).slice(0, 46)}`)
  }
  await mongoose.disconnect(); process.exit(0)
}
for (const c of courses as any[]) console.log(`     · ${String(c.title).slice(0, 50).padEnd(50)} [${c.program}]`)

/* ── live classes for those courses, inside the window ── */
const courseIds = courses.map(c => c._id)
const WINDOW = { courseId: { $in: courseIds }, scheduledStart: { $gte: fromUTC, $lt: toUTC } }
const targetClasses = await LiveClassModel.find(WINDOW)
  .select('_id title scheduledStart status').sort({ scheduledStart: 1 }).lean()
const total = targetClasses.length

const byStatus = new Map<string, number>()
for (const lc of targetClasses as any[]) byStatus.set(lc.status, (byStatus.get(lc.status) ?? 0) + 1)
console.log(`\n  Live classes in window: ${total}`)
if (total) console.log(`     by status: ${[...byStatus].map(([s, n]) => `${s}=${n}`).join('   ')}`)
for (const lc of targetClasses.slice(0, 25) as any[]) {
  console.log(`     ${inDubai(lc.scheduledStart)}  ${String(lc.status ?? '').padEnd(9)} ${String(lc.title).slice(0, 44)}`)
}
if (total > 25) console.log(`     …and ${total - 25} more`)
if (total === 0) {
  console.log('\n  Nothing in this window to delete.\n')
  await mongoose.disconnect(); process.exit(0)
}

/* ── dependants tied to exactly these classes ── */
const classIds = targetClasses.map(c => c._id)
const deps: { model: string; label: string; count: number }[] = []
for (const d of DEPENDANTS) {
  try {
    const c = await mongoose.model(d.model).countDocuments({ liveClassId: { $in: classIds } })
    if (c > 0) deps.push({ model: d.model, label: d.label, count: c })
  } catch { /* model not registered in this build — skip */ }
}
if (deps.length) {
  console.log('\n  Rows attached to these classes (would be orphaned):')
  for (const d of deps) console.log(`     ${String(d.count).padStart(6)}  ${d.label}  (${d.model})`)
  console.log(CASCADE ? '\n  --cascade is set: these are deleted too (each backed up first).'
                      : '\n  Left in place. Add --cascade to remove them as well.')
}

/* ── interlock ── */
if (!APPLY) {
  console.log(`\n  REPORT ONLY — nothing was deleted.`)
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
const tag = `${ORG_SLUG}-${PROGRAMS.join('+')}-${FROM}_${TO}`
const { EJSON } = mongoose.mongo.BSON

async function backupAndDelete(modelName: string, q: Record<string, unknown>, label: string) {
  const model = mongoose.model(modelName)
  const rows = await model.collection.find(q).toArray()
  if (rows.length === 0) { console.log(`    ${label}: none`); return }
  const file = join(dir, `${model.collection.collectionName}_${tag}_${stamp}.ejson.gz`)
  writeFileSync(file, gzipSync(Buffer.from(
    EJSON.stringify({ collection: model.collection.collectionName, takenAt: new Date().toISOString(), documents: rows }, { relaxed: false }), 'utf8')))
  const res = await model.deleteMany(q)
  console.log(`    ${label}: ${res.deletedCount} deleted  (backup: ${file.split(/[\\/]/).pop()})`)
}

console.log('\n  Working…')
if (CASCADE) {
  for (const d of deps) await backupAndDelete(d.model, { liveClassId: { $in: classIds } }, d.label)
}
await backupAndDelete('LiveClass', { _id: { $in: classIds } }, `${ORG_SLUG} ${PROGRAMS.join('/')} live classes`)

const left = await LiveClassModel.countDocuments(WINDOW)
console.log(`\n  Remaining in window: ${left}`)
if (!CASCADE && deps.length) {
  console.log(`  ⚠  ${deps.reduce((a, d) => a + d.count, 0)} attached row(s) now reference deleted classes — re-run with --cascade to clear them.`)
}
console.log(`  Backups in ${dir}\n`)

await mongoose.disconnect()
process.exit(0)
