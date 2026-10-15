/* ─────────────────────────────────────────────────────────────
   Which WhatsApp templates may go out (utils/featureFlags.ts whatsappTemplateOn,
   WHATSAPP_TEMPLATES_ON) — set here to the five the user keeps.
     A. the five are on; the rest are off
     B. an "on" template is stored and sent; an "off" one is never stored
     C. one queued before it was switched off is closed, not delivered
     D. the Send message page offers only "on" templates, and refuses an "off" one
   Run: bun --no-env-file src/tests/whatsappswitch.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_whatsappswitch'
process.env.NODE_ENV = 'test'
process.env.WHATSAPP_TEMPLATES_ON = 'class_has_started_v2,class_cancelled_v1,class_rescheduled_v1,class_link_changed_v1,instructor_review_request_v1'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.JWT_ACCESS_SECRET  ??= 'whatsappswitch-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'whatsappswitch-refresh-secret-0123456789abcdef'
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
const { whatsappTemplateOn } = await import('@/utils/featureFlags.ts')
const wa = await import('@/services/whatsapp.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_whatsappswitch') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const rows = (name: string) => M.WhatsAppOutboxModel.countDocuments({ templateName: name })

try {
  section('A · on and off')
  const ON = ['class_has_started_v2', 'class_cancelled_v1', 'class_rescheduled_v1', 'class_link_changed_v1', 'instructor_review_request_v1']
  const OFF = ['new_class_scheduled_v1', 'booking_confirmed_v2', 'class_starts_in_5_min_v2', 'class_reminder_tomorrow', 'todays_classes_v1',
    'class_update_v1', 'course_update_v1', 'class_mentor_changed_v1', 'mentor_class_in_10_min', 'enrollment_approved', 'class_starting_soon_v5']
  check('the five are on', ON.every(whatsappTemplateOn))
  check('every other one is off', OFF.every(n => !whatsappTemplateOn(n)), OFF.filter(whatsappTemplateOn).join())

  section('B · on → stored; off → never stored')
  const phone = '+971500000301'
  await wa.sendClassHasStartedV2WhatsApp(phone, 'Rahul', 'MBT 1', 'JOINCODE00000000000000')
  await wa.sendClassCancelledWhatsApp(phone, 'Rahul', 'MBT 1', 'Thu, 15 Oct', '07:00 PM GST', 'SIGNIN0000000000000000')
  check('class_has_started_v2 stored', (await rows('class_has_started_v2')) === 1)
  check('class_cancelled_v1 stored', (await rows('class_cancelled_v1')) === 1)
  await wa.sendBookingConfirmedWhatsApp(phone, 'Rahul', 'MBT 1', 'Thu, 15 Oct', '07:00 PM')
  await wa.sendClassUpdateWhatsApp(phone, 'Rahul', 'MBT 1', 'Thu, 15 Oct', 'It moved.', 'SIGNIN0000000000000000')
  await wa.sendTemplateMessage(phone, 'course_update_v1', ['Rahul', 'MBT', 'Hello'], 'SIGNIN0000000000000000')
  check('booking_confirmed_v2 not stored', (await rows('booking_confirmed_v2')) === 0)
  check('class_update_v1 not stored', (await rows('class_update_v1')) === 0)
  check('course_update_v1 (Send message path) not stored', (await rows('course_update_v1')) === 0)

  section('C · queued before it was switched off')
  const old = await M.WhatsAppOutboxModel.create({ to: '971500000302', templateName: 'new_class_scheduled_v1', languageCode: 'en_US', params: ['a', 'b', 'c', 'd', 'e'], status: 'pending', attempts: 0, nextAttemptAt: new Date(Date.now() - 1000) })
  const { drainWhatsAppOutboxOnce } = await import('@/jobs/whatsappOutbox.job.ts')
  await drainWhatsAppOutboxOnce()
  const after = await M.WhatsAppOutboxModel.findById(old._id).lean() as any
  check('closed as failed, "switched off" — never sent', after?.status === 'failed' && /switched off/i.test(String(after?.lastError)) && !after?.sentAt, JSON.stringify({ s: after?.status, e: after?.lastError }))

  section('D · the Send message page')
  const { BroadcastService } = await import('@/services/broadcast.service.ts')
  const svc = new BroadcastService()
  const course = svc.templatesFor('course').map(t => t.name)
  const session = svc.templatesFor('session').map(t => t.name)
  check('offers no switched-off template', [...course, ...session].every(whatsappTemplateOn), [...course, ...session].join())
  check('still offers the "on" ones it can send (a session: cancelled)', session.includes('class_cancelled_v1'), session.join())
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
