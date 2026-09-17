import { createHmac, timingSafeEqual } from 'crypto'
import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'

/* ─────────────────────────────────────────────────────────────────────────────
   Tamara — BNPL "Pay in 3" for UAE (AED).

   Written against docs.tamara.co. Tamara looks like Tabby from a distance and
   is not, in three ways that decide whether this integration is correct:

   1. `approved` IS NOT PAID. Tabby hands you an authorised payment when the
      customer finishes. Tamara stops at `approved` and waits for the merchant
      to call POST /orders/{id}/authorise. Skip it and the order EXPIRES after
      72 hours — with the customer's first instalment already taken. Course
      access is granted at `authorised`, never at `approved`.

   2. THE WEBHOOK JWT DOES NOT SIGN THE BODY. Its only claims are exp/iat/iss;
      it carries no order id, no event type, no body hash. It proves the caller
      holds our notification token and nothing more, so a valid token with a
      tampered body verifies. Every money-moving event is therefore re-read
      from GET /orders/{id} before we act on it — the webhook is a hint that
      something changed, never a statement of what.

   3. `updated` MEANS PARTIALLY CANCELLED, and it arrives on the same
      `order_canceled` event as a real cancellation. Branching on the event
      name alone would strip a paying student of their course.

   Money settles at capture, not at authorise. A course is delivered instantly,
   so we capture immediately after authorising rather than let Tamara's 21-day
   auto-capture do it.
───────────────────────────────────────────────────────────────────────────── */

/* ─── Statuses ────────────────────────────────────────────────────────────────
   The complete set, verbatim from the order-status-flow docs. Two spellings
   are traps: `authorised` is British, `canceled` is American single-L, and
   Tamara mixes the conventions inside a single payload (`authorized_amount`
   sits next to `status: "authorised"`). Anything outside this list is treated
   as unknown rather than defaulted, so a new Tamara status surfaces as an
   alert instead of silently enrolling or un-enrolling somebody. */
export const TAMARA_STATUSES = [
  'new', 'approved', 'authorised', 'declined', 'expired',
  'fully_captured', 'partially_captured',
  'fully_refunded', 'partially_refunded',
  'canceled', 'updated',
] as const
export type TamaraStatus = (typeof TAMARA_STATUSES)[number]

export function isTamaraStatus(v: unknown): v is TamaraStatus {
  return typeof v === 'string' && (TAMARA_STATUSES as readonly string[]).includes(v)
}

/* Statuses at which the customer's money is committed to us. `approved` is
   deliberately absent: the customer has paid Tamara their first instalment,
   but we hold nothing and must not fulfil. */
const PAID_STATUSES: ReadonlySet<string> = new Set<TamaraStatus>([
  'authorised', 'fully_captured', 'partially_captured', 'updated',
])

export function tamaraStatusIsPaid(status: string): boolean {
  return PAID_STATUSES.has(status)
}

/* Terminal and unrecoverable — start a fresh session rather than retrying. */
const DEAD_STATUSES: ReadonlySet<string> = new Set<TamaraStatus>([
  'declined', 'expired', 'canceled',
])

export function tamaraStatusIsDead(status: string): boolean {
  return DEAD_STATUSES.has(status)
}

/* ─── Webhook events ─────────────────────────────────────────────────────── */
export const TAMARA_WEBHOOK_EVENTS = [
  'order_approved', 'order_authorised', 'order_declined', 'order_expired',
  'order_canceled', 'order_captured', 'order_refunded',
] as const
export type TamaraWebhookEvent = (typeof TAMARA_WEBHOOK_EVENTS)[number]

/* ─── Money helpers ──────────────────────────────────────────────────────────
   Every amount object in the API is {amount, currency}. The OpenAPI default
   currency is SAR on every single endpoint, so AED is always sent explicitly —
   a copied example or a generated client would otherwise quietly charge in the
   wrong currency. */
export interface TamaraMoney {
  amount:   number
  currency: string
}

