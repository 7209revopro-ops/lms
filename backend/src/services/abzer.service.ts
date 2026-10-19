import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'

/*
 * AbzerService — Abzer DMCC / BillXPro payment gateway (UAE)
 * API docs: version 5.1
 *
 * Flow:
 *  1. authenticate()  → cached Bearer token (60-min TTL, refreshed at 50 min)
 *  2. createOrder()   → POST /direct-payment-request/extended  (get UUID)
 *                     → GET  /direct-payment-request/{id}/link-generate (get redirect URL)
 *  3. User pays on BillXPro hosted page
 *  4. Webhook POST → WH_RECEIPT_POSTING, paymentStatus=Success
 *                    invoiceNumber = our referenceNumber = our orderId
 *
 * Security: Abzer sends a custom header you configure in their admin console.
 *   Set X-Abzer-Secret to ABZER_WEBHOOK_SECRET and check it in the webhook handler.
 */

/* ─── module-level token cache (shared across service instances) ─── */
let _cachedToken: { token: string; expiresAt: number } | null = null

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
  })

  if (!resp.ok) {
    const text = await resp.text()
    logger.error({ status: resp.status, body: text }, 'Abzer authentication failed')
    throw new Error(`Abzer auth failed (${resp.status}): ${text}`)
  }

  const data = await resp.json() as { accessKey: string; token: string }
  /* Cache for 50 min — Abzer token is valid for 60 min */
  _cachedToken = { token: data.token, expiresAt: Date.now() + 50 * 60 * 1000 }
  return data.token
}

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

/* ─── AbzerService ─────────────────────────────────────── */

export class AbzerService {

  async createOrder(opts: AbzerCreateOrderOptions): Promise<AbzerCreateOrderResult> {
    if (!env.ABZER_ACCESS_KEY || !env.ABZER_SECRET_KEY) {
      throw new Error('ABZER_ACCESS_KEY and ABZER_SECRET_KEY must be configured')
    }

    const token = await fetchAbzerToken()

    /* Split display name into first / last (Abzer requires separate fields) */
    const parts     = opts.buyerName.trim().split(/\s+/)
    const firstName = parts[0]
    const lastName  = parts.length > 1 ? parts.slice(1).join(' ') : parts[0]

    /* Step 1 — create the direct payment request */
    const returnBase = opts.returnUrl ?? `${env.CLIENT_URL}/payment-return`
    const createResp = await fetch(`${env.ABZER_BASE_URL}/direct-payment-request/extended`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        templateConfiguration: { code: env.ABZER_TEMPLATE_CODE },
        firstName,
        lastName,
        email:           opts.buyerEmail,
        mobileNo:        opts.buyerPhone ?? '',
        amount:          opts.amountAED,
        referenceNumber: opts.orderId,   /* ← our orderId; appears as invoiceNumber in webhook */
        successUrl:      returnBase,
        failureUrl:      returnBase,
        cancelUrl:       returnBase,
      }),
    })

    if (!createResp.ok) {
      const text = await createResp.text()
      logger.error({ status: createResp.status, body: text }, 'Abzer createPaymentRequest failed')
      throw new Error(`Abzer create payment request failed (${createResp.status}): ${text}`)
    }

    const created = await createResp.json() as { id: string; [key: string]: unknown }
    const abzerRequestId = created.id

    if (!abzerRequestId) {
      throw new Error('Abzer did not return a payment request ID')
    }

    /* Step 2 — generate the hosted payment link */
    const linkResp = await fetch(
      `${env.ABZER_BASE_URL}/direct-payment-request/${abzerRequestId}/link-generate`,
      {
        method:  'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      },
    )

    if (!linkResp.ok) {
      const text = await linkResp.text()
      logger.error({ status: linkResp.status, body: text, abzerRequestId }, 'Abzer link-generate failed')
      throw new Error(`Abzer link generation failed (${linkResp.status}): ${text}`)
    }

    const linkData = await linkResp.json() as { mailLink: string; isLinkExpired: boolean }

    if (linkData.isLinkExpired || !linkData.mailLink) {
      logger.error({ linkData, abzerRequestId }, 'Abzer returned expired/empty link')
      throw new Error('Abzer returned an expired or empty payment link. Please try again.')
    }

    logger.info({ abzerRequestId, orderId: opts.orderId }, 'Abzer: payment link created')

    return {
      abzerRequestId,
      checkoutUrl: linkData.mailLink,
    }
  }

  parseWebhookPayload(rawBody: string | Buffer): AbzerWebhookPayload {
    const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody
    return JSON.parse(text) as AbzerWebhookPayload
  }
}
