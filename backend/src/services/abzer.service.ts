import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'

/*
 * AbzerService — Abzer DMCC / BillXPro payment gateway (UAE)
 * API docs: version 5.1 · Webhook docs: version 1.0
 *
 * Flow:
 *  1. authenticate()  → cached Bearer token (60-min TTL, refreshed at 50 min)
 *  2. createOrder()   → POST /direct-payment-request/extended  (get UUID)
 *                     → GET  /direct-payment-request/{id}/link-generate (get redirect URL)
 *  3. User pays on BillXPro hosted page (card processor behind it: N-Genius)
 *  4. Webhook POST → WH_RECEIPT_POSTING, paymentStatus=Success
 *                    invoiceNumber = our referenceNumber = our orderId
 *  5. getPaymentRequest() → GET /direct-payment-request/{id} — Abzer's own
 *     record of the request, with its status. NOT in the v5.1 document;
 *     verified against the sandbox 2026-10-26 (CR_REQUESTED → CR_PAID with
 *     receiptId/receiptNumber/authCode, or CR_FAILED). It is what lets us
 *     confirm a payment ourselves rather than only trusting the webhook.
 *
 * Security: Abzer sends a custom header you configure in their admin console.
 *   Set X-Abzer-Secret to ABZER_WEBHOOK_SECRET and check it in the webhook handler.
 */

const READ_TIMEOUT_MS  = 8_000
const WRITE_TIMEOUT_MS = 15_000

/* Create retries on Abzer's customer-code 409 (see createOrder). Three quick
   tries draw new digits; if the minute is simply full, wait for the next one
   (when it is close) and try twice more. Worst case ~22 s — the /explore pay
   call allows 35 s. */
const CONFLICT_RETRIES = 5
const NEXT_MINUTE_MAX_WAIT_MS = 15_000
const jitter = () => 0.5 + Math.random()
let conflictDelayMs = (retry: number, now = Date.now()): number => {
  if (retry <= 3) return 400 * 2 ** (retry - 1) * jitter()
  if (retry === 4) {
    const toNextMinute = 60_000 - (now % 60_000)
    return toNextMinute <= NEXT_MINUTE_MAX_WAIT_MS ? toNextMinute + 200 + Math.random() * 2_000 : 3_000 * jitter()
  }
  return 1_000 * jitter()
}
/** Test hook — retry without waiting. */
export function setAbzerConflictDelay(fn: (retry: number) => number): void { conflictDelayMs = fn }

/* Abzer ids are UUIDs; anything else never reaches a URL path. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isAbzerId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

/* ─── module-level token cache (shared across service instances) ─── */
let _cachedToken: { token: string; expiresAt: number } | null = null

/** Test hook — forget the cached token. */
export function resetAbzerTokenCache(): void { _cachedToken = null }

