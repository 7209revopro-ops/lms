/* ─────────────────────────────────────────────────────
   Two duplicate student accounts, for trying the Duplicates page
   (admin /duplicates, services/accountMerge.service.ts) by hand.

     A  testdup@gmail.com   — the real one: signed up, email verified, registration filled
     B  testdup@gamil.com   — the typo one: never verified, express, has a course and a booking
   Same phone, typed two ways (+971 50 777 1234 / 0507771234).

   Sign-in (student site):  A → TestDup1234   B → TypoDup1234
   Admin site (Duplicates is super admin only): lms@admin.local or qa.super@lms.local, both
   super admins in lms_qa_reviews, with the seed admin's password (SEED_ADMIN_PASSWORD in
   src/scripts/seed.ts).
   Re-running resets the pair (both accounts, their rows and any merge of them).

   ONLY for a test database — refuses any database whose name does not start with "lms_qa".
   Run: bun --no-env-file src/scripts/seed-duplicate-test-accounts.ts [mongodb-url]
        (default mongodb://localhost:27017/lms_qa_reviews)
───────────────────────────────────────────────────── */
export {}
const url = process.argv[2] ?? 'mongodb://localhost:27017/lms_qa_reviews'
process.env.DATABASE_URL ??= url
process.env.JWT_ACCESS_SECRET  ??= 'seed-duplicates-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'seed-duplicates-refresh-secret-0123456789'

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(url)
const db = mongoose.connection.db!
if (!db.databaseName.startsWith('lms_qa')) {
  console.error(`REFUSING: "${db.databaseName}" is not a test database (lms_qa…).`)
  process.exit(1)
}

const EMAILS = ['testdup@gmail.com', 'testdup@gamil.com']
const users = db.collection('users')

/* Reset: the pair, everything that points at them, and merges of them. */
const old = await users.find({ email: { $in: EMAILS } }).project({ _id: 1 }).toArray()
const oldIds = old.map(u => u._id)
if (oldIds.length) {
  for (const c of ['enrollments', 'classbookings', 'devices', 'refreshtokens', 'authtokens', 'notifications', 'lessonprogresses']) {
    await db.collection(c).deleteMany({ userId: { $in: oldIds } })
  }
  await db.collection('accountmerges').deleteMany({ $or: [{ primaryId: { $in: oldIds } }, { secondaryId: { $in: oldIds } }] })
  await db.collection('duplicatedismissals').deleteMany({ userIds: { $in: oldIds } })
  await users.deleteMany({ _id: { $in: oldIds } })
}

const dubai = await db.collection('organizations').findOne({ slug: 'dubai' })
const now = new Date()
const a = await users.insertOne({
  name: 'Test Duplicate', email: EMAILS[0], passwordHash: await hashPassword('TestDup1234'),
  role: 'student', isActive: true, isVerified: true, signupType: 'full', enrollmentStatus: 'approved',
  categories: ['4x-trading'], organizationId: dubai?._id, lastLoginAt: now,
  enrollmentApplication: { phone: '+971 50 777 1234', idNumber: '784-1995-7771234-1', dateOfBirth: '1995-05-05', city: 'Dubai', homeCountry: 'United Arab Emirates' },
  failedLoginAttempts: 0, createdAt: new Date(Date.now() - 20 * 86400_000), updatedAt: now,
})
const b = await users.insertOne({
  name: 'TEST DUPLICATE', email: EMAILS[1], passwordHash: await hashPassword('TypoDup1234'),
  role: 'student', isActive: true, isVerified: false, signupType: 'express', enrollmentStatus: 'approved',
  categories: ['digital-marketing'], organizationId: dubai?._id, phone: '0507771234',
  failedLoginAttempts: 0, createdAt: new Date(Date.now() - 40 * 86400_000), updatedAt: now,
})

/* Something on the typo account to see move: a course, and a booking on an upcoming class. */
const course = await db.collection('courses').findOne({ status: 'published', ...(dubai ? { organizationId: dubai._id } : {}) })
if (course) await db.collection('enrollments').insertOne({ userId: b.insertedId, courseId: course._id, organizationId: dubai?._id, status: 'active', source: 'admin', progressPercent: 35, enrolledAt: now, createdAt: now, updatedAt: now })
const live = await db.collection('liveclasses').findOne({ scheduledAt: { $gt: now } }, { sort: { scheduledAt: 1 } })
  ?? await db.collection('liveclasses').findOne({})
if (live) await db.collection('classbookings').insertOne({ userId: b.insertedId, liveClassId: live._id, status: 'booked', bookedAt: now, createdAt: now, updatedAt: now })

console.log(`Seeded in ${db.databaseName}:`)
console.log(`  A ${EMAILS[0]}  id ${a.insertedId}  (verified, full registration)`)
console.log(`  B ${EMAILS[1]}  id ${b.insertedId}  (unverified, express)${course ? ` · course "${course['title']}"` : ''}${live ? ` · booking "${live['title'] ?? live._id}"` : ''}`)
await mongoose.disconnect()
