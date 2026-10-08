/* ─────────────────────────────────────────────────────────────
   whatsapp-test-templates — send every WhatsApp template the LMS uses to test
   numbers, with sample values, to check each one is approved and reads right.

   Straight to Creatyvot with the LMS's own sender — the same request a real
   notification makes — but no outbox row, no database, no student involved.

   DRY RUN BY DEFAULT: lists what it would send. Add --send to send.

     bun src/scripts/whatsapp-test-templates.ts --send
     bun src/scripts/whatsapp-test-templates.ts --send --to 919526288116,918590026442
     bun src/scripts/whatsapp-test-templates.ts --send --only class_has_started,class_starts_in_5_min
     bun src/scripts/whatsapp-test-templates.ts --send --only mentor_class_in_10_min
     bun src/scripts/whatsapp-test-templates.ts --send --only new_class_scheduled_v1,todays_classes_v1
     bun src/scripts/whatsapp-test-templates.ts --send --only class_cancelled_v1,class_rescheduled_v1,class_mentor_changed_v1
     bun src/scripts/whatsapp-test-templates.ts --send --class <liveClassId>   (join buttons open that class)

   Needs WHATSAPP_API_KEY and WHATSAPP_PHONE_NUMBER_ID — run it where WhatsApp
   is configured (the server). The join-button templates (`isNew` below) fail
   with #132001 (template does not exist) until Meta approves them —
   `mentor_class_in_10_min`'s button opens the ADMIN site (<id>/join).
───────────────────────────────────────────────────────────── */
import { CreatyvotWhatsAppSender, WhatsAppApiError } from '@/services/whatsapp.service.ts'
import { normalizeWhatsAppNumber } from '@/utils/normalizeWhatsAppNumber.ts'

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
const SEND = process.argv.includes('--send')
const TO = (arg('--to') ?? '+91 95262 88116,+918590026442').split(',')
  .map(n => normalizeWhatsAppNumber(n)).filter((n): n is string => !!n)
const ONLY = arg('--only')?.split(',').map(s => s.trim()).filter(Boolean)
const CLASS_ID = arg('--class') ?? '000000000000000000000000'

const CLIENT = (process.env['CLIENT_URL'] || 'https://lms.deltainstitutions.com').replace(/\/+$/, '')
const CLASS = 'MBT 1 · TEST CLASS'

const TEMPLATES: { name: string; params: string[]; buttonParam?: string; isNew?: boolean }[] = [
  { name: 'enrollment_approved',          params: ['Test Student', 'FOREX Trading', `${CLIENT}/login`] },
  { name: 'booking_confirmed_v2',         params: ['Test Student', CLASS, 'Tue, 6 Oct 2026', '1:00 PM'] },
  { name: 'class_reminder_tomorrow',      params: [CLASS, 'Tue, 6 Oct 2026 at 1:00 PM'] },
  { name: 'class_starting_soon_v5',       params: [CLASS, '5'] },
  { name: 'support_ticket_raised_v1',     params: ['Test Student', 'Test ticket - please ignore'] },
  { name: 'instructor_review_request_v1', params: ['Test Student', CLASS] },
  { name: 'class_starts_in_5_min',        params: ['Test Student', CLASS, 'Tue, 6 Oct', '1:00 PM'], buttonParam: `${CLASS_ID}/watch`, isNew: true },
  { name: 'class_has_started',            params: ['Test Student', CLASS], buttonParam: `${CLASS_ID}/watch`, isNew: true },
  { name: 'class_starts_in_5_min_v2',     params: ['Test Student', CLASS, 'Tue, 6 Oct', '1:00 PM'], buttonParam: 'TESTCODE0000000000000000', isNew: true },
  { name: 'class_has_started_v2',         params: ['Test Student', CLASS], buttonParam: 'TESTCODE0000000000000000', isNew: true },
  { name: 'mentor_class_in_10_min',       params: ['Test Mentor', CLASS, '02:00 PM GST', '12'], buttonParam: `${CLASS_ID}/join`, isNew: true },
  { name: 'new_class_scheduled_v1',       params: ['Test Student', 'MARKET BREAK-OUT TRADING PROGRAM', CLASS, 'Tue, 6 Oct', '02:00 PM GST'], buttonParam: 'TESTCODE0000000000000000', isNew: true },
  { name: 'class_cancelled_v1',           params: ['Test Student', CLASS, 'Tue, 13 Oct', '05:00 PM GST'], buttonParam: 'TESTCODE0000000000000000', isNew: true },
  { name: 'class_rescheduled_v1',         params: ['Test Student', CLASS, 'Tue, 13 Oct, 05:00 PM GST', 'Wed, 14 Oct, 07:00 PM GST'], buttonParam: 'TESTCODE0000000000000000', isNew: true },
  { name: 'class_mentor_changed_v1',      params: ['Test Student', CLASS, 'Tue, 13 Oct, 05:00 PM GST', 'Test Mentor'], buttonParam: 'TESTCODE0000000000000000', isNew: true },
  { name: 'todays_classes_v1',            params: ['Test Student', `10:00 AM ${CLASS} · 02:00 PM IM 3 (GST)`], buttonParam: 'TESTCODE0000000000000000', isNew: true },
]

const unknown = (ONLY ?? []).filter(n => !TEMPLATES.some(t => t.name === n))
if (unknown.length) { console.error(`Unknown template(s): ${unknown.join(', ')}`); process.exit(1) }
if (!TO.length) { console.error('No usable number in --to.'); process.exit(1) }
const list = ONLY ? TEMPLATES.filter(t => ONLY.includes(t.name)) : TEMPLATES

console.log(`${list.length} template(s) × ${TO.length} number(s): ${TO.map(n => `+${n}`).join(', ')}\n`)
if (!SEND) {
  for (const t of list) {
    console.log(`  ${t.name}${t.isNew ? ' (new)' : ''}: ${t.params.join(' | ')}${t.buttonParam ? `  [button: ${t.buttonParam}]` : ''}`)
  }
  console.log('\nDry run — nothing sent. Add --send to send them.')
  process.exit(0)
}

const key = process.env['WHATSAPP_API_KEY'], phoneId = process.env['WHATSAPP_PHONE_NUMBER_ID']
if (!key || !phoneId) {
  console.error('WHATSAPP_API_KEY / WHATSAPP_PHONE_NUMBER_ID are not set — run this where WhatsApp is configured (the server).')
  process.exit(1)
}
const sender = new CreatyvotWhatsAppSender(process.env['WHATSAPP_API_BASE_URL'] || 'https://connect.creatyvot.com', key, phoneId)

let sent = 0, failed = 0
for (const t of list) {
  for (const to of TO) {
    try {
      const { waMessageId } = await sender.send({
        to, templateName: t.name, languageCode: 'en_US', params: t.params, buttonParam: t.buttonParam, category: 'utility',
      })
      sent++
      console.log(`✓ ${t.name.padEnd(30)} → +${to}  ${waMessageId ?? ''}`)
    } catch (err) {
      failed++
      const code = err instanceof WhatsAppApiError ? `HTTP ${err.httpStatus}${err.metaError?.code ? ` #${err.metaError.code}` : ''}` : 'error'
      console.log(`✗ ${t.name.padEnd(30)} → +${to}  ${code}: ${(err as Error).message}`)
    }
  }
}
console.log(`\n${sent} sent, ${failed} failed`)
process.exit(failed ? 1 : 0)
