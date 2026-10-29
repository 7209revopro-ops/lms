/* ─────────────────────────────────────────────────────────────
   Message logs and login links for the CS Portal
   (services/portalMessageLogs.service.ts, routes/portalActivity.routes.ts).

   Pinned here, against a real database:
     A. emails: only to the addresses named (any letter case), or all; filters
        by status and day; newest first, skip / limit, the total; the counts;
     B. WhatsApp: only to the phones named, or the phones on the LMS accounts
        of the addresses named (last 9 digits, however written); a one-tap
        link masked unless revealed, and then with where it stands; the
        template filter and the templates in scope;
     C. a login link: signs in once (maxUses 1), 24 hours, from the CS's own
        account else the shared one, cancels the earlier unused one, audited;
        a deactivated student or nobody refused.

   Run: bun --no-env-file src/tests/portalmessagelogs.suite.ts
   (PORTALMESSAGELOGS_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.PORTALMESSAGELOGS_DATABASE_URL ?? 'mongodb://localhost:27017/lms_portalmessagelogs'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.SMTP_BACKUP_HOST = ''
process.env.SMTP_BACKUP_USER = ''
process.env.SMTP_BACKUP_PASS = ''
process.env.EMAIL_FROM   = ''
process.env.DOTENV_CONFIG_PATH = '/nonexistent/portalmessagelogs-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'portalmessagelogs-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalmessagelogs-suite-refresh-secret-0123456789'
process.env.PORTAL_SUPPORT_USER_EMAIL = 'desk@lms.test'
process.env.CLIENT_URL = 'https://lms.test'

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

const mongoose = (await import('mongoose')).default
const { UserModel, EmailOutboxModel, WhatsAppOutboxModel, AuthTokenModel, AuditLogModel } = await import('@/models/schema.ts')
const { messageLogsForPortal, studentLoginLinkForPortal } = await import('@/services/portalMessageLogs.service.ts')
const { mintSigninCode, hashSigninCode } = await import('@/services/signinLink.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_portalmessagelogs') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.dropDatabase()

const now = new Date()
const MIN = 60_000, DAY = 24 * 60 * MIN
const ago = (ms: number) => new Date(now.getTime() - ms)
const person = async (email: string, name: string, o: Record<string, unknown> = {}) =>
  (await UserModel.collection.insertOne({ email, name, role: 'student', isActive: true, createdAt: ago(10 * DAY), updatedAt: ago(10 * DAY), ...o })).insertedId
const amal = await person('amal@lms.test', 'Amal', { enrollmentApplication: { phone: '+971 50 111 2222' } })
const banu = await person('banu@lms.test', 'Banu')
const off = await person('off@lms.test', 'Off', { isActive: false })
const desk = await person('desk@lms.test', 'Help Desk', { role: 'support' })
const csOwn = await person('cs.own@delta.test', 'CS Own', { role: 'support' })

const mail = (to: string, subject: string, status: string, at: Date) => ({ to, subject, html: '<p>x</p>', text: 'x', status, attempts: 1, nextAttemptAt: at, createdAt: at, updatedAt: at, ...(status === 'sent' ? { sentAt: at } : {}), ...(status === 'failed' ? { lastError: 'SMTP 550' } : {}) })
await EmailOutboxModel.collection.insertMany([
  mail('Amal@LMS.test', 'Welcome', 'sent', ago(3 * DAY)),
  mail('amal@lms.test', 'Your class today', 'failed', ago(2 * MIN)),
  mail('banu@lms.test', 'Banu only', 'sent', ago(MIN)),
  mail('stranger@x.test', 'Not a student here', 'pending', ago(MIN)),
])

step('A. emails')
let r: any = await messageLogsForPortal({ channel: 'email', emails: ['AMAL@lms.test'], summary: true })
check('only the addresses named, in any letter case, newest first', r.total === 2 && r.rows.map((x: any) => x.subject).join() === 'Your class today,Welcome', JSON.stringify(r.rows))
check('…the failed one says why; no bodies in the list', r.rows[0].error === 'SMTP 550' && !('html' in r.rows[0]))
check('…counts for them: today 1 failed, the week 2', r.summary.today.failed === 1 && r.summary.today.total === 1 && r.summary.last7Days.total === 2, JSON.stringify(r.summary))
r = await messageLogsForPortal({ channel: 'email', emails: ['amal@lms.test', 'banu@lms.test'], status: 'sent' })
check('status filter', r.total === 2 && r.rows.every((x: any) => x.status === 'sent'))
r = await messageLogsForPortal({ channel: 'email', emails: ['amal@lms.test', 'banu@lms.test'], skip: 1, limit: 1 })
check('skip / limit, with the total', r.total === 3 && r.rows.length === 1 && r.rows[0].subject === 'Your class today', JSON.stringify(r))
const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
r = await messageLogsForPortal({ channel: 'email', emails: ['amal@lms.test'], from: day(ago(4 * DAY)), until: day(ago(3 * DAY)) })
check('day range', r.total === 1 && r.rows[0].subject === 'Welcome', JSON.stringify(r.rows))
check('nobody named: nothing', (await messageLogsForPortal({ channel: 'email', emails: [] })).total === 0)
check('all: everything', (await messageLogsForPortal({ channel: 'email', all: true })).total === 4)
let refused: any = null
try { await messageLogsForPortal({ channel: 'sms' }) } catch (err) { refused = err }
check('a channel that is neither: refused', refused?.statusCode === 400)

step('B. WhatsApp')
const code = await mintSigninCode(String(amal), '/class-bookings')
await WhatsAppOutboxModel.collection.insertMany([
  { to: '971501112222', templateName: 'todays_classes_v1', params: ['Amal', 'MBT 1 at 7 pm'], buttonParam: code, status: 'sent', attempts: 1, nextAttemptAt: ago(MIN), sentAt: ago(MIN), createdAt: ago(MIN), updatedAt: ago(MIN) },
  { to: '971509990000', templateName: 'class_reminder_tomorrow', params: ['MBT 2', 'Tomorrow 7 pm'], status: 'failed', lastError: 'not on WhatsApp', attempts: 3, nextAttemptAt: ago(MIN), createdAt: ago(2 * MIN), updatedAt: ago(2 * MIN) },
  { to: '971505550000', templateName: 'class_reminder_tomorrow', params: ['MBT 3', 'x'], status: 'sent', attempts: 1, nextAttemptAt: ago(MIN), createdAt: ago(3 * MIN), updatedAt: ago(3 * MIN) },
])
r = await messageLogsForPortal({ channel: 'whatsapp', emails: ['amal@lms.test'], summary: true })
check('by the phone on their LMS account (asked by email only)', r.total === 1 && r.rows[0].templateName === 'todays_classes_v1' && r.rows[0].person?.email === 'amal@lms.test', JSON.stringify(r.rows))
check('…the text as they read it; the sign-in link masked', r.rows[0].text?.includes('Amal') && r.rows[0].button?.includes('••••') && !r.rows[0].login, JSON.stringify(r.rows[0]))
check('…templates in scope, labelled', r.templates?.length === 1 && r.templates[0].label === "Today's classes", JSON.stringify(r.templates))
r = await messageLogsForPortal({ channel: 'whatsapp', emails: ['amal@lms.test'], reveal: true })
check('revealed: the real link, valid, 0 of 3 sign-ins, its expiry', r.rows[0].button === `https://lms.test/s/${code}` && r.rows[0].login?.state === 'valid' && r.rows[0].login.signIns === 0 && r.rows[0].login.maxSignIns === 3 && !!r.rows[0].login.expiresAt, JSON.stringify(r.rows[0]))
await AuthTokenModel.updateOne({ tokenHash: hashSigninCode(code) }, { $set: { useCount: 3 } })
r = await messageLogsForPortal({ channel: 'whatsapp', emails: ['amal@lms.test'], reveal: true })
check('…used up when its sign-ins are', r.rows[0].login?.state === 'used_up', JSON.stringify(r.rows[0].login))
r = await messageLogsForPortal({ channel: 'whatsapp', phones: ['050 999 0000', '+971 50 555 0000'], status: 'failed' })
check('by the portal\'s phones (written any way), with the status filter; the failure says why', r.total === 1 && r.rows[0].error === 'not on WhatsApp', JSON.stringify(r.rows))
r = await messageLogsForPortal({ channel: 'whatsapp', all: true, template: 'class_reminder_tomorrow' })
check('all, template filter', r.total === 2)
check('a number not named: not there', (await messageLogsForPortal({ channel: 'whatsapp', phones: ['0501234567'] })).total === 0)

step('C. a login link')
const first = await studentLoginLinkForPortal({ email: 'Amal@lms.test', byName: 'CS Two', byEmail: 'cs.two@delta.test' })
const t1 = await AuthTokenModel.findOne({ tokenHash: hashSigninCode(first.url.split('/s/')[1]!) }).lean() as any
check('a /s/ link: signs in once, 24 hours, opens the class schedule', first.url.startsWith('https://lms.test/s/') && t1?.maxUses === 1 && t1.nextPath === '/class-bookings' && Math.abs(new Date(first.expiresAt).getTime() - now.getTime() - DAY) < 60_000, JSON.stringify(t1))
check('…from the shared account (the CS has none of their own)', String(t1?.issuedBy) === String(desk))
const audit = await AuditLogModel.findOne({ action: 'user.loginLink', entityId: String(amal) }).lean() as any
check('…audited with who asked', audit?.meta?.byName === 'CS Two' && audit.meta.from === 'shared' && audit.actorEmail === 'cs.two@delta.test', JSON.stringify(audit))
const second = await studentLoginLinkForPortal({ email: 'amal@lms.test', byName: 'CS Own', byEmail: 'cs.own@delta.test' })
const t2 = await AuthTokenModel.findOne({ tokenHash: hashSigninCode(second.url.split('/s/')[1]!) }).lean() as any
check('a new one: from the CS\'s own account, and the earlier unused one is gone', String(t2?.issuedBy) === String(csOwn) && !(await AuthTokenModel.exists({ _id: t1._id })))
check('…WhatsApp\'s sign-in link is left alone', !!(await AuthTokenModel.exists({ tokenHash: hashSigninCode(code) })))
for (const [label, email, status] of [['deactivated', 'off@lms.test', 400], ['no account', 'nobody@lms.test', 404], ['not a student', 'desk@lms.test', 404]] as const) {
  let e: any = null
  try { await studentLoginLinkForPortal({ email, byName: 'x', byEmail: '' }) } catch (err) { e = err }
  check(`${label}: refused`, e?.statusCode === status, String(e?.message))
}
void banu; void off

await mongoose.connection.dropDatabase()
await mongoose.disconnect()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

export {}