function money(amountAED: number): TamaraMoney {
  return { amount: Number(amountAED.toFixed(2)), currency: env.TAMARA_CURRENCY }
}

/* Tamara caps several strings; over-long values are rejected outright. */
function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/* Two endpoints want the phone in two different shapes, which is easy to get
   backwards:
     • create-checkout `consumer.phone_number` — LOCAL, no country code, no '+'
       (docs example "566027755")
     • eligibility `customer.phone_number`     — full international digits,
       still no '+' (docs example "971501234567")
   Both are derived here from whatever the student happens to have stored. */
export function tamaraLocalPhone(raw: string | undefined | null): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) return ''
  const noCc = digits.startsWith('971') ? digits.slice(3) : digits
  return noCc.replace(/^0+/, '')
}

export function tamaraIntlPhone(raw: string | undefined | null): string {
  const local = tamaraLocalPhone(raw)
  return local ? `971${local}` : ''
}

/* ─── API types ──────────────────────────────────────────────────────────── */

export interface TamaraConsumer {
  first_name:   string
  last_name:    string
  phone_number: string
  email?:       string
}

export interface TamaraAddress {
  first_name:    string
  last_name:     string
  line1:         string
  city:          string
  country_code:  string
  line2?:        string
  region?:       string
  phone_number?: string
}

export interface TamaraItem {
  reference_id:     string
  type:             string
  name:             string
  sku:              string
  quantity:         number
  total_amount:     TamaraMoney
  unit_price?:      TamaraMoney
  discount_amount?: TamaraMoney
  tax_amount?:      TamaraMoney
  item_url?:        string
  image_url?:       string
}

export interface TamaraCreateCheckoutOptions {
  amountAED:   number
  orderId:     string          // our LMS order id → order_reference_id
  courseTitle: string
  courseId:    string
  courseUrl?:  string
  buyerEmail:  string
  buyerName:   string
  buyerPhone?: string
  /** City / address line from the student's enrolment application, when held. */
  city?:       string
  addressLine?: string
  instalments?: number
  lang?:       'en' | 'ar'
  successUrl:  string
  cancelUrl:   string
  failureUrl:  string
}

export interface TamaraCheckoutResult {
  checkoutId:    string
  tamaraOrderId: string
  checkoutUrl:   string
  status:        string
}

/* What GET /orders/{id} tells us. This is the ONLY trustworthy view of an
   order — the webhook body is not. */
export interface TamaraOrder {
  orderId:          string
  orderReferenceId: string
  status:           string
  /** Order total as Tamara holds it, in fils. */
  totalFils:        number
  currency:         string
  capturedFils:     number
  refundedFils:     number
  canceledFils:     number
  autoCaptured:     boolean
  raw:              unknown
}

export interface TamaraEligibility {
  available:       boolean
  rejectionReason: string | null
  message:         string | null
}

/* Tamara publishes no mandated decline copy the way Tabby does, so this is
   ours — deliberately neutral, and never exposing that a lender scored the
   student. */
export const TAMARA_UNAVAILABLE_MESSAGE = {
  en: 'Tamara is not available for this purchase. Please choose another payment method.',
  ar: 'خدمة تمارا غير متاحة لهذه العملية. يُرجى اختيار وسيلة دفع أخرى.',
} as const

export class TamaraRejectedError extends Error {
  readonly rejectionReason: string
  constructor(reason: string | null | undefined, lang: 'en' | 'ar' = 'en') {
    super(TAMARA_UNAVAILABLE_MESSAGE[lang])
    this.name = 'TamaraRejectedError'
    this.rejectionReason = reason ?? 'not_available'
  }
}

/* ─── Identifier hygiene ─────────────────────────────────────────────────────
   Tamara order ids are UUIDs and they arrive from outside — in webhook JSON,
   and (via the order row) on paths we authenticate with the API token. An
   unvalidated value would let a caller redirect an authenticated request to a
   different endpoint, so the shape is checked at the last hop regardless of
   what the route validated. */
