import { Types } from 'mongoose'
import { OrderRepository } from '@/repositories/order.repository.ts'
import { CouponService } from '@/services/coupon.service.ts'
import { StripeService } from '@/services/stripe.service.ts'
import { RazorpayService } from '@/services/razorpay.service.ts'
import {
  TabbyService, TabbyRejectedError, tabbySumFils,
  type TabbyEligibility, type TabbyOrderHistoryEntry, type TabbyShippingAddress,
} from '@/services/tabby.service.ts'
import { AbzerService } from '@/services/abzer.service.ts'
import {
  TamaraService, isTamaraId, isTamaraStatus, tamaraStatusIsPaid, tamaraStatusIsDead,
  type TamaraEligibility,
} from '@/services/tamara.service.ts'
import { EnrollmentService } from '@/services/enrollment.service.ts'
import { NotificationService } from '@/services/notification.service.ts'
import { sendEnrollmentConfirmation } from '@/services/email.service.ts'
import { CourseModel, UserModel } from '@/models/schema.ts'
import { env } from '@/config/env.ts'
import type { OrderGateway, IOrder } from '@/models/schema.ts'
import { logger } from '@/utils/logger.ts'

/* What a Tabby webhook delivery resulted in. `retry` is the one the HTTP layer
   must act on: Tabby re-delivers up to 4 more times with backoff on a non-200,
   which is how a webhook that overtook our own order write still lands. */
export type TabbyFulfillOutcome =
  | 'fulfilled'
  | 'already-fulfilled'
  | 'ignored'
  | 'retry'

export type GatewayConfig =
  | { gateways: ('tabby' | 'abzer' | 'tamara')[]; currency: 'AED' }
  | { gateways: ['razorpay'];                      currency: 'INR' }
  | { gateways: [];                                currency: 'USD' }

export class OrderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'OrderError'
  }
}

/* ── What a course costs in a currency that is not USD (B-01) ──────────────
   `price` is the USD figure Stripe charges. These resolve the AED and INR
   figures: the course's own override when an admin has set one, otherwise a
   conversion of the USD price at the configured rate.

   Extracted because the same expression was written out seven times — six for
   AED alone — and because the fallback is the only path any existing course
   takes, so it is worth being able to test directly. Before B-01 the overrides
   could not be stored at all, which made these fallbacks the ONLY prices the
   non-USD gateways ever charged, and the INR rate was a literal rather than a
   setting. */
export function inrPriceFor(course: { price: number; priceINR?: number }): number {
  return course.priceINR ?? Math.round(course.price * env.INR_EXCHANGE_RATE)
}

export function aedPriceFor(course: { price: number; priceAED?: number }): number {
  return course.priceAED ?? Math.round(course.price * env.UAE_EXCHANGE_RATE * 100) / 100
}

/* ── A past order's value as Tabby will read it ────────────────────────────
   Every order row is stored in whatever currency its own gateway charged —
   USD for Stripe, INR for Razorpay, AED for the UAE gateways — but Tabby's
   order_history entries carry NO currency field: Tabby reads each `amount` in
   the checkout's currency, which is always AED here. Emitting the raw figure
   therefore reports a ₹16,417 Razorpay order to a regulated lender as
   AED 16,417 (~22x its real value) and a $199 Stripe order as AED 199 (~a
   third). Convert at the same rates the checkout itself prices with, and
   return null for a currency we have no rate for rather than assert a number
   we cannot stand behind. All three currencies have exponent 2, so the /100 is
   only the minor→major unit step. */
export function tabbyHistoryAmountAED(amountMinor: number, currency: string): string | null {
  const major = amountMinor / 100
  switch (String(currency).trim().toUpperCase()) {
    case 'AED': return major.toFixed(2)
    case 'USD': return (major * env.UAE_EXCHANGE_RATE).toFixed(2)
    case 'INR': return (major * env.UAE_EXCHANGE_RATE / env.INR_EXCHANGE_RATE).toFixed(2)
    default:    return null
  }
}

/* Tabby's payment_method enum is 'card' | 'cod' and the field is optional, so
   a BNPL order is omitted rather than described as something it was not. */
const TABBY_HISTORY_CARD_GATEWAYS: ReadonlySet<OrderGateway> = new Set<OrderGateway>([
  'stripe', 'razorpay', 'abzer',
])

export class OrderService {
  private readonly orderRepo     = new OrderRepository()
  private readonly couponSvc     = new CouponService()
  private readonly stripeSvc     = new StripeService()
  private readonly razorpaySvc   = new RazorpayService()
  private readonly tabbySvc      = new TabbyService()
  private readonly abzerSvc      = new AbzerService()
  private readonly tamaraSvc     = new TamaraService()
  private readonly enrollSvc     = new EnrollmentService()
  private readonly notifications = new NotificationService()

