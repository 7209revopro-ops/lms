/* ─────────────────────────────────────────────────────────────
   Seed ONE realistic demo student for the tutorial recording.

   Local development only — it refuses to run against anything that is not a
   localhost database, because its whole job is to invent plausible-looking
   activity and none of that belongs in production.

   Additive: it never drops a collection and never touches another user. Run
   it twice and you get the same student, not two.

   Usage (from backend/):
     bun src/scripts/seed-demo-student.ts
     bun src/scripts/seed-demo-student.ts --wipe    # remove the demo student
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import bcrypt from 'bcrypt'

const EMAIL    = 'aisha.rahman@delta.demo'
const PASSWORD = 'DemoPass123'
const NAME     = 'Aisha Rahman'

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
if (!/(localhost|127\.0\.0\.1)/.test(DB_URL)) {
  console.error(`❌ Refusing to seed demo data into a non-local database:\n   ${DB_URL.replace(/\/\/[^@/]+@/, '//***@')}`)
  process.exit(1)
}

await mongoose.connect(DB_URL)
const db = mongoose.connection.db!
const {
  UserModel, OrganizationModel, CourseModel, SectionModel, LessonModel,
  EnrollmentModel, LessonProgressModel, UserStreakModel, UserAchievementModel,
  NotificationModel, FavoriteModel, LiveClassModel, ClassBookingModel,
} = await import('@/models/schema.ts')

const WIPE = process.argv.includes('--wipe')
const existing = await UserModel.findOne({ email: EMAIL }).select('_id').lean()

if (WIPE) {
  if (existing) {
    const id = existing._id
    for (const m of [EnrollmentModel, LessonProgressModel, UserStreakModel,
                     UserAchievementModel, NotificationModel, FavoriteModel, ClassBookingModel]) {
      await (m as typeof EnrollmentModel).deleteMany({ userId: id })
    }
    await UserModel.deleteOne({ _id: id })
    console.log(`removed demo student ${EMAIL} and their activity`)
  } else console.log('nothing to remove')
  await mongoose.disconnect(); process.exit(0)
}

console.log('═'.repeat(60))
console.log(`  Database: ${db.databaseName}   (local only)`)
console.log('═'.repeat(60))

/* ── the student ── */
const org = await OrganizationModel.findOne({ slug: 'dubai' }).select('_id').lean()
const passwordHash = await bcrypt.hash(PASSWORD, 10)
const user = await UserModel.findOneAndUpdate(
  { email: EMAIL },
  {
    $set: {
      name: NAME, email: EMAIL, passwordHash, role: 'student',
      isActive: true, isVerified: true, signupType: 'full',
      enrollmentStatus: 'approved', category: '4x-trading',
      categories: ['4x-trading', 'digital-marketing'],
      approvedByName: 'Admin Team', approvedByRole: 'admin', approvedAt: new Date(),
      ...(org ? { organizationId: org._id } : {}),
      headline: 'Trading student',
      enrollmentApplication: {
        phone: '971501234567', gender: 'Female', dateOfBirth: '1996-04-12',
        nationality: 'Indian', homeCountry: 'India', occupation: 'Marketing Executive',
        countryAttendance: 'UAE', city: 'Dubai', addressCountry: 'UAE',
        idType: 'Emirates ID', experienceLevel: 'Beginner',
      },
    },
  },
  { upsert: true, new: true },
)
console.log(`  student : ${NAME} <${EMAIL}>  (password: ${PASSWORD})`)

