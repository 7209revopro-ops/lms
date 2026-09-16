import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'

/* ─────────────────────────────────────────────────────────────────────────────
   Tabby — BNPL "Pay in 4" for UAE (AED).

   Written against https://docs.tabby.ai (Pay in 4 custom integration) and the
   items Tabby's QA team verifies before switching a merchant to production.
   That checklist is what shapes several decisions below that would otherwise
   look arbitrary, so the relevant rule is quoted at each one.

   Money movement lives here: capture, refund and close all take a
   `reference_id` derived from OUR order id, never a timestamp, because Tabby
   treats it as an idempotency key — replaying the same reference_id replays
   the first result instead of moving money twice.
───────────────────────────────────────────────────────────────────────────── */

/* ─── Rejection copy ──────────────────────────────────────────────────────────
   Tabby publishes the exact wording merchants must show when pre-scoring
   declines a customer, and QA checks for it: "Rejected sessions treated as
   business outcomes, not errors; rejection messages displayed instead of
   redirects". Kept verbatim — do not paraphrase these. */
export const TABBY_REJECTION_MESSAGES: Record<string, { en: string; ar: string }> = {
  not_available: {
    en: 'Sorry, Tabby is unable to approve this purchase. Please use an alternative payment method for your order.',
    ar: 'نأسف، تابي غير قادرة على الموافقة على هذه العملية. الرجاء استخدام طريقة دفع أخرى.',
  },
  order_amount_too_high: {
    en: 'This purchase is above your current spending limit with Tabby, try a smaller cart or use another payment method',
    ar: 'قيمة الطلب تفوق الحد الأقصى المسموح به حاليًا مع تابي. يُرجى تخفيض قيمة السلة أو استخدام وسيلة دفع أخرى.',
  },
  order_amount_too_low: {
    en: 'The purchase amount is below the minimum amount required to use Tabby, try adding more items or use another payment method',
    ar: 'قيمة الطلب أقل من الحد الأدنى المطلوب لاستخدام خدمة تابي. يُرجى زيادة قيمة الطلب أو استخدام وسيلة دفع أخرى.',
  },
}

export type TabbyLang = 'en' | 'ar'

/* Unknown reasons fall back to the generic `not_available` copy rather than
   leaking a raw code like `order_amount_too_high` to a student. */
export function tabbyRejectionMessage(reason: string | null | undefined, lang: TabbyLang = 'en'): string {
  const entry = TABBY_REJECTION_MESSAGES[reason ?? 'not_available'] ?? TABBY_REJECTION_MESSAGES['not_available']!
  return entry[lang]
}

/* Thrown when Tabby declines the session. Carries the reason so the caller can
   surface Tabby's own copy instead of a generic "payment failed". */
export class TabbyRejectedError extends Error {
  readonly rejectionReason: string
  constructor(rejectionReason: string | null | undefined, lang: TabbyLang = 'en') {
    super(tabbyRejectionMessage(rejectionReason, lang))
    this.name = 'TabbyRejectedError'
    this.rejectionReason = rejectionReason ?? 'not_available'
  }
}

/* ─── Tabby API types ─────────────────────────────────────────────────────── */

export interface TabbyBuyer {
  name:  string
  email: string
  phone: string
  dob?:  string          // YYYY-MM-DD
}

export interface TabbyShippingAddress {
  city:    string
  address: string
  zip?:    string
}

export interface TabbyItem {
  title:            string
  quantity:         number
  unit_price:       string
  category:         string
  reference_id?:    string
  description?:     string
  discount_amount?: string
  image_url?:       string
  product_url?:     string
  is_refundable?:   boolean
}

/* One past purchase. Tabby scores on this, and QA checks that a second order
   actually carries real values: "Second order confirms buyer_history and
   order_history contain real values with ISO-8601 dates; optional fields
   omitted rather than empty". */
