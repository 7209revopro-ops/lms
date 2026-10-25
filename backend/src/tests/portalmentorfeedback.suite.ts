/* The portal's Mentor Report reviews (2026-10-25: "the comments aren't visible"): a mentor's class feedback (the class
   page's Session feedback) counts and shows beside their mentor ratings — one per student per class, the mentor
   rating's stars when there are both, with the class comment kept. Run: bun --no-env-file src/tests/portalmentorfeedback.suite.ts */
process.env.DATABASE_URL = process.env.PORTALMENTORFEEDBACK_DB_URL || 'mongodb://localhost:27017/lms_portalmentorfeedback'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'portalmentorfeedback-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalmentorfeedback-suite-refresh-secret-0123456789'
export {}
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const j = (v: unknown) => JSON.stringify(v).slice(0, 400)
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { mentorReportForPortal, mentorReviewsForPortal } = await import('@/services/portalMentorReport.service.ts')
const { InstructorReviewService } = await import('@/services/instructorReview.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_portalmentorfeedback') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const at = (d: string, h = '12') => new Date(`2026-10-${d}T${h}:00:00+04:00`)
  const org = new mongoose.Types.ObjectId()
  const u = (name: string, email: string, role: string) => ({ _id: new mongoose.Types.ObjectId(), name, email, role, organizationId: org, createdAt: new Date(), updatedAt: new Date() })
  const ann = u('ANN', 'ann@f.local', 'instructor'), bob = u('BOB', 'bob@f.local', 'instructor')
  const s1 = u('Saif', 's1@f.local', 'student'), s2 = u('Nitish', 's2@f.local', 'student'), s3 = u('Hamda', 's3@f.local', 'student')
  await M.UserModel.collection.insertMany([ann, bob, s1, s2, s3] as any)
  const cls = (title: string, who: any, day: string) => ({ _id: new mongoose.Types.ObjectId(), title, instructorId: who._id, scheduledStart: at(day, '19'), status: 'ended', organizationId: org, createdAt: new Date(), updatedAt: new Date() })
  const c1 = cls('MBT 6', ann, '20'), c2 = cls('MBT 5', ann, '21'), c3 = cls('Bob class', bob, '21')
  await M.LiveClassModel.collection.insertMany([c1, c2, c3] as any)
  // Saif rated Ann's MBT 6 (no words) and left class feedback with words; Nitish only class feedback; Hamda only a mentor rating with words.
  await M.InstructorReviewModel.collection.insertMany([
    { instructorId: ann._id, studentId: s1._id, liveClassId: c1._id, rating: 5, createdAt: at('20', '20'), updatedAt: new Date() },
    { instructorId: ann._id, studentId: s3._id, liveClassId: c2._id, rating: 2, comment: 'Too fast', createdAt: at('21', '21'), updatedAt: new Date() },
  ] as any)
  await M.ClassFeedbackModel.collection.insertMany([
    { liveClassId: c1._id, userId: s1._id, rating: 4, comment: 'Clear explanations, thank you', createdAt: at('20', '20'), updatedAt: new Date() },
    { liveClassId: c2._id, userId: s2._id, rating: 5, comment: 'Best class so far', createdAt: at('21', '22'), updatedAt: new Date() },
    { liveClassId: c3._id, userId: s2._id, rating: 3, comment: 'Bob was ok', createdAt: at('21', '22'), updatedAt: new Date() },
    { liveClassId: c2._id, userId: s3._id, rating: 1, createdAt: at('25', '10'), updatedAt: new Date() },   // outside the dates; Hamda rated too
  ] as any)

  const report = await mentorReportForPortal({ from: '2026-10-20', to: '2026-10-22' })
  const annRow: any = report.mentors.find((m: any) => m.email === 'ann@f.local')
  check("Ann: 3 reviews — Saif's rating (not his feedback too), Hamda's rating, Nitish's class feedback", annRow?.total?.reviews === 3, j(annRow?.total))
  check('…average (5 + 2 + 5) / 3 = 4, one low, the stars counted', annRow?.total?.avgRating === 4 && annRow.total.lowRatings === 1
    && annRow.total.ratingCounts[5] === 2 && annRow.total.ratingCounts[2] === 1, j(annRow?.total))
  check('…on their days: the 20th 1, the 21st 2', annRow?.days?.find((d: any) => d.day === '2026-10-20')?.reviews === 1 && annRow.days.find((d: any) => d.day === '2026-10-21')?.reviews === 2, j(annRow?.days))
  check("Bob: his class's feedback is his", report.mentors.find((m: any) => m.email === 'bob@f.local')?.total?.reviews === 1)
  const named = await mentorReportForPortal({ from: '2026-10-20', to: '2026-10-22', emails: 'bob@f.local' })
  check("a chief's team (Bob only): Ann's feedback isn't counted for him", named.mentors.length === 1 && named.mentors[0]!.total.reviews === 1, j(named.mentors))

  const range = { from: at('20', '00'), to: at('23', '00') }
  const list = await mentorReviewsForPortal(String(ann._id), 1, 50, range)
  check('her list: the same 3, newest first', list.total === 3 && list.reviews.map((r: any) => r.studentId?.name).join() === 'Nitish,Hamda,Saif', j(list.reviews))
  const saif: any = list.reviews.find((r: any) => r.studentId?.name === 'Saif'), nit: any = list.reviews.find((r: any) => r.studentId?.name === 'Nitish')
  check("Saif's mentor rating, with his class comment beside it", saif?.kind === 'mentor_rating' && !saif.comment && saif.classComment === 'Clear explanations, thank you' && saif.liveClassId?.title === 'MBT 6', j(saif))
  check("Nitish's class feedback, labelled, with its words and class", nit?.kind === 'class_feedback' && nit.comment === 'Best class so far' && nit.rating === 5 && nit.liveClassId?.title === 'MBT 5', j(nit))
  check("Hamda's rating keeps its own words", list.reviews.find((r: any) => r.studentId?.name === 'Hamda')?.comment === 'Too fast')
  check("…and nothing of Bob's", !list.reviews.some((r: any) => r.comment === 'Bob was ok'))
  const all = await mentorReviewsForPortal(String(ann._id), 1, 50, {})
  check("no dates: Hamda's later feedback isn't added — she rated that class", all.total === 3, j(all.reviews.map((r: any) => [r.kind, r.studentId?.name])))
  const p2 = await mentorReviewsForPortal(String(ann._id), 2, 2, range)
  check('paged: page 2 of 2 a page holds the third', p2.total === 3 && p2.reviews.length === 1 && (p2.reviews[0] as any).studentId?.name === 'Saif')
  let threw = ''
  try { await mentorReviewsForPortal('nope', 1, 50, {}) } catch (e) { threw = (e as Error).message }
  check('a bad id is refused', /Invalid instructor id/.test(threw), threw)

  const admin = await new InstructorReviewService().listForInstructor(String(ann._id), undefined, undefined, 1, 50)
  check("the LMS admin's own list is unchanged: mentor ratings only", admin.totalCount === 2, j(admin))
} catch (err) { fail++; console.log('  FAIL threw', err) } finally {
  await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
