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

/* v3 → v4 → v5: brings the URL button back, but not the way v1/v2 had it.
   v1/v2's button carried a DYNAMIC suffix (the live class id), sent
   per-message as `buttonParam` — Meta validates that as its own component,
   separate from the body's {{1}}/{{2}}, and that split is exactly what
   produced every bug this template has had: the #132000 param-count
   mismatch, and the button silently vanishing whenever the id was falsy
   (`buttonParam ? [...] : []` → an empty components array → Meta rejects
   the whole send for a missing required component). v3 dropped the button
   entirely rather than fight that a third time. v4 designed a static
   replacement pointed at /live-classes; v5 is the same static design,
   retargeted at /my-bookings before the template was ever submitted (the
   schedule mixes in classes the student hasn't booked yet, rendered with an
   "Enroll" CTA instead of Join — /my-bookings is only their own bookings, so
   there's nothing to search past and no unrelated class to confuse the one
   they're being reminded about).

   v5's button has NO dynamic suffix at all — it points at the same static
   `{CLIENT_URL}/my-bookings` URL for every student and every class, entered
   directly into the Meta template definition (via Creatyvot) rather than
   sent per-message. Structurally this cannot reproduce either v1/v2 bug:
   there is no `buttonParam`, no per-send button component, nothing whose
   presence depends on a live class id being truthy. sendTemplate() below is
   called exactly as v3/v4 were — 2 body params, no `buttonParam` — the
   button is just part of the approved template now, the same way the logo
   or a fixed footer line would be.

   Both /my-bookings and /live-classes fire the identical join/attendance
   mechanism (JoinMeetButton → POST /live-classes/:id/join), so auto-
   attendance works the same regardless of which one the button points at —
   /my-bookings was chosen purely for how much less there is to wade through.
   It also carries the same `?from=` login bounce-back as /live-classes, so
   an expired session still lands back here after signing in.

   MUST be approved in Meta Business Manager (via Creatyvot) under this exact
   name, WITH the static URL button configured on the template itself,
   before sendTemplate() will deliver anything — see the file header.
   Unverified against the real Graph API; confirm with a live send to a test
   student once approved, the same way v2 and booking_confirmed_v2 were. */
export async function sendClassStartingSoonWhatsApp(
  to: string | null | undefined, sessionTitle: string, minutesLeft: string,
): Promise<void> {
  await sendTemplate(to, 'class_starting_soon_v5', [sessionTitle, minutesLeft], { category: 'utility' })
}

/* class_starts_in_5_min and class_has_started — the join reminders for an
   ONLINE class, each with a Join button that opens the class's own page:
   the template's URL is {CLIENT_URL}/live-classes/ and every send adds
   `<classId>/watch`, where the seat and the join window are checked before
   the meeting link is handed over.

   That is a DYNAMIC button again, the kind v1/v2 of class_starting_soon died
   of (see above). Both of their bugs are closed off here: the body param
   counts are fixed by these signatures — 4 and 2, as the approved templates
   take — and with no class id there is no send at all, rather than a send
   whose button component is missing and which Meta refuses whole. The email
   beside it still goes either way. */
export async function sendClassStartsIn5MinWhatsApp(
  to: string | null | undefined, studentName: string, sessionTitle: string,
  dateLabel: string, timeLabel: string, liveClassId: string,
): Promise<void> {
  if (!liveClassId) {
    logger.warn({ templateName: 'class_starts_in_5_min' }, 'WhatsApp join reminder skipped — no class id for its button')
    return
  }
  await sendTemplate(to, 'class_starts_in_5_min', [studentName || 'there', sessionTitle, dateLabel, timeLabel],
    { category: 'utility', buttonParam: `${liveClassId}/watch` })
}

export async function sendClassHasStartedWhatsApp(
  to: string | null | undefined, studentName: string, sessionTitle: string, liveClassId: string,
): Promise<void> {
  if (!liveClassId) {
    logger.warn({ templateName: 'class_has_started' }, 'WhatsApp join reminder skipped — no class id for its button')
    return
  }
  await sendTemplate(to, 'class_has_started', [studentName || 'there', sessionTitle],
    { category: 'utility', buttonParam: `${liveClassId}/watch` })
}

/* First WhatsApp template aimed at STAFF rather than students — every other
   function in this file notifies a student. Sent to a support ticket's
   org admin(s), programme sub_admin(s), and every super_admin (see
   SupportService#create), ONLY for a recipient who has a phone number on
   file — the field this feature adds to staff accounts. Every other
   recipient still gets the email/in-app alert regardless.

   Button is STATIC, same reasoning as class_starting_soon_v5: a fixed
   "Open Support Inbox" link to {ADMIN_URL}/support, configured once on the
   Meta template itself, no per-message buttonParam — so this can't reproduce
   the v1/v2 class_starting_soon bugs (a dynamic per-message button component
   Meta validates separately from the body, and silently drops on a falsy id).

   MUST be approved in Meta Business Manager (via Creatyvot) under this exact
   name, WITH the static URL button configured on the template itself, before
   sendTemplate() will deliver anything — see the file header. Unverified
   against the real Graph API; the template does not exist yet. */
export async function sendSupportTicketRaisedWhatsApp(
  to: string | null | undefined, studentName: string, ticketSubject: string,
): Promise<void> {
  await sendTemplate(to, 'support_ticket_raised_v1', [studentName, ticketSubject], { category: 'utility' })
}

/* Sent once a student's attendance finalizes to 'attended' (see
   reminders.job.ts#runReviewRequestDispatch), asking them to rate the class.

   Button is STATIC, same design as class_starting_soon_v5 and
   support_ticket_raised_v1: a fixed "Rate This Class" link to
   {CLIENT_URL}/reviews, configured once on the Meta template itself. No
   buttonParam — deliberately not a per-class deep link, which would need a
   dynamic per-message button component and reopen the exact Meta validation
   bug class that broke class_starting_soon twice (a falsy id silently
   dropping the whole button). /reviews lists THAT student's own pending
   reviews once they're logged in — reached via the `?from=` bounce-back on
   an expired session, same as every other static-button template here.

   MUST be approved in Meta Business Manager (via Creatyvot) under this exact
   name, WITH the static URL button configured on the template itself, before
   sendTemplate() will deliver anything — see the file header. The template
   does not exist yet. */
export async function sendInstructorReviewRequestWhatsApp(
  to: string | null | undefined, studentName: string, sessionTitle: string,
): Promise<void> {
  await sendTemplate(to, 'instructor_review_request_v1', [studentName, sessionTitle], { category: 'utility' })
}