async function fetchAbzerToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt) {
    return _cachedToken.token
  }

  const resp = await fetch(`${env.ABZER_BASE_URL}/authenticate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessKey: env.ABZER_ACCESS_KEY,
      secretKey: env.ABZER_SECRET_KEY,
    }),
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  })

  if (!resp.ok) {
    const text = await resp.text()
    logger.error({ status: resp.status, body: text.slice(0, 300) }, 'Abzer authentication failed')
    throw new Error(`Abzer auth failed (${resp.status}): ${text.slice(0, 300)}`)
  }

  const data = await resp.json() as { accessKey: string; token: string }
  if (!data?.token) throw new Error('Abzer auth returned no token')
  /* Cache for 50 min — Abzer token is valid for 60 min */
  _cachedToken = { token: data.token, expiresAt: Date.now() + 50 * 60 * 1000 }
  return data.token
}

/* An expired or revoked token. The docs list 401; the sandbox answers 403
   "Authentication failed. Token expired." — both mean: log in again. */
const tokenRejected = (status: number, text: string) =>
  status === 401 || (status === 403 && /token|authenticat/i.test(text))

/** An authenticated call. A rejected token is refreshed and the call made once more. */
async function abzerCall(path: string, init: { method?: string; body?: string; timeoutMs?: number } = {}): Promise<{ ok: boolean; status: number; text: string }> {
  for (let attempt = 0; ; attempt++) {
    const token = await fetchAbzerToken()
    const resp = await fetch(`${env.ABZER_BASE_URL}${path}`, {
      method:  init.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(init.body !== undefined && { body: init.body }),
      signal: AbortSignal.timeout(init.timeoutMs ?? READ_TIMEOUT_MS),
    })
    const text = await resp.text()
    if (attempt === 0 && tokenRejected(resp.status, text)) {
      logger.warn({ status: resp.status, path: path.split('/').slice(0, 2).join('/') }, 'Abzer: token rejected — logging in again')
      _cachedToken = null
      continue
    }
    return { ok: resp.ok, status: resp.status, text }
  }
}

const parse = (text: string): any => { try { return JSON.parse(text) } catch { return null } }

/* ─── Public types ─────────────────────────────────────── */

export interface AbzerCreateOrderOptions {
  amountAED:   number   // decimal AED amount e.g. 199.00
  orderId:     string   // our internal order ID — sent as referenceNumber
  courseTitle: string
  buyerEmail:  string
  buyerName:   string
  buyerPhone?: string
  /** Where BillXPro sends the buyer back — the public /explore return page for a guest (2026-10-18). */
  returnUrl?:  string
}

export interface AbzerCreateOrderResult {
  abzerRequestId: string   // Abzer UUID from create response (stored for reference)
  checkoutUrl:    string   // mailLink — redirect user here
}

/* Subset of WH_RECEIPT_POSTING payload fields we care about */
export interface AbzerWebhookPayload {
  type:             string
  receiptId:        string
  receiptNumber:    string
  receiptAmount:    number
  paymentRefNumber: string
  paymentStatus:    string   // 'Success' | 'Pending Approval'
  collectedCurrency: string
  invoiceNumber:    string   // = our referenceNumber (orderId)
  customerName?:    string
}

/** Abzer's record of one payment request, reduced to what decides fulfilment. */
export interface AbzerPaymentRequest {
  id:              string
  referenceNumber: string          // our order id
  status:          string          // CR_REQUESTED | CR_PAID | CR_FAILED | …
  amount:          number          // decimal, as Abzer holds it
  currency:        string          // ISO code, upper case
  receiptId?:      string
  receiptNumber?:  string
  authCode?:       string
  payReferenceNo?: string
}

/** The statuses seen on the sandbox. Anything else is reported, not guessed at. */
export const ABZER_STATUS = { requested: 'CR_REQUESTED', paid: 'CR_PAID', failed: 'CR_FAILED' } as const

/* ─── AbzerService ─────────────────────────────────────── */

export class AbzerService {

  get isConfigured(): boolean { return !!(env.ABZER_ACCESS_KEY && env.ABZER_SECRET_KEY) }

  async createOrder(opts: AbzerCreateOrderOptions): Promise<AbzerCreateOrderResult> {
    if (!this.isConfigured) {
      throw new Error('ABZER_ACCESS_KEY and ABZER_SECRET_KEY must be configured')
    }

    /* Split display name into first / last (Abzer requires separate fields) */
    const parts     = opts.buyerName.trim().split(/\s+/)
    const firstName = parts[0]
    const lastName  = parts.length > 1 ? parts.slice(1).join(' ') : parts[0]

    /* Step 1 — create the direct payment request.
       The return URLs are not in the v5.1 request body; the hosted page uses
       them where the merchant template allows. Nothing depends on them: the
       return page, the webhook and the sweep each confirm with Abzer. */
    const returnBase = opts.returnUrl ?? `${env.CLIENT_URL}/payment-return`
    const body = JSON.stringify({
      templateConfiguration: { code: env.ABZER_TEMPLATE_CODE },
      firstName,
      lastName,
      email:           opts.buyerEmail,
      mobileNo:        opts.buyerPhone ?? '',
      /* A double, in AED — never more than two decimals. */
      amount:          Math.round(opts.amountAED * 100) / 100,
      referenceNumber: opts.orderId,   /* ← our orderId; appears as invoiceNumber in webhook */
      successUrl:      returnBase,
      failureUrl:      returnBase,
      cancelUrl:       returnBase,
    })
    /* Every request makes Abzer create a NEW customer coded <yyyyMMddHHmm>
       plus one random digit; when that code is already taken — anywhere on the
       merchant account, that minute — the whole request is refused 409
       "conflicts with existing data". Measured on the sandbox 2026-10-26: 5 of
       12 new buyers in one minute refused, and a minute holds ~11 at most;
       passing an existing customer does not avoid it. An Abzer defect,
       reported; until fixed, nothing was created, so asking again is safe. */
    let created = await abzerCall('/direct-payment-request/extended', { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS, body })
    for (let retry = 1; created.status === 409 && retry <= CONFLICT_RETRIES; retry++) {
      logger.warn({ orderId: opts.orderId, retry }, 'Abzer: customer-code conflict (409) — asking again')
      await new Promise(r => setTimeout(r, conflictDelayMs(retry)))
      created = await abzerCall('/direct-payment-request/extended', { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS, body })
    }

    if (!created.ok) {
      logger.error({ status: created.status, body: created.text.slice(0, 300) }, 'Abzer createPaymentRequest failed')
      throw new Error(`Abzer create payment request failed (${created.status}): ${created.text.slice(0, 300)}`)
    }

    const abzerRequestId = parse(created.text)?.id
    if (!isAbzerId(abzerRequestId)) {
      throw new Error('Abzer did not return a payment request ID')
    }

    /* Step 2 — generate the hosted payment link */
    const link = await abzerCall(`/direct-payment-request/${abzerRequestId}/link-generate`)
    if (!link.ok) {
      logger.error({ status: link.status, body: link.text.slice(0, 300), abzerRequestId }, 'Abzer link-generate failed')
      throw new Error(`Abzer link generation failed (${link.status}): ${link.text.slice(0, 300)}`)
    }

    const linkData = parse(link.text) as { mailLink?: string; isLinkExpired?: boolean } | null
    if (!linkData || linkData.isLinkExpired || !linkData.mailLink) {
      logger.error({ linkData, abzerRequestId }, 'Abzer returned expired/empty link')
      throw new Error('Abzer returned an expired or empty payment link. Please try again.')
    }

    logger.info({ abzerRequestId, orderId: opts.orderId }, 'Abzer: payment link created')

    return {
      abzerRequestId,
      checkoutUrl: linkData.mailLink,
    }
  }

  /** Abzer's own record of a payment request. Throws when it cannot be read —
      a lookup that failed has not said "unpaid". */
  async getPaymentRequest(abzerRequestId: string): Promise<AbzerPaymentRequest> {
    if (!this.isConfigured) throw new Error('Abzer is not configured')
    if (!isAbzerId(abzerRequestId)) throw new Error('Abzer request id is not a UUID')

    const r = await abzerCall(`/direct-payment-request/${abzerRequestId}`)
    const j = parse(r.text)
    if (!r.ok || !j) throw new Error(`Abzer lookup failed (${r.status}): ${r.text.slice(0, 200)}`)

    const amount = Number(j.amount)
    return {
      id:              String(j.id ?? ''),
      referenceNumber: String(j.referenceNumber ?? ''),
      status:          String(j.status?.code ?? ''),
      amount:          Number.isFinite(amount) ? amount : NaN,
      currency:        String(j.currency?.code ?? '').toUpperCase(),
      ...(j.receiptId      && { receiptId:      String(j.receiptId) }),
      ...(j.receiptNumber  && { receiptNumber:  String(j.receiptNumber) }),
      ...(j.authCode       && { authCode:       String(j.authCode) }),
      ...(j.payReferenceNo && { payReferenceNo: String(j.payReferenceNo) }),
    }
  }

  parseWebhookPayload(rawBody: string | Buffer): AbzerWebhookPayload {
    const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody
    return JSON.parse(text) as AbzerWebhookPayload
  }

  /** Every event in a webhook body. The docs allow a JSON object (one receipt),
      a JSON array (one payment settling several invoices), and — with the
      POST_PARAMS body type — form fields, which express has already parsed. */
  static webhookEvents(body: unknown): Record<string, unknown>[] {
    let v: unknown = body
    if (Buffer.isBuffer(v)) v = v.toString('utf8')
    if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return [] } }
    const list = Array.isArray(v) ? v : [v]
    return list.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
  }
}