export const TAMARA_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isTamaraId(value: unknown): value is string {
  return typeof value === 'string' && TAMARA_ID_RE.test(value)
}

function assertTamaraId(value: string, what: string): void {
  if (!isTamaraId(value)) throw new Error(`Refusing to call Tamara with a malformed ${what}`)
}

/* Every outbound call gets a deadline. Without one a stalled Tamara response
   holds a webhook (and the student's checkout request) open indefinitely. */
const READ_TIMEOUT_MS  = 15_000
const WRITE_TIMEOUT_MS = 25_000

/* ─── TamaraService ──────────────────────────────────────────────────────── */

export class TamaraService {
  /* Pinned from our own config, never from the OpenAPI default — which is
     SANDBOX, so a client that forgot to set it would "succeed" in production
     while no money moved. */
  private get baseUrl(): string {
    return String(env.TAMARA_BASE_URL).replace(/\/+$/, '')
  }

  get isConfigured(): boolean {
    return Boolean(env.TAMARA_API_KEY)
  }

  /** True when pointed at Tamara's production host — used to refuse test-only paths. */
  get isProduction(): boolean {
    return /^https:\/\/api\.tamara\.co/i.test(this.baseUrl)
  }

  private get headers() {
    return {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.TAMARA_API_KEY}`,
    }
  }

  private async call<T>(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<{ ok: boolean; status: number; data: T | null; text: string }> {
    const { timeoutMs = READ_TIMEOUT_MS, ...rest } = init
    const resp = await fetch(`${this.baseUrl}${path}`, {
      ...rest,
      headers: { ...this.headers, ...(rest.headers ?? {}) },
      signal:  AbortSignal.timeout(timeoutMs),
    })
    const text = await resp.text()
    let data: T | null = null
    try { data = text ? JSON.parse(text) as T : null } catch { /* non-JSON body */ }
    return { ok: resp.ok, status: resp.status, data, text }
  }

  /* ─── Eligibility ────────────────────────────────────────────────────────
     Asks Tamara whether this customer can use Tamara for this amount before
     the button is offered. The status-flow diagram models exactly this: an
     ineligible customer's Tamara option is greyed out rather than offered and
     then refused at the hosted page.

     Fails SAFE. A scoring outage must not pull a payment method off the page;
     Tamara will decline at checkout if it has to. */
  async checkEligibility(opts: {
    amountAED: number
    phone?:    string
    email?:    string
    lang?:     'en' | 'ar'
  }): Promise<TamaraEligibility> {
    if (!this.isConfigured) return { available: false, rejectionReason: null, message: null }

    try {
      const r = await this.call<{
        has_available_payment_options?: boolean
        available_payment_labels?: unknown[]
      }>('/pre-checkout/v1/eligibility', {
        method: 'POST',
        body: JSON.stringify({
          order: { amount: Number(opts.amountAED.toFixed(2)), currency: env.TAMARA_CURRENCY },
          customer: {
            /* Full international digits, no '+', per this endpoint's example.
               Tamara treats a missing phone as eligible. */
            ...(opts.phone && { phone_number: tamaraIntlPhone(opts.phone) }),
            ...(opts.email && { email: opts.email }),
          },
        }),
      })

      if (!r.ok) {
        logger.warn({ status: r.status }, 'Tamara eligibility call failed — failing safe (available)')
        return { available: true, rejectionReason: null, message: null }
      }

      const available = r.data?.has_available_payment_options !== false
      return available
        ? { available: true, rejectionReason: null, message: null }
        : {
            available: false,
            rejectionReason: 'not_available',
            message: TAMARA_UNAVAILABLE_MESSAGE[opts.lang ?? 'en'],
          }
    } catch (err) {
      logger.warn({ err }, 'Tamara eligibility error — failing safe (available)')
      return { available: true, rejectionReason: null, message: null }
    }
  }

  /* ─── Create checkout session ───────────────────────────────────────────── */
  async createCheckout(opts: TamaraCreateCheckoutOptions): Promise<TamaraCheckoutResult> {
    if (!this.isConfigured) {
      throw new Error('TAMARA_API_KEY must be configured')
    }
    if (env.TAMARA_CURRENCY !== 'AED') {
      throw new Error(`Tamara integration is AED-only; TAMARA_CURRENCY is ${env.TAMARA_CURRENCY}`)
    }

    const parts     = opts.buyerName.trim().split(/\s+/)
    const firstName = parts[0] || 'Student'
    const lastName  = parts.slice(1).join(' ') || firstName
    const total     = money(opts.amountAED)

    const item: TamaraItem = {
      reference_id: opts.courseId,
      type:         'Digital',
      name:         clip(opts.courseTitle, 255),
      sku:          clip(opts.courseId, 128),
      quantity:     1,
      unit_price:   total,
      total_amount: total,
      ...(opts.courseUrl && { item_url: opts.courseUrl }),
    }

    /* shipping_address is REQUIRED even for a digital course with nothing to
       ship. Tamara uses it for risk scoring, so the student's real city is
       sent when we hold one. */
    const address: TamaraAddress = {
      first_name:   firstName,
      last_name:    lastName,
      line1:        clip(opts.addressLine || opts.city || 'N/A', 255),
      city:         clip(opts.city || 'Dubai', 100),
      country_code: 'AE',
      ...(opts.buyerPhone && { phone_number: tamaraLocalPhone(opts.buyerPhone) }),
    }

    const body = {
      order_reference_id: opts.orderId,
      total_amount:       total,
      description:        clip(`Delta Academy — ${opts.courseTitle}`, 256),
      country_code:       'AE',
      payment_type:       'PAY_BY_INSTALMENTS',
      instalments:        opts.instalments ?? 3,
      locale:             opts.lang === 'ar' ? 'ar_AE' : 'en_US',
      items:              [item],
      consumer: {
        first_name:   firstName,
        last_name:    lastName,
        /* LOCAL format for this endpoint — no country code, no '+'. */
        phone_number: tamaraLocalPhone(opts.buyerPhone),
        ...(opts.buyerEmail && { email: opts.buyerEmail }),
      } satisfies TamaraConsumer,
      shipping_address: address,
      /* Both objects are required even at zero. */
      shipping_amount: money(0),
      tax_amount:      money(0),
      /* success / failure / cancel only. There is NO `notification` key — the
         webhook is registered separately against the account, not per session.
         Sending one is silently ignored and gives a false sense of coverage. */
      merchant_url: {
        success: opts.successUrl,
        failure: opts.failureUrl,
        cancel:  opts.cancelUrl,
      },
    }

    const r = await this.call<{
      checkout_id?: string
      order_id?:    string
      checkout_url?: string
      status?:      string
    }>('/checkout', { method: 'POST', body: JSON.stringify(body), timeoutMs: WRITE_TIMEOUT_MS })

    if (!r.ok) {
      /* Body is logged, never thrown — it echoes the payload back, including
         the student's name, email and phone. */
      logger.error({ status: r.status, body: r.text }, 'Tamara createCheckout failed')
      throw new Error(`Tamara API error ${r.status}`)
    }

    const checkoutUrl = r.data?.checkout_url
    const orderId     = r.data?.order_id
    if (!checkoutUrl || !orderId) {
      logger.error({ data: r.data }, 'Tamara: session created without a checkout_url / order_id')
      throw new TamaraRejectedError('not_available', opts.lang ?? 'en')
    }

    return {
      checkoutId:    r.data?.checkout_id ?? '',
      tamaraOrderId: orderId,
      checkoutUrl,
      status:        r.data?.status ?? 'new',
    }
  }

  /* ─── Get order — the source of truth ────────────────────────────────────
     Called before acting on ANY webhook. The notification JWT authenticates
     the caller but signs nothing about the payload, so amounts and statuses
     taken from a webhook body are attacker-controllable in principle. These
     are not. */
  async getOrder(tamaraOrderId: string): Promise<TamaraOrder> {
    if (!this.isConfigured) throw new Error('TAMARA_API_KEY not configured')
    assertTamaraId(tamaraOrderId, 'order id')

    const r = await this.call<Record<string, any>>(`/orders/${encodeURIComponent(tamaraOrderId)}`)
    if (!r.ok || !r.data) {
      logger.warn({ status: r.status, tamaraOrderId, body: r.text.slice(0, 300) }, 'Tamara getOrder failed')
      throw new Error(`Tamara getOrder ${r.status}`)
    }

    const d = r.data
    /* `authorized_amount` is declared as an array in the OpenAPI but returned
        as an object in every documented example — tolerate both. */
    const pick = (v: any): number => {
      const o = Array.isArray(v) ? v[0] : v
      const n = Number(o?.amount ?? o?.total_amount?.amount ?? 0)
      return Number.isFinite(n) ? Math.round(n * 100) : 0
    }
    const sum = (arr: any): number =>
      Array.isArray(arr) ? arr.reduce((t, e) => t + pick(e?.total_amount ?? e), 0) : 0

    return {
      orderId:          String(d.order_id ?? tamaraOrderId),
      orderReferenceId: String(d.order_reference_id ?? ''),
      status:           String(d.status ?? ''),
      totalFils:        pick(d.total_amount ?? d.authorized_amount),
      currency:         String(d.total_amount?.currency ?? env.TAMARA_CURRENCY).toUpperCase(),
      capturedFils:     sum(d.captures) || pick(d.captured_amount),
      refundedFils:     sum(d.refunds)  || pick(d.refunded_amount),
      canceledFils:     pick(d.canceled_amount),
      autoCaptured:     Boolean(d.auto_captured),
      raw:              d,
    }
  }

  /* ─── Authorise ──────────────────────────────────────────────────────────
     The step Tabby has no equivalent of, and the one with a 72-hour fuse: an
     `approved` order that is never authorised expires, with the customer's
     first instalment already taken.

     Takes no body — so there is no opportunity to confirm the amount here.
     That check belongs to getOrder(), before this is called. */
  async authoriseOrder(tamaraOrderId: string): Promise<{ ok: boolean; status: string; autoCaptured: boolean }> {
    if (!this.isConfigured) {
      logger.error({ tamaraOrderId }, 'Tamara authorise: not configured — refusing to treat as paid')
      return { ok: false, status: '', autoCaptured: false }
    }
    assertTamaraId(tamaraOrderId, 'order id')

    const r = await this.call<{ status?: string; auto_captured?: boolean }>(
      `/orders/${encodeURIComponent(tamaraOrderId)}/authorise`,
      { method: 'POST', body: JSON.stringify({}), timeoutMs: WRITE_TIMEOUT_MS },
    )
    if (!r.ok) {
      logger.error({ status: r.status, tamaraOrderId, body: r.text.slice(0, 300) },
        'Tamara authorise FAILED — order will not be fulfilled')
      return { ok: false, status: '', autoCaptured: false }
    }
    /* Auto-capture is an account-level flag: when it is on, this call returns
       `fully_captured` and capturing again would be wrong. */
    return {
      ok:           true,
      status:       String(r.data?.status ?? 'authorised'),
      autoCaptured: Boolean(r.data?.auto_captured),
    }
  }

  /* ─── Capture ────────────────────────────────────────────────────────────
     Capture is what puts the money into a settlement; `authorised` alone never
     pays out. A course is delivered the instant it is bought, so this runs
     straight after authorise rather than waiting for the 21-day auto-capture.

     NOTE the shape: order_id travels in the BODY. There is no
     /orders/{id}/capture endpoint. */
  async captureOrder(opts: {
    tamaraOrderId: string
    amountAED:     number
    courseTitle:   string
    courseId:      string
    shippedAtIso:  string
  }): Promise<boolean> {
    if (!this.isConfigured) return false
    assertTamaraId(opts.tamaraOrderId, 'order id')

    const total = money(opts.amountAED)
    const r = await this.call(`/payments/capture`, {
      method: 'POST',
      timeoutMs: WRITE_TIMEOUT_MS,
      body: JSON.stringify({
        order_id:     opts.tamaraOrderId,
        total_amount: total,
        /* Required even though nothing ships. Named for what actually happened
           so the merchant portal reads honestly. */
        shipping_info: {
          shipped_at:       opts.shippedAtIso,
          shipping_company: 'Digital delivery',
        },
        items: [{
          reference_id: opts.courseId,
          type:         'Digital',
          name:         clip(opts.courseTitle, 255),
          sku:          clip(opts.courseId, 128),
          quantity:     1,
          total_amount: total,
        }],
        shipping_amount: money(0),
        tax_amount:      money(0),
      }),
    })
    if (!r.ok) {
      logger.error({ status: r.status, tamaraOrderId: opts.tamaraOrderId, body: r.text.slice(0, 300) },
        'Tamara capture FAILED — order authorised but not captured, settlement needs follow-up')
      return false
    }
    logger.info({ tamaraOrderId: opts.tamaraOrderId }, 'Tamara order captured')
    return true
  }

  /* ─── Refund ─────────────────────────────────────────────────────────────
     Only a CAPTURED order can be refunded — the refund edge in Tamara's state
     machine runs from the captured box, not from `authorised`. To unwind an
     authorised-but-uncaptured order, cancel it instead.

     `merchant_refund_id` is the closest thing Tamara offers to an idempotency
     key, so it is derived from our order id rather than a timestamp. */
  async refundOrder(opts: {
    tamaraOrderId: string
    amountAED:     number
    orderId:       string
    comment?:      string
    attempt?:      number
  }): Promise<boolean> {
    if (!this.isConfigured) return false
    assertTamaraId(opts.tamaraOrderId, 'order id')

    const suffix     = opts.attempt && opts.attempt > 1 ? `-${opts.attempt}` : ''
    const refundRef  = `refund-${opts.orderId}${suffix}`

    const r = await this.call<{ refund_id?: string }>(
      `/payments/simplified-refund/${encodeURIComponent(opts.tamaraOrderId)}`,
      {
        method: 'POST',
        timeoutMs: WRITE_TIMEOUT_MS,
        body: JSON.stringify({
          total_amount:       money(opts.amountAED),
          comment:            clip(opts.comment ?? `Refund for order ${opts.orderId}`, 255),
          merchant_refund_id: refundRef,
        }),
      },
    )
    if (!r.ok) {
      logger.error({ status: r.status, tamaraOrderId: opts.tamaraOrderId, refundRef, body: r.text.slice(0, 300) },
        'Tamara refund failed')
      return false
    }
    logger.info({ tamaraOrderId: opts.tamaraOrderId, refundRef, refundId: r.data?.refund_id },
      'Tamara refund issued')
    return true
  }

  /* ─── Cancel ─────────────────────────────────────────────────────────────
     The unwind path for an order that is `authorised` but not yet captured.
     Cancelling for less than the total is what produces the `updated` status
     (partially cancelled), which this integration never does deliberately. */
  async cancelOrder(opts: {
    tamaraOrderId: string
    amountAED:     number
    orderId:       string
  }): Promise<boolean> {
    if (!this.isConfigured) return false
    assertTamaraId(opts.tamaraOrderId, 'order id')

    const r = await this.call(`/orders/${encodeURIComponent(opts.tamaraOrderId)}/cancel`, {
      method: 'POST',
      timeoutMs: WRITE_TIMEOUT_MS,
      body: JSON.stringify({
        total_amount: money(opts.amountAED),
        items: [],
      }),
    })
    if (!r.ok) {
      logger.error({ status: r.status, tamaraOrderId: opts.tamaraOrderId, body: r.text.slice(0, 300) },
        'Tamara cancel failed')
      return false
    }
    logger.info({ tamaraOrderId: opts.tamaraOrderId, orderId: opts.orderId }, 'Tamara order cancelled')
    return true
  }

  /* ─── Webhook registration ───────────────────────────────────────────────
     Tamara offers no "list webhooks" endpoint — only GET/PUT/DELETE by id — so
     this cannot be made idempotent the way Tabby's is. The registered id is
     logged so it can be put in TAMARA_WEBHOOK_ID and reused rather than
     re-registered on every boot. */
  async registerWebhook(url: string, events: readonly string[] = TAMARA_WEBHOOK_EVENTS): Promise<string | null> {
    if (!this.isConfigured) return null
    if (!url.startsWith('https://')) {
      logger.warn({ url },
        'Tamara webhook not registered: URL is not HTTPS. Local checkouts still fulfil via the ' +
        'verify-return fallback; use a public HTTPS tunnel to test webhooks.')
      return null
    }

    const r = await this.call<{ webhook_id?: string }>('/webhooks', {
      method: 'POST',
      timeoutMs: WRITE_TIMEOUT_MS,
      body: JSON.stringify({ url: clip(url, 255), events: [...events] }),
    })
    if (!r.ok) {
      logger.warn({ status: r.status, body: r.text.slice(0, 300) }, 'Tamara webhook registration failed (non-fatal)')
      return null
    }
    const id = r.data?.webhook_id ?? null
    logger.info({ url, webhookId: id }, 'Tamara webhook registered — set TAMARA_WEBHOOK_ID to reuse it')
    return id
  }

  async getWebhook(webhookId: string): Promise<{ url?: string; events?: string[] } | null> {
    if (!this.isConfigured) return null
    const r = await this.call<{ url?: string; events?: string[] }>(`/webhooks/${encodeURIComponent(webhookId)}`)
    return r.ok ? r.data : null
  }

  /* ─── Webhook authentication ─────────────────────────────────────────────
     Tamara sends the same HS256 JWT twice — as the `tamaraToken` query
     parameter and as `Authorization: Bearer <token>` — signed with the
     NOTIFICATION token, which is a different credential from the API token.

     Its claims are exactly exp, iat and iss. That is the whole security model,
     and it is weaker than it looks: the token says nothing about the order,
     the event or the body, so it proves only that the caller holds our
     notification token. `exp` is therefore load-bearing — it is the one thing
     stopping a captured token being replayed forever — and is enforced here. */
  verifyWebhookJwt(token: string, notificationToken: string): { valid: boolean; reason?: string } {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return { valid: false, reason: 'malformed' }
      const [header, payload, signature] = parts as [string, string, string]

      const computed = createHmac('sha256', notificationToken)
        .update(`${header}.${payload}`)
        .digest('base64url')
      const a = Buffer.from(computed)
      const b = Buffer.from(signature)
      if (a.length !== b.length) return { valid: false, reason: 'bad-signature' }
      if (!timingSafeEqual(a, b)) return { valid: false, reason: 'bad-signature' }

      /* Signature is good — now the claims. A 15-minute token that never
         expires in our check is a replayable credential. */
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        exp?: number; iat?: number; iss?: string
      }
      const nowSec = Math.floor(Date.now() / 1000)
      /* 60s of slack for clock drift between us and Tamara. */
      if (typeof claims.exp === 'number' && claims.exp + 60 < nowSec) {
        return { valid: false, reason: 'expired' }
      }
      if (claims.iss && claims.iss !== 'Tamara') {
        return { valid: false, reason: 'bad-issuer' }
      }
      return { valid: true }
    } catch {
      return { valid: false, reason: 'error' }
    }
  }
}

/* Sum a fils figure from an AED major-unit decimal. */
export function tamaraFils(amountAED: number): number {
  return Math.round(amountAED * 100)
}
