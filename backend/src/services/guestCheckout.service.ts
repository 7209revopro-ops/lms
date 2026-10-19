/* ─────────────────────────────────────────────────────────────
   Guest checkout — buying a course on the public /explore page with no
   account (the user, 2026-10-18: "direct buying … it will create account
   after buy").

     1. prepare  — name, email, phone, country. The account is found by email
                   or made (a student, no password, pending until paid). The
                   payment methods for the buyer's country are worked out, with
                   Tabby's and Tamara's background pre-scoring done here, as
                   their QA requires, before a button is shown. An httpOnly
                   checkout cookie ties the rest to this account and course.
     2. pay      — the chosen method, through the SAME gateway code the
                   student app uses (order.service.ts); only the return page
                   differs (/explore/checkout/return, public).
     3. complete — after the gateway: the same verify as the app. Once paid:
                   a NEW account is signed in with a one-time sign-in link
                   (/s/<code>, the course's page) and emailed a set-password
                   link; an account that ALREADY existed is never signed in
                   from here — its owner is emailed a sign-in link, so typing
                   someone's email can buy them a course but never open their
                   account.

   Countries: India → Razorpay (INR). UAE → Card (Abzer/BillXPro), Tabby,
   Tamara (AED). Anywhere else → Card (Abzer, AED). Free courses do not come
   here — /explore sends them through the ordinary sign-up.
───────────────────────────────────────────────────────────── */
import { SignJWT, jwtVerify } from 'jose'
import { createHash, randomBytes } from 'node:crypto'
import { Types } from 'mongoose'
import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'
import { OrderService, OrderError, aedPriceFor, inrPriceFor } from '@/services/order.service.ts'

export const GUEST_COOKIE = 'lms_gc'
const TTL_S = 3 * 3600
const AUD = 'guest-checkout'
const key = () => new TextEncoder().encode(`${env.JWT_ACCESS_SECRET}:guest-checkout`)
const orders = new OrderService()

export class GuestCheckoutError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) { super(message) }
}

export type GuestMethod = 'card' | 'tabby' | 'tamara' | 'razorpay'
export interface GuestClaims { uid: string; cid: string; nw: boolean }

export async function signGuestToken(c: GuestClaims): Promise<string> {
  return new SignJWT({ cid: c.cid, nw: c.nw }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.uid).setAudience(AUD).setIssuedAt().setExpirationTime(`${TTL_S}s`).sign(key())
}
export async function readGuestToken(raw: unknown): Promise<GuestClaims> {
  if (typeof raw !== 'string' || !raw) throw new GuestCheckoutError('CHECKOUT_EXPIRED', 'Your checkout has expired — please start again.', 401)
  try {
    const { payload } = await jwtVerify(raw, key(), { audience: AUD })
    if (!payload.sub || typeof payload['cid'] !== 'string') throw new Error('claims')
    return { uid: payload.sub, cid: payload['cid'] as string, nw: payload['nw'] === true }
  } catch {
    throw new GuestCheckoutError('CHECKOUT_EXPIRED', 'Your checkout has expired — please start again.', 401)
  }
}
export const guestCookieMaxAgeMs = TTL_S * 1000

const UAE = 'United Arab Emirates'
const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)

