import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireCheckoutEligibility } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { checkoutRateLimit } from '@/middleware/rateLimit.middleware.ts'
import { OrderService } from '@/services/order.service.ts'
import { TABBY_ID_RE } from '@/services/tabby.service.ts'
import { sendSuccess, sendError } from '@/utils/response.ts'
import { env } from '@/config/env.ts'
import type { Request, Response, NextFunction } from 'express'

const router   = Router()
const orderSvc = new OrderService()

/* ── Stripe ────────────────────────────────────────────── */
const checkoutSchema = z.object({
  courseId:   z.string().min(1),
  couponCode: z.string().trim().optional(),
})

router.post('/', authenticate, checkoutRateLimit, requireCheckoutEligibility, validate(checkoutSchema), async (req: Request, res: Response, next: NextFunction) => {
  if (!env.STRIPE_SECRET_KEY) {
    sendError(res, 'STRIPE_NOT_CONFIGURED', 'Payments are not configured on this server.', 503)
    return
  }
  try {
    const { courseId, couponCode } = req.body as { courseId: string; couponCode?: string }
    const result = await orderSvc.createCheckoutSession(req.user!.id, courseId, couponCode)
    sendSuccess(res, result, 'Checkout session created', 201)
  } catch (err) { next(err) }
})

/* ── Razorpay — create order ────────────────────────────── */
const razorpayCreateSchema = z.object({
  courseId:   z.string().min(1),
  couponCode: z.string().trim().optional(),
})

router.post('/razorpay/create-order', authenticate, checkoutRateLimit, requireCheckoutEligibility, validate(razorpayCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    sendError(res, 'RAZORPAY_NOT_CONFIGURED', 'Razorpay is not configured on this server.', 503)
    return
  }
  try {
    const { courseId, couponCode } = req.body as { courseId: string; couponCode?: string }
    const result = await orderSvc.createRazorpayOrder(req.user!.id, courseId, couponCode)
    sendSuccess(res, result, 'Razorpay order created', 201)
  } catch (err) { next(err) }
})

/* ── Razorpay — verify signature + enroll ───────────────── */
const razorpayVerifySchema = z.object({
  razorpayOrderId:   z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
})

router.post('/razorpay/verify', authenticate, validate(razorpayVerifySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
      razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string
    }
    const result = await orderSvc.verifyAndFulfillRazorpay(
      razorpayOrderId, razorpayPaymentId, razorpaySignature, req.user!.id,
    )
    sendSuccess(res, result, 'Payment verified and enrollment created')
  } catch (err) { next(err) }
})

/* ── Gateway config — which gateways are available for this user ── */
router.get('/config', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await orderSvc.getGatewayConfig(req.user!.id)
    sendSuccess(res, config)
  } catch (err) { next(err) }
})

/* ── Tabby — background pre-scoring (eligibility check) ─── */
const tabbyPrescoreSchema = z.object({
  courseId: z.string().min(1),
})

router.post('/tabby/prescore', authenticate, checkoutRateLimit, requireCheckoutEligibility, validate(tabbyPrescoreSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { courseId } = req.body as { courseId: string }
    const result = await orderSvc.checkTabbyEligibility(req.user!.id, courseId)
    sendSuccess(res, result)
  } catch (err) { next(err) }
})

/* ── Tabby — create checkout (UAE) ──────────────────────── */
const tabbyCreateSchema = z.object({
  courseId:   z.string().min(1),
  slug:       z.string().min(1),
  couponCode: z.string().trim().optional(),
})

router.post('/tabby/create-order', authenticate, checkoutRateLimit, requireCheckoutEligibility, validate(tabbyCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { courseId, slug, couponCode } = req.body as { courseId: string; slug: string; couponCode?: string }
    const result = await orderSvc.createTabbyOrder(req.user!.id, courseId, slug, couponCode)
    sendSuccess(res, result, 'Tabby checkout created', 201)
  } catch (err) { next(err) }
})

