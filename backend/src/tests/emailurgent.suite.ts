/* ─────────────────────────────────────────────────────────────
   Urgent mail always gets out (2026-10-17) — password reset, sign-in code,
   verify, welcome. Both Gmail mailboxes had run out of their daily allowance
   on class notices, and a sign-in code waited behind 8,000 of them.
     A. the backup mailbox is kept for urgent mail: other mail never uses it;
        urgent mail tries the main mailbox, then the backup
     B. the queue sends urgent mail before older bulk mail
     C. a reminder past its use (expiresAt) is closed, never sent
     D. the urgent senders mark their mail urgent; reminders carry an expiry
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
  check('the reset went in the first batch, ahead of 12 older notices', reset?.status === 'sent' && bulkLeft === 8, `${reset?.status} / ${bulkLeft} left`)

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
  check('password reset is urgent', (await row('r@t.local'))?.priority === 10)
  check('sign-in code is urgent', (await row('c@t.local'))?.priority === 10)
  const five = await row('f@t.local')
  check('the 5-minute reminder is not urgent, and expires within about 2 hours', !five?.priority && five?.expiresAt && Math.abs(new Date(five.expiresAt).getTime() - Date.now() - 2 * 3600_000) < 60_000, JSON.stringify({ p: five?.priority, e: five?.expiresAt }))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