/* ── 1. prepare ─────────────────────────────────────────── */
export async function prepareGuestCheckout(input: { slug?: unknown; name?: unknown; email?: unknown; phone?: unknown; country?: unknown }) {
  const { CourseModel, UserModel, EnrollmentModel, OrganizationModel } = await import('@/models/schema.ts')
  const name = clean(input.name, 120), email = clean(input.email, 200).toLowerCase()
  const phone = clean(input.phone, 30), country = clean(input.country, 80)
  if (name.length < 2) throw new GuestCheckoutError('INVALID_NAME', 'Please enter your full name')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new GuestCheckoutError('INVALID_EMAIL', 'Please enter a valid email address')
  if (phone.replace(/\D/g, '').length < 8) throw new GuestCheckoutError('INVALID_PHONE', 'Please enter your phone number with the country code')
  if (country.length < 2) throw new GuestCheckoutError('INVALID_COUNTRY', 'Please choose your country')

  const slug = clean(input.slug, 200).toLowerCase()
  const course: any = slug ? await CourseModel.findOne({ slug, status: 'published' }).select('title slug price priceAED priceINR isFree program').lean() : null
  if (!course) throw new GuestCheckoutError('COURSE_NOT_FOUND', 'This course is not available', 404)
  if (course.isFree || !(course.price > 0)) throw new GuestCheckoutError('COURSE_IS_FREE', 'This course is free — create an account to enrol', 400)

  /* The account: the one with this email, or a new one. Staff addresses are never used for a purchase. */
  let user: any = await UserModel.findOne({ email }).select('role isActive enrollmentApplication phone').lean()
  let created = false
  if (user) {
    if (user.role !== 'student') throw new GuestCheckoutError('EMAIL_NOT_STUDENT', 'This email belongs to a staff account — please use another email', 409)
    if (user.isActive === false) throw new GuestCheckoutError('ACCOUNT_DISABLED', 'This account is disabled — please contact Delta support', 403)
    if (await EnrollmentModel.exists({ userId: user._id, courseId: course._id })) {
      throw new GuestCheckoutError('ALREADY_ENROLLED', 'You already have this course — sign in to open it', 409)
    }
    /* Fill only what the account lacks; never overwrite what its owner set. */
    const set: Record<string, unknown> = {}
    if (!user.enrollmentApplication?.homeCountry) set['enrollmentApplication.homeCountry'] = country
    if (!user.enrollmentApplication?.phone && !user.phone) set['enrollmentApplication.phone'] = phone
    if (Object.keys(set).length) await UserModel.updateOne({ _id: user._id }, { $set: set })
  } else {
    const org: any = await OrganizationModel.findOne({ slug: country === 'India' ? 'bangalore' : 'dubai' }).select('_id').lean()
    try {
      /* The document's own _id — toObject() here hides _id behind `id` (baseSchemaOptions). */
      const doc = await UserModel.create({
        name, email, role: 'student', isActive: true,
        ...(org ? { organizationId: org._id } : {}),
        phone,
        enrollmentApplication: { phone, homeCountry: country },
      })
      user = { _id: doc._id, role: 'student' }
      created = true
      logger.info({ userId: String(user._id), course: course.slug }, 'guest checkout: account made')
    } catch (err: any) {
      /* Two tabs racing on the same new email: the second finds the first's. */
      if (err?.code !== 11000) throw err
      user = await UserModel.findOne({ email }).select('role isActive enrollmentApplication phone').lean()
      if (!user || user.role !== 'student') throw err
    }
  }
  const uid = String(user._id), cid = String(course._id)
  /* The country decides the methods; an existing account's own country wins if it has one. */
  const fresh: any = await UserModel.findById(uid).select('enrollmentApplication.homeCountry').lean()
  const home = String(fresh?.enrollmentApplication?.homeCountry || country)

  const methods: Array<{ id: GuestMethod; available: boolean; message?: string | null }> = []
  let currency: 'AED' | 'INR'
  if (home === 'India') {
    currency = 'INR'
    if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) methods.push({ id: 'razorpay', available: true })
  } else {
    currency = 'AED'
    if (env.ABZER_ACCESS_KEY && env.ABZER_SECRET_KEY) methods.push({ id: 'card', available: true })
    if (home === UAE && env.TABBY_SECRET_KEY && env.TABBY_MERCHANT_CODE) {
      const t = await orders.checkTabbyEligibility(uid, cid).catch(() => null)
      if (t) methods.push({ id: 'tabby', available: t.available, message: t.message })
    }
    if (home === UAE && env.TAMARA_API_KEY) {
      const t = await orders.checkTamaraEligibility(uid, cid).catch(() => null)
      if (t) methods.push({ id: 'tamara', available: t.available, message: t.message })
    }
  }
  const amount = currency === 'INR' ? inrPriceFor(course) : aedPriceFor(course)
  return {
    token: await signGuestToken({ uid, cid, nw: created }),
    checkout: { course: { title: course.title, slug: course.slug }, amount, currency, methods },
  }
}

/* ── 2. pay ─────────────────────────────────────────────── */
export async function startGuestPayment(claims: GuestClaims, method: unknown, couponCode?: unknown) {
  const { CourseModel } = await import('@/models/schema.ts')
  const course: any = await CourseModel.findById(claims.cid).select('slug').lean()
  if (!course) throw new GuestCheckoutError('COURSE_NOT_FOUND', 'This course is not available', 404)
  const coupon = typeof couponCode === 'string' && couponCode.trim() ? couponCode.trim().slice(0, 64) : undefined
  switch (method) {
    case 'card': {
      const r = await orders.createAbzerOrder(claims.uid, claims.cid, course.slug, coupon, { guest: true })
      return { kind: 'redirect' as const, url: r.checkoutUrl, orderId: r.orderId }
    }
    case 'tabby': {
      const r = await orders.createTabbyOrder(claims.uid, claims.cid, course.slug, coupon, { guest: true })
      return { kind: 'redirect' as const, url: r.checkoutUrl, orderId: r.orderId }
    }
    case 'tamara': {
      const r = await orders.createTamaraOrder(claims.uid, claims.cid, course.slug, coupon, { guest: true })
      return { kind: 'redirect' as const, url: r.checkoutUrl, orderId: r.orderId }
    }
    case 'razorpay': {
      const r = await orders.createRazorpayOrder(claims.uid, claims.cid, coupon)
      return { kind: 'razorpay' as const, razorpay: r }
    }
    default:
      throw new GuestCheckoutError('INVALID_METHOD', 'Choose a payment method')
  }
}