  /* ─── Gateway config for current user ────────────────────────
     Middle East residents (declared homeCountry) get the Abzer AED checkout;
     Tamara/Tabby BNPL ride along for UAE only, matching where those providers
     are licensed. Everyone else gets Razorpay (INR). Country strings must
     match the client's CountryPicker spellings exactly (RegisterForm.tsx /
     RequestSection.tsx share the same list). */
  async getGatewayConfig(userId: string): Promise<GatewayConfig> {
    const user = await UserModel.findById(userId).select('enrollmentApplication.homeCountry').lean()
    const homeCountry = String((user as any)?.enrollmentApplication?.homeCountry ?? '').trim()
    const isUAE = homeCountry === 'United Arab Emirates'

    if (OrderService.MIDDLE_EAST_COUNTRIES.has(homeCountry)) {
      const gateways: ('tabby' | 'abzer' | 'tamara')[] = []
      if (isUAE && env.TAMARA_API_KEY)   gateways.push('tamara')
      if (env.ABZER_ACCESS_KEY)          gateways.push('abzer')
      if (isUAE && env.TABBY_SECRET_KEY) gateways.push('tabby')
      if (gateways.length > 0)           return { gateways, currency: 'AED' }
    }
    if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
      return { gateways: ['razorpay'], currency: 'INR' }
    }
    return { gateways: [], currency: 'USD' }
  }

  /* Spellings must stay in step with the client's country lists. Cyprus is
     deliberately absent (EU/EUR market). Sanctioned markets in this set are
     the gateway's call to decline — membership here only selects the
     checkout currency and button set. */
  static readonly MIDDLE_EAST_COUNTRIES: ReadonlySet<string> = new Set([
    'Bahrain', 'Egypt', 'Iran', 'Iraq', 'Israel', 'Jordan', 'Kuwait',
    'Lebanon', 'Oman', 'Palestine', 'Qatar', 'Saudi Arabia', 'Syria',
    'Turkey', 'United Arab Emirates', 'Yemen',
  ])

  /* ─── Coupon reservation rollback ───────────────────
     Every create*Order path claims a coupon usage slot BEFORE it creates the
     order row and calls the gateway. If either of those fails the slot was
     never spent, so it has to go back — otherwise a maxUses:10 coupon is
     burned to zero by ten failed checkouts (a misconfigured gateway, a network
     blip, or a caller retrying).

     Only ever runs on a path that is already throwing: a successful checkout
     never enters the catch, so gateway behaviour is unchanged. */
  private async releasingOnFailure<T>(
    couponId: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work()
    } catch (err) {
      /* Awaited, not fire-and-forget: the caller commonly retries immediately,
         and the slot must be back before the error reaches them. A failure to
         release is logged but never masks the original error. */
      if (couponId) {
        try {
          await this.couponSvc.release(couponId)
        } catch (releaseErr) {
          logger.warn({ releaseErr, couponId }, 'Failed to release coupon slot after a failed checkout')
        }
      }
      throw err
    }
  }

  /* ─── Create Stripe checkout session ──────────────── */
  async createCheckoutSession(userId: string, courseId: string, couponCode?: string): Promise<{ url: string }> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new OrderError('INVALID_COURSE_ID', 'Invalid course id', 400)
    }

    const course = await CourseModel.findById(courseId).exec()
    if (!course || course.status !== 'published') {
      throw new OrderError('COURSE_NOT_FOUND', 'Course not found', 404)
    }
    if (course.isFree || course.price <= 0) {
      throw new OrderError('COURSE_IS_FREE', 'This course is free — use the enroll endpoint instead', 400)
    }

    const { EnrollmentModel } = await import('@/models/schema.ts')
    const existing = await EnrollmentModel.findOne({ userId, courseId }).exec()
    if (existing) {
      throw new OrderError('ALREADY_ENROLLED', 'You are already enrolled in this course', 409)
    }

    const originalCents = Math.round(course.price * 100)
    let finalCents      = originalCents
    let discountCents   = 0
    let couponId: string | undefined

    if (couponCode) {
      /* Prices BEFORE claiming the usage slot — see validateAndPrice(). */
      const priced  = await this.couponSvc.validateAndPrice(
        couponCode, courseId, originalCents, env.STRIPE_CURRENCY,
      )
      finalCents    = priced.finalCents
      discountCents = priced.discountCents
      couponId      = priced.coupon.id
    }

    if (finalCents > 0 && finalCents < 50) finalCents = 50

    return this.releasingOnFailure(couponId, async () => {
      const clientUrl  = env.CLIENT_URL
      const successUrl = `${clientUrl}/courses/${course.slug}?checkout=success&session_id={CHECKOUT_SESSION_ID}`
      const cancelUrl  = `${clientUrl}/courses/${course.slug}?checkout=cancel`

      const order = await this.orderRepo.create({
        userId,
        courseId,
        ...(await this._orgIdFor(userId)),
        gateway:                  'stripe',
        stripeCheckoutSessionId:  'pending',
        amount:   finalCents,
        currency: env.STRIPE_CURRENCY,
        ...(couponId      && { couponId }),
        ...(discountCents && { discountAmount: discountCents }),
      })

      const session = await this.stripeSvc.createCheckoutSession({
        orderId:       order.id,
        userId,
        courseId,
        courseTitle:   course.title,
        thumbnailUrl:  course.thumbnailUrl,
        description:   course.description,
        amountCents:   finalCents,
        currency:      env.STRIPE_CURRENCY,
        successUrl,
        cancelUrl,
      })

      await patchStripeSession(order.id, session.id)

      return { url: session.url! }
    })
  }

  /* ─── Create Razorpay order ────────────────────────── */
  async createRazorpayOrder(
    userId: string,
    courseId: string,
    couponCode?: string,
  ): Promise<{
    razorpayOrderId: string
    amount:          number
    currency:        string
    key:             string
    courseName:      string
    userEmail:       string
    userName:        string
  }> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new OrderError('INVALID_COURSE_ID', 'Invalid course id', 400)
    }

    const course = await CourseModel.findById(courseId).exec()
    if (!course || course.status !== 'published') {
      throw new OrderError('COURSE_NOT_FOUND', 'Course not found', 404)
    }
    if (course.isFree || (!(course as any).priceINR && course.price <= 0)) {
      throw new OrderError('COURSE_IS_FREE', 'This course is free — use the enroll endpoint instead', 400)
    }

    const { EnrollmentModel } = await import('@/models/schema.ts')
    const existing = await EnrollmentModel.findOne({ userId, courseId }).exec()
    if (existing) {
      throw new OrderError('ALREADY_ENROLLED', 'You are already enrolled in this course', 409)
    }

    /* Convert to paise: the course's own INR price when set, otherwise the
       configured conversion rate (B-01 — before that fix priceINR could not be
       stored, so this fallback was the only path). */
    const priceINR      = inrPriceFor(course as any)
    const originalPaise = Math.round(priceINR * 100)
    let   finalPaise    = originalPaise
    let   discountPaise = 0
    let   couponId: string | undefined

    if (couponCode) {
      /* Prices BEFORE claiming the usage slot — see validateAndPrice(). */
      const priced  = await this.couponSvc.validateAndPrice(
        couponCode, courseId, originalPaise, env.RAZORPAY_CURRENCY,
      )
      finalPaise    = priced.finalCents
      discountPaise = priced.discountCents
      couponId      = priced.coupon.id
    }

    /* Razorpay minimum: 100 paise (₹1) */
    if (finalPaise > 0 && finalPaise < 100) finalPaise = 100

    return this.releasingOnFailure(couponId, async () => {
      const order = await this.orderRepo.create({
        userId,
        courseId,
        ...(await this._orgIdFor(userId)),
        gateway:  'razorpay',
        amount:   finalPaise,
        currency: env.RAZORPAY_CURRENCY,
        ...(couponId      && { couponId }),
        ...(discountPaise && { discountAmount: discountPaise }),
      })

      const rzpOrder = await this.razorpaySvc.createOrder({
        amountPaise: finalPaise,
        currency:    env.RAZORPAY_CURRENCY,
        receipt:     order.id.slice(-40),
        notes:       { courseId, userId },
      })

      /* Patch order with real Razorpay order id */
      await patchRazorpayOrderId(order.id, rzpOrder.id)

      const user = await UserModel.findById(userId).select('name email').exec()

      return {
        razorpayOrderId: rzpOrder.id,
        amount:          finalPaise,
        currency:        env.RAZORPAY_CURRENCY,
        key:             env.RAZORPAY_KEY_ID!,
        courseName:      course.title,
        userEmail:       user?.email ?? '',
        userName:        user?.name  ?? '',
      }
    })
  }

  /* ─── Verify Razorpay signature + fulfill ─────────── */
  async verifyAndFulfillRazorpay(
    razorpayOrderId:   string,
    razorpayPaymentId: string,
    razorpaySignature: string,
    userId?:           string,
  ): Promise<{ orderId: string }> {
    const valid = this.razorpaySvc.verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)
    if (!valid) {
      throw new OrderError('INVALID_SIGNATURE', 'Payment signature verification failed', 400)
    }

    const order = await this.orderRepo.findByRazorpayOrderId(razorpayOrderId)
    if (!order) {
      throw new OrderError('ORDER_NOT_FOUND', 'Order not found', 404)
    }

    /* Ownership (P-26). The signature already proves the payment is genuine, so
       this is defence in depth rather than a live hole — but every other
       gateway's return handler checks it and this one did not. `userId` is
       optional so the webhook path, which has no caller identity, is unchanged. */
    if (userId && order.userId.toString() !== userId) {
      throw new OrderError('FORBIDDEN', 'Order does not belong to you', 403)
    }

    /* Idempotent — already fulfilled (e.g. webhook beat us here) */
    if (order.status === 'paid') {
      logger.info({ orderId: order.id }, 'Razorpay: order already fulfilled, skipping')
      return { orderId: order.id }
    }

    /* Conditional flip — the webhook may have raced us past the check above */
    const fulfilled = await this.orderRepo.fulfillRazorpay(order.id, razorpayPaymentId, razorpaySignature)
    if (!fulfilled) {
      logger.info({ orderId: order.id }, 'Razorpay: order fulfilled concurrently, skipping side effects')
      return { orderId: order.id }
    }

    await this._createEnrollment(order.userId.toString(), order.courseId.toString())
    await this._autoApproveViaPayment(order.userId.toString(), order.courseId.toString())
    void this._sendPostPaymentNotifications(order.userId.toString(), order.courseId.toString(), order.id)

    return { orderId: order.id }
  }

  /* ─── Webhook backup fulfillment (idempotent) ──────── */
  async fulfillFromWebhook(razorpayOrderId: string, razorpayPaymentId: string): Promise<void> {
    const order = await this.orderRepo.findByRazorpayOrderId(razorpayOrderId)
    if (!order) {
      logger.warn({ razorpayOrderId }, 'Webhook: no matching order found')
      return
    }
    if (order.status === 'paid') {
      logger.info({ orderId: order.id }, 'Webhook: order already fulfilled, skipping')
      return
    }

    /* Conditional flip — the client return-URL verify may have raced us */
    const fulfilled = await this.orderRepo.fulfillRazorpay(order.id, razorpayPaymentId, '')
    if (!fulfilled) {
      logger.info({ orderId: order.id }, 'Webhook: order fulfilled concurrently, skipping side effects')
      return
    }

    await this._createEnrollment(order.userId.toString(), order.courseId.toString())
    await this._autoApproveViaPayment(order.userId.toString(), order.courseId.toString())
    void this._sendPostPaymentNotifications(order.userId.toString(), order.courseId.toString(), order.id)
  }

  /* ─── Stripe webhook fulfillment ────────────────────── */
  async fulfillOrder(stripeSessionId: string, paymentIntentId: string): Promise<void> {
    const order = await this.orderRepo.findBySessionId(stripeSessionId)
    if (!order) {
      logger.warn({ stripeSessionId }, 'Webhook: no matching order found')
      return
    }
    if (order.status === 'paid') {
      logger.info({ orderId: order.id }, 'Webhook: order already fulfilled, skipping')
      return
    }

    /* Conditional flip — a retried webhook delivery may have raced us */
    const fulfilled = await this.orderRepo.fulfill(order.id, paymentIntentId)
    if (!fulfilled) {
      logger.info({ orderId: order.id }, 'Webhook: order fulfilled concurrently, skipping side effects')
      return
    }

    await this._createEnrollment(order.userId.toString(), order.courseId.toString())
    await this._autoApproveViaPayment(order.userId.toString(), order.courseId.toString())
    void this._sendPostPaymentNotifications(order.userId.toString(), order.courseId.toString(), order.id)
  }

  /* ─── Tamara pre-checkout eligibility check ──────────────────────────────
     Tamara's own status-flow diagram models this as the gate BEFORE a session
     exists: an ineligible customer has the option greyed out rather than being
     sent to the hosted page to be refused there.

     Returns the AED figure alongside, so the on-site widget quotes the number
     the student will actually be charged rather than deriving its own. */
  async checkTamaraEligibility(
    userId:   string,
    courseId: string,
  ): Promise<TamaraEligibility & { amount: number; currency: string }> {
    await this.assertTamaraOffered(userId)

    const course = await CourseModel.findById(courseId).select('priceAED price status isFree').exec()
    if (!course || course.status !== 'published' || course.isFree) {
      return { available: false, rejectionReason: null, message: null, amount: 0, currency: env.TAMARA_CURRENCY }
    }
    const priceAED = aedPriceFor(course as any)
    const user     = await UserModel.findById(userId).select('phone email enrollmentApplication').exec()
    const app      = (user as any)?.enrollmentApplication ?? {}

    const score = await this.tamaraSvc.checkEligibility({
      amountAED: priceAED,
      phone:     (user as any)?.phone ?? app.phone,
      email:     user?.email,
    })
    return { ...score, amount: priceAED, currency: env.TAMARA_CURRENCY }
  }

  /* Tamara is licensed per country and, like Tabby, must be enforced on the
     API rather than only in the UI — otherwise the gating is decorative and a
     student outside the market can drive the routes directly. */
  private async assertTamaraOffered(userId: string): Promise<void> {
    const cfg = await this.getGatewayConfig(userId)
    if (!(cfg.gateways as string[]).includes('tamara')) {
      throw new OrderError('GATEWAY_NOT_AVAILABLE', 'Tamara is not available for your account.', 403)
    }
  }

  /* ─── Tabby background pre-scoring ──────────────────── */
  /* Tabby's QA checklist requires this to run before the button is offered,
     and requires the decline copy to come from Tabby rather than from us, so
     the reason is resolved to a message here and passed straight through. */
  /* ─── Is this student offered Tabby at all? ────────────────────────────────
     getGatewayConfig() is what the cart reads to decide which buttons to draw.
     It used to be the ONLY place the UAE-only rule lived, so a student outside
     the UAE who called /checkout/tabby/* directly got a session anyway — the
     gating was decorative. Tabby is licensed per country and their QA checks
     that the method is offered only where the merchant is registered, so the
     API now enforces the same answer the UI shows. */
  private async assertTabbyOffered(userId: string): Promise<void> {
    const cfg = await this.getGatewayConfig(userId)
    if (!(cfg.gateways as string[]).includes('tabby')) {
      throw new OrderError('GATEWAY_NOT_AVAILABLE', 'Tabby is not available for your account.', 403)
    }
  }

  /* Pre-scoring is a create-session call against Tabby's rate budget (200 per
     10 s on live keys) and it costs them a scoring decision each time. The
     client caches for five minutes, but the client is not in charge — an
     authenticated script can call this in a loop. Answers are held here per
     student + course for a short window so a burst becomes one Tabby call. */
  private static readonly prescoreCache = new Map<string, { until: number; value: TabbyEligibility & { amount: number; currency: string } }>()
  private static readonly PRESCORE_TTL_MS = 60_000

  async checkTabbyEligibility(
    userId:   string,
    courseId: string,
  ): Promise<TabbyEligibility & { amount: number; currency: string }> {
    await this.assertTabbyOffered(userId)

    const cacheKey = `${userId}:${courseId}`
    const hit = OrderService.prescoreCache.get(cacheKey)
    if (hit && hit.until > Date.now()) return hit.value

    const value = await this._checkTabbyEligibilityUncached(userId, courseId)
    OrderService.prescoreCache.set(cacheKey, { until: Date.now() + OrderService.PRESCORE_TTL_MS, value })
    /* Bounded: evict anything expired once the map grows past a sane size. */
    if (OrderService.prescoreCache.size > 5_000) {
      const now = Date.now()
      for (const [k, v] of OrderService.prescoreCache) if (v.until <= now) OrderService.prescoreCache.delete(k)
    }
    return value
  }

  private async _checkTabbyEligibilityUncached(
    userId:   string,
    courseId: string,
  ): Promise<TabbyEligibility & { amount: number; currency: string }> {
    const course = await CourseModel.findById(courseId).select('priceAED price status isFree').exec()
    if (!course || course.status !== 'published' || course.isFree) {
      return { available: false, rejectionReason: null, message: null, amount: 0, currency: env.TABBY_CURRENCY }
    }
    /* The AED figure the student will actually be charged. Returned so the
       on-site snippet quotes the same number Tabby's checkout will — the cart's
       own `coursePriceIn` falls back to the USD price when a course has no
       priceAED override, and QA checks "Checkout total matches amount displayed
       on Tabby Checkout". */
    const priceAED = aedPriceFor(course as any)
    const user     = await UserModel.findById(userId).select('email phone').exec()
    const score    = await this.tabbySvc.checkEligibility({
      amountAED:  priceAED,
      buyerEmail: user?.email ?? '',
      buyerPhone: (user as any)?.phone,
    })
    return { ...score, amount: priceAED, currency: env.TABBY_CURRENCY }
  }

  /* A Tabby decline is a business outcome, not a server fault — QA is explicit
     that rejected sessions must surface Tabby's own copy rather than a generic
     error or a redirect. Translated to a distinct code so the client can render
     the message inline next to the other payment options. */
  private async _asTabbyOutcome<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (err) {
      if (err instanceof TabbyRejectedError) {
        throw new OrderError('TABBY_REJECTED', err.message, 422)
      }
      throw err
    }
  }

  /* ─── Buyer / order history for Tabby scoring ───────────────────────────
     Tabby scores on who the customer is and what they have bought before, and
     QA verifies on a second order that both carry real values with ISO-8601
     dates. This builds order_history from the student's own settled orders —
     most recent first, capped because the payload is sent on every checkout. */
  private async _tabbyOrderHistory(userId: string): Promise<TabbyOrderHistoryEntry[]> {
    const past = await this.orderRepo.listForUser(userId)
    return past
      .filter(o => o.status === 'paid' || o.status === 'refunded')
      .sort((a, b) => {
        const at = (a as any).paidAt ?? (a as any).createdAt ?? 0
        const bt = (b as any).paidAt ?? (b as any).createdAt ?? 0
        return new Date(bt).getTime() - new Date(at).getTime()
      })
      /* Converted BEFORE the cap so an unconvertible row does not consume one
         of the ten slots. */
      .flatMap<TabbyOrderHistoryEntry>(o => {
        const amount = tabbyHistoryAmountAED(o.amount, o.currency)
        if (amount === null) return []
        return [{
          purchased_at: new Date((o as any).paidAt ?? (o as any).createdAt ?? Date.now()).toISOString(),
          amount,
          status:       o.status === 'refunded' ? 'refunded' : 'complete',
          ...(TABBY_HISTORY_CARD_GATEWAYS.has(o.gateway) && { payment_method: 'card' as const }),
        }]
      })
      .slice(0, 10)
  }

  /* ─── Create Tabby checkout (UAE) ───────────────────── */
  /* `slug` is accepted for API compatibility with the client and the other
     gateways, but deliberately unused — the course's own slug is authoritative.
     See the courseUrl comment below. */
  async createTabbyOrder(
    userId:      string,
    courseId:    string,
    _slug:       string,
    couponCode?: string,
  ): Promise<{ checkoutUrl: string; checkoutId: string }> {
    if (!env.TABBY_SECRET_KEY || !env.TABBY_MERCHANT_CODE) {
      throw new OrderError('TABBY_NOT_CONFIGURED', 'Tabby is not configured on this server.', 503)
    }
    if (!Types.ObjectId.isValid(courseId)) {
      throw new OrderError('INVALID_COURSE_ID', 'Invalid course id', 400)
    }
    await this.assertTabbyOffered(userId)

    const course = await CourseModel.findById(courseId).exec()
    if (!course || course.status !== 'published') {
      throw new OrderError('COURSE_NOT_FOUND', 'Course not found', 404)
    }
    if (course.isFree || course.price <= 0) {
      throw new OrderError('COURSE_IS_FREE', 'This course is free — use the enroll endpoint instead', 400)
    }

    const { EnrollmentModel } = await import('@/models/schema.ts')
    const existing = await EnrollmentModel.findOne({ userId, courseId }).exec()
    if (existing) {
      throw new OrderError('ALREADY_ENROLLED', 'You are already enrolled in this course', 409)
    }

    /* Convert USD price to AED */
    const priceAED      = aedPriceFor(course as any)
    const originalFils  = Math.round(priceAED * 100)
    let   finalFils     = originalFils
    let   discountFils  = 0
    let   couponId: string | undefined

    if (couponCode) {
      /* Prices BEFORE claiming the usage slot — see validateAndPrice(). */
      const priced   = await this.couponSvc.validateAndPrice(
        couponCode, courseId, originalFils, env.TABBY_CURRENCY,
      )
      finalFils      = priced.finalCents
      discountFils   = priced.discountCents
      couponId       = priced.coupon.id
    }

    const finalAED = finalFils / 100

    return this.releasingOnFailure(couponId, async () => {
      const order = await this.orderRepo.create({
        userId,
        courseId,
        ...(await this._orgIdFor(userId)),
        gateway:  'tabby',
        amount:   finalFils,
        currency: env.TABBY_CURRENCY,
        ...(couponId     && { couponId }),
        ...(discountFils && { discountAmount: discountFils }),
      })

      const user = await UserModel.findById(userId)
        .select('name email phone createdAt emailVerified enrollmentApplication').exec()
      const successUrl = `${env.CLIENT_URL}/payment-return?gateway=tabby&orderId=${order.id}`
      const cancelUrl  = `${env.CLIENT_URL}/payment-return?gateway=tabby&status=cancelled`
      const failureUrl = `${env.CLIENT_URL}/payment-return?gateway=tabby&status=failed&orderId=${order.id}`

      const app = (user as any)?.enrollmentApplication ?? {}
      /* Sent only when the student actually has an address on file — Tabby's
         QA asks for optional fields to be omitted rather than sent empty. */
      const shippingAddress: TabbyShippingAddress | undefined =
        app.city && (app.villa || app.addressCountry)
          ? { city: String(app.city), address: String(app.villa || app.addressCountry) }
          : undefined

      const orderHistory = await this._tabbyOrderHistory(userId)

      const result = await this._asTabbyOutcome(() => this.tabbySvc.createCheckout({
        amountAED:   finalAED,
        orderId:     order.id,
        courseTitle: course.title,
        courseId:    course.id,
        /* The course's OWN slug, not the one the client sent. `slug` is a
           request-body field validated only as a non-empty string, and it went
           straight into the product_url Tabby shows in its app and emails — so
           a student could point a link inside a trusted third party's UI
           wherever they liked. We already hold the course; use it. */
        courseUrl:   `${env.CLIENT_URL}/courses/${encodeURIComponent(course.slug)}`,
        buyerEmail:  user?.email ?? '',
        buyerName:   user?.name  ?? '',
        buyerPhone:  (user as any)?.phone ?? app.phone ?? '',
        ...(app.dateOfBirth && { buyerDob: String(app.dateOfBirth).slice(0, 10) }),
        /* The student's real signup date, not `now` — see tabby.service.ts. */
        registeredSince: (user as any)?.createdAt ?? new Date(),
        isEmailVerified: Boolean((user as any)?.emailVerified),
        isPhoneVerified: Boolean((user as any)?.phone || app.phone),
        ...(shippingAddress && { shippingAddress }),
        orderHistory,
        successUrl,
        cancelUrl,
        failureUrl,
      }))

      await patchTabbyCheckoutId(order.id, result.checkoutId, result.paymentId)

      return { checkoutUrl: result.checkoutUrl, checkoutId: result.checkoutId }
    })
  }

  /* ─── Tabby webhook fulfillment (idempotent) ─────────── */
  /* tabbyPaymentId  — from webhook payload.id
     ourOrderId      — from webhook payload.order.reference_id (our LMS order ID) */
  async fulfillTabbyFromWebhook(tabbyPaymentId: string, ourOrderId?: string): Promise<TabbyFulfillOutcome> {
    /* 1. Server-to-server verification: confirm AUTHORIZED status with Tabby */
    /* FAIL CLOSED (P-03). This used to catch a failed lookup, log "proceeding
       without status check" and fall through — and because the guard below was
       written `if (verifiedStatus && …)`, an undefined status skipped it
       entirely. During any Tabby outage or credential rotation, every pending
       order could then be self-fulfilled through verify-return. A payment
       check that cannot run has not passed.

       `retry` rather than `ignored`: a lookup we could not perform is a
       transient failure, and Tabby re-delivering is exactly what we want. */
    let payment: Awaited<ReturnType<TabbyService['getPayment']>>
    try {
      payment = await this.tabbySvc.getPayment(tabbyPaymentId)
    } catch (err) {
      logger.error({ err, tabbyPaymentId }, 'Tabby: getPayment failed — refusing to fulfil unverified payment')
      return 'retry'
    }

    /* getPayment reports UPPERCASE, webhooks lowercase; normalised in the
       service so only one form reaches here. */
    if (payment.status !== 'AUTHORIZED' && payment.status !== 'CLOSED') {
      logger.warn({ tabbyPaymentId, status: payment.status }, 'Tabby: payment not capturable')
      return 'ignored'
    }

    /* 2. Find order — prefer our orderId (reliable), fallback to tabbyPaymentId field */
    const order = ourOrderId
      ? await this.orderRepo.findById(ourOrderId)
      : await this.orderRepo.findByTabbyPaymentId(tabbyPaymentId)

    /* Tabby documents this race explicitly: the webhook can beat our own order
       write. Answering 200 here would tell Tabby the payment is handled and it
       would never re-deliver, silently losing the purchase. Asking for a retry
       is the documented fix. */
    if (!order) {
      logger.warn({ tabbyPaymentId, ourOrderId }, 'Tabby webhook: no matching order yet — asking Tabby to retry')
      return 'retry'
    }
    if (order.status === 'paid') {
      logger.info({ orderId: order.id }, 'Tabby webhook: already fulfilled')
      return 'already-fulfilled'
    }

    /* ── Bind this payment to THIS order ──────────────────────────────────────
       getPayment() proves only that SOME Tabby payment is authorised. On its
       own it says nothing about which order that payment paid for, and
       `ourOrderId` arrives from outside — from webhook payload JSON, and from
       the request body of /checkout/tabby/verify-return, which any student can
       call with any payment id they have ever seen.

       Without the checks below, one genuine cheap purchase becomes unlimited
       free enrolments: replay its (now CLOSED) payment id against a fresh
       pending order for any course, and not even Tabby is consulted a second
       time, because captures[] is already populated so the capture step is
       skipped. It also survives a refund — a refunded payment stays CLOSED.

       Three independent bindings; any mismatch refuses to fulfil:
         · the order must be a Tabby order at all;
         · the payment must be the one created for this order — either the id
           we recorded at checkout, or Tabby's own order.reference_id naming
           this order;
         · the money must match what we are about to hand a course over for. */
    if (order.gateway !== 'tabby') {
      logger.error({ orderId: order.id, gateway: order.gateway, tabbyPaymentId },
        'Tabby: refusing to fulfil a non-Tabby order')
      return 'ignored'
    }

    const recordedPaymentId = (order as any).tabbyPaymentId as string | undefined
    const belongsToOrder =
      (recordedPaymentId && recordedPaymentId === tabbyPaymentId) ||
      (payment.orderReferenceId && payment.orderReferenceId === order.id)
    if (!belongsToOrder) {
      logger.error(
        { orderId: order.id, tabbyPaymentId, recordedPaymentId, reportedOrder: payment.orderReferenceId },
        'Tabby: payment does not belong to this order — refusing to fulfil (replay attempt?)',
      )
      return 'ignored'
    }

    /* Tabby reports decimal major units; our orders are stored in fils. */
    const paidFils = Math.round(Number(payment.amount) * 100)
    if (!Number.isFinite(paidFils) || paidFils !== order.amount) {
      logger.error({ orderId: order.id, tabbyPaymentId, paidFils, orderAmount: order.amount },
        'Tabby: authorised amount does not match the order — refusing to fulfil')
      return 'ignored'
    }
    if (payment.currency && payment.currency.toUpperCase() !== String(order.currency).toUpperCase()) {
      logger.error({ orderId: order.id, paymentCurrency: payment.currency, orderCurrency: order.currency },
        'Tabby: currency mismatch — refusing to fulfil')
      return 'ignored'
    }

    /* 3. Capture — but only if nothing has captured this payment already.
       Tabby sends a second webhook to CONFIRM our capture, and that
       confirmation is not a request for another one: "don't trigger a new one
       if the captures array is already populated". The reference_id would make
       a duplicate harmless anyway, but not sending it is cleaner and is what
       QA looks for. */
    const amountAED     = (order.amount / 100).toFixed(2)
    const netHeldFils   = tabbySumFils(payment.captures) - tabbySumFils(payment.refunds)
    const alreadyCaptured = tabbySumFils(payment.captures) > 0

    /* CLOSED is terminal, and it covers three different endings: captured in
       full, cancelled without capture, and captured-then-refunded. Only the
       first is a payment. Treating the status alone as proof of payment means a
       student who opens a checkout and then CANCELS it in the Tabby app gets a
       closed, never-captured payment — which fell into the capture branch
       below, failed there (a closed payment cannot be captured), and was
       fulfilled anyway by the "funds are already committed" allowance.

       That allowance is only true of AUTHORIZED. For CLOSED the question is
       settled and answerable: do we actually hold the money? */
    if (payment.status === 'CLOSED' && netHeldFils < order.amount) {
      logger.error(
        { tabbyPaymentId, orderId: order.id, netHeldFils, orderAmount: order.amount,
          captured: tabbySumFils(payment.captures), refunded: tabbySumFils(payment.refunds) },
        'Tabby: payment is CLOSED but the money is not held (cancelled or refunded) — refusing to fulfil',
      )
      return 'ignored'
    }

    if (alreadyCaptured) {
      logger.info({ tabbyPaymentId, orderId: order.id }, 'Tabby: payment already captured, skipping capture')
    } else {
      const course   = await CourseModel.findById(order.courseId).select('title').lean()
      const captured = await this.tabbySvc.capturePayment({
        paymentId:   tabbyPaymentId,
        amountAED,
        orderId:     order.id,
        courseTitle: (course as any)?.title ?? 'Delta Academy course',
        courseId:    order.courseId.toString(),
      })
      /* Deliberately NOT a reason to withhold the course — but only because we
         are here on an AUTHORIZED payment, where the customer's funds ARE
         committed and the enrolment is genuinely owed. A failed capture is then
         money we have not collected yet: a settlement problem to chase from the
         logs, not something to punish the student for. The CLOSED case never
         reaches this line; it is refused above. */
      if (!captured) {
        logger.error({ tabbyPaymentId, orderId: order.id }, 'Tabby: fulfilling an UNCAPTURED payment — collect manually')
      }
    }

    /* 4. Fulfill order — conditional flip, the return-URL verify may have raced us */
    const fulfilled = await this.orderRepo.fulfillTabby(order.id, tabbyPaymentId)
    if (!fulfilled) {
      logger.info({ orderId: order.id }, 'Tabby webhook: order fulfilled concurrently, skipping side effects')
      return 'already-fulfilled'
    }

    await this._createEnrollment(order.userId.toString(), order.courseId.toString())
    await this._autoApproveViaPayment(order.userId.toString(), order.courseId.toString())
    void this._sendPostPaymentNotifications(order.userId.toString(), order.courseId.toString(), order.id)
    logger.info({ tabbyPaymentId, orderId: order.id }, 'Tabby: order fulfilled')
    return 'fulfilled'
  }

  /* ─── Tabby webhook cancellation (rejected / expired) ─────────────────────
     The mirror of cancelTamaraFromWebhook, which Tabby never had. Every
     create*Order path claims the coupon usage slot BEFORE the gateway call,
     and releasingOnFailure only hands it back when that call THROWS — so a
     session the student simply abandons (BNPL drop-off is routine) left the
     order `pending` and the slot spent for good, with no cron sweeping either.
     Tabby tells us when a payment is rejected or expires; act on it.

     Bound to the order the way fulfilment is, minus the network call: a cancel
     may only touch an order that is a Tabby order AND already carries this
     payment id. Nothing is taken on the payload's word alone. */
  async cancelTabbyFromWebhook(tabbyPaymentId: string, ourOrderId?: string): Promise<void> {
    const order = ourOrderId
      ? await this.orderRepo.findById(ourOrderId)
      : await this.orderRepo.findByTabbyPaymentId(tabbyPaymentId)

    if (!order) {
      logger.warn({ tabbyPaymentId, ourOrderId }, 'Tabby cancel-webhook: no matching order')
      return
    }
    if (order.gateway !== 'tabby' || (order as any).tabbyPaymentId !== tabbyPaymentId) {
      logger.error(
        { orderId: order.id, gateway: order.gateway, tabbyPaymentId },
        'Tabby cancel-webhook: payment does not belong to this order — ignoring',
      )
      return
    }
    /* Only cancel pending orders — don't touch already-paid or refunded ones */
    if (order.status !== 'pending') {
      logger.info({ orderId: order.id, status: order.status }, 'Tabby cancel-webhook: order not pending, skipping')
      return
    }

    const cancelled = await this.orderRepo.markCancelled(order.id)
    if (!cancelled) {
      logger.info({ orderId: order.id }, 'Tabby cancel-webhook: order no longer pending, skipping')
      return
    }

    /* Hand the coupon slot claimed at checkout back to the pool. Gated on the
       conditional flip above, so a re-delivered webhook releases at most once. */
    if (order.couponId) {
      const couponId = order.couponId.toString()
      void this.couponSvc.release(couponId).catch(err =>
        logger.warn({ err, orderId: order.id, couponId }, 'Failed to release coupon reservation'),
      )
    }

    logger.info({ tabbyPaymentId, orderId: order.id }, 'Tabby: order cancelled via webhook')
  }

  /* ─── Tabby return-URL verify + fulfill (webhook fallback) ─── */
  /* paymentId: Tabby appends ?payment_id=... to the success redirect URL */
  /* `paid` is the answer to the only question the return page actually has:
     did this order settle? It used to report nothing but needsRegistration, so
     the client treated ANY 200 as success — it emptied the basket and showed a
     thank-you even when fulfilment had been refused (payment not authorised,
     binding mismatch, Tabby unreachable). A student who abandoned the BNPL
     agreement lost their cart and was told they had paid.

     Tabby's QA checks the same behaviour from the other side: "Cart preserved
     after cancellation/failure; cleared after successful payment." */
  async verifyTabbyReturn(
    userId: string, orderId: string, paymentId?: string,
  ): Promise<{ needsRegistration: boolean; paid: boolean }> {
    const order = await this.orderRepo.findById(orderId)
    if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found', 404)
    if (order.userId.toString() !== userId) {
      throw new OrderError('FORBIDDEN', 'Order does not belong to you', 403)
    }

    let paid = order.status === 'paid'

    if (!paid) {
      /* Prefer payment_id from redirect URL, fall back to what was stored at checkout creation */
      const tabbyPaymentId = paymentId || ((order as any).tabbyPaymentId as string | undefined)
      if (tabbyPaymentId) {
        const outcome = await this.fulfillTabbyFromWebhook(tabbyPaymentId, orderId)
        paid = outcome === 'fulfilled' || outcome === 'already-fulfilled'
      } else {
        logger.warn({ orderId }, 'Tabby verify-return: no payment_id available — awaiting webhook')
      }
    }

    const user = await UserModel.findById(userId).select('signupType').lean()
    const needsRegistration = (user as any)?.signupType === 'express'
    return { needsRegistration, paid }
  }

  /* ─── Create Abzer checkout (UAE) ───────────────────── */
  async createAbzerOrder(
    userId:      string,
    courseId:    string,
    slug:        string,
    couponCode?: string,
  ): Promise<{ checkoutUrl: string; abzerOrderId: string }> {
    if (!env.ABZER_ACCESS_KEY || !env.ABZER_SECRET_KEY) {
      throw new OrderError('ABZER_NOT_CONFIGURED', 'Abzer is not configured on this server.', 503)
    }
    if (!Types.ObjectId.isValid(courseId)) {
      throw new OrderError('INVALID_COURSE_ID', 'Invalid course id', 400)
    }

    const course = await CourseModel.findById(courseId).exec()
    if (!course || course.status !== 'published') {
      throw new OrderError('COURSE_NOT_FOUND', 'Course not found', 404)
    }
    if (course.isFree || course.price <= 0) {
      throw new OrderError('COURSE_IS_FREE', 'This course is free — use the enroll endpoint instead', 400)
    }

    const { EnrollmentModel } = await import('@/models/schema.ts')
    const existing = await EnrollmentModel.findOne({ userId, courseId }).exec()
    if (existing) {
      throw new OrderError('ALREADY_ENROLLED', 'You are already enrolled in this course', 409)
    }

    const priceAED     = aedPriceFor(course as any)
    const originalFils = Math.round(priceAED * 100)
    let   finalFils    = originalFils
    let   discountFils = 0
    let   couponId: string | undefined

    if (couponCode) {
      /* Prices BEFORE claiming the usage slot — see validateAndPrice(). */
      const priced   = await this.couponSvc.validateAndPrice(
        couponCode, courseId, originalFils, env.ABZER_CURRENCY,
      )
      finalFils      = priced.finalCents
      discountFils   = priced.discountCents
      couponId       = priced.coupon.id
    }

    return this.releasingOnFailure(couponId, async () => {
      const order = await this.orderRepo.create({
        userId,
        courseId,
        ...(await this._orgIdFor(userId)),
        gateway:  'abzer',
        amount:   finalFils,
        currency: env.ABZER_CURRENCY,
        ...(couponId     && { couponId }),
        ...(discountFils && { discountAmount: discountFils }),
      })

      const user = await UserModel.findById(userId).select('name email').exec()
      const successUrl = `${env.CLIENT_URL}/courses/${slug}?checkout=success`
      const cancelUrl  = `${env.CLIENT_URL}/courses/${slug}?checkout=cancel`
      const failureUrl = `${env.CLIENT_URL}/courses/${slug}?checkout=cancel`

      const result = await this.abzerSvc.createOrder({
        amountAED:   finalFils / 100,
        orderId:     order.id,
        courseTitle: course.title,
        buyerEmail:  user?.email ?? '',
        buyerName:   user?.name  ?? '',
        buyerPhone:  (user as any)?.phone ?? '',
      })

      await patchAbzerOrderId(order.id, result.abzerRequestId)

      return { checkoutUrl: result.checkoutUrl, abzerOrderId: result.abzerRequestId }
    })
  }

  /* ─── Abzer webhook fulfillment (idempotent) ─────────── */
  /* orderId = the invoiceNumber from the webhook payload, which Abzer sets to our referenceNumber */
  async fulfillAbzerFromWebhook(orderId: string, receiptId: string): Promise<void> {
    const order = await this.orderRepo.findById(orderId)
    if (!order) {
      logger.warn({ orderId }, 'Abzer webhook: no matching order')
      return
    }
    if (order.status === 'paid') {
      logger.info({ orderId: order.id }, 'Abzer webhook: already fulfilled')
      return
    }

    /* Conditional flip — the return-URL verify may have raced us */
    const fulfilled = await this.orderRepo.fulfillAbzer(order.id, receiptId)
    if (!fulfilled) {
      logger.info({ orderId: order.id }, 'Abzer webhook: order fulfilled concurrently, skipping side effects')
      return
    }

    await this._createEnrollment(order.userId.toString(), order.courseId.toString())
    await this._autoApproveViaPayment(order.userId.toString(), order.courseId.toString())
    void this._sendPostPaymentNotifications(order.userId.toString(), order.courseId.toString(), order.id)
    logger.info({ orderId, receiptId }, 'Abzer: order fulfilled via webhook')
  }

  /* ─── Abzer return-URL verify + fulfill (called by client after BillxPro redirect) ── */
  /* Fallback path in case the Abzer webhook didn't fire (common in sandbox).
     Also tells the client whether the user is an express account that needs
     to complete registration before accessing their course. */
  async verifyAbzerReturn(
    userId:        string,
    orderId:       string,
    _transactionId: string,
  ): Promise<{ needsRegistration: boolean; paid: boolean }> {
    const order = await this.orderRepo.findById(orderId)
    if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found', 404)
    if (order.userId.toString() !== userId) {
      throw new OrderError('FORBIDDEN', 'Order does not belong to you', 403)
    }

    /* READ-ONLY (P-01). This used to call fulfillAbzerFromWebhook() directly,
       which marks the order paid, creates the enrolment and auto-approves the
       account — with NO verification of any kind, because AbzerService has no
       status-lookup method to call. Three requests (register → create-order →
       verify-return) bought any course for free and upgraded a browse-only
       viewer to an approved student.

       The Abzer WEBHOOK is the verified path: it checks X-Abzer-Secret before
       fulfilling. So this endpoint now only reports what that path has already
       decided. It waits briefly first, because the browser redirect commonly
       beats the server-to-server callback by a few hundred milliseconds and
       returning "not paid yet" in that window would be a worse answer than the
       truth a moment later.

       ⚠️ OPERATIONAL DEPENDENCY: ABZER_WEBHOOK_SECRET must be configured in
       the Abzer console for production, or orders will never fulfil. */
    let paid = order.status === 'paid'
    if (!paid) {
      paid = await this.#awaitGatewayFulfilment(orderId)
    }
    if (!paid) {
      logger.warn(
        { orderId },
        'Abzer verify-return: order still pending after the webhook grace window — check ABZER_WEBHOOK_SECRET is registered with the gateway',
      )
    }

    const user = await UserModel.findById(userId).select('signupType').lean()
    const needsRegistration = (user as any)?.signupType === 'express'

    return { needsRegistration, paid }
  }

  /* ─── Wait out the redirect/webhook race ────────────────
     The customer's browser is redirected back to us the instant the gateway
     finishes, which often lands ahead of the gateway's own server-to-server
     callback. Re-read the order for a short window so the return page can show
     a settled answer instead of "pending" for something that is about to be
     paid. Never mutates — the webhook remains the only thing that can fulfil. */
  async #awaitGatewayFulfilment(orderId: string, timeoutMs = 4_000, stepMs = 400): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      await new Promise(r => setTimeout(r, stepMs))
      const current = await this.orderRepo.findById(orderId)
      if (current?.status === 'paid') return true
      if (Date.now() >= deadline) return false
    }
  }

  /* ─── Create Tamara checkout (UAE BNPL) ─────────────── */
  async createTamaraOrder(
    userId:      string,
    courseId:    string,
    slug:        string,
    couponCode?: string,
  ): Promise<{ checkoutUrl: string; tamaraCheckoutId: string }> {
    if (!env.TAMARA_API_KEY) {
      throw new OrderError('TAMARA_NOT_CONFIGURED', 'Tamara is not configured on this server.', 503)
    }
    if (!Types.ObjectId.isValid(courseId)) {
      throw new OrderError('INVALID_COURSE_ID', 'Invalid course id', 400)
    }
    await this.assertTamaraOffered(userId)

    const course = await CourseModel.findById(courseId).exec()
    if (!course || course.status !== 'published') {
      throw new OrderError('COURSE_NOT_FOUND', 'Course not found', 404)
    }
    if (course.isFree || course.price <= 0) {
      throw new OrderError('COURSE_IS_FREE', 'This course is free — use the enroll endpoint instead', 400)
    }

    const { EnrollmentModel } = await import('@/models/schema.ts')
    const existing = await EnrollmentModel.findOne({ userId, courseId }).exec()
    if (existing) {
      throw new OrderError('ALREADY_ENROLLED', 'You are already enrolled in this course', 409)
    }

    const priceAED     = aedPriceFor(course as any)
    const originalFils = Math.round(priceAED * 100)
    let   finalFils    = originalFils
    let   discountFils = 0
    let   couponId: string | undefined

    if (couponCode) {
      /* Prices BEFORE claiming the usage slot — see validateAndPrice(). */
      const priced   = await this.couponSvc.validateAndPrice(
        couponCode, courseId, originalFils, env.TAMARA_CURRENCY,
      )
      finalFils      = priced.finalCents
      discountFils   = priced.discountCents
      couponId       = priced.coupon.id
    }

    return this.releasingOnFailure(couponId, async () => {
      const order = await this.orderRepo.create({
        userId,
        courseId,
        ...(await this._orgIdFor(userId)),
        gateway:  'tamara',
        amount:   finalFils,
        currency: env.TAMARA_CURRENCY,
        ...(couponId     && { couponId }),
        ...(discountFils && { discountAmount: discountFils }),
      })

      const user       = await UserModel.findById(userId).select('name email').exec()
      const successUrl = `${env.CLIENT_URL}/payment-return?gateway=tamara&orderId=${order.id}`
      const cancelUrl  = `${env.CLIENT_URL}/payment-return?gateway=tamara&status=cancelled`
      const failureUrl = `${env.CLIENT_URL}/payment-return?gateway=tamara&status=failed&orderId=${order.id}`

      const result = await this.tamaraSvc.createCheckout({
        amountAED:   finalFils / 100,
        orderId:     order.id,
        courseTitle: course.title,
        courseId:    course.id,
        buyerEmail:  user?.email ?? '',
        buyerName:   user?.name  ?? '',
        buyerPhone:  (user as any)?.phone ?? '',
        successUrl,
        cancelUrl,
        failureUrl,
      })

      await patchTamaraIds(order.id, result.checkoutId, result.tamaraOrderId)

      return { checkoutUrl: result.checkoutUrl, tamaraCheckoutId: result.checkoutId }
    })
  }

  /* ─── Tamara fulfilment ──────────────────────────────────────────────────
     Driven by the order's ACTUAL state at Tamara, not by whatever a webhook
     body or a request parameter claimed. Both entry points — the webhook and
     the student-callable verify-return — funnel through here.

     Tamara's notification JWT authenticates the caller but signs nothing about
     the payload: its only claims are exp/iat/iss. So the event name and any
     amounts in the body are untrusted, and the first thing this does is ask
     Tamara what is actually true.

     Written status-driven rather than sequence-driven because auto-authorise
     and auto-capture are account-level flags we do not control: the same code
     has to be correct whether we drive each step or Tamara has already. */
  async fulfillTamaraFromWebhook(tamaraOrderId: string, ourOrderId?: string): Promise<TabbyFulfillOutcome> {
    if (!isTamaraId(tamaraOrderId)) {
      logger.warn({ tamaraOrderId }, 'Tamara: malformed order id — ignoring')
      return 'ignored'
    }

    /* 1. Source of truth. A lookup we could not perform has not passed, so a
          failure asks for redelivery rather than being treated as a decline. */
    let remote: Awaited<ReturnType<TamaraService['getOrder']>>
    try {
      remote = await this.tamaraSvc.getOrder(tamaraOrderId)
    } catch (err) {
      logger.error({ err, tamaraOrderId }, 'Tamara: getOrder failed — refusing to fulfil unverified order')
      return 'retry'
    }

    /* 2. Find our order. */
    const order = ourOrderId
      ? await this.orderRepo.findById(ourOrderId)
      : await this.orderRepo.findByTamaraOrderId(tamaraOrderId)

    /* Tamara can beat our own write. Answering "handled" would lose the sale. */
    if (!order) {
      logger.warn({ tamaraOrderId, ourOrderId }, 'Tamara webhook: no matching order yet — asking for retry')
      return 'retry'
    }
    if (order.status === 'paid') {
      logger.info({ orderId: order.id }, 'Tamara webhook: already fulfilled')
      return 'already-fulfilled'
    }

    /* 3. Bind the Tamara order to THIS order — the lesson from the Tabby
          audit. `ourOrderId` arrives from outside on both entry points, so
          without this a student could point any order of theirs at a Tamara
          order that was genuinely paid for something cheaper. Tamara's own
          order_reference_id is the authoritative link. */
    if (order.gateway !== 'tamara') {
      logger.error({ orderId: order.id, gateway: order.gateway }, 'Tamara: refusing to fulfil a non-Tamara order')
      return 'ignored'
    }
    const recordedId = (order as any).tamaraOrderId as string | undefined
    const bound =
      (recordedId && recordedId === tamaraOrderId) ||
      (remote.orderReferenceId && remote.orderReferenceId === order.id)
    if (!bound) {
      logger.error(
        { orderId: order.id, tamaraOrderId, recordedId, reportedRef: remote.orderReferenceId },
        'Tamara: order does not belong to this purchase — refusing to fulfil (replay attempt?)',
      )
      return 'ignored'
    }
    if (remote.totalFils !== order.amount) {
      logger.error({ orderId: order.id, remoteFils: remote.totalFils, orderAmount: order.amount },
        'Tamara: amount does not match the order — refusing to fulfil')
      return 'ignored'
    }
    if (remote.currency.toUpperCase() !== String(order.currency).toUpperCase()) {
      logger.error({ orderId: order.id, remote: remote.currency, ours: order.currency },
        'Tamara: currency mismatch — refusing to fulfil')
      return 'ignored'
    }

    /* 4. Act on the real status. */
    if (!isTamaraStatus(remote.status)) {
      logger.error({ orderId: order.id, status: remote.status },
        'Tamara: unrecognised order status — refusing to guess')
      return 'ignored'
    }
    if (tamaraStatusIsDead(remote.status)) {
      logger.info({ orderId: order.id, status: remote.status }, 'Tamara: order is terminal, not fulfilling')
      return 'ignored'
    }

    const course      = await CourseModel.findById(order.courseId).select('title').lean()
    const courseTitle = (course as any)?.title ?? 'Delta Academy course'
    const amountAED   = order.amount / 100
    /* Widened deliberately: the authorise call below can move this on to a
       status Tamara chooses (`authorised`, or `fully_captured` when
       account-level auto-capture is on). */
    let   status: string = remote.status

    /* `approved` is NOT paid — the customer has paid Tamara a first
       instalment but we hold nothing. Authorise is what commits the funds,
       and it has a 72-hour fuse. */
    if (status === 'approved') {
      const auth = await this.tamaraSvc.authoriseOrder(tamaraOrderId)
      if (!auth.ok) {
        /* Retry rather than ignore: the customer HAS paid, and letting this
           lapse silently is how an order expires with their money taken. */
        logger.error({ tamaraOrderId, orderId: order.id }, 'Tamara: authorise refused — will retry')
        return 'retry'
      }
      status = auth.status || 'authorised'
    }

    if (!tamaraStatusIsPaid(status)) {
      logger.warn({ orderId: order.id, status }, 'Tamara: order not in a paid state — not fulfilling')
      return 'ignored'
    }

    /* Capture is what puts the money in a settlement; `authorised` alone never
       pays out. A course is delivered instantly, so capture now rather than
       waiting for Tamara's 21-day auto-capture. Skipped when it already
       happened — either because account-level auto-capture is on, or because a
       redelivered webhook is walking the same path a second time. */
    const alreadyCaptured = remote.capturedFils > 0 || status === 'fully_captured' || status === 'partially_captured'
    if (!alreadyCaptured) {
      const captured = await this.tamaraSvc.captureOrder({
        tamaraOrderId,
        amountAED,
        courseTitle,
        courseId:     order.courseId.toString(),
        shippedAtIso: new Date().toISOString(),
      })
      /* Deliberately not a reason to withhold the course: at `authorised` the
         funds are committed and the enrolment is owed. An uncaptured payment
         is money not yet collected — a settlement problem to chase from the
         logs, and loud rather than silent. */
      if (!captured) {
        logger.error({ tamaraOrderId, orderId: order.id },
          'Tamara: fulfilling an UNCAPTURED order — collect manually before the 21-day auto-capture')
      }
    }

    /* 5. Conditional flip — the return-URL verify may have raced us. */
    const fulfilled = await this.orderRepo.fulfillTamara(order.id, tamaraOrderId)
    if (!fulfilled) {
      logger.info({ orderId: order.id }, 'Tamara: order fulfilled concurrently, skipping side effects')
      return 'already-fulfilled'
    }

    await this._createEnrollment(order.userId.toString(), order.courseId.toString())
    await this._autoApproveViaPayment(order.userId.toString(), order.courseId.toString())
    void this._sendPostPaymentNotifications(order.userId.toString(), order.courseId.toString(), order.id)
    logger.info({ tamaraOrderId, orderId: order.id, status }, 'Tamara: order fulfilled')
    return 'fulfilled'
  }

  /* ─── Tamara webhook cancellation (ORDER_EXPIRED / ORDER_DECLINED) ───────── */
  async cancelTamaraFromWebhook(tamaraOrderId: string, ourOrderId?: string): Promise<void> {
    const order = ourOrderId
      ? await this.orderRepo.findById(ourOrderId)
      : await this.orderRepo.findByTamaraOrderId(tamaraOrderId)

    if (!order) {
      logger.warn({ tamaraOrderId, ourOrderId }, 'Tamara cancel-webhook: no matching order')
      return
    }
    /* Only cancel pending orders — don't touch already-paid ones */
    if (order.status !== 'pending') {
      logger.info({ orderId: order.id, status: order.status }, 'Tamara cancel-webhook: order not pending, skipping')
      return
    }

    const cancelled = await this.orderRepo.markCancelled(order.id)
    if (!cancelled) {
      logger.info({ orderId: order.id }, 'Tamara cancel-webhook: order no longer pending, skipping')
      return
    }

    /* Hand the coupon slot claimed at checkout back to the pool */
    if (order.couponId) {
      const couponId = order.couponId.toString()
      void this.couponSvc.release(couponId).catch(err =>
        logger.warn({ err, orderId: order.id, couponId }, 'Failed to release coupon reservation'),
      )
    }

    logger.info({ tamaraOrderId, orderId: order.id }, 'Tamara: order cancelled via webhook')
  }

  /* ─── Tamara `order_canceled` reconciliation ─────────────────────────────
     This one event covers two opposite outcomes, which is the single most
     dangerous ambiguity in the Tamara API:

       • status `canceled` — the order really was cancelled before capture.
         Release it and hand the coupon slot back.
       • status `updated`  — PARTIALLY cancelled. Tamara's own state diagram
         routes `updated` onward to capture, so the order is still live and
         will still settle. A naive `if (event === 'order_canceled') revoke()`
         would strip a paying student of a course they still own.

     The event name decides nothing; the order's real status does. */
  async reconcileTamaraCancellation(tamaraOrderId: string, ourOrderId?: string): Promise<void> {
    if (!isTamaraId(tamaraOrderId)) return

    let remote: Awaited<ReturnType<TamaraService['getOrder']>>
    try {
      remote = await this.tamaraSvc.getOrder(tamaraOrderId)
    } catch (err) {
      logger.error({ err, tamaraOrderId }, 'Tamara cancel-webhook: getOrder failed — leaving the order untouched')
      return
    }

    if (remote.status === 'updated') {
      logger.warn({ tamaraOrderId, ourOrderId, canceledFils: remote.canceledFils },
        'Tamara: PARTIAL cancellation (status `updated`) — order is still live, access left intact')
      return
    }
    if (remote.status !== 'canceled') {
      logger.info({ tamaraOrderId, status: remote.status },
        'Tamara cancel-webhook: order is not cancelled at Tamara, ignoring')
      return
    }
    await this.cancelTamaraFromWebhook(tamaraOrderId, ourOrderId)
  }

  /* ─── Tamara return-URL verify + fulfill (called by client after redirect) ── */
  /* `paid` is the only question the return page actually has. Reporting just
     needsRegistration let the client treat any 200 as success — emptying the
     cart and showing a thank-you even when fulfilment had been refused.

     Note this route never accepts a Tamara order id from the caller: it uses
     the one recorded at checkout. That is deliberate, and is what stops the
     replay that the equivalent Tabby route had to be hardened against. */
  async verifyTamaraReturn(
    userId:  string,
    orderId: string,
  ): Promise<{ needsRegistration: boolean; paid: boolean }> {
    const order = await this.orderRepo.findById(orderId)
    if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found', 404)
    if (order.userId.toString() !== userId) {
      throw new OrderError('FORBIDDEN', 'Order does not belong to you', 403)
    }

    let paid = order.status === 'paid'
    if (!paid) {
      const tamaraOrderId = (order as any).tamaraOrderId as string | undefined
      if (tamaraOrderId) {
        const outcome = await this.fulfillTamaraFromWebhook(tamaraOrderId, orderId)
        paid = outcome === 'fulfilled' || outcome === 'already-fulfilled'
      } else {
        logger.warn({ orderId }, 'Tamara verify-return: no tamaraOrderId stored — cannot authorise')
      }
    }

    const user = await UserModel.findById(userId).select('signupType').lean()
    const needsRegistration = (user as any)?.signupType === 'express'

    return { needsRegistration, paid }
  }

  /* ─── Refund (gateway-aware) ────────────────────────── */
  async refund(orderId: string): Promise<void> {
    const order = await this.orderRepo.findById(orderId)
    if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found', 404)
    if (order.status !== 'paid') {
      throw new OrderError('ORDER_NOT_PAID', 'Only paid orders can be refunded', 400)
    }

    if (order.gateway === 'razorpay') {
      if (!order.razorpayPaymentId) {
        throw new OrderError('NO_PAYMENT_ID', 'Cannot refund — no Razorpay payment id on record', 400)
      }
      await this.razorpaySvc.refundPayment(order.razorpayPaymentId)
    } else if (order.gateway === 'tabby') {
      await this._refundTabby(order)
    } else if (order.gateway === 'tamara') {
      await this._refundTamara(order)
    } else if (order.gateway === 'abzer') {
      throw new OrderError(
        'MANUAL_REFUND_REQUIRED',
        'Abzer refunds must be processed via the gateway dashboard.',
        422,
      )
    } else {
      if (!order.stripePaymentIntentId) {
        throw new OrderError('NO_PAYMENT_ID', 'Cannot refund — no payment intent on record', 400)
      }
      await this.stripeSvc.refundPaymentIntent(order.stripePaymentIntentId)
    }

    await this.orderRepo.markRefunded(orderId)
  }

  /* ─── Tabby refund ────────────────────────────────────────────────────────
     Tabby draws a hard line between two operations and QA tests both:

       • money was captured  → REFUND it (only a CLOSED payment can be refunded)
       • money was never captured → CLOSE the payment, which returns everything
         the customer has paid. Refunding an uncaptured payment is rejected.

     So the live payment is read first and the branch taken from what Tabby
     itself reports, never from our own order row. Refund totals are validated
     against the CAPTURED amount — not the authorized amount — and computed by
     summing the arrays by value, because Tabby does not guarantee their order. */
  private async _refundTabby(order: IOrder): Promise<void> {
    const paymentId = (order as any).tabbyPaymentId as string | undefined
    if (!paymentId) {
      throw new OrderError('NO_PAYMENT_ID', 'Cannot refund — no Tabby payment id on record', 400)
    }

    let payment: Awaited<ReturnType<TabbyService['getPayment']>>
    try {
      payment = await this.tabbySvc.getPayment(paymentId)
    } catch (err) {
      logger.error({ err, paymentId, orderId: order.id }, 'Tabby refund: getPayment failed')
      throw new OrderError('GATEWAY_UNAVAILABLE', 'Could not reach Tabby to verify the payment. Try again.', 502)
    }

    const capturedFils = tabbySumFils(payment.captures)
    const refundedFils = tabbySumFils(payment.refunds)

    /* Nothing captured: this is a cancellation, not a refund. */
    if (capturedFils === 0) {
      const closed = await this.tabbySvc.closePayment(paymentId)
      if (!closed) {
        throw new OrderError('REFUND_FAILED', 'Tabby refused to close this payment. Check the Tabby dashboard.', 502)
      }
      logger.info({ orderId: order.id, paymentId }, 'Tabby: uncaptured payment closed (full cancellation)')
      return
    }

    const refundableFils = capturedFils - refundedFils
    if (refundableFils <= 0) {
      throw new OrderError('ALREADY_REFUNDED', 'This Tabby payment has already been fully refunded.', 409)
    }

    /* Refund what is left, capped at the captured total. */
    const amountAED = (refundableFils / 100).toFixed(2)
    const course    = await CourseModel.findById(order.courseId).select('title').lean()

    const ok = await this.tabbySvc.refundPayment({
      paymentId,
      amountAED,
      orderId:     order.id,
      reason:      'Refunded by Delta Academy admin',
      /* A reused reference_id replays the first refund rather than issuing a
         second, so genuine repeat refunds need a distinct one. Derived from how
         many refunds Tabby already holds — stable across retries of the SAME
         refund, distinct for the next one. */
      attempt:     payment.refunds.length + 1,
      courseTitle: (course as any)?.title,
      courseId:    order.courseId.toString(),
    })
    if (!ok) {
      throw new OrderError('REFUND_FAILED', 'Tabby refused the refund. Check the Tabby dashboard.', 502)
    }
  }

  /* ─── Tamara refund ──────────────────────────────────────────────────────
     Tamara draws a hard line that the API will enforce for us if we get it
     wrong, so the branch is taken from the order's REAL state at Tamara:

       • captured  → REFUND. The refund edge in Tamara's state machine runs
         only from a captured status; refunding an authorised-but-uncaptured
         order is rejected.
       • authorised, nothing captured → CANCEL. That is the documented unwind
         for an order whose money has not yet been moved into a settlement.

     Refund totals are validated against what Tamara says was captured, never
     against our own row. */
  private async _refundTamara(order: IOrder): Promise<void> {
    const tamaraOrderId = (order as any).tamaraOrderId as string | undefined
    if (!tamaraOrderId) {
      throw new OrderError('NO_PAYMENT_ID', 'Cannot refund — no Tamara order id on record', 400)
    }

    let remote: Awaited<ReturnType<TamaraService['getOrder']>>
    try {
      remote = await this.tamaraSvc.getOrder(tamaraOrderId)
    } catch (err) {
      logger.error({ err, tamaraOrderId, orderId: order.id }, 'Tamara refund: getOrder failed')
      throw new OrderError('GATEWAY_UNAVAILABLE', 'Could not reach Tamara to verify the order. Try again.', 502)
    }

    /* Nothing captured yet: this is a cancellation, not a refund. */
    if (remote.capturedFils === 0) {
      if (remote.status !== 'authorised') {
        throw new OrderError('NOT_REFUNDABLE',
          `Tamara order is ${remote.status || 'in an unknown state'} — nothing to refund or cancel.`, 409)
      }
      const cancelled = await this.tamaraSvc.cancelOrder({
        tamaraOrderId, amountAED: order.amount / 100, orderId: order.id,
      })
      if (!cancelled) {
        throw new OrderError('REFUND_FAILED', 'Tamara refused to cancel this order. Check the Tamara portal.', 502)
      }
      logger.info({ orderId: order.id, tamaraOrderId }, 'Tamara: uncaptured order cancelled')
      return
    }

    const refundableFils = remote.capturedFils - remote.refundedFils
    if (refundableFils <= 0) {
      throw new OrderError('ALREADY_REFUNDED', 'This Tamara order has already been fully refunded.', 409)
    }

    const ok = await this.tamaraSvc.refundOrder({
      tamaraOrderId,
      amountAED: refundableFils / 100,
      orderId:   order.id,
      comment:   'Refunded by Delta Academy admin',
      /* Tamara's merchant_refund_id is the nearest thing to an idempotency
         key. Derived from how many refunds Tamara already holds, so a retry of
         the SAME refund reuses it and a genuine second one does not. */
      attempt:   remote.refundedFils > 0 ? 2 : 1,
    })
    if (!ok) {
      throw new OrderError('REFUND_FAILED', 'Tamara refused the refund. Check the Tamara portal.', 502)
    }
  }

  /* ─── List orders (student) ─────────────────────────── */
  async listForUser(userId: string) {
    return this.orderRepo.listForUser(userId)
  }

  /* ─── Admin list + analytics ──────────────────────── */
  async adminList(
    page = 1, perPage = 20, status?: string, organizationId?: string, gateway?: string,
  ) {
    return this.orderRepo.listAll(page, perPage, status, organizationId, gateway)
  }

  async gatewayBreakdown(organizationId?: string) {
    return this.orderRepo.gatewayBreakdown(organizationId)
  }

  async revenueTimeseries(days: number, organizationId?: string) {
    return this.orderRepo.revenueTimeseries(days, organizationId)
  }

  async totalRevenue(): Promise<number> {
    return this.orderRepo.totalRevenue()
  }

  /* ─── Private helpers ───────────────────────────────── */
  /* The academy an order belongs to, spread into orderRepo.create().

     Every order was created without this, which quietly disarmed the admin
     refund route: its tenancy check treats an order with no organizationId as
     grandfathered and refundable by anyone, so with the field never set, one
     academy's admin could issue a real gateway refund against another's order.
     Returns {} when the buyer has no org, which keeps that grandfather path
     working for genuinely old rows. */
  private async _orgIdFor(userId: string): Promise<{ organizationId?: string }> {
    const user = await UserModel.findById(userId).select('organizationId').lean()
    const orgId = (user as { organizationId?: unknown } | null)?.organizationId
    return orgId ? { organizationId: String(orgId) } : {}
  }

  /* ── Provision an LMS student from an external (AI-academy website) purchase ──
     Server-to-server, called by the AI-academy integration. Idempotent on the
     external orderId (stored as Order.razorpayOrderId): a webhook retry returns
     the existing result rather than re-enrolling. Creates a passwordless account
     if needed, auto-approves, and enrolls in BOTH AI-academy courses. */
  async provisionExternalPurchase(input: {
    email: string
    name?: string
    phone?: string
    orderId: string
    amount?: number
    currency?: string
    /* Which gateway actually took the money. Optional for compatibility with
       callers written before this existed; those still record 'razorpay',
       which is what the AI-academy site used at the time. */
    gateway?: OrderGateway
  }): Promise<{ userId: string; created: boolean; alreadyProcessed: boolean; enrolled: string[] }> {
    const { OrderModel, OrganizationModel } = await import('@/models/schema.ts')
    const email = input.email.toLowerCase().trim()
    const COURSE_SLUGS = ['ai', 'ai-academy-english']   // Malayalam + English

    /* AI-academy buyers belong to the Bangalore (India) academy — the
       INR/Razorpay org the AI-academy programme sits under — so they show up
       under, and are managed by, that org rather than being org-less. */
    const bangalore = await OrganizationModel.findOne({ slug: 'bangalore' }).select('_id').lean()
    const organizationId = bangalore?._id

    /* Upsert the user (create passwordless if new; backfill blank name/phone). */
    let user = await UserModel.findOne({ email })
    let created = false
    if (!user) {
      user = await UserModel.create({
        name:  input.name?.trim() || email.split('@')[0],
        email,
        role:  'student',
        ...(organizationId ? { organizationId } : {}),
        ...(input.phone ? { enrollmentApplication: { phone: input.phone.trim() } } : {}),
      })
      created = true
    } else {
      const set: Record<string, unknown> = {}
      if (input.name && !user.name) set['name'] = input.name.trim()
      if (input.phone && !(user as { enrollmentApplication?: { phone?: string } }).enrollmentApplication?.phone) {
        set['enrollmentApplication.phone'] = input.phone.trim()
      }
      /* Assign the org only if the account has none — never clobber a student
         who already belongs to a different academy. */
      if (organizationId && !(user as { organizationId?: unknown }).organizationId) {
        set['organizationId'] = organizationId
      }
      if (Object.keys(set).length) await UserModel.updateOne({ _id: user._id }, { $set: set })
    }
    const userId = String(user._id)

    /* Idempotency: this external order already provisioned? */
    const prior = await OrderModel.findOne({ razorpayOrderId: input.orderId }).select('_id').lean()
    if (prior) {
      logger.info({ orderId: input.orderId, userId }, 'AI-academy purchase already provisioned — skipping')
      return { userId, created, alreadyProcessed: true, enrolled: COURSE_SLUGS }
    }

    const courses = await CourseModel.find({ slug: { $in: COURSE_SLUGS } }).select('_id slug price').lean()

    /* Which gateway took the money, as reported by the caller. Hardcoding
       'razorpay' meant the Orders table described every external purchase as
       a Razorpay one whatever actually happened — so the table could never
       answer the question it exists to answer. */
    const gateway: OrderGateway = input.gateway ?? 'razorpay'

    /* What was actually paid.

       `input.amount ?? 0` recorded a settled purchase as a payment of zero
       whenever the caller omitted the field — which it is allowed to do, so
       every row read ₹0.00 and the revenue figures built on them were silently
       wrong. Zero is a CLAIM, not a safe default: it says the student paid
       nothing, which is a different statement from "the amount was not sent".
       Falling back to the course's own price is the best available truth, and
       a missing amount is logged so the gap is visible rather than absorbed. */
    if (input.amount === undefined) {
      logger.warn(
        { orderId: input.orderId, gateway },
        'external purchase arrived with no amount — falling back to the course price',
      )
    }

    /* ONE payment, several courses.

       A single external purchase enrols the buyer in every AI-academy course,
       and each enrolment needs its own Order row because Order.courseId is
       required. Writing the full amount on all of them turned one ₹5,000
       purchase into ₹10,000 of reported revenue — every revenue query sums
       this collection. The paid amount is therefore attributed ONCE, to the
       first row; the rest carry 0 and the same external order id, so they stay
       traceable to the purchase without being counted twice. */
    const enrolled: string[] = []
    let amountRemaining: number | null = input.amount ?? null

    for (const c of courses as Array<{ _id: unknown; slug: string; price?: number }>) {
      const courseId = String(c._id)
      await this._createEnrollment(userId, courseId)
      await this._autoApproveViaPayment(userId, courseId)

      let amount: number
      if (amountRemaining !== null) { amount = amountRemaining; amountRemaining = 0 }
      else                          { amount = enrolled.length === 0 ? (c.price ?? 0) : 0 }

      await OrderModel.create({
        userId, courseId, gateway, status: 'paid',
        amount,
        currency: (input.currency ?? 'INR').toLowerCase().slice(0, 3),
        razorpayOrderId: input.orderId,
      })
      enrolled.push(c.slug)
    }

    logger.info({ orderId: input.orderId, userId, enrolled, created }, '✅ AI-academy purchase provisioned in LMS')
    return { userId, created, alreadyProcessed: false, enrolled }
  }

  /**
   * Grants a student one course by hand — the manual equivalent of a settled
   * purchase for any course (not just AI-academy). Creates a passwordless
   * account if needed, enrols + approves them, records a paid Order, and puts
   * them under the academy that owns the course. Idempotent per (user, course).
   * Does NOT email — the caller (script/route) sends the login link, so the
   * link is built with that process's CLIENT_URL.
   */
  async provisionManualPurchase(input: {
    email: string
    name?: string
    phone?: string
    courseSlug: string
    amount?: number
  }): Promise<{
    userId: string
    created: boolean
    courseSlug: string
    courseTitle: string
    organizationSlug: string | null
  }> {
    const { OrderModel, OrganizationModel } = await import('@/models/schema.ts')
    const email = input.email.toLowerCase().trim()

    const course = await CourseModel.findOne({ slug: input.courseSlug })
      .select('_id slug title organizationId program').lean()
    if (!course?._id) throw new Error(`No course with slug "${input.courseSlug}"`)
    const courseId = String(course._id)

    /* The student belongs to the academy that runs the course. */
    const organizationId = (course as { organizationId?: unknown }).organizationId
    const org = organizationId
      ? await OrganizationModel.findById(organizationId as string).select('slug currency').lean()
      : null

    let user = await UserModel.findOne({ email })
    let created = false
    if (!user) {
      user = await UserModel.create({
        name: input.name?.trim() || email.split('@')[0],
        email,
        role: 'student',
        ...(organizationId ? { organizationId } : {}),
        ...(input.phone ? { enrollmentApplication: { phone: input.phone.trim() } } : {}),
      })
      created = true
    } else {
      const set: Record<string, unknown> = {}
      if (input.name && !user.name) set['name'] = input.name.trim()
      if (input.phone && !(user as { enrollmentApplication?: { phone?: string } }).enrollmentApplication?.phone) {
        set['enrollmentApplication.phone'] = input.phone.trim()
      }
      if (organizationId && !(user as { organizationId?: unknown }).organizationId) {
        set['organizationId'] = organizationId
      }
      if (Object.keys(set).length) await UserModel.updateOne({ _id: user._id }, { $set: set })
    }
    const userId = String(user._id)

    await this._createEnrollment(userId, courseId)

    /* Manual grants approve immediately — the point is to give access now. The
       payment flow's _autoApproveViaPayment defers express accounts until they
       finish registration, which isn't what a hand-provision wants. Still merge
       the course's programme category so their access scope is right. */
    const existing = user as { categories?: string[]; category?: string }
    const cats = new Set<string>(existing.categories ?? (existing.category ? [existing.category] : []))
    const courseCat = (course as { program?: string }).program
    if (courseCat) cats.add(courseCat)
    await UserModel.findByIdAndUpdate(userId, {
      $set: {
        enrollmentStatus: 'approved',
        approvedByEmail: 'manual@system',
        approvedByName: 'Manual Enrollment',
        approvedByRole: 'system',
        approvedAt: new Date(),
        ...(cats.size ? { categories: [...cats], category: [...cats][0] } : {}),
      },
      $unset: { rejectionReason: '', enrollmentCancellationReason: '' },
    })

    await OrderModel.create({
      userId, courseId,
      gateway: 'razorpay', status: 'paid',
      amount: input.amount ?? 0,
      currency: ((org as { currency?: string })?.currency ?? 'AED').toLowerCase().slice(0, 3),
    })

    logger.info({ userId, courseSlug: input.courseSlug, created }, '✅ Manual course purchase provisioned')
    return {
      userId,
      created,
      courseSlug: (course as { slug: string }).slug,
      courseTitle: (course as { title: string }).title,
      organizationSlug: (org as { slug?: string })?.slug ?? null,
    }
  }

  private async _createEnrollment(userId: string, courseId: string): Promise<void> {
    const { EnrollmentRepository } = await import('@/repositories/enrollment.repository.ts')
    const { CourseRepository }     = await import('@/repositories/course.repository.ts')
    const enrollRepo = new EnrollmentRepository()
    const courseRepo = new CourseRepository()

    const already = await enrollRepo.findByUserCourse(userId, courseId)
    if (!already) {
      /* Every caller of _createEnrollment is a settled payment — the gateway
         webhooks, the manual capture paths, and the AI-academy provisioning,
         which writes its own paid Order alongside. */
      try {
        await enrollRepo.create_({ userId, courseId, source: 'purchase' })
        await courseRepo.incrementEnrollment(courseId, 1)
      } catch (err) {
        /* check-then-create is not atomic: a webhook and a verify-return racing
           for the same order both see "not enrolled". The unique index on
           (userId, courseId) settles it, and the loser must not turn that into
           a 500 — which the webhook would answer with a retry, hiding a
           fulfilment that in fact succeeded. Only a duplicate is swallowed. */
        if ((err as { code?: number })?.code === 11000) {
          logger.info({ userId, courseId }, 'Enrolment already created concurrently — ignoring duplicate')
        } else {
          throw err
        }
      }
    }
  }

  /* Auto-approve a viewer/rejected user when they successfully pay for a course.
     Sets enrollmentStatus → 'approved', assigns the course's program category,
     and marks approval as a paid self-enrollment so admins can see it in the UI.
     Express accounts (signupType === 'express') are skipped — they must complete
     their full registration first; the registration handler checks for paid orders
     and auto-approves at that point. */
  private async _autoApproveViaPayment(userId: string, courseId: string): Promise<void> {
    const user = await UserModel.findById(userId)
      .select('enrollmentStatus categories category signupType').lean()
    if (!user || (user as any).enrollmentStatus === 'approved') return

    if ((user as any).signupType === 'express') {
      logger.info({ userId }, 'Express account paid — deferring approval until registration complete')
      return
    }

    const course = await CourseModel.findById(courseId).select('program').lean()
    const newCat  = (course as any)?.program as string | undefined

    const existingCats: string[] = (user as any).categories
      ?? ((user as any).category ? [(user as any).category] : [])
    const mergedCats = newCat
      ? [...new Set([...existingCats, newCat])]
      : existingCats

    await UserModel.findByIdAndUpdate(userId, {
      $set: {
        enrollmentStatus: 'approved',
        approvedByEmail:  'payment@system',
        approvedByName:   'Paid Enrollment',
        approvedByRole:   'system',
        approvedAt:       new Date(),
        ...(mergedCats.length > 0 && { categories: mergedCats, category: mergedCats[0] }),
      },
      $unset: { rejectionReason: '', enrollmentCancellationReason: '' },
    })

    logger.info({ userId, courseId, category: newCat }, '✅ Viewer auto-approved via paid enrollment')
  }

  private async _sendPostPaymentNotifications(userId: string, courseId: string, orderId: string): Promise<void> {
    try {
      const course = await CourseModel.findById(courseId).select('title slug').exec()
      if (!course) return

      void this.notifications.create(userId, {
        kind:  'enrollment',
        title: `Enrolled in ${course.title}`,
        body:  'Your payment was successful. Start learning now!',
        link:  `/courses/${course.slug}`,
      }).catch(() => {})

      const user = await UserModel.findById(userId).select('name email').exec()
      if (user) {
        const courseUrl = `${env.CLIENT_URL}/courses/${course.slug}`
        await sendEnrollmentConfirmation(user.email, user.name, course.title, courseUrl)
      }
    } catch (err) {
      logger.warn({ err, orderId }, 'Post-payment notification failed')
    }
  }
}

