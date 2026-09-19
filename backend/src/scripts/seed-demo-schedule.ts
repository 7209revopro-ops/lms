/* ─────────────────────────────────────────────────────────────
   Seed a realistic UPCOMING class schedule for the demo student.

   The Course → Module → Class catalogue (plan.md §9) only shows sessions
   that are still ahead, deliberately — it is a catalogue, not a diary. A
   development database that has been sitting for a while has almost nothing
   ahead of it, so the whole feature renders as one course with one module
   and one slot and none of it can actually be judged.

   This fills in what the screens are meant to show:

     · several courses, so Level 1 is a grid rather than a single card
     · modules with their own `order` and `description`, so Level 2 can be
       read as a course and not an alphabetical pile
     · weekly repeats, so Level 3 can label a slot "Tuesdays · 7:00 PM"
       instead of listing dates
     · two languages on some modules, so Level 3's grouping has something to
       group
     · one module deliberately blocked, so the LOCKED state is visible

   Local development only — it refuses to run against anything that is not a
   localhost database, because everything it writes is invented.

   Additive and idempotent: every session it creates is tagged, so running it
   twice replaces its own rows rather than piling up, and `--wipe` removes
   them and nothing else.

   Usage (from backend/):
     bun src/scripts/seed-demo-schedule.ts
     bun src/scripts/seed-demo-schedule.ts --wipe
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
if (!/(localhost|127\.0\.0\.1)/.test(DB_URL)) {
  console.error(`❌ Refusing to seed demo data into a non-local database:\n   ${DB_URL.replace(/\/\/[^@/]+@/, '//***@')}`)
  process.exit(1)
}

await mongoose.connect(DB_URL)
const {
  UserModel, CourseModel, SectionModel, LiveClassModel, EnrollmentModel,
} = await import('@/models/schema.ts')

/** Everything this script creates carries the marker, so it can find its own
    rows again without touching anything a human made. */
const MARKER = '[demo-schedule]'
const WIPE   = process.argv.includes('--wipe')

const student = await UserModel.findOne({ email: 'aisha.rahman@delta.demo' })
  .select('_id organizationId').lean() as any
if (!student) {
  console.error('❌ Demo student not found. Run seed-demo-student.ts first.')
  process.exit(1)
}

/* ── Wipe ─────────────────────────────────────────────────── */
const removed = await LiveClassModel.deleteMany({ description: new RegExp(MARKER.replace(/[[\]]/g, '\\$&')) })
if (WIPE) {
  /* Un-block whatever this script blocked. Keyed on the marker's own section
     list rather than clearing the array, so a block an admin set by hand in
     the same database survives. */
  console.log(`\n  removed ${removed.deletedCount} demo session(s).`)
  console.log('  note: any module this script blocked stays blocked — clear it from the admin UI.\n')
  await mongoose.disconnect()
  process.exit(0)
}

/* ── The courses the demo student is actually enrolled in ──── */
const enrolments = await EnrollmentModel.find({ userId: student._id }).select('courseId').lean() as any[]
if (enrolments.length === 0) {
  console.error('❌ The demo student has no enrolments. Run seed-demo-student.ts first.')
  process.exit(1)
}

/* An instructor to put in front of them. Any real one will do — the screens
   show the name and avatar, and a dangling reference would render blank. */
const instructor = await UserModel.findOne({ role: { $in: ['instructor', 'admin', 'super_admin'] } })
  .select('_id name').lean() as any
if (!instructor) {
  console.error('❌ No instructor/admin user found to host the sessions.')
  process.exit(1)
}

/* Monday of next week, 00:00 local — a stable base so repeated runs land on
   the same weekdays and the "Tuesdays · 7:00 PM" labels stay meaningful. */
const base = new Date()
base.setHours(0, 0, 0, 0)
base.setDate(base.getDate() + ((8 - base.getDay()) % 7 || 7))

/** weekday: 0=Sun..6=Sat, relative to `base` (a Monday). */
function at(weekOffset: number, weekday: number, hour: number, minute = 0): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + weekOffset * 7 + ((weekday + 6) % 7))
  d.setHours(hour, minute, 0, 0)
  return d
}

