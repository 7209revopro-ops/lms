/* ─────────────────────────────────────────────────────────────
   Delete ONE course and its tree (sections → lessons → quizzes →
   assignments), by slug (or id), optionally scoped to an org.

   Built to remove a course copy that was created by mistake. It is deliberately
   cautious about deleting a course real students use:

     · resolves EXACTLY one course (slug is unique; --org adds a guard)
     · refuses if the course has enrolments, reviews or lesson progress, unless
       --force is given — so an empty draft copy deletes freely while a live
       course with students cannot be nuked by accident
     · backs up the course and every child document to .logs/deleted/ BEFORE
       removing anything
     · report-only unless --apply

   Usage (from backend/):
     bun src/scripts/delete-course.ts --slug=uae-labour-law-hr-compliance-blr --org=bangalore
     …then add --apply
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
const SLUG  = args.get('slug')?.trim().toLowerCase()
const ID    = args.get('id')?.trim()
const ORG   = args.get('org')?.trim().toLowerCase()
const APPLY = args.has('apply')
const FORCE = args.has('force')
if (!SLUG && !ID) { console.error('❌ Give --slug=<course-slug> or --id=<courseId>.'); process.exit(1) }

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const db = mongoose.connection.db!
await import('@/models/schema.ts')
const {
  OrganizationModel, CourseModel, SectionModel, LessonModel, QuizModel,
  AssignmentModel, EnrollmentModel, ReviewModel, LessonProgressModel,
} = await import('@/models/schema.ts')

console.log('═'.repeat(64))
console.log(`  Mode:     ${APPLY ? 'APPLY — the course will be deleted' : 'REPORT ONLY'}`)
console.log(`  Database: ${db.databaseName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log('═'.repeat(64))

const query: Record<string, unknown> = ID ? { _id: ID } : { slug: SLUG }
if (ORG) {
  const org = await OrganizationModel.findOne({ slug: ORG }).select('_id').lean()
  if (!org) { console.error(`❌ Org "${ORG}" not found.`); await mongoose.disconnect(); process.exit(1) }
  query['organizationId'] = org._id
}
const matches = await CourseModel.find(query).select('_id title slug status organizationId').lean()
if (matches.length !== 1) {
  console.error(`\n❌ Expected exactly one course, found ${matches.length}${ORG ? ` in org "${ORG}"` : ''}.`)
  matches.forEach(c => console.error(`     · ${c.title}  [${c.slug}]  ${String(c._id)}`))
  await mongoose.disconnect(); process.exit(1)
}
const course = matches[0]!
const cid = course._id

const [sections, lessons, quizzes, assignments, enrols, reviews, progress] = await Promise.all([
  SectionModel.find({ courseId: cid }).lean(),
  LessonModel.find({ courseId: cid }).lean(),
  QuizModel.find({ courseId: cid }).lean(),
  AssignmentModel.find({ courseId: cid }).lean(),
  EnrollmentModel.countDocuments({ courseId: cid }),
  ReviewModel.countDocuments({ courseId: cid }),
  LessonProgressModel.countDocuments({ courseId: cid }),
])

console.log(`\n  Course:  ${course.title}  [${course.slug}]`)
console.log(`  Status:  ${course.status}`)
console.log(`  Tree:    ${sections.length} sections · ${lessons.length} lessons · ${quizzes.length} quizzes · ${assignments.length} assignments`)
console.log(`  Student data: ${enrols} enrolments · ${reviews} reviews · ${progress} progress records`)

const studentData = enrols + reviews + progress
if (studentData > 0 && !FORCE) {
  console.error(`\n❌ This course has ${studentData} student-data record(s). Refusing to delete without --force.`)
  console.error(`   (A freshly copied draft has zero — if this shows a number, make sure it is the right course.)`)
  await mongoose.disconnect(); process.exit(1)
}

if (!APPLY) {
  console.log(`\n  Nothing was deleted. Re-run with --apply${studentData > 0 ? ' --force' : ''} to remove it.\n`)
  await mongoose.disconnect(); process.exit(0)
}

/* backup everything first */
const dir = join(process.cwd(), '.logs', 'deleted')
mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const { EJSON } = mongoose.mongo.BSON
const payload = { course, sections, lessons, quizzes, assignments, takenAt: new Date().toISOString() }
const file = join(dir, `course_${course.slug}_${stamp}.ejson.gz`)
writeFileSync(file, gzipSync(Buffer.from(EJSON.stringify(payload, { relaxed: false }), 'utf8')))
console.log(`\n  Backed up to ${file}`)

const lessonIds = lessons.map(l => l._id)
const r = {
  quizzes:     (await QuizModel.deleteMany({ courseId: cid })).deletedCount,
  assignments: (await AssignmentModel.deleteMany({ courseId: cid })).deletedCount,
  lessons:     (await LessonModel.deleteMany({ courseId: cid })).deletedCount,
  sections:    (await SectionModel.deleteMany({ courseId: cid })).deletedCount,
  ...(FORCE ? {
    enrolments: (await EnrollmentModel.deleteMany({ courseId: cid })).deletedCount,
    reviews:    (await ReviewModel.deleteMany({ courseId: cid })).deletedCount,
    progress:   (await LessonProgressModel.deleteMany({ courseId: cid })).deletedCount,
  } : {}),
}
void lessonIds
await CourseModel.deleteOne({ _id: cid })

console.log(`\n  ✅ Deleted "${course.title}"`)
for (const [k, v] of Object.entries(r)) console.log(`     ${k}: ${v}`)
console.log(`     course: 1\n`)

await mongoose.disconnect()
process.exit(0)
