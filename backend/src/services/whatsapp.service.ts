/* ─────────────────────────────────────────────────────
   WhatsAppService — Creatyvot (Meta Cloud API v25.0 proxy)
   ─────────────────────────────────────────────────────
   Same shape as email.service.ts on purpose: a persisted outbox, an
   immediate best-effort attempt, and a cron drain for whatever that attempt
   couldn't finish — see whatsappOutbox.job.ts. A caller stays fire-and-
   forget (`void sendXWhatsApp(...).catch(log)`); durability is this layer's
   job, not the caller's.

   Creatyvot is a DROP-IN for graph.facebook.com — same paths, same payload
   shapes, Graph version v25.0 only. The one difference: Authorization is
   Bearer {WHATSAPP_API_KEY} (a Creatyvot wc_... key), never a Meta access
   token. Success and error responses are raw Meta JSON, unwrapped.

   Templates must be pre-approved in Meta Business Manager (via Creatyvot's
   dashboard) before sendTemplate() will actually deliver anything — an
   unapproved or misspelled template name comes back as a Meta error and is
   classified permanent (see classify() below), so it fails the outbox row
   rather than retrying forever. */
import { logger } from '@/utils/logger.ts'
import { env } from '@/config/env.ts'
import { normalizeWhatsAppNumber } from '@/utils/normalizeWhatsAppNumber.ts'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

export type WhatsAppTemplateCategory = 'utility'

export interface WhatsAppTemplateMessage {
  to:           string        // digits-only MSISDN, already normalized
  templateName: string
  languageCode: string        // e.g. 'en_US'
  params:       string[]      // positional {{1}}, {{2}}, … BODY variables
  /* A URL-type BUTTON's dynamic suffix — a template with a button carries
     its OWN parameter, in its OWN component, entirely separate from the
     body's. Meta rejects a message with the wrong param count per
     component, not just the wrong total — sending the button's value as a
     third body param (what this used to do) is exactly what produced
     "(#132000) Number of parameters does not match the expected number of
     params" against the real, approved class_starting_soon_v2 template.
     Index 0 only: no template here has more than one button. */
  buttonParam?: string
  category?:    WhatsAppTemplateCategory
}

export interface WhatsAppSender {
  send(msg: WhatsAppTemplateMessage): Promise<{ waMessageId?: string }>
}

/* ─── Console sender (dev) ───────────────────────────── */
class ConsoleWhatsAppSender implements WhatsAppSender {
  private static seq = 0
  private readonly dir = process.env['WHATSAPP_LOG_DIR']?.trim()
    || join(process.cwd(), '.logs', 'whatsapp')

  async send(msg: WhatsAppTemplateMessage): Promise<{ waMessageId?: string }> {
    try {
      await mkdir(this.dir, { recursive: true })
      const safe = msg.to.replace(/[^a-z0-9]/gi, '_')
      const file = join(this.dir, `${Date.now()}-${String(ConsoleWhatsAppSender.seq++).padStart(4, '0')}-${safe}.json`)
      await writeFile(file, JSON.stringify(msg, null, 2), 'utf8')
      logger.info({ to: msg.to, template: msg.templateName, file }, '💬  [dev] WhatsApp message captured')
    } catch (err) {
      logger.error({ err }, 'WhatsApp log write failed')
    }
    return {}
  }
}

/* ─── Creatyvot sender (production) ──────────────────── */
/* Exported (unlike ConsoleWhatsAppSender) so tests can instantiate it
   directly against a mocked fetch — same reasoning as email.service.ts
   exporting PooledEmailSender: the behaviour under test is the HTTP/error
   handling, not which sender NODE_ENV happens to pick. */
export class CreatyvotWhatsAppSender implements WhatsAppSender {
  constructor(
    private readonly baseUrl:       string,
    private readonly apiKey:        string,
    private readonly phoneNumberId: string,
  ) {}

  async send(msg: WhatsAppTemplateMessage): Promise<{ waMessageId?: string }> {
    const url = `${this.baseUrl}/v25.0/${this.phoneNumberId}/messages`
    const body = {
      messaging_product: 'whatsapp',
      to:   msg.to,
      type: 'template',
      template: {
        name: msg.templateName,
        language: { code: msg.languageCode },
        components: [
          ...(msg.params.length > 0
            ? [{ type: 'body', parameters: msg.params.map(text => ({ type: 'text', text })) }]
            : []),
          ...(msg.buttonParam
            ? [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: msg.buttonParam }] }]
            : []),
        ],
      },
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    const json = await res.json().catch(() => ({})) as {
      messages?: { id: string }[]
      error?: { code?: number; type?: string; message?: string; error_data?: { details?: string } }
    }

    if (!res.ok) {
      const err = new WhatsAppApiError(
        json.error?.message ?? `HTTP ${res.status}`,
        res.status,
        json.error,
      )
      throw err
    }

    return { waMessageId: json.messages?.[0]?.id }
  }
}

