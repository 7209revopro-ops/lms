import { Router, type Request, type Response, type NextFunction } from 'express'
import { authRateLimit, checkoutRateLimit } from '@/middleware/rateLimit.middleware.ts'
import { sendSuccess, sendError } from '@/utils/response.ts'

/* ── /public/checkout — buying a course on the public /explore page with no account (2026-10-18) ──
   services/guestCheckout.service.ts. No session: the checkout is carried by an httpOnly cookie, set on
   prepare and scoped to these routes, that names the account and course — never by the URL. */
const router = Router()
const isProd = () => process.env['NODE_ENV'] === 'production'
const COOKIE_PATH = '/api/v1/public/checkout'

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { await fn(req, res) } catch (err: any) {
      const { GuestCheckoutError } = await import('@/services/guestCheckout.service.ts')
      const { OrderError } = await import('@/services/order.service.ts')
      if (err instanceof GuestCheckoutError || err instanceof OrderError) { sendError(res, err.code, err.message, err.statusCode); return }
      next(err)
    }
  }

const claimsOf = async (req: Request) => {
  const { readGuestToken, GUEST_COOKIE } = await import('@/services/guestCheckout.service.ts')
  return readGuestToken((req as Request & { cookies?: Record<string, string> }).cookies?.[GUEST_COOKIE])
}

/* 1. Who is buying → the payment methods for their country (Tabby / Tamara pre-scored). */
router.post('/prepare', authRateLimit, wrap(async (req, res) => {
  const { prepareGuestCheckout, GUEST_COOKIE, guestCookieMaxAgeMs } = await import('@/services/guestCheckout.service.ts')
  const { token, checkout } = await prepareGuestCheckout(req.body ?? {})
  res.cookie(GUEST_COOKIE, token, { httpOnly: true, secure: isProd(), sameSite: 'lax', path: COOKIE_PATH, maxAge: guestCookieMaxAgeMs })
  sendSuccess(res, checkout)
}))

/* 2. Pay with the chosen method → a gateway page to go to, or Razorpay's own checkout to open. */
router.post('/pay', checkoutRateLimit, wrap(async (req, res) => {
  const { startGuestPayment, GuestCheckoutError } = await import('@/services/guestCheckout.service.ts')
  const { OrderError } = await import('@/services/order.service.ts')
  const claims = await claimsOf(req)
  try {
    sendSuccess(res, await startGuestPayment(claims, req.body?.method, req.body?.couponCode), undefined, 201)
  } catch (err) {
    if (err instanceof GuestCheckoutError || err instanceof OrderError) throw err
    /* The gateway itself failed (down, refused, timed out). Its own text never reaches the buyer — it can
       echo their details — only that it did not start; the full error is logged for us. */
    const { logger } = await import('@/utils/logger.ts')
    logger.error({ err, method: req.body?.method, userId: claims.uid }, 'guest checkout: the gateway did not start')
    sendError(res, 'PAYMENT_UNAVAILABLE', 'The payment provider could not be reached — please try again in a minute, or choose another payment method.', 502)
  }
}))

/* 3. Back from the gateway → paid? Then a new account is signed in; an existing one is emailed a link. */
router.post('/complete', checkoutRateLimit, wrap(async (req, res) => {
  const { completeGuestCheckout } = await import('@/services/guestCheckout.service.ts')
  /* The cookie is kept until it expires (3 h): complete is idempotent, so a reload of the return page
     answers the same instead of "your checkout has expired". */
  sendSuccess(res, await completeGuestCheckout(await claimsOf(req), req.body ?? {}))
}))

router.use((_req, res) => { sendError(res, 'NOT_FOUND', 'Not found', 404) })

export default router
