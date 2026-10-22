/* The portal's Instructor Reviews (2026-10-22): the leaderboard across academies carries each instructor's address,
   and one instructor's reviews come with student and class. Run: bun --no-env-file src/tests/portalinstructorreviews.suite.ts */
process.env.DATABASE_URL = process.env.PORTALREVIEWS_DB_URL || 'mongodb://localhost:27017/lms_portalinstructorreviews'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'portalinstructorreviews-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalinstructorreviews-suite-refresh-secret-0123456789'
export {}
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { InstructorReviewService } = await import('@/services/instructorReview.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_portalinstructorreviews') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const dubai = new mongoose.Types.ObjectId(), blr = new mongoose.Types.ObjectId()
  await M.UserModel.collection.insertMany([
    { name: 'HAFFIS', email: 'haf@r.local', role: 'instructor', organizationId: dubai, createdAt: new Date(), updatedAt: new Date() },
    { name: 'TONY', email: 'tony@r.local', role: 'instructor', organizationId: blr, createdAt: new Date(), updatedAt: new Date() },
    { name: 'Stu', email: 'stu@r.local', role: 'student', organizationId: dubai, createdAt: new Date(), updatedAt: new Date() },
  ] as any)
  const cls = new mongoose.Types.ObjectId()
  const ids = await M.UserModel.collection.find({}).toArray() as any[]
  const haf = ids.find((u: any) => u.email === 'haf@r.local'), tony = ids.find((u: any) => u.email === 'tony@r.local'), stu = ids.find((u: any) => u.email === 'stu@r.local')
  await M.InstructorReviewModel.collection.deleteMany({})
  await M.InstructorReviewModel.collection.insertMany([
    { instructorId: haf._id, rating: 5, comment: 'Great', studentId: stu._id, liveClassId: cls, organizationId: dubai, createdAt: new Date(), updatedAt: new Date() },
    { instructorId: tony._id, rating: 2, comment: 'Late', studentId: stu._id, liveClassId: cls, organizationId: blr, createdAt: new Date(), updatedAt: new Date() },
  ] as any)
  const svc = new InstructorReviewService()
  const board = await svc.leaderboard(undefined, undefined)
  check('both academies on the board', board.length === 2, JSON.stringify(board))
  check('each with their address', board.find(r => r.name === 'TONY')?.email === 'tony@r.local')
  check('a low rating counted', board.find(r => r.name === 'TONY')?.lowRatingCount === 1)
  const one = await svc.listForInstructor(String(haf._id), undefined, undefined, 1, 50)
  check("one instructor's reviews", one.totalCount === 1 && (one.docs[0] as any).comment === 'Great')
} catch (err) { fail++; console.log('  FAIL threw', err) } finally {
  await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