/* ─────────────────────────────────────────────────────
   Failure classification
   ─────────────────────────────────────────────────────
   Meta's error payload carries a `code` — the same handful of codes cover
   nearly every rejection reason:
     100/132001 — unknown/unapproved template, or a param count mismatch:
                  PERMANENT, retrying changes nothing.
     131026     — recipient has no WhatsApp / number unreachable: PERMANENT.
     131047, 131056 — outside the 24h session window / re-engagement limit:
                  PERMANENT for THIS send; a template message is exactly the
                  tool for this case, so if it's still rejected there is
                  nothing a retry fixes.
     4, 80007   — app/account rate limit: TRANSIENT, worth a backoff retry.
     anything 5xx from Creatyvot itself — TRANSIENT (their side, not Meta's).
─────────────────────────────────────────────────────── */
export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly metaError?: { code?: number; type?: string; message?: string },
  ) { super(message) }
}

const PERMANENT_META_CODES = new Set([100, 131026, 131047, 131051, 131056, 132000, 132001, 132005, 132007, 132012, 132015, 132016])

/* Exported for direct unit testing — a pure function over the error shape,
   same reasoning as CreatyvotWhatsAppSender above. */
export function classify(err: unknown): 'permanent' | 'transient' {
  if (err instanceof WhatsAppApiError) {
    const code = err.metaError?.code
    if (typeof code === 'number' && PERMANENT_META_CODES.has(code)) return 'permanent'
    if (err.httpStatus >= 400 && err.httpStatus < 500 && err.httpStatus !== 429) return 'permanent'
    return 'transient'
  }
  return 'transient'
}

/* ─── Singleton sender ────────────────────────────────── */
function buildSender(): WhatsAppSender {
  if (process.env['NODE_ENV'] === 'test') {
    return new ConsoleWhatsAppSender()
  }
  if (env.WHATSAPP_API_KEY && env.WHATSAPP_PHONE_NUMBER_ID) {
    logger.info({ baseUrl: env.WHATSAPP_API_BASE_URL }, 'WhatsApp backend: Creatyvot (Meta Cloud API v25.0)')
    return new CreatyvotWhatsAppSender(env.WHATSAPP_API_BASE_URL, env.WHATSAPP_API_KEY, env.WHATSAPP_PHONE_NUMBER_ID)
  }
  logger.info('WhatsApp backend: console (set WHATSAPP_API_KEY + WHATSAPP_PHONE_NUMBER_ID to enable real sending)')
  return new ConsoleWhatsAppSender()
}

const rawSender = buildSender()

/* ─────────────────────────────────────────────────────
   Durable outbox — mirrors email.service.ts exactly
─────────────────────────────────────────────────────── */
const BACKOFF_MIN = [1, 5, 15, 60, 240, 720, 1440]
export const MAX_WHATSAPP_ATTEMPTS = 10

export function whatsappBackoffFor(attempts: number): number {
  const idx = Math.min(attempts, BACKOFF_MIN.length - 1)
  return BACKOFF_MIN[idx]! * 60_000
}

/** Attempt one already-persisted row. Exported so the drain job reuses it. */
export async function deliverWhatsAppOutboxRow(row: {
  id: string; to: string; templateName: string; languageCode: string; params: string[]; buttonParam?: string; attempts: number
}): Promise<'sent' | 'retry' | 'failed'> {
  const { WhatsAppOutboxModel } = await import('@/models/schema.ts')
  try {
    const { waMessageId } = await rawSender.send({
      to: row.to, templateName: row.templateName, languageCode: row.languageCode,
      params: row.params, buttonParam: row.buttonParam,
    })
    await WhatsAppOutboxModel.updateOne({ _id: row.id }, {
      $set: { status: 'sent', sentAt: new Date(), ...(waMessageId && { waMessageId }) }, $unset: { lastError: 1 },
    })
    return 'sent'
  } catch (err) {
    const attempts  = row.attempts + 1
    const verdict   = classify(err)
    const exhausted = attempts >= MAX_WHATSAPP_ATTEMPTS
    const message   = String((err as Error)?.message ?? err).slice(0, 500)

    if (verdict === 'permanent' || exhausted) {
      await WhatsAppOutboxModel.updateOne({ _id: row.id }, {
        $set: { status: 'failed', attempts, lastError: message },
      })
      logger.error({ to: row.to, template: row.templateName, attempts, verdict }, 'WhatsApp message permanently failed — needs a human')
      return 'failed'
    }

    await WhatsAppOutboxModel.updateOne({ _id: row.id }, {
      $set: { attempts, lastError: message, nextAttemptAt: new Date(Date.now() + whatsappBackoffFor(attempts)) },
    })
    return 'retry'
  }
}