export interface TabbyOrderHistoryEntry {
  purchased_at:      string          // ISO-8601
  amount:            string
  status:            'new' | 'processing' | 'complete' | 'refunded' | 'canceled' | 'unknown'
  payment_method?:   'card' | 'cod'
  buyer?:            TabbyBuyer
  shipping_address?: TabbyShippingAddress
  items?:            TabbyItem[]
}

export interface TabbyBuyerHistory {
  registered_since:              string    // ISO-8601, the REAL signup date
  loyalty_level:                 number
  wishlist_count?:               number
  is_social_networks_connected?: boolean
  is_phone_number_verified?:     boolean
  is_email_verified?:            boolean
}

interface TabbyCheckoutRequest {
  payment: {
    amount:            string
    currency:          string
    description:       string
    buyer:             TabbyBuyer
    buyer_history:     TabbyBuyerHistory
    shipping_address?: TabbyShippingAddress
    order: {
      reference_id:    string
      updated_at:      string
      tax_amount:      string
      shipping_amount: string
      discount_amount: string
      items:           TabbyItem[]
    }
    order_history?:    TabbyOrderHistoryEntry[]
    meta?: {
      customer?: string
      order_id?: string
    }
  }
  /* merchant_urls is at ROOT level, not inside payment */
  merchant_urls: {
    success: string
    cancel:  string
    failure: string
    webhook: string
  }
  merchant_code: string
  lang:          string
}

/* A capture or refund entry as Tabby returns it. Ordering of these arrays is
   not guaranteed, so callers must read them by value and by `created_at` —
   QA: "Code reads captures[] and refunds[] by created_at, never by array
   position". */
export interface TabbyCaptureEntry {
  id?:           string
  amount:        string
  created_at:    string
  reference_id?: string
}

export interface TabbyPayment {
  id:        string
  status:    string          // normalised to UPPERCASE here
  amount:    string
  currency?: string
  /* The merchant order reference WE sent when the session was created. This is
     Tabby's own answer to "which order is this payment for", and it is the
     binding that makes a replayed payment id detectable. */
  orderReferenceId?: string
  captures:  TabbyCaptureEntry[]
  refunds:   TabbyCaptureEntry[]
}

interface TabbyCheckoutResponse {
  id:     string
  status: string
  payment?: {
    id:       string
    status:   string
    amount:   string
    currency: string
  }
  configuration?: {
    available_products?: {
      /* installments is an array of products, not a single object */
      installments?: Array<{ web_url: string; qr_code?: string }>
      pay_later?:    Array<{ web_url: string }>
    }
    products?: {
      installments?: { is_available?: boolean; rejection_reason?: string | null }
    }
  }
}

export interface TabbyCreateCheckoutOptions {
  amountAED:    number   // decimal AED amount e.g. 199.00
  orderId:      string
  courseTitle:  string
  courseId:     string
  courseUrl?:   string
  buyerEmail:   string
  buyerName:    string
  buyerPhone?:  string
  buyerDob?:    string
  /* The student's REAL signup timestamp — never "now". */
  registeredSince:  Date
  isEmailVerified?: boolean
  isPhoneVerified?: boolean
  shippingAddress?: TabbyShippingAddress
  orderHistory?:    TabbyOrderHistoryEntry[]
  lang?:            TabbyLang
  successUrl:   string
  cancelUrl:    string
  failureUrl:   string
}

export interface TabbyCheckoutResult {
  checkoutId:  string
  paymentId:   string
  checkoutUrl: string
}

export interface TabbyRegisteredWebhook {
  id:       string
  url:      string
  is_test?: boolean
  header?:  { title: string | null; value: string | null }
}

export interface TabbyEligibility {
  available:       boolean
  rejectionReason: string | null
  /* Tabby's own copy for this reason, ready to render. null when available. */
  message:         string | null
}

/* The endpoint we hand to Tabby, or null when it is not one Tabby can use.
   Tabby requires a reachable HTTPS URL and answers a localhost dev URL with an
   opaque 400, so the check is worth making on our side where we can say
   something useful about it. Pure and exported so it can be asserted without
   standing up the service. */
