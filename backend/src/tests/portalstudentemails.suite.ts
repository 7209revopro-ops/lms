/* The portal's student page — a student's LMS emails (2026-10-17): by address (either case), newest first, without
   bodies; one email's body only for its own address. Run: bun --no-env-file src/tests/portalstudentemails.suite.ts */
process.env.DATABASE_URL = process.env.PORTALEMAILS_DB_URL || 'mongodb://localhost:27017/lms_portalstudentemails'
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'portalstudentemails-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalstudentemails-suite-refresh-secret-0123456789'
export {}
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const S = await import('@/services/portalStudentEmails.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_portalstudentemails') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
try {
  const t0 = Date.now()
  await M.EmailOutboxModel.collection.insertMany([
    { to: 'Ali@X.test', subject: 'Welcome', html: '<p>Hi Ali</p>', status: 'sent', sentAt: new Date(t0 - 3e5), createdAt: new Date(t0 - 3e5), updatedAt: new Date() },
    { to: 'ali@x.test', subject: 'Class reminder', html: '<p>Soon</p>', status: 'failed', lastError: 'cleared: not sent', createdAt: new Date(t0), updatedAt: new Date() },
    { to: 'other@x.test', subject: 'Not theirs', html: '<p>no</p>', status: 'sent', createdAt: new Date(t0), updatedAt: new Date() },
  ] as any[])
  const r = await S.studentEmailsForPortal('Ali@X.test', 50)
  check('their emails, either case, newest first', r.emails.map(e => e.subject).join() === 'Class reminder,Welcome', JSON.stringify(r.emails))
  check('the failed one says why', r.emails[0]!.error === 'cleared: not sent')
  check('no bodies in the list', !('html' in (r.emails[0] as any)))
  const one = await S.studentEmailForPortal(r.emails[1]!.id, 'ali@x.test')
  check('one email with its body', one.html === '<p>Hi Ali</p>')
  const theirs = (await M.EmailOutboxModel.findOne({ to: 'other@x.test' }).lean()) as any
  let refused = false
  try { await S.studentEmailForPortal(String(theirs._id), 'ali@x.test') } catch { refused = true }
  check("someone else's email is refused", refused)
} catch (err) { fail++; console.log('  FAIL threw', err) } finally {
  await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