/* ── enrolments with believable progress ── */
const courses = await CourseModel.find({}).select('_id title').limit(3).lean()
let lessonsDone = 0
for (const [i, c] of courses.entries()) {
  const sections = await SectionModel.find({ courseId: c._id }).sort({ order: 1 }).select('_id').lean()
  const lessons  = await LessonModel.find({ courseId: c._id }).sort({ order: 1 }).select('_id').lean()
  /* first course well under way, second just started, third untouched */
  const pct   = [62, 18, 0][i] ?? 0
  const done  = Math.floor(lessons.length * pct / 100)

  await EnrollmentModel.findOneAndUpdate(
    { userId: user._id, courseId: c._id },
    { $set: { status: 'active', progressPercent: pct, enrolledAt: new Date(Date.now() - (30 - i * 9) * 864e5),
              blockedLessons: [], ...(org ? { organizationId: org._id } : {}) } },
    { upsert: true },
  )
  for (const [j, l] of lessons.slice(0, done).entries()) {
    await LessonProgressModel.findOneAndUpdate(
      { userId: user._id, lessonId: l._id },
      { $set: { courseId: c._id, isCompleted: true, watchTimeSecs: 420 + j * 17,
                completedAt: new Date(Date.now() - (done - j) * 864e5) } },
      { upsert: true },
    )
    lessonsDone++
  }
  console.log(`  course  : ${String(c.title).slice(0, 38).padEnd(38)} ${pct}%  (${done}/${lessons.length} lessons, ${sections.length} modules)`)
}

/* ── streak ── */
const today = new Date()
const iso = (d: Date) => d.toISOString().slice(0, 10)
const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
await UserStreakModel.findOneAndUpdate(
  { userId: user._id },
  { $set: { currentStreak: 12, longestStreak: 21, lastActiveDate: iso(today),
            totalDaysActive: 47, weeklyGoal: 5, weekProgress: 3, weekStartDate: iso(monday) } },
  { upsert: true },
)
console.log('  streak  : 12-day current, 21 best, 3 of 5 lessons this week')

/* ── achievements ── */
const badges = [
  { kind: 'first_lesson', title: 'First Steps',    description: 'Completed your first lesson', icon: '🎯', days: 30 },
  { kind: 'streak_7',     title: 'Week Warrior',   description: 'Seven days in a row',         icon: '🔥', days: 9  },
  { kind: 'quiz_pass',    title: 'Quiz Passed',    description: 'Passed your first quiz',      icon: '✅', days: 5  },
]
for (const b of badges) {
  await UserAchievementModel.findOneAndUpdate(
    { userId: user._id, kind: b.kind },
    { $set: { title: b.title, description: b.description, icon: b.icon,
              earnedAt: new Date(Date.now() - b.days * 864e5) } },
    { upsert: true },
  )
}
console.log(`  badges  : ${badges.length} earned`)

/* ── favourites ── */
for (const c of courses.slice(1, 3)) {
  await FavoriteModel.findOneAndUpdate({ userId: user._id, courseId: c._id }, { $set: {} }, { upsert: true })
}

/* ── a booked upcoming class ── */
const upcoming = await LiveClassModel.find({}).sort({ scheduledAt: 1 }).select('_id title').limit(2).lean()
for (const lc of upcoming) {
  await ClassBookingModel.findOneAndUpdate(
    { userId: user._id, liveClassId: lc._id },
    { $set: { status: 'booked', bookedAt: new Date() } },
    { upsert: true },
  )
}
console.log(`  bookings: ${upcoming.length} class seat(s) reserved`)

/* ── notifications ── */
await NotificationModel.deleteMany({ userId: user._id })
await NotificationModel.insertMany([
  { userId: user._id, kind: 'achievement', title: 'Achievement unlocked: Week Warrior',
    body: 'Seven days of learning in a row. Keep it going!', link: '/achievements',
    createdAt: new Date(Date.now() - 2 * 36e5) },
  { userId: user._id, kind: 'live-class-scheduled', title: 'New live class scheduled',
    body: 'A new session has been added to your schedule.', link: '/class-bookings',
    createdAt: new Date(Date.now() - 6 * 36e5) },
  { userId: user._id, kind: 'lesson-complete', title: 'Lesson completed',
    body: 'Nice work — your progress has been saved.', link: '/my-learning',
    readAt: new Date(), createdAt: new Date(Date.now() - 26 * 36e5) },
])
console.log('  notices : 3 (2 unread)')

console.log(`\n  Done. Sign in at http://localhost:3000/login`)
console.log(`  ${EMAIL} / ${PASSWORD}\n`)
await mongoose.disconnect()
process.exit(0)
