/* ─────────────────────────────────────────────────────────────
   WhatsApp durable outbox + Creatyvot sender.

   Mirrors emailoutbox.suite.ts's shape and reasoning: the claim under test
   is "no WhatsApp notification is lost or sent to a garbage number", so this
   drives real failure modes — an unapproved template, a rate limit, a
   malformed phone number — rather than only the happy path.

   No real Creatyvot/Meta network calls — CreatyvotWhatsAppSender is
   exercised directly against a mocked global.fetch, and the outbox/drain
   tests run through ConsoleWhatsAppSender (NODE_ENV=test forces it, same as
   the email suite forces ConsoleEmailSender).

   Isolated throwaway database (lms_whatsappoutbox), dropped on exit.
   Run: bun run test:whatsappoutbox
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_whatsappoutbox'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.WHATSAPP_API_KEY         = ''
process.env.WHATSAPP_PHONE_NUMBER_ID = ''

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const { WhatsAppOutboxModel } = await import('@/models/schema.ts')
const {
  whatsappBackoffFor, MAX_WHATSAPP_ATTEMPTS, classify, WhatsAppApiError, CreatyvotWhatsAppSender,
  sendEnrollmentApprovedWhatsApp, sendBookingConfirmedWhatsApp, sendClassReminderTomorrowWhatsApp,
  sendClassStartingSoonWhatsApp,
} = await import('@/services/whatsapp.service.ts')
const { drainWhatsAppOutboxOnce } = await import('@/jobs/whatsappOutbox.job.ts')
const { normalizeWhatsAppNumber } = await import('@/utils/normalizeWhatsAppNumber.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_whatsappoutbox') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

try {
  section('A · phone normalization — the shape guard before anything is sent')
  check('a +-prefixed international number normalizes to digits-only',
    normalizeWhatsAppNumber('+91 98765 43210') === '919876543210')
  check('a plain digits-only number passes through',
    normalizeWhatsAppNumber('919876543210') === '919876543210')
  check('dashes and parens are stripped',
    normalizeWhatsAppNumber('(971) 50-495-5895') === '971504955895')
  check('too short is rejected', normalizeWhatsAppNumber('12345') === null)
  check('too long is rejected', normalizeWhatsAppNumber('1234567890123456') === null)
  check('empty string is rejected', normalizeWhatsAppNumber('') === null)
  check('null is rejected', normalizeWhatsAppNumber(null) === null)
  check('undefined is rejected', normalizeWhatsAppNumber(undefined) === null)
  check('letters-only garbage is rejected', normalizeWhatsAppNumber('not-a-phone') === null)

  section('B · backoff grows, then plateaus — same contract as email')
  const steps = [0, 1, 2, 3, 4, 5, 6, 7, 20].map(whatsappBackoffFor)
  check('first retry is a minute', steps[0] === 60_000, String(steps[0]))
  check('backoff is non-decreasing', steps.every((v, i) => i === 0 || v >= steps[i - 1]!))
  check('it plateaus at 24h rather than growing forever',
    steps[steps.length - 1] === 24 * 60 * 60_000, String(steps[steps.length - 1]))
  check('attempts are capped', MAX_WHATSAPP_ATTEMPTS > 0 && MAX_WHATSAPP_ATTEMPTS <= 20, String(MAX_WHATSAPP_ATTEMPTS))

  section('C · classify() separates permanent Meta rejections from transient ones')
  const unapproved = new WhatsAppApiError('Template not found', 400, { code: 132001, type: 'OAuthException' })
  const rateLimit   = new WhatsAppApiError('Too many requests', 429, { code: 4, type: 'OAuthException' })
  const noWhatsApp  = new WhatsAppApiError('Recipient unreachable', 400, { code: 131026 })
  const serverBlip  = new WhatsAppApiError('Bad gateway', 502, {})
  const genericErr  = new Error('network reset')

  check('an unapproved/misnamed template is PERMANENT — retrying never fixes it',
    classify(unapproved) === 'permanent')
  check('a recipient with no WhatsApp is PERMANENT',
    classify(noWhatsApp) === 'permanent')
  check('a 429 rate limit is TRANSIENT even though it is a 4xx — worth retrying',
    classify(rateLimit) === 'transient')
  check('a 5xx from Creatyvot itself is TRANSIENT — their side, not Meta rejecting the message',
    classify(serverBlip) === 'transient')
  check('a non-API error (network failure) defaults to TRANSIENT, never silently permanent',
    classify(genericErr) === 'transient')

  section('D · CreatyvotWhatsAppSender — the Meta Cloud API v25.0 request shape')
  {
    const calls: { url: string; init: RequestInit }[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      const body = JSON.parse(String(init.body))
      if (body.template.name === 'unapproved_template') {
        return new Response(JSON.stringify({ error: { code: 132001, type: 'OAuthException', message: 'Template name does not exist' } }), { status: 400 })
      }
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST123' }] }), { status: 200 })
    }) as typeof fetch

    try {
      const sender = new CreatyvotWhatsAppSender('https://connect.creatyvot.com', 'wc_test_key', 'PHONE_ID_123')

      const ok = await sender.send({ to: '919876543210', templateName: 'enrollment_approved', languageCode: 'en_US', params: ['Alan', 'Forex Trading'] })
      check('a successful send returns Meta\'s message id', ok.waMessageId === 'wamid.TEST123', JSON.stringify(ok))
      check('the request hits the drop-in v25.0 messages path',
        calls[0]!.url === 'https://connect.creatyvot.com/v25.0/PHONE_ID_123/messages', calls[0]!.url)
      check('auth is the Creatyvot key, not a Meta token',
        (calls[0]!.init.headers as Record<string, string>)['Authorization'] === 'Bearer wc_test_key')
      const sentBody = JSON.parse(String(calls[0]!.init.body))
      check('body params become positional {{n}} text components in order',
        JSON.stringify(sentBody.template.components[0].parameters.map((p: any) => p.text)) === JSON.stringify(['Alan', 'Forex Trading']))

      let threw: unknown = null
      try {
        await sender.send({ to: '919876543210', templateName: 'unapproved_template', languageCode: 'en_US', params: [] })
      } catch (e) { threw = e }
      check('an unapproved template throws WhatsAppApiError', threw instanceof WhatsAppApiError)
      check('carrying Meta\'s real error code for classify() to read',
        (threw as InstanceType<typeof WhatsAppApiError>)?.metaError?.code === 132001)

      /* A URL-button template (class_starting_soon_v2) sends its button's
         dynamic suffix in a SEPARATE component from the body — this is the
         exact distinction whose absence produced a real Meta rejection,
         "(#132000) Number of parameters does not match the expected number
         of params", against the actually-approved template. */
      calls.length = 0
      await sender.send({ to: '919876543210', templateName: 'class_starting_soon_v2', languageCode: 'en_US', params: ['Live Q&A', '5'], buttonParam: 'LIVECLASS123' })
      const btnBody = JSON.parse(String(calls[0]!.init.body))
      check('the body component carries exactly the 2 BODY variables, not the button param too',
        JSON.stringify(btnBody.template.components[0].parameters.map((p: any) => p.text)) === JSON.stringify(['Live Q&A', '5']))
      const buttonComponent = btnBody.template.components.find((c: any) => c.type === 'button')
      check('a separate button component is sent', !!buttonComponent, JSON.stringify(btnBody.template.components))
      check('with the right sub_type/index for a URL button',
        buttonComponent?.sub_type === 'url' && buttonComponent?.index === '0')
      check('carrying the live class id as its own parameter',
        buttonComponent?.parameters?.[0]?.text === 'LIVECLASS123')

      /* And the common case — no button param — must NOT emit an empty/stray
         button component; Meta rejects a components array entry it didn't
         ask for just as readily as a missing one. */
      calls.length = 0
      await sender.send({ to: '919876543210', templateName: 'enrollment_approved', languageCode: 'en_US', params: ['Alan'] })
      const noBtnBody = JSON.parse(String(calls[0]!.init.body))
      check('no button component is sent when there is no buttonParam',
        !noBtnBody.template.components.some((c: any) => c.type === 'button'), JSON.stringify(noBtnBody.template.components))
    } finally {
      globalThis.fetch = realFetch
    }
  }

  section('E · a persisted row survives, and only the drain actually sends it')
  await WhatsAppOutboxModel.deleteMany({})
  const row = await WhatsAppOutboxModel.create({
    to: '919876543210', templateName: 'booking_confirmed', languageCode: 'en_US',
    params: ['Priya', 'Live Q&A', 'Tue 30 Sep', '7:00 PM'],
    nextAttemptAt: new Date(Date.now() - 1000),
  })
  check('the row is persisted before any send is attempted',
    (await WhatsAppOutboxModel.countDocuments({ status: 'pending' })) === 1)

  const t1 = await drainWhatsAppOutboxOnce()
  check('the drain delivers a due row', t1.sent === 1, JSON.stringify(t1))
  const after = await WhatsAppOutboxModel.findById(row._id).lean() as any
  check('and marks it sent with a timestamp', after?.status === 'sent' && !!after?.sentAt, after?.status)

  section('F · a row that is not yet due is left alone')
  await WhatsAppOutboxModel.deleteMany({})
  await WhatsAppOutboxModel.create({
    to: '919876543210', templateName: 'class_reminder_tomorrow', languageCode: 'en_US', params: ['x', 'y'],
    nextAttemptAt: new Date(Date.now() + 60 * 60_000),
  })
  const t2 = await drainWhatsAppOutboxOnce()
  check('a future nextAttemptAt is skipped', t2.sent === 0 && t2.retry === 0, JSON.stringify(t2))
  check('and the row is still pending', (await WhatsAppOutboxModel.countDocuments({ status: 'pending' })) === 1)

  section('G · the drain is batched, so a backlog cannot become a burst of messages')
  await WhatsAppOutboxModel.deleteMany({})
  const many = Array.from({ length: 40 }, (_, i) => ({
    to: '919876543210', templateName: 'class_reminder_tomorrow', languageCode: 'en_US', params: [`x${i}`, 'y'],
    nextAttemptAt: new Date(Date.now() - 1000),
  }))
  await WhatsAppOutboxModel.insertMany(many)
  const t3 = await drainWhatsAppOutboxOnce()
  check('one pass sends at most the batch size', t3.sent <= 25, `sent ${t3.sent}`)
  let guard = 0
  while ((await WhatsAppOutboxModel.countDocuments({ status: 'pending' })) > 0 && guard++ < 10) {
    await drainWhatsAppOutboxOnce()
  }
  check('repeated ticks clear the whole backlog', (await WhatsAppOutboxModel.countDocuments({ status: 'pending' })) === 0, `after ${guard} ticks`)
  check('every one of the 40 was delivered', (await WhatsAppOutboxModel.countDocuments({ status: 'sent' })) === 40)

  section('H · nothing is ever silently discarded')
  const total = await WhatsAppOutboxModel.countDocuments({})
  const sent  = await WhatsAppOutboxModel.countDocuments({ status: 'sent' })
  const pend  = await WhatsAppOutboxModel.countDocuments({ status: 'pending' })
  const bad   = await WhatsAppOutboxModel.countDocuments({ status: 'failed' })
  check('every row is accounted for in exactly one state', total === sent + pend + bad, `${total} != ${sent}+${pend}+${bad}`)

  section('I · the TTL only ever reaps DELIVERED messages')
  await WhatsAppOutboxModel.syncIndexes()
  const idx = await WhatsAppOutboxModel.collection.indexes()
  const ttl = idx.find((i: any) => i.expireAfterSeconds !== undefined)
  check('a TTL index exists', !!ttl)
  check('and it is keyed on sentAt, so pending/failed rows never expire',
    !!ttl && Object.keys(ttl.key)[0] === 'sentAt', JSON.stringify(ttl?.key))

  section('J · typed helpers — the real call sites this codebase actually uses')
  await WhatsAppOutboxModel.deleteMany({})

  await sendEnrollmentApprovedWhatsApp('+91 98765 43210', 'Alan', '4x-trading', 'https://lms.deltainstitutions.com')
  const enroll = await WhatsAppOutboxModel.findOne({ templateName: 'enrollment_approved' }).lean() as any
  check('sendEnrollmentApprovedWhatsApp queues the right template', !!enroll, 'no row created')
  check('the phone was normalized before storage', enroll?.to === '919876543210', enroll?.to)
  check('params are in positional order [name, category, loginUrl]',
    JSON.stringify(enroll?.params) === JSON.stringify(['Alan', '4x-trading', 'https://lms.deltainstitutions.com']))
  check('category is recorded as utility', enroll?.category === 'utility')
  check('the immediate attempt already marked it sent (console sender in test mode)', enroll?.status === 'sent')

  await sendBookingConfirmedWhatsApp('919876543210', 'Priya', 'Live Q&A', 'Tue, 30 Sep', '7:00 PM')
  const booking = await WhatsAppOutboxModel.findOne({ templateName: 'booking_confirmed_v2' }).lean() as any
  check('sendBookingConfirmedWhatsApp queues its own template', !!booking)

  await sendClassStartingSoonWhatsApp('919876543210', 'Live Q&A', '5', 'LIVECLASS_ABC')
  const starting = await WhatsAppOutboxModel.findOne({ templateName: 'class_starting_soon_v2' }).lean() as any
  check('sendClassStartingSoonWhatsApp queues exactly the 2 BODY params the approved template expects',
    JSON.stringify(starting?.params) === JSON.stringify(['Live Q&A', '5']), JSON.stringify(starting?.params))
  check('and stores the live class id as buttonParam, not a 3rd body param',
    starting?.buttonParam === 'LIVECLASS_ABC', starting?.buttonParam)

  section('K · a title with newlines/injection characters cannot corrupt a template param')
  await sendClassReminderTomorrowWhatsApp('919876543210', 'Live\n\n\nQ&A     Session\t\ttitle', 'Tomorrow at 7pm')
  const reminder = await WhatsAppOutboxModel.findOne({ templateName: 'class_reminder_tomorrow' }).lean() as any
  check('newlines and tabs are stripped from the stored param',
    !!reminder && !/[\r\n\t]/.test(reminder.params[0]), JSON.stringify(reminder?.params))
  check('runs of 5+ spaces are collapsed (Meta rejects them outright)',
    !!reminder && !/ {5,}/.test(reminder.params[0]), JSON.stringify(reminder?.params))

  section('L · a garbage phone number is skipped, never queued')
  const before = await WhatsAppOutboxModel.countDocuments({})
  await sendEnrollmentApprovedWhatsApp('not-a-real-phone', 'Ghost', 'ai', 'https://lms.deltainstitutions.com')
  await sendEnrollmentApprovedWhatsApp(null, 'NoPhone', 'ai', 'https://lms.deltainstitutions.com')
  await sendEnrollmentApprovedWhatsApp(undefined, 'AlsoNoPhone', 'ai', 'https://lms.deltainstitutions.com')
  const afterCount = await WhatsAppOutboxModel.countDocuments({})
  check('no outbox row is created for an unusable number — logged and skipped, not queued to fail forever',
    afterCount === before, `${before} -> ${afterCount}`)

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