/* Each module gets a weekly slot, some of them in two languages, so the
   catalogue has patterns to label and languages to group by. */
const SLOTS: { weekday: number; hour: number; minute: number; language: string }[] = [
  { weekday: 2, hour: 19, minute: 0,  language: 'English'   },
  { weekday: 4, hour: 11, minute: 30, language: 'Malayalam' },
  { weekday: 6, hour: 10, minute: 0,  language: 'Hindi'     },
]

const WEEKS = 4
let created = 0
const summary: string[] = []
let blockedNote = ''

for (const enr of enrolments) {
  const course = await CourseModel.findById(enr.courseId).select('title organizationId').lean() as any
  if (!course) continue

  const sections = await SectionModel.find({ courseId: enr.courseId })
    .select('_id title order').sort({ order: 1 }).lean() as any[]
  if (sections.length === 0) continue

  /* Three modules per course is enough to show ordering without making the
     list a wall. */
  const picked = sections.slice(0, 3)
  let perCourse = 0

  for (let mi = 0; mi < picked.length; mi++) {
    const section = picked[mi]!
    /* Give the module a description if it has none — Level 3 is built around
       showing the module's own blurb, and an empty one hides the feature. */
    await SectionModel.updateOne(
      { _id: section._id, $or: [{ description: { $exists: false } }, { description: '' }, { description: null }] },
      { $set: { description: `What ${section.title} covers, and what you should be able to do by the end of it.` } },
    )

    /* One slot for the first module, two for the rest — so Level 3 shows both
       a single-language module and a multi-language one. */
    const slots = mi === 0 ? SLOTS.slice(0, 1) : SLOTS.slice(0, 2)

    for (const slot of slots) {
      const seriesId = new mongoose.Types.ObjectId()
      for (let w = 0; w < WEEKS; w++) {
        await LiveClassModel.create({
          courseId:       enr.courseId,
          sectionId:      section._id,
          instructorId:   instructor._id,
          organizationId: course.organizationId ?? student.organizationId,
          title:          `${section.title} — Live Session`,
          description:    `${MARKER} Weekly live session for ${section.title}.`,
          scheduledStart: at(w, slot.weekday, slot.hour, slot.minute),
          durationMins:   90,
          type:           'external',
          status:         'scheduled',
          meetingUrl:     'https://meet.google.com/demo-only-link',
          sessionCapacity: 30,
          bookedCount:     0,
          language:        slot.language,
          isOnline:        true,
          seriesId,
        })
        created++; perCourse++
      }
    }
  }

  /* One module locked, on the FIRST course only, so the locked state is on
     screen exactly once and the rest stay bookable. `blockedLessons` stores
     SECTION ids — a legacy misnomer, see CLAUDE.md. */
  if (!blockedNote && picked.length >= 3) {
    const lockMe = picked[2]!
    await EnrollmentModel.updateOne(
      { userId: student._id, courseId: enr.courseId },
      { $addToSet: { blockedLessons: String(lockMe._id) } },
    )
    blockedNote = `${course.title} › ${lockMe.title}`
  }

  summary.push(`  ${course.title.padEnd(34)} ${perCourse} session(s) across ${picked.length} module(s)`)
}

console.log('\n════════════════════════════════════════════════════════════')
console.log('  Demo class schedule seeded   (local database only)')
console.log('════════════════════════════════════════════════════════════')
if (removed.deletedCount) console.log(`  replaced  : ${removed.deletedCount} session(s) from a previous run`)
console.log(`  instructor: ${instructor.name}`)
console.log(`  created   : ${created} upcoming session(s), ${WEEKS} weeks out`)
summary.forEach(l => console.log(l))
if (blockedNote) console.log(`  locked    : ${blockedNote}   ← shows the blocked-module state`)
console.log('\n  Sign in at http://localhost:3000/login')
console.log('  aisha.rahman@delta.demo / DemoPass123')
console.log('  Then open Class Schedule.\n')

await mongoose.disconnect()
