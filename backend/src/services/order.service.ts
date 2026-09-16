import { Types } from 'mongoose'
import { OrderRepository } from '@/repositories/order.repository.ts'
import { CouponService } from '@/services/coupon.service.ts'
import { StripeService } from '@/services/stripe.service.ts'
import { RazorpayService } from '@/services/razorpay.service.ts'
import { TabbyService } from '@/services/tabby.service.ts'
import { AbzerService } from '@/services/abzer.service.ts'
import { TamaraService } from '@/services/tamara.service.ts'
import { EnrollmentService } from '@/services/enrollment.service.ts'
import { NotificationService } from '@/services/notification.service.ts'
import { sendEnrollmentConfirmation } from '@/services/email.service.ts'
import { CourseModel, UserModel } from '@/models/schema.ts'
import { env } from '@/config/env.ts'
import type { OrderGateway } from '@/models/schema.ts'
import { logger } from '@/utils/logger.ts'

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

  /* ─── Tamara pre-checkout eligibility check ─────────── */
  async checkTamaraEligibility(
    userId:   string,
    courseId: string,
  ): Promise<{ available: boolean; rejectionReason: string | null }> {
    const course = await CourseModel.findById(courseId).select('priceAED price status isFree').exec()
    if (!course || course.status !== 'published' || course.isFree) {
      return { available: false, rejectionReason: null }
    }
    const priceAED = aedPriceFor(course as any)
    const user     = await UserModel.findById(userId).select('phone').exec()
    return this.tamaraSvc.checkEligibility(priceAED, (user as any)?.phone)
  }

  /* ─── Tabby background pre-scoring ──────────────────── */
  async checkTabbyEligibility(
    userId:   string,
    courseId: string,
  ): Promise<{ available: boolean; rejectionReason: string | null }> {
    const course = await CourseModel.findById(courseId).select('priceAED price status isFree').exec()
    if (!course || course.status !== 'published' || course.isFree) {
      return { available: false, rejectionReason: null }
    }
    const priceAED = aedPriceFor(course as any)
    const user     = await UserModel.findById(userId).select('email phone').exec()
    return this.tabbySvc.checkEligibility(priceAED, user?.email ?? '', (user as any)?.phone)
  }

  /* ─── Create Tabby checkout (UAE) ───────────────────── */
  async createTabbyOrder(
    userId:      string,
    courseId:    string,
    slug:        string,
    couponCode?: string,
  ): Promise<{ checkoutUrl: string; checkoutId: string }> {
    if (!env.TABBY_SECRET_KEY || !env.TABBY_MERCHANT_CODE) {
      throw new OrderError('TABBY_NOT_CONFIGURED', 'Tabby is not configured on this server.', 503)
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
        gateway:  'tabby',
        amount:   finalFils,
        currency: env.TABBY_CURRENCY,
        ...(couponId     && { couponId }),
        ...(discountFils && { discountAmount: discountFils }),
      })

      const user = await UserModel.findById(userId).select('name email phone').exec()
      const successUrl = `${env.CLIENT_URL}/payment-return?gateway=tabby&orderId=${order.id}`
      const cancelUrl  = `${env.CLIENT_URL}/payment-return?gateway=tabby&status=cancelled`
      const failureUrl = `${env.CLIENT_URL}/payment-return?gateway=tabby&status=failed&orderId=${order.id}`

      const result = await this.tabbySvc.createCheckout({
        amountAED:   finalAED,
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

      await patchTabbyCheckoutId(order.id, result.checkoutId, result.paymentId)

      return { checkoutUrl: result.checkoutUrl, checkoutId: result.checkoutId }
    })
  }

  /* ─── Tabby webhook fulfillment (idempotent) ─────────── */
  /* tabbyPaymentId  — from webhook payload.id
     ourOrderId      — from webhook payload.order.reference_id (our LMS order ID) */
  async fulfillTabbyFromWebhook(tabbyPaymentId: string, ourOrderId?: string): Promise<void> {
    /* 1. Server-to-server verification: confirm AUTHORIZED status with Tabby */
    /* FAIL CLOSED (P-03). This used to catch a failed lookup, log "proceeding
       without status check" and fall through — and because the guard below was
       written `if (verifiedStatus && …)`, an undefined status skipped it
       entirely. During any Tabby outage or credential rotation, every pending
       order could then be self-fulfilled through verify-return. A payment
       check that cannot run has not passed. */
    let verifiedStatus: string
    try {
      const payment = await this.tabbySvc.getPayment(tabbyPaymentId)
      verifiedStatus = payment.status.toUpperCase()
    } catch (err) {
      logger.error({ err, tabbyPaymentId }, 'Tabby: getPayment failed — refusing to fulfil unverified payment')
      return
    }

    if (verifiedStatus !== 'AUTHORIZED' && verifiedStatus !== 'CLOSED') {
      logger.warn({ tabbyPaymentId, verifiedStatus }, 'Tabby: payment not capturable')
      return
    }

    /* 2. Find order — prefer our orderId (reliable), fallback to tabbyPaymentId field */
    const order = ourOrderId
      ? await this.orderRepo.findById(ourOrderId)
      : await this.orderRepo.findByTabbyPaymentId(tabbyPaymentId)

    if (!order) {
      logger.warn({ tabbyPaymentId, ourOrderId }, 'Tabby webhook: no matching order')
      return
    }
    if (order.status === 'paid') {
      logger.info({ orderId: order.id }, 'Tabby webhook: already fulfilled')
      return
    }

    /* 3. Capture the payment (Tabby requires amount + idempotency key) */
    const amountAED = (order.amount / 100).toFixed(2)
    await this.tabbySvc.capturePayment(tabbyPaymentId, amountAED, order.id)

    /* 4. Fulfill order — conditional flip, the return-URL verify may have raced us */
    const fulfilled = await this.orderRepo.fulfillTabby(order.id, tabbyPaymentId)
    if (!fulfilled) {
      logger.info({ orderId: order.id }, 'Tabby webhook: order fulfilled concurrently, skipping side effects')
      return
    }

    await this._createEnrollment(order.userId.toString(), order.courseId.toString())
    await this._autoApproveViaPayment(order.userId.toString(), order.courseId.toString())
    void this._sendPostPaymentNotifications(order.userId.toString(), order.courseId.toString(), order.id)
    logger.info({ tabbyPaymentId, orderId: order.id }, 'Tabby: order fulfilled')
  }

  /* ─── Tabby return-URL verify + fulfill (webhook fallback) ─── */
  /* paymentId: Tabby appends ?payment_id=... to the success redirect URL */
  async verifyTabbyReturn(userId: string, orderId: string, paymentId?: string): Promise<{ needsRegistration: boolean }> {
    const order = await this.orderRepo.findById(orderId)
    if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found', 404)
    if (order.userId.toString() !== userId) {
      throw new OrderError('FORBIDDEN', 'Order does not belong to you', 403)
    }

    if (order.status !== 'paid') {
      /* Prefer payment_id from redirect URL, fall back to what was stored at checkout creation */
      const tabbyPaymentId = paymentId || ((order as any).tabbyPaymentId as string | undefined)
      if (tabbyPaymentId) {
        await this.fulfillTabbyFromWebhook(tabbyPaymentId, orderId)
      } else {
        logger.warn({ orderId }, 'Tabby verify-return: no payment_id available — awaiting webhook')
      }
    }

    const user = await UserModel.findById(userId).select('signupType').lean()
    const needsRegistration = (user as any)?.signupType === 'express'
    return { needsRegistration }
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

  /* ─── Tamara webhook fulfillment (idempotent) ────────── */
  async fulfillTamaraFromWebhook(tamaraOrderId: string, ourOrderId?: string): Promise<void> {
    /* Tamara sends both order_id (their ID) and order_reference_id (our ID) */
    const order = ourOrderId
      ? await this.orderRepo.findById(ourOrderId)
      : await this.orderRepo.findByTamaraOrderId(tamaraOrderId)

    if (!order) {
      logger.warn({ tamaraOrderId, ourOrderId }, 'Tamara webhook: no matching order')
      return
    }
    if (order.status === 'paid') {
      logger.info({ orderId: order.id }, 'Tamara webhook: already fulfilled')
      return
    }

    /* Authorise with Tamara (approved → authorised) then capture (authorised → fully_captured).

       FULFILMENT IS GATED ON THE AUTHORISE (P-02). Both calls used to be
       fire-and-forget `void`s that logged failures as "(non-fatal)", so the
       order was marked paid whatever Tamara answered — which made
       /checkout/tamara/verify-return a free-course button for the buyer.
       A successful authorise is the point at which funds are committed, so it
       is the honest gate. A failed capture after a successful authorise is a
       settlement problem to chase, not a reason to withhold a course the
       customer has already committed to. */
    const authorised = await this.tamaraSvc.authoriseOrder(tamaraOrderId)
    if (!authorised) {
      logger.warn({ tamaraOrderId, orderId: order.id }, 'Tamara: authorise refused — not fulfilling')
      return
    }

    /* Fetch course details for capture request */
    const course = await CourseModel.findById(order.courseId).select('title priceAED price').lean()
    const amountAED = (order.amount / 100).toFixed(2)
    await this.tamaraSvc.captureOrder({
      tamaraOrderId,
      amountAED,
      courseTitle: (course as any)?.title ?? 'Course',
      courseId:    order.courseId.toString(),
    })

    /* Conditional flip — the return-URL verify may have raced us */
    const fulfilled = await this.orderRepo.fulfillTamara(order.id, tamaraOrderId)
    if (!fulfilled) {
      logger.info({ orderId: order.id }, 'Tamara webhook: order fulfilled concurrently, skipping side effects')
      return
    }

    await this._createEnrollment(order.userId.toString(), order.courseId.toString())
    await this._autoApproveViaPayment(order.userId.toString(), order.courseId.toString())
    void this._sendPostPaymentNotifications(order.userId.toString(), order.courseId.toString(), order.id)
    logger.info({ tamaraOrderId, orderId: order.id }, 'Tamara: order fulfilled via webhook')
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

  /* ─── Tamara return-URL verify + fulfill (called by client after redirect) ── */
  async verifyTamaraReturn(
    userId:  string,
    orderId: string,
  ): Promise<{ needsRegistration: boolean }> {
    const order = await this.orderRepo.findById(orderId)
    if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found', 404)
    if (order.userId.toString() !== userId) {
      throw new OrderError('FORBIDDEN', 'Order does not belong to you', 403)
    }

    if (order.status !== 'paid') {
      const tamaraOrderId = (order as any).tamaraOrderId as string | undefined
      if (tamaraOrderId) {
        await this.fulfillTamaraFromWebhook(tamaraOrderId, orderId)
      } else {
        logger.warn({ orderId }, 'Tamara verify-return: no tamaraOrderId stored — cannot authorise')
      }
    }

    const user = await UserModel.findById(userId).select('signupType').lean()
    const needsRegistration = (user as any)?.signupType === 'express'

    return { needsRegistration }
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
    } else if (order.gateway === 'tabby' || order.gateway === 'abzer' || order.gateway === 'tamara') {
      const label = order.gateway === 'tabby' ? 'Tabby' : order.gateway === 'tamara' ? 'Tamara' : 'Abzer'
      throw new OrderError(
        'MANUAL_REFUND_REQUIRED',
        `${label} refunds must be processed via the gateway dashboard.`,
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
      await enrollRepo.create_({ userId, courseId, source: 'purchase' })
      await courseRepo.incrementEnrollment(courseId, 1)
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
