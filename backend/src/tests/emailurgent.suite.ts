/* ─────────────────────────────────────────────────────────────
   Urgent mail always gets out (2026-10-17) — password reset, sign-in code,
   verify, welcome. Both Gmail mailboxes had run out of their daily allowance
   on class notices, and a sign-in code waited behind 8,000 of them.
     A. the backup mailbox is kept for urgent mail: other mail never uses it;
        urgent mail tries the main mailbox, then the backup
     B. the queue sends urgent mail before older bulk mail
     C. a reminder past its use (expiresAt) is closed, never sent
     D. the urgent senders mark their mail urgent; reminders carry an expiry
     E. while urgent mail waits, other mail is held back
   Run: bun --no-env-file src/tests/emailurgent.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_emailurgent'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.SMTP_BACKUP_USER = ''; process.env.SMTP_BACKUP_PASS = ''
process.env.EMAIL_OUTBOX = 'on'
process.env.EMAIL_OUTBOX_BATCH = '5'
process.env.JWT_ACCESS_SECRET  ??= 'emailurgent-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'emailurgent-refresh-secret-0123456789abcdef'
export {}
let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_emailurgent') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()

const QUOTA_ERR = Object.assign(new Error('Message failed'), { responseCode: 550, response: '550 5.4.5 Daily user sending limit exceeded.' })

try {
  section('A · the backup mailbox is for urgent mail')
  const { PooledEmailSender } = await import('@/services/email.service.ts')
  const log: string[] = []
  const fake = (name: string, quota: boolean, urgentOnly = false) => ({
    name, from: `${name}@t.local`, cooldownUntil: 0, urgentOnly,
    transporter: { sendMail: async () => { log.push(name); if (quota) throw QUOTA_ERR; return { messageId: `<${name}>` } } },
  })
  const msg = { to: 's@t.local', subject: 'x', html: '<p>x</p>' }
  {
    const pool = new PooledEmailSender([fake('primary', false), fake('backup', false, true)] as never)
    await pool.send(msg)
    check('normal mail goes by the main mailbox', log.join() === 'primary', log.join())
  }
  {
    log.length = 0
    const pool = new PooledEmailSender([fake('primary', true), fake('backup', false, true)] as never)
    let err = ''
    try { await pool.send(msg) } catch (e) { err = (e as Error).message }
    check('main mailbox out of allowance: normal mail waits — the backup is NOT used', log.join() === 'primary' && /quota cooldown/.test(err), `${log.join()} | ${err}`)
    log.length = 0
    await pool.send({ ...msg, urgent: true })
    check('...but urgent mail goes by the backup', log.join() === 'backup', log.join())
  }
  {
    log.length = 0
    const pool = new PooledEmailSender([fake('primary', true), fake('backup', false, true)] as never)
    await pool.send({ ...msg, urgent: true })
    check('urgent mail tries the main mailbox first, then the backup', log.join() === 'primary,backup', log.join())
  }

  section('B · urgent first in the queue')
  const old = new Date(Date.now() - 3600_000)
  await M.EmailOutboxModel.collection.insertMany(Array.from({ length: 12 }, (_, i) => ({
    to: `bulk${i}@t.local`, subject: 'Class cancelled — MBT', html: '<p/>', status: 'pending', attempts: 0, priority: 0,
    nextAttemptAt: old, createdAt: old, updatedAt: old })))
  await M.EmailOutboxModel.collection.insertOne({ to: 'me@t.local', subject: 'Reset your Delta password', html: '<p/>', status: 'pending',
    attempts: 0, priority: 10, nextAttemptAt: new Date(), createdAt: new Date(), updatedAt: new Date() } as any)
  const { drainOutboxOnce } = await import('@/jobs/emailOutbox.job.ts')
  await drainOutboxOnce()   // one batch of 5
  const reset = await M.EmailOutboxModel.findOne({ to: 'me@t.local' }).lean() as any
  const bulkLeft = await M.EmailOutboxModel.countDocuments({ subject: /Class cancelled/, status: 'pending' })
  check('the reset goes first; the 12 older notices are held while it waits', reset?.status === 'sent' && bulkLeft === 12, `${reset?.status} / ${bulkLeft} left`)
  await drainOutboxOnce()
  check('...and go once it is out (a batch of 5)', (await M.EmailOutboxModel.countDocuments({ subject: /Class cancelled/, status: 'pending' })) === 7)

  section('C · a reminder past its use')
  await M.EmailOutboxModel.collection.insertOne({ to: 'late@t.local', subject: '🔔 Your Class Starts in 5 Minutes', html: '<p/>', status: 'pending',
    attempts: 0, nextAttemptAt: new Date(), expiresAt: new Date(Date.now() - 60_000), createdAt: new Date(), updatedAt: new Date() } as any)
  await drainOutboxOnce()
  const late = await M.EmailOutboxModel.findOne({ to: 'late@t.local' }).lean() as any
  check('closed, never sent', late?.status === 'failed' && /class is over/.test(String(late?.lastError)) && !late?.sentAt, JSON.stringify({ s: late?.status, e: late?.lastError }))

  section('D · who is urgent, what expires')
  const E = await import('@/services/email.service.ts')
  await E.sendPasswordReset('r@t.local', 'R', 'https://lms.example/reset?token=x')
  await E.sendLoginCode('c@t.local', 'C', '123456')
  await E.sendFiveMinReminder('f@t.local', 'F', 'MBT 1', 'https://lms.example/j/x', new Date(Date.now() + 5 * 60_000))
  const row = async (to: string) => M.EmailOutboxModel.findOne({ to }).lean() as any
  check('password reset: top priority (20)', (await row('r@t.local'))?.priority === 20)
  check('sign-in code: top priority (20)', (await row('c@t.local'))?.priority === 20)
  await E.sendVerifyEmail('v@t.local', 'V', 'https://lms.example/verify?t=x')
  check('verify email: top priority (20)', (await row('v@t.local'))?.priority === 20)
  await E.sendImportedStudentWelcome('w@t.local', 'W', '4x-trading', 'https://lms.example/reset?token=x')
  check('welcome: urgent, below them (10)', (await row('w@t.local'))?.priority === 10)
  const five = await row('f@t.local')
  check('the 5-minute reminder is not urgent, and expires within about 2 hours', !five?.priority && five?.expiresAt && Math.abs(new Date(five.expiresAt).getTime() - Date.now() - 2 * 3600_000) < 60_000, JSON.stringify({ p: five?.priority, e: five?.expiresAt }))

  section('E · while urgent mail waits, bulk mail is held back')
  await M.EmailOutboxModel.deleteMany({})
  await M.EmailOutboxModel.collection.insertOne({ to: 'stuck@t.local', subject: 'Reset your Delta password', html: '<p/>', status: 'pending',
    attempts: 0, priority: 10, nextAttemptAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() } as any)
  await E.sendFiveMinReminder('bulk@t.local', 'B', 'MBT 1', 'https://lms.example/j/x', new Date(Date.now() + 5 * 60_000))
  const held = await M.EmailOutboxModel.findOne({ to: 'bulk@t.local' }).lean() as any
  check('a new class reminder is queued, not sent, while a reset waits', held?.status === 'pending' && !held?.attempts, JSON.stringify({ s: held?.status, a: held?.attempts }))
  await M.EmailOutboxModel.updateOne({ to: 'bulk@t.local' }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } })
  await drainOutboxOnce()
  check('...and the queue does not send it either', (await M.EmailOutboxModel.findOne({ to: 'bulk@t.local' }).lean() as any)?.status === 'pending')
  await M.EmailOutboxModel.updateOne({ to: 'stuck@t.local' }, { $set: { status: 'sent', sentAt: new Date() } })
  await drainOutboxOnce()
  check('once the urgent mail is out, it goes', (await M.EmailOutboxModel.findOne({ to: 'bulk@t.local' }).lean() as any)?.status === 'sent')

  section('F · Send now, from the Email Logs page')
  const app = (await import('@/app.ts')).default
  const server = app.listen(0); await new Promise<void>(r => server.once('listening', () => r()))
  const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
  const { hashPassword } = await import('@/utils/hash.ts')
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  await M.UserModel.create({ name: 'SA', email: 'sa@t.local', passwordHash: await hashPassword('CorrectHorse1'), role: 'super_admin', isActive: true, isVerified: true, organizationId: org._id })
  await M.UserModel.create({ name: 'AD', email: 'ad@t.local', passwordHash: await hashPassword('CorrectHorse1'), role: 'admin', isActive: true, isVerified: true, organizationId: org._id })
  const login = async (email: string) => { const r = await fetch(`${BASE}/admin/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'CorrectHorse1' }) }); return (r.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ') }
  const sa = await login('sa@t.local'), ad = await login('ad@t.local')
  const stopped = await M.EmailOutboxModel.collection.insertOne({ to: 'stopped@t.local', subject: 'Class cancelled — MBT', html: '<p/>', status: 'failed',
    lastError: 'stopped 2026-10-17: queue cleared by admin, not sent', attempts: 0, nextAttemptAt: new Date(), createdAt: new Date(), updatedAt: new Date() } as any)
  const post = (id: unknown, cookie: string) => fetch(`${BASE}/email-logs/${String(id)}/send-now`, { method: 'POST', headers: { cookie } })
  const r1 = await post(stopped.insertedId, sa)
  const after = await M.EmailOutboxModel.findById(stopped.insertedId).lean() as any
  check('a stopped email is sent at once', r1.status === 200 && after?.status === 'sent', `${r1.status} ${after?.status}`)
  check('...not twice (already sent → refused)', (await post(stopped.insertedId, sa)).status === 409)
  check('only a super admin may', (await post(stopped.insertedId, ad)).status === 403)
  server.close()
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