export function tabbyWebhookEndpoint(publicUrl: string | undefined | null): string | null {
  if (!publicUrl) return null
  const url = `${publicUrl}/api/v1/webhooks/tabby`
  return url.startsWith('https://') ? url : null
}

/* ─── Identifier hygiene ─────────────────────────────────────────────────────
   Tabby payment and checkout ids are UUIDs. Two of them arrive from OUTSIDE —
   `payment_id` on the return redirect (forwarded by the student's browser) and
   `id` in a webhook body — and both are spliced into the PATH of a request we
   authenticate with the secret key. An unvalidated value like
   `../../v1/webhooks` would be normalised by fetch into a request to a
   different, authenticated Tabby endpoint chosen by the caller. So every id is
   shape-checked here, at the last hop, regardless of what the route validated. */
export const TABBY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isTabbyId(value: unknown): value is string {
  return typeof value === 'string' && TABBY_ID_RE.test(value)
}

function assertTabbyId(value: string, what: string): void {
  if (!isTabbyId(value)) throw new Error(`Refusing to call Tabby with a malformed ${what}`)
}

/* Every outbound call gets a deadline. Without one a stalled Tabby response
   holds a webhook (and its retry slot) or a student's checkout request open
   indefinitely — and Tabby's own retry schedule assumes we answer within a
   minute. Money-moving calls get a little longer than reads. */
const TABBY_READ_TIMEOUT_MS  = 15_000
const TABBY_WRITE_TIMEOUT_MS = 25_000

function tabbyFetch(url: string, init: RequestInit = {}, timeoutMs = TABBY_READ_TIMEOUT_MS): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

/* ─── TabbyService ────────────────────────────────────────────────────────── */

export class TabbyService {
  private readonly baseUrl    = 'https://api.tabby.ai/api/v2'
  private readonly webhookUrl = 'https://api.tabby.ai/api/v1'  // webhook registration is v1

