/* ─────────────────────────────────────────────────────────────
   Deep-copy courses from one organisation to another.

   A course is a tree — Course → Sections → Lessons, plus Quizzes and
   Assignments attached per lesson. This clones the whole tree into the target
   org with fresh ids, reusing the same text and the same content URLs
   (thumbnails, videos, PDFs point at the identical assets — the content is the
   same, only the org differs).

   What is deliberately BLANKED on each copy (user decision):
     · instructorId → a placeholder instructor in the TARGET org (the field is
       required, so it cannot be null; the copy is parked on a placeholder)
     · price / priceAED / priceINR → 0 / unset, isFree = false
     · status → draft   (not live, not sellable until an admin sets the real
       instructor + price and publishes)
     · enrolledCount / ratingAvg / ratingCount → 0 (fresh course)

   ADDITIVE ONLY: it inserts new documents. It never modifies or deletes the
   source courses or anything already in the target org. Idempotent: a source
   course whose title already exists in the target org is skipped, so re-running
   never duplicates.

   Report-only unless --apply. Every run writes a CSV to .logs/import-reports/.

   Usage (from backend/):
     bun src/scripts/copy-courses-to-org.ts --from=dubai --to=bangalore
     bun src/scripts/copy-courses-to-org.ts --from=dubai --to=bangalore --exclude="Course Title"
     bun src/scripts/copy-courses-to-org.ts --from=dubai --to=bangalore --exclude="A,B" --instructor=someone@blr --apply
   Flags:
     --exclude=   comma-separated course titles / slugs / ids to NOT copy
     --instructor= email of the target-org instructor to park copies on
                   (defaults to the only instructor in the target org)
     --skip-empty  don't copy source courses that have zero lessons
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const FROM       = (args.get('from') ?? 'dubai').toLowerCase()
const TO         = (args.get('to')   ?? 'bangalore').toLowerCase()
const APPLY      = args.has('apply')
const SKIP_EMPTY = args.has('skip-empty')
const INSTRUCTOR = args.get('instructor')?.trim().toLowerCase()
const EXCLUDE = (args.get('exclude') ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

if (FROM === TO) { console.error('❌ --from and --to must be different orgs.'); process.exit(1) }

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const db = mongoose.connection.db!
await import('@/models/schema.ts')
const {
  OrganizationModel, UserModel, CourseModel, SectionModel, LessonModel,
  QuizModel, AssignmentModel,
} = await import('@/models/schema.ts')

console.log('═'.repeat(66))
console.log(`  Mode:     ${APPLY ? 'APPLY — copies will be created' : 'REPORT ONLY'}`)
console.log(`  Database: ${db.databaseName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Copy:     ${FROM}  →  ${TO}`)
console.log('═'.repeat(66))

const fromOrg = await OrganizationModel.findOne({ slug: FROM }).select('_id name').lean()
const toOrg   = await OrganizationModel.findOne({ slug: TO }).select('_id name').lean()
if (!fromOrg) { console.error(`❌ Source org "${FROM}" not found.`); await mongoose.disconnect(); process.exit(1) }
if (!toOrg)   { console.error(`❌ Target org "${TO}" not found.`);   await mongoose.disconnect(); process.exit(1) }

/* ── placeholder instructor in the target org ── */
const toInstructors = await UserModel.find({ organizationId: toOrg._id, role: 'instructor' })
  .select('_id name email').lean()
let placeholder = INSTRUCTOR
  ? toInstructors.find(u => (u.email as string).toLowerCase() === INSTRUCTOR)
  : (toInstructors.length === 1 ? toInstructors[0] : undefined)
if (!placeholder) {
  console.error(`\n❌ Could not choose a placeholder instructor for "${TO}".`)
  if (toInstructors.length === 0) console.error(`   No instructors exist in that org — create one first, or pass --instructor=<email>.`)
  else {
    console.error(`   Pass --instructor=<email>. Instructors in ${TO}:`)
    toInstructors.forEach(u => console.error(`     · ${u.email}  (${u.name})`))
  }
  await mongoose.disconnect(); process.exit(1)
}
console.log(`\n  Placeholder instructor: ${(placeholder as any).name} <${(placeholder as any).email}>`)

/* ── existing target titles (for idempotent skip) ── */
const existingTitles = new Set(
  (await CourseModel.find({ organizationId: toOrg._id }).select('title').lean())
    .map(c => String(c.title).trim().toLowerCase()),
)

/* ── source courses ── */
const sources = await CourseModel.find({ organizationId: fromOrg._id }).lean()
console.log(`\n  Source courses in ${FROM}: ${sources.length}`)
if (EXCLUDE.length) console.log(`  Excluding: ${EXCLUDE.join(', ')}`)

const isExcluded = (c: any) =>
  EXCLUDE.includes(String(c.title).trim().toLowerCase()) ||
  EXCLUDE.includes(String(c.slug).toLowerCase()) ||
  EXCLUDE.includes(String(c._id))