/* ── Tabby — verify return URL + fulfill (webhook fallback) ─ */
/* payment_id is forwarded by the student's BROWSER from Tabby's redirect, so it
   is attacker-controlled. It ends up in the path of a request we authenticate
   with the secret key; anything that is not a Tabby UUID is refused here and
   again in the service. */
const tabbyVerifyReturnSchema = z.object({
  orderId:   z.string().min(1),
  paymentId: z.string().regex(TABBY_ID_RE, 'paymentId must be a Tabby payment id').optional(),
})

router.post('/tabby/verify-return', authenticate, validate(tabbyVerifyReturnSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId, paymentId } = req.body as { orderId: string; paymentId?: string }
    const result = await orderSvc.verifyTabbyReturn(req.user!.id, orderId, paymentId)
    sendSuccess(res, result)
  } catch (err) { next(err) }
})

/* ── Abzer — create checkout (UAE) ──────────────────────── */
const abzerCreateSchema = z.object({
  courseId:   z.string().min(1),
  slug:       z.string().min(1),
  couponCode: z.string().trim().optional(),
})

router.post('/abzer/create-order', authenticate, checkoutRateLimit, requireCheckoutEligibility, validate(abzerCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { courseId, slug, couponCode } = req.body as { courseId: string; slug: string; couponCode?: string }
    const result = await orderSvc.createAbzerOrder(req.user!.id, courseId, slug, couponCode)
    sendSuccess(res, result, 'Abzer checkout created', 201)
  } catch (err) { next(err) }
})

/* ── Abzer — verify return URL + fulfill (webhook fallback) ─ */
/* Called by the client payment-return page after BillxPro redirects back.
   Ensures the order is fulfilled even when the sandbox webhook doesn't fire.
   Returns needsRegistration so the client can redirect express users. */
const abzerVerifyReturnSchema = z.object({
  orderId:       z.string().min(1),
  transactionId: z.string().optional(),
})

router.post('/abzer/verify-return', authenticate, validate(abzerVerifyReturnSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId, transactionId } = req.body as { orderId: string; transactionId?: string }
    const result = await orderSvc.verifyAbzerReturn(req.user!.id, orderId, transactionId ?? '')
    sendSuccess(res, result)
  } catch (err) { next(err) }
})

/* ── Tamara — pre-checkout eligibility check ─────────── */
const tamaraPrescoreSchema = z.object({ courseId: z.string().min(1) })

router.post('/tamara/prescore', authenticate, checkoutRateLimit, requireCheckoutEligibility, validate(tamaraPrescoreSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { courseId } = req.body as { courseId: string }
    const result = await orderSvc.checkTamaraEligibility(req.user!.id, courseId)
    sendSuccess(res, result)
  } catch (err) { next(err) }
})

/* ── Tamara — create checkout (UAE BNPL) ─────────────── */
const tamaraCreateSchema = z.object({
  courseId:   z.string().min(1),
  slug:       z.string().min(1),
  couponCode: z.string().trim().optional(),
})

router.post('/tamara/create-order', authenticate, checkoutRateLimit, requireCheckoutEligibility, validate(tamaraCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  if (!env.TAMARA_API_KEY) {
    sendError(res, 'TAMARA_NOT_CONFIGURED', 'Tamara is not configured on this server.', 503)
    return
  }
  try {
    const { courseId, slug, couponCode } = req.body as { courseId: string; slug: string; couponCode?: string }
    const result = await orderSvc.createTamaraOrder(req.user!.id, courseId, slug, couponCode)
    sendSuccess(res, result, 'Tamara checkout created', 201)
  } catch (err) { next(err) }
})

/* ── Tamara — verify return + fulfill (webhook fallback) ─ */
const tamaraVerifyReturnSchema = z.object({
  orderId: z.string().min(1),
})

router.post('/tamara/verify-return', authenticate, validate(tamaraVerifyReturnSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.body as { orderId: string }
    const result = await orderSvc.verifyTamaraReturn(req.user!.id, orderId)
    sendSuccess(res, result)
  } catch (err) { next(err) }
})

export default router