  private get authHeaders() {
    return {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.TABBY_SECRET_KEY}`,
    }
  }

  /* The webhook endpoints additionally require the merchant code as a header —
     it is how Tabby scopes them for a multi-store / multi-country merchant.
     Omitting it is not harmless: registration is rejected. */
  private get webhookHeaders() {
    return {
      ...this.authHeaders,
      'X-Merchant-Code': env.TABBY_MERCHANT_CODE ?? '',
    }
  }

  get isConfigured(): boolean {
    return Boolean(env.TABBY_SECRET_KEY && env.TABBY_MERCHANT_CODE)
  }

  /* Every registered webhook for this merchant_code + key pair. */
  async listWebhooks(): Promise<TabbyRegisteredWebhook[]> {
    if (!this.isConfigured) return []
    const resp = await tabbyFetch(`${this.webhookUrl}/webhooks`, { headers: this.webhookHeaders })
    if (!resp.ok) {
      throw new Error(`Tabby listWebhooks ${resp.status}: ${await resp.text()}`)
    }
    /* Documented as "a Webhook object or null" — in practice an array. Normalise
       all three shapes rather than trusting one. */
    const data = await resp.json() as unknown
    if (Array.isArray(data)) return data as TabbyRegisteredWebhook[]
    if (data && typeof data === 'object') return [data as TabbyRegisteredWebhook]
    return []
  }

  /* Point Tabby at our webhook endpoint. Runs on every boot, so it has to be
     genuinely idempotent — and that takes more than hoping Tabby de-duplicates.

     Tabby allows only FOUR webhooks per merchant_code + key pair and does not
     document what a repeat POST of the same URL does. Under PM2, which restarts
     on every deploy, blindly posting would plausibly exhaust that budget within
     a day and then fail silently. So: list first, and only register when our URL
     is genuinely absent.

     `is_test` is deliberately not sent. Tabby deprecated it — the environment is
     decided by which key authorises this call — and the previous value was wrong
     anyway, testing for an `sk_live_` prefix that no Tabby key has ever used. */
  async registerWebhook(): Promise<void> {
    if (!this.isConfigured || !env.TABBY_WEBHOOK_SECRET || !env.BACKEND_PUBLIC_URL) return

    const url = tabbyWebhookEndpoint(env.BACKEND_PUBLIC_URL)
    if (!url) {
      logger.warn(
        { backendPublicUrl: env.BACKEND_PUBLIC_URL },
        'Tabby webhook not registered: BACKEND_PUBLIC_URL is not HTTPS. ' +
        'Local checkouts still fulfil via the verify-return fallback; use a public HTTPS tunnel to test webhooks.',
      )
      return
    }

    try {
      const existing = await this.listWebhooks()
      const ours     = existing.find(w => w.url === url)

      if (ours) {
        logger.info({ url, id: ours.id }, 'Tabby webhook already registered')
        return
      }
      if (existing.length >= 4) {
        logger.error(
          { url, registered: existing.map(w => w.url) },
          'Tabby webhook NOT registered: this merchant_code + key pair already has 4 webhooks (Tabby’s limit). ' +
          'Remove a stale one in the Tabby dashboard.',
        )
        return
      }

      const resp = await tabbyFetch(`${this.webhookUrl}/webhooks`, {
        method:  'POST',
        headers: this.webhookHeaders,
        body: JSON.stringify({
          url,
          header: {
            title: 'Authorization',
            value: `Bearer ${env.TABBY_WEBHOOK_SECRET}`,
          },
        }),
      })
      if (resp.ok) {
        logger.info({ url }, 'Tabby webhook registered')
      } else {
        const text = await resp.text()
        logger.warn({ status: resp.status, text }, 'Tabby webhook registration failed (non-fatal)')
      }
    } catch (err) {
      logger.warn({ err }, 'Tabby webhook registration error (non-fatal)')
    }
  }

  /* Background pre-scoring: ask Tabby whether this customer can use Tabby for
     this amount BEFORE the button is shown. QA requires it ("Background
     pre-scoring check present and functioning") and also requires that we add
     no restrictions of our own on top — availability is Tabby's call alone.

     Uses the same /checkout endpoint with a minimal payload. Network and API
     failures fail SAFE (available), per Tabby's guidance: a scoring outage
     should not pull the payment method off the page. A genuine `rejected`
     answer is a business outcome, not an error, and carries copy to show. */
  async checkEligibility(opts: {
    amountAED:   number
    buyerEmail:  string
    buyerPhone?: string
    lang?:       TabbyLang
  }): Promise<TabbyEligibility> {
    if (!this.isConfigured) {
      return { available: false, rejectionReason: null, message: null }
    }
    try {
      const resp = await tabbyFetch(`${this.baseUrl}/checkout`, {
        method:  'POST',
        headers: this.authHeaders,
        body: JSON.stringify({
          payment: {
            amount:   opts.amountAED.toFixed(2),
            currency: env.TABBY_CURRENCY,
            buyer: { email: opts.buyerEmail, phone: opts.buyerPhone ?? '' },
          },
          lang:          opts.lang ?? 'en',
          merchant_code: env.TABBY_MERCHANT_CODE,
        }),
      })
      if (!resp.ok) {
        logger.warn({ status: resp.status }, 'Tabby pre-scoring call failed — failing safe (available)')
        return { available: true, rejectionReason: null, message: null }
      }
      const data = await resp.json() as TabbyCheckoutResponse
      if (data.status === 'rejected') {
        const reason = data.configuration?.products?.installments?.rejection_reason ?? 'not_available'
        return {
          available:       false,
          rejectionReason: reason,
          message:         tabbyRejectionMessage(reason, opts.lang ?? 'en'),
        }
      }
      return { available: true, rejectionReason: null, message: null }
    } catch (err) {
      logger.warn({ err }, 'Tabby pre-scoring error — failing safe (available)')
      return { available: true, rejectionReason: null, message: null }
    }
  }

  async createCheckout(opts: TabbyCreateCheckoutOptions): Promise<TabbyCheckoutResult> {
    if (!this.isConfigured) {
      throw new Error('TABBY_SECRET_KEY and TABBY_MERCHANT_CODE must be configured')
    }

    const amountStr  = opts.amountAED.toFixed(2)
    const lang       = opts.lang ?? 'en'
    const webhookUrl = `${env.BACKEND_PUBLIC_URL}/api/v1/webhooks/tabby`

    const buyer: TabbyBuyer = {
      email: opts.buyerEmail,
      name:  opts.buyerName,
      phone: opts.buyerPhone ?? '',
      ...(opts.buyerDob && { dob: opts.buyerDob }),
    }

    const item: TabbyItem = {
      title:           tabbyField(opts.courseTitle),
      quantity:        1,
      unit_price:      amountStr,
      discount_amount: '0.00',
      reference_id:    opts.courseId,
      category:        'Digital Services',
      is_refundable:   true,
      ...(opts.courseUrl && { product_url: opts.courseUrl }),
    }

    const body: TabbyCheckoutRequest = {
      payment: {
        amount:      amountStr,
        currency:    env.TABBY_CURRENCY,
        description: tabbyField(`Delta Academy — ${opts.courseTitle}`),
        buyer,
        buyer_history: {
          /* The student's real signup date. Sending `now` here (which this used
             to do) is exactly what QA looks for on a second order. */
          registered_since: opts.registeredSince.toISOString(),
          loyalty_level:    0,
          ...(opts.isEmailVerified !== undefined && { is_email_verified:        opts.isEmailVerified }),
          ...(opts.isPhoneVerified !== undefined && { is_phone_number_verified: opts.isPhoneVerified }),
        },
        /* Omitted entirely for students with no address on file — QA wants
           optional fields absent rather than present-and-empty. */
        ...(opts.shippingAddress && { shipping_address: opts.shippingAddress }),
        order: {
          reference_id:    opts.orderId,
          updated_at:      new Date().toISOString(),
          tax_amount:      '0.00',
          shipping_amount: '0.00',
          discount_amount: '0.00',
          items:           [item],
        },
        ...(opts.orderHistory?.length && { order_history: opts.orderHistory }),
        meta: {
          order_id: opts.orderId,
        },
      },
      /* merchant_urls at ROOT level per Tabby API spec */
      merchant_urls: {
        success: opts.successUrl,
        cancel:  opts.cancelUrl,
        failure: opts.failureUrl,
        webhook: webhookUrl,
      },
      merchant_code: env.TABBY_MERCHANT_CODE!,
      lang,
    }

    const resp = await tabbyFetch(`${this.baseUrl}/checkout`, {
      method:  'POST',
      headers: this.authHeaders,
      body:    JSON.stringify(body),
    }, TABBY_WRITE_TIMEOUT_MS)

    if (!resp.ok) {
      const text = await resp.text()
      logger.error({ status: resp.status, body: text }, 'Tabby createCheckout failed')
      /* The response body is logged, not thrown. It can carry merchant config
         and echo back the payload we sent (buyer email, phone, order history),
         and this message reaches the browser verbatim in development. */
      throw new Error(`Tabby API error ${resp.status}`)
    }

    const data = await resp.json() as TabbyCheckoutResponse

    /* A declined session comes back 200 with status `rejected`. It is a
       business outcome, so it becomes a typed rejection carrying Tabby's own
       copy rather than a generic failure. */
    if (data.status === 'rejected') {
      const reason = data.configuration?.products?.installments?.rejection_reason ?? 'not_available'
      logger.info({ orderId: opts.orderId, reason }, 'Tabby rejected the checkout session')
      throw new TabbyRejectedError(reason, lang)
    }

    /* installments is an array — take the first element's web_url */
    const checkoutUrl =
      data.configuration?.available_products?.installments?.[0]?.web_url ??
      data.configuration?.available_products?.pay_later?.[0]?.web_url

    if (!checkoutUrl) {
      const reason = data.configuration?.products?.installments?.rejection_reason
      logger.error({ data }, 'Tabby: no checkout URL returned — product may not be available')
      throw new TabbyRejectedError(reason ?? 'not_available', lang)
    }

    return {
      checkoutId:  data.id,
      paymentId:   data.payment?.id ?? '',
      checkoutUrl,
    }
  }

  /* Server-to-server status check. Required before capture, and the only
     trustworthy source of truth — QA: "Always verify payment status via your
     backend. Never rely on redirect URLs or query parameters alone."

     Note the case difference Tabby documents: webhooks send `authorized`
     lowercase, this endpoint returns `AUTHORIZED` uppercase. Normalised to
     uppercase here so callers never have to care. */
  async getPayment(paymentId: string): Promise<TabbyPayment> {
    if (!env.TABBY_SECRET_KEY) {
      throw new Error('TABBY_SECRET_KEY not configured')
    }
    assertTabbyId(paymentId, 'payment id')
    const resp = await tabbyFetch(`${this.baseUrl}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { 'Authorization': `Bearer ${env.TABBY_SECRET_KEY}` },
    })
    if (!resp.ok) {
      const text = await resp.text()
      logger.warn({ status: resp.status, paymentId, text }, 'Tabby getPayment failed')
      throw new Error(`Tabby getPayment ${resp.status}: ${text}`)
    }
    const data = await resp.json() as Partial<TabbyPayment> & {
      id: string; status: string
      order?: { reference_id?: string }
    }
    return {
      id:       data.id,
      status:   String(data.status).toUpperCase(),
      amount:   data.amount ?? '0.00',
      ...(data.currency && { currency: data.currency }),
      ...(data.order?.reference_id && { orderReferenceId: data.order.reference_id }),
      captures: Array.isArray(data.captures) ? data.captures : [],
      refunds:  Array.isArray(data.refunds)  ? data.refunds  : [],
    }
  }

  /* Capture an AUTHORIZED payment. Only captured payments settle to us, and
     Tabby auto-captures after 21 days if we never do.

     `reference_id` is `capture-<our order id>` exactly as Tabby recommends —
     derived from the order, never a timestamp — so a retry after a timeout
     replays the first capture instead of taking the money twice.

     Returns whether Tabby accepted it. Callers must not treat a failed capture
     as a failed payment: funds are already committed at AUTHORIZED, so the
     course is owed either way — but an uncaptured payment is money we never
     receive, so this must be loud rather than "(non-fatal)". */
  async capturePayment(opts: {
    paymentId:   string
    amountAED:   string
    orderId:     string
    courseTitle: string
    courseId:    string
  }): Promise<boolean> {
    if (!env.TABBY_SECRET_KEY) {
      throw new Error('TABBY_SECRET_KEY not configured')
    }
    assertTabbyId(opts.paymentId, 'payment id')
    const resp = await tabbyFetch(`${this.baseUrl}/payments/${encodeURIComponent(opts.paymentId)}/captures`, {
      method:  'POST',
      headers: this.authHeaders,
      body: JSON.stringify({
        amount:          opts.amountAED,
        reference_id:    `capture-${opts.orderId}`,
        tax_amount:      '0.00',
        shipping_amount: '0.00',
        discount_amount: '0.00',
        items: [{
          reference_id: opts.courseId,
          title:        tabbyField(opts.courseTitle),
          quantity:     1,
          unit_price:   opts.amountAED,
          category:     'Digital Services',
        }],
      }),
    }, TABBY_WRITE_TIMEOUT_MS)
    if (!resp.ok) {
      const text = await resp.text()
      logger.error(
        { status: resp.status, paymentId: opts.paymentId, orderId: opts.orderId, text },
        'Tabby capture FAILED — payment is authorized but not captured, settlement needs follow-up',
      )
      return false
    }
    logger.info({ paymentId: opts.paymentId, orderId: opts.orderId }, 'Tabby payment captured')
    return true
  }

  /* Refund part or all of a CLOSED payment.

     Tabby validates refunds against the CAPTURED amount, not the authorized
     one, and a reused `reference_id` replays the first refund rather than
     issuing a second — so a genuine second refund needs a distinct reference.
     `attempt` exists for that: callers pass a stable discriminator (the count
     of refunds already on the payment), never a timestamp, so a retry of the
     same refund stays idempotent. */
  async refundPayment(opts: {
    paymentId:    string
    amountAED:    string
    orderId:      string
    reason?:      string
    attempt?:     number
    courseTitle?: string
    courseId?:    string
  }): Promise<boolean> {
    if (!env.TABBY_SECRET_KEY) {
      throw new Error('TABBY_SECRET_KEY not configured')
    }
    const suffix      = opts.attempt && opts.attempt > 1 ? `-${opts.attempt}` : ''
    const referenceId = `refund-${opts.orderId}${suffix}`

    assertTabbyId(opts.paymentId, 'payment id')
    const resp = await tabbyFetch(`${this.baseUrl}/payments/${encodeURIComponent(opts.paymentId)}/refunds`, {
      method:  'POST',
      headers: this.authHeaders,
      body: JSON.stringify({
        amount:       opts.amountAED,
        reference_id: referenceId,
        ...(opts.reason && { reason: opts.reason }),
        ...(opts.courseTitle && opts.courseId && {
          items: [{
            reference_id: opts.courseId,
            title:        tabbyField(opts.courseTitle),
            quantity:     1,
            unit_price:   opts.amountAED,
            category:     'Digital Services',
          }],
        }),
      }),
    }, TABBY_WRITE_TIMEOUT_MS)
    if (!resp.ok) {
      const text = await resp.text()
      logger.error({ status: resp.status, paymentId: opts.paymentId, referenceId, text }, 'Tabby refund failed')
      return false
    }
    logger.info({ paymentId: opts.paymentId, referenceId, amount: opts.amountAED }, 'Tabby refund issued')
    return true
  }

  /* Close a payment without capturing it — Tabby's cancellation path. The
     customer is refunded everything they have paid. Capturing the full amount
     closes the payment automatically, so this is only for orders we will not
     fulfil at all, or for the undelivered remainder after a partial capture. */
  async closePayment(paymentId: string): Promise<boolean> {
    if (!env.TABBY_SECRET_KEY) {
      throw new Error('TABBY_SECRET_KEY not configured')
    }
    assertTabbyId(paymentId, 'payment id')
    const resp = await tabbyFetch(`${this.baseUrl}/payments/${encodeURIComponent(paymentId)}/close`, {
      method:  'POST',
      headers: this.authHeaders,
      body:    JSON.stringify({}),
    }, TABBY_WRITE_TIMEOUT_MS)
    if (!resp.ok) {
      const text = await resp.text()
      logger.error({ status: resp.status, paymentId, text }, 'Tabby close failed')
      return false
    }
    logger.info({ paymentId }, 'Tabby payment closed')
    return true
  }
}

/* Tabby caps every string field at 255 characters and answers a longer one with
   a 400 `bad_data`. Course titles are admin-authored free text, so the two
   fields built from them are clipped rather than left to fail a checkout. */
const TABBY_MAX_FIELD = 255

export function tabbyField(value: string): string {
  return value.length <= TABBY_MAX_FIELD ? value : `${value.slice(0, TABBY_MAX_FIELD - 1)}…`
}

/* Total of a captures[] / refunds[] array in fils, read by value rather than by
   position — Tabby does not guarantee array order. */
export function tabbySumFils(entries: TabbyCaptureEntry[]): number {
  return entries.reduce((sum, e) => sum + Math.round(Number(e.amount ?? 0) * 100), 0)
}