/* ── 3. complete ────────────────────────────────────────── */
export async function completeGuestCheckout(claims: GuestClaims, input: {
  gateway?: unknown; orderId?: unknown; paymentId?: unknown
  razorpayOrderId?: unknown; razorpayPaymentId?: unknown; razorpaySignature?: unknown
}) {
  const { OrderModel, CourseModel, UserModel } = await import('@/models/schema.ts')
  let orderId = typeof input.orderId === 'string' ? input.orderId : ''

  switch (input.gateway) {
    case 'razorpay': {
      const r = await orders.verifyAndFulfillRazorpay(
        String(input.razorpayOrderId ?? ''), String(input.razorpayPaymentId ?? ''), String(input.razorpaySignature ?? ''), claims.uid)
      orderId = r.orderId
      break
    }
    case 'tabby':  await orders.verifyTabbyReturn(claims.uid, orderId, typeof input.paymentId === 'string' ? input.paymentId : undefined); break
    case 'tamara': await orders.verifyTamaraReturn(claims.uid, orderId); break
    case 'abzer':  await orders.verifyAbzerReturn(claims.uid, orderId, ''); break
    default: throw new GuestCheckoutError('INVALID_METHOD', 'Unknown payment method')
  }
  if (!Types.ObjectId.isValid(orderId)) throw new GuestCheckoutError('ORDER_NOT_FOUND', 'Order not found', 404)
  const order: any = await OrderModel.findById(orderId).select('userId courseId status').lean()
  /* The order must be this checkout's — its account and course. */
  if (!order || String(order.userId) !== claims.uid || String(order.courseId) !== claims.cid) {
    throw new GuestCheckoutError('ORDER_NOT_FOUND', 'Order not found', 404)
  }
  if (order.status !== 'paid') return { paid: false as const }

  const [course, user]: any[] = await Promise.all([
    CourseModel.findById(claims.cid).select('title slug').lean(),
    UserModel.findById(claims.uid).select('name email').lean(),
  ])
  const coursePath = `/courses/${course?.slug ?? ''}`
  /* The access email goes once per order, however often the return page is reloaded. */
  const firstTime = (await OrderModel.updateOne({ _id: order._id, guestAccessSentAt: { $exists: false } }, { $set: { guestAccessSentAt: new Date() } })).modifiedCount === 1
  const { mintSigninCode } = await import('@/services/signinLink.service.ts')
  const { sendGuestPurchaseAccess } = await import('@/services/email.service.ts')
  const clientUrl = env.CLIENT_URL.replace(/\/+$/, '')

  if (claims.nw) {
    /* The account was made in THIS checkout and is paid for: sign the buyer in now, and email a way to set a password. */
    const code = await mintSigninCode(claims.uid, coursePath)
    if (firstTime) {
      const emailCode = await mintSigninCode(claims.uid, coursePath)
      const setPassword = await mintSetPasswordLink(claims.uid)
      void sendGuestPurchaseAccess(user.email, user.name, course?.title ?? 'your course', {
        signInUrl: `${clientUrl}/s/${emailCode}`, setPasswordUrl: `${clientUrl}/reset-password?token=${setPassword}`, newAccount: true,
      }).catch(err => logger.warn({ err, userId: claims.uid }, 'guest checkout: access email failed'))
    }
    return { paid: true as const, signIn: `/s/${code}`, emailed: true }
  }
  /* An account that existed before: never signed in from here — its owner gets the link by email. */
  if (firstTime) {
    const code = await mintSigninCode(claims.uid, coursePath)
    await sendGuestPurchaseAccess(user.email, user.name, course?.title ?? 'your course', {
      signInUrl: `${clientUrl}/s/${code}`, newAccount: false,
    }).catch(err => logger.warn({ err, userId: claims.uid }, 'guest checkout: access email failed'))
  }
  return { paid: true as const, signIn: null, emailed: true }
}

/* A 7-day set-password link, the reset-password flow's own token (as imported students get). */
async function mintSetPasswordLink(userId: string): Promise<string> {
  const { AuthTokenModel } = await import('@/models/schema.ts')
  const raw = randomBytes(32).toString('hex')
  await AuthTokenModel.create({
    userId: new Types.ObjectId(userId), tokenHash: createHash('sha256').update(raw).digest('hex'),
    purpose: 'reset-password', expiresAt: new Date(Date.now() + 7 * 86_400_000),
  })
  return raw
}

export { OrderError }