async function patchStripeSession(orderId: string, sessionId: string): Promise<void> {
  const { OrderModel } = await import('@/models/schema.ts')
  await OrderModel.findByIdAndUpdate(orderId, { $set: { stripeCheckoutSessionId: sessionId } }).exec()
}

async function patchRazorpayOrderId(orderId: string, razorpayOrderId: string): Promise<void> {
  const { OrderModel } = await import('@/models/schema.ts')
  await OrderModel.findByIdAndUpdate(orderId, { $set: { razorpayOrderId } }).exec()
}

async function patchTabbyCheckoutId(orderId: string, tabbyCheckoutId: string, tabbyPaymentId: string): Promise<void> {
  const { OrderModel } = await import('@/models/schema.ts')
  await OrderModel.findByIdAndUpdate(orderId, { $set: { tabbyCheckoutId, tabbyPaymentId } }).exec()
}

async function patchAbzerOrderId(orderId: string, abzerOrderId: string): Promise<void> {
  const { OrderModel } = await import('@/models/schema.ts')
  await OrderModel.findByIdAndUpdate(orderId, { $set: { abzerOrderId } }).exec()
}

async function patchTamaraIds(orderId: string, tamaraCheckoutId: string, tamaraOrderId: string): Promise<void> {
  const { OrderModel } = await import('@/models/schema.ts')
  await OrderModel.findByIdAndUpdate(orderId, { $set: { tamaraCheckoutId, tamaraOrderId } }).exec()
}