async function uniqueSlug(base: string): Promise<string> {
  let slug = `${base}-blr`.toLowerCase()
  let n = 1
  while (await CourseModel.exists({ slug })) { n++; slug = `${base}-blr-${n}`.toLowerCase() }
  return slug
}
const strip = (doc: any) => { const { _id, id, __v, createdAt, updatedAt, ...rest } = doc; return rest }

interface Row { title: string; action: string; detail: string }
const rows: Row[] = []
let created = 0

for (const src of sources as any[]) {
  const lessonCount = await LessonModel.countDocuments({ courseId: src._id })
  if (isExcluded(src)) { rows.push({ title: src.title, action: 'excluded', detail: '--exclude' }); continue }
  if (existingTitles.has(String(src.title).trim().toLowerCase())) {
    rows.push({ title: src.title, action: 'skip', detail: 'already in target org' }); continue
  }
  if (SKIP_EMPTY && lessonCount === 0) { rows.push({ title: src.title, action: 'skip', detail: 'no lessons (--skip-empty)' }); continue }

  const secs = await SectionModel.find({ courseId: src._id }).sort({ order: 1 }).lean()
  const les  = await LessonModel.find({ courseId: src._id }).lean()
  const qz   = await QuizModel.find({ courseId: src._id }).lean()
  const asg  = await AssignmentModel.find({ courseId: src._id }).lean()

  if (!APPLY) {
    rows.push({ title: src.title, action: 'would copy', detail: `${secs.length} sec · ${les.length} les · ${qz.length} qz · ${asg.length} asg` })
    continue
  }

  try {
  /* create the course */
  const slug = await uniqueSlug(String(src.slug))
  const courseData = strip(src)
  const newCourse = await CourseModel.create({
    ...courseData,
    slug,
    organizationId: toOrg._id,
    instructorId:   (placeholder as any)._id,
    price: 0, isFree: false,
    status: 'draft',
    enrolledCount: 0, ratingAvg: 0, ratingCount: 0,
  })
  await CourseModel.updateOne({ _id: newCourse._id }, { $unset: { priceAED: '', priceINR: '' } })

  /* sections (map old id → new id) */
  const secMap = new Map<string, mongoose.Types.ObjectId>()
  for (const s of secs) {
    const ns = await SectionModel.create({ ...strip(s), courseId: newCourse._id })
    secMap.set(String(s._id), ns._id as mongoose.Types.ObjectId)
  }
  /* lessons (map old id → new id, re-point section + course) */
  const lesMap = new Map<string, mongoose.Types.ObjectId>()
  for (const l of les) {
    const newSec = secMap.get(String(l.sectionId))
    if (!newSec) continue   // orphan lesson with no section — skip
    const nl = await LessonModel.create({ ...strip(l), courseId: newCourse._id, sectionId: newSec })
    lesMap.set(String(l._id), nl._id as mongoose.Types.ObjectId)
  }
  /* quizzes + assignments (re-point lesson + course) */
  let qzCopied = 0, asgCopied = 0
  for (const q of qz) {
    const newLes = lesMap.get(String(q.lessonId))
    if (!newLes) continue
    await QuizModel.create({ ...strip(q), courseId: newCourse._id, lessonId: newLes }); qzCopied++
  }
  for (const a of asg) {
    const newLes = lesMap.get(String(a.lessonId))
    if (!newLes) continue
    await AssignmentModel.create({ ...strip(a), courseId: newCourse._id, lessonId: newLes }); asgCopied++
  }

  created++
  rows.push({ title: src.title, action: 'copied', detail: `→ ${slug}  (${secMap.size} sec · ${lesMap.size} les · ${qzCopied} qz · ${asgCopied} asg)` })
  } catch (err: any) {
    /* One bad source course must not abort the whole batch. Report it and move
       on; because inserts are ordered (course → sections → lessons → quizzes),
       a mid-way failure may leave a partial draft — the report names it so it
       can be removed by hand. */
    rows.push({ title: src.title, action: 'ERROR', detail: String(err?.message ?? err).slice(0, 120) })
  }
}

/* ── report ── */
console.log('\n  Result:')
for (const r of rows) console.log(`    ${r.action.padEnd(11)} ${String(r.title).slice(0, 40).padEnd(40)} ${r.detail}`)
const summary = rows.reduce<Record<string, number>>((a, r) => { a[r.action] = (a[r.action] ?? 0) + 1; return a }, {})
console.log('\n  ' + Object.entries(summary).map(([k, v]) => `${v} ${k}`).join('  ·  '))

const dir = join(process.cwd(), '.logs', 'import-reports')
mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const path  = join(dir, `copy-courses-${FROM}-to-${TO}-${stamp}.csv`)
const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
writeFileSync(path, ['title,action,detail', ...rows.map(r => [r.title, r.action, r.detail].map(v => esc(String(v))).join(','))].join('\n'), 'utf8')
console.log(`\n  Report: ${path}`)
if (!APPLY) console.log(`  Nothing was created. Add --apply to copy${EXCLUDE.length ? '' : ' (and --exclude="…" to leave one out)'}.\n`)
else console.log(`  Created ${created} course(s) in ${TO} as drafts with price 0 — set instructor + price per course, then publish.\n`)

await mongoose.disconnect()
process.exit(0)