/* Strips characters Meta rejects inside a template parameter: newlines/tabs
   and runs of 5+ spaces are refused outright by the Graph API, and a raw
   param is exactly where a course/session TITLE (free text an admin typed)
   could carry either. Truncated to a sane length — Meta caps body params
   around 1024 chars, but a WhatsApp bubble is unreadable well before that. */
function sanitiseParam(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/ {5,}/g, '    ').trim().slice(0, 300)
}

interface SendOptions {
  category?:    WhatsAppTemplateCategory
  buttonParam?: string
}

async function sendTemplate(
  to: string | null | undefined,
  templateName: string,
  params: string[],
  opts: SendOptions = {},
  languageCode = 'en_US',
): Promise<void> {
  const normalized = normalizeWhatsAppNumber(to)
  if (!normalized) {
    logger.debug({ to, templateName }, 'WhatsApp send skipped — no usable phone number')
    return
  }
  const clean = params.map(sanitiseParam)
  const cleanButtonParam = opts.buttonParam !== undefined ? sanitiseParam(opts.buttonParam) : undefined

  const { WhatsAppOutboxModel } = await import('@/models/schema.ts')
  /* Persist FIRST, same reasoning as the email outbox: if the process dies
     between here and the send, the drain cron picks the row up; if we sent
     first, there would be no record to retry from. */
  const row = await WhatsAppOutboxModel.create({
    to: normalized, templateName, languageCode, params: clean, buttonParam: cleanButtonParam, category: opts.category,
  })

  await deliverWhatsAppOutboxRow({
    id: String(row._id), to: normalized, templateName, languageCode,
    params: clean, buttonParam: cleanButtonParam, attempts: 0,
  })
}

/* ── Typed helpers, one per trigger event ─────────────── */

export async function sendEnrollmentApprovedWhatsApp(
  to: string | null | undefined, name: string, courseOrCategoryLabel: string, loginUrl: string,
): Promise<void> {
  await sendTemplate(to, 'enrollment_approved', [name, courseOrCategoryLabel, loginUrl], { category: 'utility' })
}

export async function sendBookingConfirmedWhatsApp(
  to: string | null | undefined, name: string, sessionTitle: string, dateStr: string, timeStr: string,
): Promise<void> {
  await sendTemplate(to, 'booking_confirmed_v2', [name, sessionTitle, dateStr, timeStr], { category: 'utility' })
}

export async function sendClassReminderTomorrowWhatsApp(
  to: string | null | undefined, sessionTitle: string, whenStr: string,
): Promise<void> {
  await sendTemplate(to, 'class_reminder_tomorrow', [sessionTitle, whenStr], { category: 'utility' })
}

/* class_starting_soon renamed to class_starting_soon_v2 to match the
   template now APPROVED on the Meta/Creatyvot account — same rename this
   file already made for booking_confirmed_v2. The approved template's BODY
   still takes exactly 2 params (title, minutes) and its URL BUTTON takes its
   own, separate one — the live class id, appended to the button's
   pre-registered base URL by Meta itself. Passing it as a third body param
   is exactly what produced Meta's real "(#132000) Number of parameters does
   not match the expected number of params" — the two components are
   validated independently. Unverified against the real Graph API in this
   change (the prior rename was); confirm with a live send before relying on
   it, the same way booking_confirmed_v2 and the button-component fix were
   confirmed with a real test student. */
export async function sendClassStartingSoonWhatsApp(
  to: string | null | undefined, sessionTitle: string, minutesLeft: string, liveClassId: string,
): Promise<void> {
  await sendTemplate(to, 'class_starting_soon_v2', [sessionTitle, minutesLeft], { category: 'utility', buttonParam: liveClassId })
}
